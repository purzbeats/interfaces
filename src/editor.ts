import * as THREE from 'three';
import { SeededRandom } from './random';
import { createRegion, type Region } from './layout/region';
import { createElement } from './elements/registry';
import { getPalette, type Palette } from './color/palettes';
import { type BaseElement } from './elements/base-element';
import { resizeRenderer, type RendererContext } from './renderer/setup';
import { type PostFXPipeline } from './postfx/pipeline';
import { type Config, computeAspectSize } from './config';
import { showToast } from './gui/toast';
import {
  type EditorRegion,
  type EditorLayout,
  toRegion,
  snapToGrid,
  clampRegion,
  regionsOverlap,
  captureCurrentLayout,
  defaultRegionSize,
  createBlankLayout,
  nextRegionId,
} from './editor/editor-layout';
import { EditorOverlay, EDITOR_TOOLBAR_H, EDITOR_PANEL_H } from './editor/editor-overlay';
import {
  saveEditorLayouts,
  loadEditorLayouts,
  exportLayoutJSON,
  importLayoutJSON,
  downloadJSON,
  pickJSONFile,
} from './editor/editor-persistence';
import { ThumbnailGenerator } from './editor/thumbnail-generator';
import { elementTypes } from './elements/registry';
import { TOOLBAR_HEIGHT } from './gui/mobile-toolbar';

/* ---------- Internal types ---------- */

/** What kind of drag operation is active. */
type ActiveDrag =
  | { kind: 'palette'; elementType: string; startClientX: number; startClientY: number; isDragging: boolean }
  | { kind: 'move'; regionId: string; startNX: number; startNY: number; startRegionX: number; startRegionY: number; lastX: number; lastY: number }
  | { kind: 'resize'; regionId: string; handle: string; startRegion: EditorRegion; startClientX: number; startClientY: number; lastRegion: EditorRegion };

/** Deferred drag for touch — waits for movement threshold before committing. */
interface PendingTouchDrag {
  intent: ActiveDrag;
  pointerId: number;
  startX: number;
  startY: number;
}

/* ---------- Undo system ---------- */

interface UndoSnapshot {
  regions: EditorRegion[];
  selectedId: string | null;
}

const MAX_UNDO = 50;

/* ---------- EditorMode class ---------- */

export class EditorMode {
  private ctx: RendererContext;
  private pipeline: PostFXPipeline;
  private config: Config;
  private onExit: () => void;
  private isMobileCheck: () => boolean;

  private active: boolean = false;
  private subMode: 'edit' | 'perform' = 'edit';
  private layout!: EditorLayout;
  private elements: Map<string, BaseElement> = new Map();
  private wrappers: Map<string, THREE.Group> = new Map();
  private selectedRegionId: string | null = null;
  private activeDrag: ActiveDrag | null = null;
  private pendingTouch: PendingTouchDrag | null = null;
  private palette!: Palette;
  private elapsed: number = 0;
  private stashedChildren: THREE.Object3D[] = [];
  private overlay: EditorOverlay;
  private snapEnabled: boolean = true;

  // Undo/redo
  private undoStack: UndoSnapshot[] = [];
  private redoStack: UndoSnapshot[] = [];

  // Thumbnail generator
  private thumbGen: ThumbnailGenerator | null = null;

  /**
   * Full-screen transparent div that captures ALL pointer events during a drag.
   */
  private dragCapture: HTMLDivElement;

  // Bound event handlers
  private keyHandler: (e: KeyboardEvent) => void;
  private resizeHandler: () => void;

  constructor(
    ctx: RendererContext,
    pipeline: PostFXPipeline,
    config: Config,
    onExit: () => void,
    isMobile: () => boolean,
  ) {
    this.ctx = ctx;
    this.pipeline = pipeline;
    this.config = config;
    this.onExit = onExit;
    this.isMobileCheck = isMobile;

    // Bind event handlers
    this.keyHandler = (e) => this.handleKey(e);
    this.resizeHandler = () => this.handleResize();

    // Create drag-capture overlay
    this.dragCapture = document.createElement('div');
    this.dragCapture.id = 'editor-drag-capture';
    Object.assign(this.dragCapture.style, {
      position: 'fixed',
      top: '0',
      left: '0',
      right: '0',
      bottom: '0',
      zIndex: '9999',
      cursor: 'default',
      display: 'none',
      touchAction: 'none',
    });
    this.dragCapture.addEventListener('pointermove', (e) => this.onDragMove(e));
    this.dragCapture.addEventListener('pointerup', (e) => this.onDragEnd(e));
    this.dragCapture.addEventListener('pointercancel', () => this.cancelDrag());
    document.body.appendChild(this.dragCapture);

    // Create overlay
    this.overlay = new EditorOverlay({
      onNewLayout: () => this.newLayout(),
      onSaveLayout: () => this.saveLayout(),
      onLoadLayout: () => this.loadLayoutDialog(),
      onExportLayout: () => this.exportLayout(),
      onImportLayout: () => this.importLayout(),
      onClearLayout: () => this.clearLayout(),
      onTogglePerform: () => this.togglePerform(),
      onExitEditor: () => this.exit(),
      onPaletteElementClick: (type) => this.placeElementAtCenter(type),
      onDuplicate: () => this.duplicateSelected(),
      onDelete: () => this.deleteSelected(),
      onUndo: () => this.undo(),
      onRedo: () => this.redo(),
      onBringToFront: () => this.bringToFront(),
      onSendToBack: () => this.sendToBack(),
      onToggleGrid: () => this.toggleGrid(),
      onSwapType: (newType) => this.swapSelectedType(newType),
      onUpdateRegion: (x, y, w, h) => this.updateSelectedRegion(x, y, w, h),
      onRenameLayout: (name) => this.renameLayout(name),
      onChangePalette: (pal) => this.changePalette(pal),
      onPanelResize: () => this.handleResize(),
    });
  }

  get isActive(): boolean {
    return this.active;
  }

  /* ============================================
   *  UNDO / REDO
   * ============================================ */

  private pushUndo(): void {
    this.undoStack.push({
      regions: this.layout.regions.map(r => ({ ...r })),
      selectedId: this.selectedRegionId,
    });
    if (this.undoStack.length > MAX_UNDO) {
      this.undoStack.shift();
    }
    // Clear redo stack on new action
    this.redoStack = [];
  }

  private undo(): void {
    if (this.undoStack.length === 0) return;

    // Save current state to redo
    this.redoStack.push({
      regions: this.layout.regions.map(r => ({ ...r })),
      selectedId: this.selectedRegionId,
    });

    const snap = this.undoStack.pop()!;
    this.applySnapshot(snap);
    showToast('Undo');
  }

  private redo(): void {
    if (this.redoStack.length === 0) return;

    // Save current state to undo
    this.undoStack.push({
      regions: this.layout.regions.map(r => ({ ...r })),
      selectedId: this.selectedRegionId,
    });

    const snap = this.redoStack.pop()!;
    this.applySnapshot(snap);
    showToast('Redo');
  }

  private applySnapshot(snap: UndoSnapshot): void {
    // Dispose all current elements
    this.disposeAllElements();

    // Restore regions
    this.layout.regions = snap.regions.map(r => ({ ...r }));
    this.layout.modified = Date.now();

    // Respawn all elements
    this.spawnAllElements();

    // Restore selection
    this.selectedRegionId = snap.selectedId;
    if (this.selectedRegionId) {
      const region = this.layout.regions.find(r => r.id === this.selectedRegionId);
      if (region) {
        this.showSelectionHandles();
        this.overlay.showProperties(region);
      } else {
        this.selectedRegionId = null;
        this.overlay.clearHandles();
        this.overlay.hideProperties();
      }
    } else {
      this.overlay.clearHandles();
      this.overlay.hideProperties();
    }

    this.updateStatus();
  }

  /* ============================================
   *  DRAG CAPTURE
   * ============================================ */

  private beginDrag(drag: ActiveDrag, e: PointerEvent): void {
    // On touch, defer drag until movement threshold is met
    if (e.pointerType === 'touch') {
      this.pendingTouch = {
        intent: drag,
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
      };
      // Show the drag capture to receive move/up events
      this.dragCapture.style.display = '';
      this.dragCapture.setPointerCapture(e.pointerId);
      return;
    }
    this.commitDrag(drag, e.pointerId);
  }

  private commitDrag(drag: ActiveDrag, pointerId?: number): void {
    this.pendingTouch = null;
    this.activeDrag = drag;
    if (pointerId != null && !this.dragCapture.hasPointerCapture(pointerId)) {
      this.dragCapture.style.display = '';
      this.dragCapture.setPointerCapture(pointerId);
    }
    this.overlay.setDragTranslucent(true);
  }

  private cancelDrag(): void {
    if (this.pendingTouch) {
      this.pendingTouch = null;
      this.dragCapture.style.display = 'none';
      return;
    }
    if (!this.activeDrag) return;

    if (this.activeDrag.kind === 'move') {
      const wrapper = this.wrappers.get(this.activeDrag.regionId);
      if (wrapper) wrapper.position.set(0, 0, 0);
    }

    this.activeDrag = null;
    this.dragCapture.style.display = 'none';
    this.overlay.hideGhostRect();
    this.overlay.setDragTranslucent(false);
  }

  private static readonly TOUCH_DRAG_THRESHOLD = 12;

  private onDragMove(e: PointerEvent): void {
    // Handle pending touch — check threshold before committing
    if (this.pendingTouch) {
      const dx = e.clientX - this.pendingTouch.startX;
      const dy = e.clientY - this.pendingTouch.startY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < EditorMode.TOUCH_DRAG_THRESHOLD) return; // not enough movement yet

      // For palette drags, if horizontal motion dominates, cancel — let browser scroll
      if (this.pendingTouch.intent.kind === 'palette' && Math.abs(dx) > Math.abs(dy)) {
        this.cancelDrag();
        return;
      }

      // Commit the drag
      this.commitDrag(this.pendingTouch.intent, this.pendingTouch.pointerId);
    }

    if (!this.activeDrag) return;
    const canvasRect = this.ctx.renderer.domElement.getBoundingClientRect();

    switch (this.activeDrag.kind) {
      case 'palette': {
        const drag = this.activeDrag;
        const dx = Math.abs(e.clientX - drag.startClientX);
        const dy = Math.abs(e.clientY - drag.startClientY);
        if (!drag.isDragging && (dx > 5 || dy > 5)) {
          drag.isDragging = true;
          this.dragCapture.style.cursor = 'copy';
        }
        if (drag.isDragging) {
          const nx = (e.clientX - canvasRect.left) / canvasRect.width;
          const ny = 1 - (e.clientY - canvasRect.top) / canvasRect.height;
          const { w, h } = defaultRegionSize(drag.elementType);
          const gx = this.snapEnabled ? snapToGrid(nx - w / 2) : nx - w / 2;
          const gy = this.snapEnabled ? snapToGrid(ny - h / 2) : ny - h / 2;
          this.overlay.showGhostRect(canvasRect, gx, gy, w, h);
        }
        break;
      }

      case 'move': {
        const drag = this.activeDrag;
        const nx = (e.clientX - canvasRect.left) / canvasRect.width;
        const ny = 1 - (e.clientY - canvasRect.top) / canvasRect.height;
        const ddx = nx - drag.startNX;
        const ddy = ny - drag.startNY;

        let newX = drag.startRegionX + ddx;
        let newY = drag.startRegionY + ddy;
        if (this.snapEnabled) {
          newX = snapToGrid(newX);
          newY = snapToGrid(newY);
        }
        drag.lastX = newX;
        drag.lastY = newY;

        const region = this.layout.regions.find(r => r.id === drag.regionId);
        if (!region) break;

        const wrapper = this.wrappers.get(drag.regionId);
        if (wrapper) {
          const pxDx = (newX - region.x) * this.config.width;
          const pxDy = (newY - region.y) * this.config.height;
          wrapper.position.set(pxDx, pxDy, 0);
        }

        this.overlay.showGhostRect(canvasRect, newX, newY, region.width, region.height);
        break;
      }

      case 'resize': {
        const drag = this.activeDrag;
        const { handle, startRegion, startClientX, startClientY } = drag;

        const dx = (e.clientX - startClientX) / canvasRect.width;
        const dy = -(e.clientY - startClientY) / canvasRect.height;

        let { x, y, width, height } = startRegion;

        if (handle.includes('e')) { width += dx; }
        if (handle.includes('w')) { x += dx; width -= dx; }
        if (handle.includes('n')) { y += dy; height += dy; }
        if (handle.includes('s')) { height -= dy; y += dy; }

        if (this.snapEnabled) {
          x = snapToGrid(x);
          y = snapToGrid(y);
          width = snapToGrid(width);
          height = snapToGrid(height);
        }

        const clamped = clampRegion({ ...startRegion, x, y, width, height });
        drag.lastRegion = clamped;

        this.overlay.showGhostRect(canvasRect, clamped.x, clamped.y, clamped.width, clamped.height);
        break;
      }
    }
  }

  private onDragEnd(e: PointerEvent): void {
    // If touch never exceeded threshold, treat as tap
    if (this.pendingTouch) {
      const intent = this.pendingTouch.intent;
      this.pendingTouch = null;
      this.dragCapture.style.display = 'none';
      // Palette tap → place at center; handle/outline tap → select
      if (intent.kind === 'palette') {
        this.placeElementAtCenter(intent.elementType);
      } else if (intent.kind === 'move') {
        // Already selected from handleOverlayPointerDown
      }
      return;
    }
    if (!this.activeDrag) return;
    const canvasRect = this.ctx.renderer.domElement.getBoundingClientRect();

    switch (this.activeDrag.kind) {
      case 'palette': {
        const drag = this.activeDrag;
        if (drag.isDragging) {
          const nx = (e.clientX - canvasRect.left) / canvasRect.width;
          const ny = 1 - (e.clientY - canvasRect.top) / canvasRect.height;
          // Allow placement anywhere — clampRegion will keep it within bounds
          this.placeElementAt(drag.elementType, Math.max(0, Math.min(1, nx)), Math.max(0, Math.min(1, ny)));
        } else {
          this.placeElementAtCenter(drag.elementType);
        }
        break;
      }

      case 'move': {
        const drag = this.activeDrag;
        const region = this.layout.regions.find(r => r.id === drag.regionId);
        if (region) {
          this.pushUndo();
          const clamped = clampRegion({ ...region, x: drag.lastX, y: drag.lastY });
          region.x = clamped.x;
          region.y = clamped.y;
          this.layout.modified = Date.now();
          this.recreateElement(region.id);
          this.showSelectionHandles();
          this.overlay.showProperties(region);
          this.updateStatus();
        }
        break;
      }

      case 'resize': {
        const drag = this.activeDrag;
        const region = this.layout.regions.find(r => r.id === drag.regionId);
        if (region) {
          this.pushUndo();
          region.x = drag.lastRegion.x;
          region.y = drag.lastRegion.y;
          region.width = drag.lastRegion.width;
          region.height = drag.lastRegion.height;
          this.layout.modified = Date.now();
          this.recreateElement(region.id);
          this.showSelectionHandles();
          this.overlay.showProperties(region);
          this.updateStatus();
        }
        break;
      }
    }

    this.activeDrag = null;
    this.dragCapture.style.display = 'none';
    this.dragCapture.style.cursor = 'default';
    this.overlay.hideGhostRect();
    this.overlay.setDragTranslucent(false);
  }

  /* ============================================
   *  ENTRY / EXIT
   * ============================================ */

  promptEntry(
    currentRegions?: Region[],
    currentElementTypeMap?: Map<string, string>,
    currentPalette?: string,
  ): void {
    const saved = loadEditorLayouts();
    const hasSaved = !!saved && saved.layouts.length > 0;

    this.overlay.showEntryPrompt(hasSaved, (choice) => {
      switch (choice) {
        case 'current':
          if (currentRegions && currentElementTypeMap && currentPalette) {
            const layout = captureCurrentLayout(currentRegions, currentElementTypeMap, currentPalette);
            this.enter(layout);
          } else {
            this.enter(createBlankLayout(this.config.palette));
          }
          break;
        case 'blank':
          this.enter(createBlankLayout(this.config.palette));
          break;
        case 'load':
          if (saved && saved.layouts.length > 0) {
            this.overlay.showLoadDialog(saved.layouts, (index) => {
              this.enter(saved.layouts[index]);
            });
          }
          break;
      }
    });
  }

  private enter(layout: EditorLayout): void {
    this.active = true;
    this.subMode = 'edit';
    this.elapsed = 0;
    this.layout = layout;
    this.selectedRegionId = null;
    this.activeDrag = null;
    this.undoStack = [];
    this.redoStack = [];

    // Stash scene children
    this.stashedChildren = [...this.ctx.scene.children];
    for (const child of this.stashedChildren) {
      this.ctx.scene.remove(child);
    }

    // Apply aspect
    this.applyAspect();
    resizeRenderer(this.ctx, this.config.width, this.config.height);
    this.pipeline.resize(this.config.width, this.config.height);

    // Set palette
    this.palette = getPalette(layout.palette || this.config.palette);
    this.ctx.scene.background = this.palette.bg;
    this.overlay.setPalette(layout.palette || this.config.palette);

    // Start thumbnail generator
    this.startThumbnailGenerator();

    // Register event listeners
    window.addEventListener('keydown', this.keyHandler);
    window.addEventListener('resize', this.resizeHandler);

    // Listen for pointerdown on the canvas AND on the overlay
    this.overlay.onPointerDownOutside = (e) => this.handleOverlayPointerDown(e);
    const canvas = this.ctx.renderer.domElement;
    canvas.addEventListener('pointerdown', this.onCanvasPointerDown);
    // Prevent browser gestures (scroll/zoom) on canvas while editing
    canvas.style.touchAction = 'none';

    // Spawn all layout elements
    this.spawnAllElements();

    // Show overlay
    this.overlay.show();
    this.updateGridPosition();
    this.updateStatus();

    showToast('Editor mode');
  }

  exit(): void {
    if (!this.active) return;
    this.active = false;
    this.cancelDrag();

    // Hide overlay
    this.overlay.hide();
    this.overlay.onPointerDownOutside = null;

    // Remove event listeners
    window.removeEventListener('keydown', this.keyHandler);
    window.removeEventListener('resize', this.resizeHandler);
    const canvas = this.ctx.renderer.domElement;
    canvas.removeEventListener('pointerdown', this.onCanvasPointerDown);
    canvas.style.touchAction = '';

    // Dispose thumbnail generator
    if (this.thumbGen) {
      this.thumbGen.dispose();
      this.thumbGen = null;
    }
    this.overlay.getThumbnail = null;

    // Dispose all editor elements
    this.disposeAllElements();

    // Restore stashed scene children
    for (const child of this.stashedChildren) {
      this.ctx.scene.add(child);
    }
    this.stashedChildren = [];

    this.onExit();
  }

  /* ============================================
   *  UPDATE / RENDER
   * ============================================ */

  update(dt: number): void {
    if (!this.active) return;
    this.elapsed += dt;

    for (const el of this.elements.values()) {
      el.tick(dt, this.elapsed);
    }

    // Process thumbnail generation batches
    if (this.thumbGen) {
      this.thumbGen.processBatch();
    }

    this.pipeline.update(this.elapsed, this.config);
  }

  render(): void {
    if (!this.active) return;
    this.pipeline.composer.render();
  }

  /* ============================================
   *  ELEMENT MANAGEMENT
   * ============================================ */

  private spawnAllElements(): void {
    this.disposeAllElements();

    const w = this.config.width;
    const h = this.config.height;

    for (const er of this.layout.regions) {
      this.spawnElement(er, w, h);
    }
  }

  private spawnElement(er: EditorRegion, w: number, h: number): void {
    const region = toRegion(er);
    const rng = new SeededRandom(hashString(er.id));
    const element = createElement(er.elementType, region, this.palette, rng, w, h);

    const wrapper = new THREE.Group();
    wrapper.add(element.group);
    this.ctx.scene.add(wrapper);

    // Skip boot animation — immediately activate
    element.group.visible = true;
    element.stateMachine.transition('active');

    this.elements.set(er.id, element);
    this.wrappers.set(er.id, wrapper);
  }

  private disposeElement(regionId: string): void {
    const el = this.elements.get(regionId);
    const wrapper = this.wrappers.get(regionId);
    if (el) {
      el.dispose();
      this.elements.delete(regionId);
    }
    if (wrapper) {
      this.ctx.scene.remove(wrapper);
      this.wrappers.delete(regionId);
    }
  }

  private disposeAllElements(): void {
    for (const [id] of this.elements) {
      this.disposeElement(id);
    }
    this.elements.clear();
    this.wrappers.clear();
  }

  private recreateElement(regionId: string): void {
    this.disposeElement(regionId);
    const er = this.layout.regions.find(r => r.id === regionId);
    if (er) {
      this.spawnElement(er, this.config.width, this.config.height);
    }
  }

  /* ============================================
   *  PLACEMENT
   * ============================================ */

  private placeElementAtCenter(elementType: string): void {
    this.pushUndo();
    const { w, h } = defaultRegionSize(elementType);
    const x = snapToGrid(0.5 - w / 2);
    const y = snapToGrid(0.5 - h / 2);

    const newRegion: EditorRegion = {
      id: nextRegionId(),
      x, y, width: w, height: h,
      padding: 0.008,
      elementType,
    };

    const nudged = this.nudgeIfOverlapping(newRegion);

    this.layout.regions.push(nudged);
    this.layout.modified = Date.now();
    this.spawnElement(nudged, this.config.width, this.config.height);
    this.selectedRegionId = nudged.id;
    this.showSelectionHandles();
    this.overlay.showProperties(nudged);
    this.updateStatus();

    showToast(`Added ${elementType}`);
  }

  private placeElementAt(elementType: string, nx: number, ny: number): void {
    this.pushUndo();
    const { w, h } = defaultRegionSize(elementType);
    const x = this.snapEnabled ? snapToGrid(nx - w / 2) : nx - w / 2;
    const y = this.snapEnabled ? snapToGrid(ny - h / 2) : ny - h / 2;

    const newRegion = clampRegion({
      id: nextRegionId(),
      x, y, width: w, height: h,
      padding: 0.008,
      elementType,
    });

    const nudged = this.nudgeIfOverlapping(newRegion);

    this.layout.regions.push(nudged);
    this.layout.modified = Date.now();
    this.spawnElement(nudged, this.config.width, this.config.height);
    this.selectedRegionId = nudged.id;
    this.showSelectionHandles();
    this.overlay.showProperties(nudged);
    this.updateStatus();

    showToast(`Placed ${elementType}`);
  }

  private nudgeIfOverlapping(region: EditorRegion): EditorRegion {
    let result = { ...region };
    let attempts = 0;
    while (attempts < 20) {
      const overlaps = this.layout.regions.some(r => r.id !== result.id && regionsOverlap(result, r));
      if (!overlaps) break;
      result.x += 0.02;
      result.y -= 0.02;
      result = clampRegion(result);
      attempts++;
    }
    return result;
  }

  /* ============================================
   *  POINTER-DOWN HANDLERS
   * ============================================ */

  private onCanvasPointerDown = (e: PointerEvent): void => {
    if (!this.active || this.subMode !== 'edit') return;
    if (this.activeDrag) return;

    // Hide context menu on any click
    this.overlay.hideContextMenu();

    const canvasRect = this.ctx.renderer.domElement.getBoundingClientRect();
    const nx = (e.clientX - canvasRect.left) / canvasRect.width;
    const ny = 1 - (e.clientY - canvasRect.top) / canvasRect.height;
    if (nx < 0 || nx > 1 || ny < 0 || ny > 1) return;

    this.selectRegionAt(nx, ny);
  };

  private handleOverlayPointerDown(e: PointerEvent): void {
    if (!this.active || this.subMode !== 'edit') return;
    if (this.activeDrag) return;

    // Hide context menu on any click
    this.overlay.hideContextMenu();

    const target = e.target as HTMLElement;

    // --- Resize handle? ---
    if (target.dataset.editorHandle) {
      const handle = target.dataset.editorHandle;
      const regionId = target.dataset.editorRegion!;
      const region = this.layout.regions.find(r => r.id === regionId);
      if (!region) return;

      this.dragCapture.style.cursor = target.style.cursor;
      this.beginDrag({
        kind: 'resize',
        regionId,
        handle,
        startRegion: { ...region },
        startClientX: e.clientX,
        startClientY: e.clientY,
        lastRegion: { ...region },
      }, e);
      return;
    }

    // --- Selection outline body (move)? ---
    if (target.dataset.editorOutline) {
      const regionId = target.dataset.editorOutline;
      const region = this.layout.regions.find(r => r.id === regionId);
      if (!region) return;

      const canvasRect = this.ctx.renderer.domElement.getBoundingClientRect();
      const nx = (e.clientX - canvasRect.left) / canvasRect.width;
      const ny = 1 - (e.clientY - canvasRect.top) / canvasRect.height;

      this.dragCapture.style.cursor = 'move';
      this.beginDrag({
        kind: 'move',
        regionId,
        startNX: nx,
        startNY: ny,
        startRegionX: region.x,
        startRegionY: region.y,
        lastX: region.x,
        lastY: region.y,
      }, e);
      return;
    }

    // --- Palette tile? ---
    const tile = target.closest('[data-element-type]') as HTMLElement | null;
    if (tile && tile.dataset.elementType) {
      this.beginDrag({
        kind: 'palette',
        elementType: tile.dataset.elementType,
        startClientX: e.clientX,
        startClientY: e.clientY,
        isDragging: false,
      }, e);
      return;
    }
  }

  /* ============================================
   *  SELECTION + HANDLES
   * ============================================ */

  private selectRegionAt(nx: number, ny: number): boolean {
    for (let i = this.layout.regions.length - 1; i >= 0; i--) {
      const r = this.layout.regions[i];
      if (nx >= r.x && nx <= r.x + r.width && ny >= r.y && ny <= r.y + r.height) {
        this.selectedRegionId = r.id;
        this.showSelectionHandles();
        this.overlay.showProperties(r);
        return true;
      }
    }
    this.selectedRegionId = null;
    this.overlay.clearHandles();
    this.overlay.hideProperties();
    return false;
  }

  private showSelectionHandles(): void {
    if (!this.selectedRegionId || this.subMode !== 'edit') {
      this.overlay.clearHandles();
      return;
    }

    const region = this.layout.regions.find(r => r.id === this.selectedRegionId);
    if (!region) {
      this.overlay.clearHandles();
      return;
    }

    const canvasRect = this.ctx.renderer.domElement.getBoundingClientRect();
    this.overlay.showHandles(region, canvasRect);
  }

  /* ============================================
   *  DELETE
   * ============================================ */

  private deleteSelected(): void {
    if (!this.selectedRegionId) return;
    const idx = this.layout.regions.findIndex(r => r.id === this.selectedRegionId);
    if (idx === -1) return;

    this.pushUndo();
    const type = this.layout.regions[idx].elementType;
    this.disposeElement(this.selectedRegionId);
    this.layout.regions.splice(idx, 1);
    this.layout.modified = Date.now();
    this.selectedRegionId = null;
    this.overlay.clearHandles();
    this.overlay.hideProperties();
    this.updateStatus();

    showToast(`Removed ${type}`);
  }

  /* ============================================
   *  DUPLICATE
   * ============================================ */

  private duplicateSelected(): void {
    if (!this.selectedRegionId) return;
    const region = this.layout.regions.find(r => r.id === this.selectedRegionId);
    if (!region) return;

    this.pushUndo();
    const newRegion: EditorRegion = {
      ...region,
      id: nextRegionId(),
      x: region.x + 0.02,
      y: region.y - 0.02,
    };
    const clamped = clampRegion(newRegion);
    const nudged = this.nudgeIfOverlapping(clamped);

    this.layout.regions.push(nudged);
    this.layout.modified = Date.now();
    this.spawnElement(nudged, this.config.width, this.config.height);
    this.selectedRegionId = nudged.id;
    this.showSelectionHandles();
    this.overlay.showProperties(nudged);
    this.updateStatus();

    showToast(`Duplicated ${region.elementType}`);
  }

  /* ============================================
   *  ELEMENT TYPE SWAP
   * ============================================ */

  private swapSelectedType(newType: string): void {
    if (!this.selectedRegionId) return;
    const region = this.layout.regions.find(r => r.id === this.selectedRegionId);
    if (!region || region.elementType === newType) return;

    this.pushUndo();
    region.elementType = newType;
    this.layout.modified = Date.now();
    this.recreateElement(region.id);
    this.showSelectionHandles();
    this.updateStatus();

    showToast(`Swapped to ${newType}`);
  }

  /* ============================================
   *  REGION UPDATE (from properties panel)
   * ============================================ */

  private updateSelectedRegion(x: number, y: number, w: number, h: number): void {
    if (!this.selectedRegionId) return;
    const region = this.layout.regions.find(r => r.id === this.selectedRegionId);
    if (!region) return;

    this.pushUndo();
    const clamped = clampRegion({ ...region, x, y, width: w, height: h });
    region.x = clamped.x;
    region.y = clamped.y;
    region.width = clamped.width;
    region.height = clamped.height;
    this.layout.modified = Date.now();
    this.recreateElement(region.id);
    this.showSelectionHandles();
    this.overlay.updatePropertiesPosition(region);
    this.updateStatus();
  }

  /* ============================================
   *  BRING TO FRONT / SEND TO BACK
   * ============================================ */

  private bringToFront(): void {
    if (!this.selectedRegionId) return;
    const idx = this.layout.regions.findIndex(r => r.id === this.selectedRegionId);
    if (idx === -1 || idx === this.layout.regions.length - 1) return;

    this.pushUndo();
    const [region] = this.layout.regions.splice(idx, 1);
    this.layout.regions.push(region);
    this.layout.modified = Date.now();
    this.updateStatus();
    showToast('Brought to front');
  }

  private sendToBack(): void {
    if (!this.selectedRegionId) return;
    const idx = this.layout.regions.findIndex(r => r.id === this.selectedRegionId);
    if (idx <= 0) return;

    this.pushUndo();
    const [region] = this.layout.regions.splice(idx, 1);
    this.layout.regions.unshift(region);
    this.layout.modified = Date.now();
    this.updateStatus();
    showToast('Sent to back');
  }

  /* ============================================
   *  ARROW NUDGE
   * ============================================ */

  private nudgeSelected(dx: number, dy: number): void {
    if (!this.selectedRegionId) return;
    const region = this.layout.regions.find(r => r.id === this.selectedRegionId);
    if (!region) return;

    this.pushUndo();
    const gridSize = 1 / 12;
    const clamped = clampRegion({
      ...region,
      x: region.x + dx * gridSize,
      y: region.y + dy * gridSize,
    });
    region.x = clamped.x;
    region.y = clamped.y;
    this.layout.modified = Date.now();
    this.recreateElement(region.id);
    this.showSelectionHandles();
    this.overlay.showProperties(region);
    this.updateStatus();
  }

  /* ============================================
   *  GRID TOGGLE
   * ============================================ */

  private toggleGrid(): void {
    this.overlay.toggleGrid();
    this.updateGridPosition();
    showToast(this.overlay.gridVisible ? 'Grid on' : 'Grid off');
  }

  private updateGridPosition(): void {
    const canvasRect = this.ctx.renderer.domElement.getBoundingClientRect();
    this.overlay.updateGridPosition(canvasRect);
  }

  /* ============================================
   *  THUMBNAIL GENERATOR
   * ============================================ */

  private startThumbnailGenerator(): void {
    if (this.thumbGen) {
      this.thumbGen.dispose();
    }
    this.thumbGen = new ThumbnailGenerator(
      this.ctx.renderer,
      this.palette,
      elementTypes(),
      () => this.overlay.refreshThumbnails(),
    );
    this.overlay.getThumbnail = (type: string) => this.thumbGen?.get(type);
  }

  /* ============================================
   *  PALETTE CHANGE
   * ============================================ */

  private changePalette(paletteName: string): void {
    this.layout.palette = paletteName;
    this.palette = getPalette(paletteName);
    this.ctx.scene.background = this.palette.bg;
    this.layout.modified = Date.now();

    // Respawn all elements with new palette
    this.spawnAllElements();
    if (this.selectedRegionId) {
      this.showSelectionHandles();
      const region = this.layout.regions.find(r => r.id === this.selectedRegionId);
      if (region) this.overlay.showProperties(region);
    }
    this.updateStatus();

    // Regenerate thumbnails with new palette
    this.startThumbnailGenerator();

    showToast(`Palette: ${paletteName}`);
  }

  /* ============================================
   *  LAYOUT RENAME
   * ============================================ */

  private renameLayout(name: string): void {
    this.layout.name = name;
    this.layout.modified = Date.now();
    this.updateStatus();
  }

  /* ============================================
   *  EDIT <-> PERFORM TOGGLE
   * ============================================ */

  private togglePerform(): void {
    if (this.subMode === 'edit') {
      this.subMode = 'perform';
      this.selectedRegionId = null;
      this.cancelDrag();
      this.overlay.enterPerformMode();
      showToast('Perform mode');
    } else {
      this.subMode = 'edit';
      this.overlay.exitPerformMode();
      this.updateGridPosition();
      this.updateStatus();
      showToast('Edit mode');
    }
  }

  /* ============================================
   *  PERSISTENCE ACTIONS
   * ============================================ */

  private newLayout(): void {
    this.pushUndo();
    this.disposeAllElements();
    this.layout = createBlankLayout(this.config.palette);
    this.selectedRegionId = null;
    this.overlay.clearHandles();
    this.overlay.hideProperties();
    this.undoStack = [];
    this.redoStack = [];
    this.updateStatus();
    showToast('New layout');
  }

  private saveLayout(): void {
    const saved = loadEditorLayouts() ?? { layouts: [], lastActiveIndex: 0 };

    const existingIdx = saved.layouts.findIndex(l => l.name === this.layout.name);
    if (existingIdx >= 0) {
      saved.layouts[existingIdx] = { ...this.layout };
      saved.lastActiveIndex = existingIdx;
    } else {
      if (this.layout.name === 'Untitled') {
        this.layout.name = `Layout ${saved.layouts.length + 1}`;
      }
      saved.layouts.push({ ...this.layout });
      saved.lastActiveIndex = saved.layouts.length - 1;
    }

    saveEditorLayouts(saved);
    this.updateStatus();
    showToast(`Saved: ${this.layout.name}`);
  }

  private loadLayoutDialog(): void {
    const saved = loadEditorLayouts();
    if (!saved || saved.layouts.length === 0) {
      showToast('No saved layouts');
      return;
    }

    this.overlay.showLoadDialog(saved.layouts, (index) => {
      this.disposeAllElements();
      this.layout = { ...saved.layouts[index] };
      this.selectedRegionId = null;
      this.overlay.clearHandles();
      this.overlay.hideProperties();
      this.palette = getPalette(this.layout.palette || this.config.palette);
      this.ctx.scene.background = this.palette.bg;
      this.overlay.setPalette(this.layout.palette || this.config.palette);
      this.spawnAllElements();
      this.undoStack = [];
      this.redoStack = [];
      this.updateStatus();
      showToast(`Loaded: ${this.layout.name}`);
    });
  }

  private exportLayout(): void {
    const json = exportLayoutJSON(this.layout);
    const filename = `${this.layout.name.replace(/\s+/g, '-').toLowerCase()}.json`;
    downloadJSON(json, filename);
    showToast('Layout exported');
  }

  private async importLayout(): Promise<void> {
    const text = await pickJSONFile();
    if (!text) return;

    const layout = importLayoutJSON(text);
    if (!layout) {
      showToast('Invalid layout file');
      return;
    }

    this.disposeAllElements();
    this.layout = layout;
    this.selectedRegionId = null;
    this.overlay.clearHandles();
    this.overlay.hideProperties();
    this.palette = getPalette(this.layout.palette || this.config.palette);
    this.ctx.scene.background = this.palette.bg;
    this.overlay.setPalette(this.layout.palette || this.config.palette);
    this.spawnAllElements();
    this.undoStack = [];
    this.redoStack = [];
    this.updateStatus();
    showToast(`Imported: ${layout.name}`);
  }

  private clearLayout(): void {
    this.pushUndo();
    this.disposeAllElements();
    this.layout.regions = [];
    this.layout.modified = Date.now();
    this.selectedRegionId = null;
    this.overlay.clearHandles();
    this.overlay.hideProperties();
    this.updateStatus();
    showToast('Layout cleared');
  }

  /* ============================================
   *  EVENT HANDLERS
   * ============================================ */

  private handleKey(e: KeyboardEvent): void {
    if (!this.active) return;

    // Don't handle keys when help dialog is showing (except Escape)
    if (this.overlay.helpVisible && e.key !== 'Escape') return;

    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        if (this.overlay.helpVisible) {
          this.overlay.hideHelp();
        } else if (this.activeDrag) {
          this.cancelDrag();
        } else {
          this.exit();
        }
        break;
      case 'Tab':
        e.preventDefault();
        this.togglePerform();
        break;
      case 'Delete':
      case 'Backspace':
        if (this.subMode === 'edit') {
          e.preventDefault();
          this.deleteSelected();
        }
        break;
      case 's':
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          this.saveLayout();
        }
        break;
      case 'z':
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          this.undo();
        }
        break;
      case 'y':
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          this.redo();
        }
        break;
      case 'd':
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          this.duplicateSelected();
        }
        break;
      case 'p':
      case 'P':
        if (!e.ctrlKey && !e.metaKey) {
          this.overlay.togglePanel();
        }
        break;
      case 'g':
      case 'G':
        if (!e.ctrlKey && !e.metaKey && this.subMode === 'edit') {
          this.toggleGrid();
        }
        break;
      case '?':
        this.overlay.showHelp();
        break;
      case 'ArrowLeft':
        if (this.subMode === 'edit' && this.selectedRegionId) {
          e.preventDefault();
          this.nudgeSelected(-1, 0);
        }
        break;
      case 'ArrowRight':
        if (this.subMode === 'edit' && this.selectedRegionId) {
          e.preventDefault();
          this.nudgeSelected(1, 0);
        }
        break;
      case 'ArrowUp':
        if (this.subMode === 'edit' && this.selectedRegionId) {
          e.preventDefault();
          this.nudgeSelected(0, 1);
        }
        break;
      case 'ArrowDown':
        if (this.subMode === 'edit' && this.selectedRegionId) {
          e.preventDefault();
          this.nudgeSelected(0, -1);
        }
        break;
    }
  }

  private handleResize(): void {
    if (!this.active) return;
    this.cancelDrag();
    this.applyAspect();
    resizeRenderer(this.ctx, this.config.width, this.config.height);
    this.pipeline.resize(this.config.width, this.config.height);
    this.spawnAllElements();
    if (this.selectedRegionId) {
      this.showSelectionHandles();
    }
    this.updateGridPosition();
  }

  /* ============================================
   *  HELPERS
   * ============================================ */

  private applyAspect(): void {
    const isMobile = this.isMobileCheck();
    // In editor mode, canvas spans full viewport so elements can be placed anywhere
    // (toolbars float translucently over the canvas)
    const mobileInset = !this.active && isMobile ? TOOLBAR_HEIGHT : 0;
    const viewportH = window.innerHeight - mobileInset;
    const { width, height, offsetX, offsetY } = computeAspectSize(
      this.config.aspectRatio,
      window.innerWidth,
      viewportH,
    );
    this.config.width = width;
    this.config.height = height;
    const canvas = this.ctx.renderer.domElement;
    canvas.style.position = 'absolute';
    canvas.style.left = `${offsetX}px`;
    canvas.style.top = `${offsetY}px`;
  }

  private updateStatus(): void {
    this.overlay.updateStatus(
      this.layout,
      this.snapEnabled,
      this.undoStack.length,
      this.redoStack.length,
    );
  }

  dispose(): void {
    if (this.active) {
      this.exit();
    }
    this.dragCapture.remove();
    this.overlay.dispose();
  }
}

/* ---------- Utility ---------- */

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}
