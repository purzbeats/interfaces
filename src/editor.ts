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
import { EditorOverlay } from './editor/editor-overlay';
import {
  saveEditorLayouts,
  loadEditorLayouts,
  exportLayoutJSON,
  importLayoutJSON,
  downloadJSON,
  pickJSONFile,
} from './editor/editor-persistence';
import { TOOLBAR_HEIGHT } from './gui/mobile-toolbar';

/* ---------- Internal types ---------- */

/** What kind of drag operation is active. */
type ActiveDrag =
  | { kind: 'palette'; elementType: string; startClientX: number; startClientY: number; isDragging: boolean }
  | { kind: 'move'; regionId: string; startNX: number; startNY: number; startRegionX: number; startRegionY: number; lastX: number; lastY: number }
  | { kind: 'resize'; regionId: string; handle: string; startRegion: EditorRegion; startClientX: number; startClientY: number; lastRegion: EditorRegion };

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
  private palette!: Palette;
  private elapsed: number = 0;
  private stashedChildren: THREE.Object3D[] = [];
  private overlay: EditorOverlay;
  private snapEnabled: boolean = true;

  /**
   * Full-screen transparent div that captures ALL pointer events during a drag.
   * Created once, shown/hidden as needed. This prevents pointer events from being
   * swallowed by the toolbar, palette, handles, or anything else during drag ops.
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

    // Create drag-capture overlay (invisible, only active during drags)
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
    });
    this.dragCapture.addEventListener('pointermove', (e) => this.onDragMove(e));
    this.dragCapture.addEventListener('pointerup', (e) => this.onDragEnd(e));
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
      onTogglePalette: () => this.overlay.togglePalette(),
    });
  }

  get isActive(): boolean {
    return this.active;
  }

  /* ============================================
   *  DRAG CAPTURE — the single source of truth
   *  for all pointer-drag operations.
   * ============================================ */

  /**
   * Begin a drag operation. Shows the full-screen capture overlay and captures
   * the pointer so that ALL subsequent move/up events come through here,
   * regardless of what DOM element the cursor is over.
   */
  private beginDrag(drag: ActiveDrag, e: PointerEvent): void {
    this.activeDrag = drag;
    this.dragCapture.style.display = '';
    this.dragCapture.setPointerCapture(e.pointerId);
  }

  /** Cancel any active drag without applying changes. */
  private cancelDrag(): void {
    if (!this.activeDrag) return;

    // Reset wrapper position if we were mid-move
    if (this.activeDrag.kind === 'move') {
      const wrapper = this.wrappers.get(this.activeDrag.regionId);
      if (wrapper) wrapper.position.set(0, 0, 0);
    }

    this.activeDrag = null;
    this.dragCapture.style.display = 'none';
    this.overlay.hideGhostRect();
  }

  private onDragMove(e: PointerEvent): void {
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

        // Live preview: shift the THREE.Group wrapper
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
        const dy = -(e.clientY - startClientY) / canvasRect.height; // flip Y for GL

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
    if (!this.activeDrag) return;
    const canvasRect = this.ctx.renderer.domElement.getBoundingClientRect();

    switch (this.activeDrag.kind) {
      case 'palette': {
        const drag = this.activeDrag;
        if (drag.isDragging) {
          // Dragged onto canvas — place at drop position
          const nx = (e.clientX - canvasRect.left) / canvasRect.width;
          const ny = 1 - (e.clientY - canvasRect.top) / canvasRect.height;
          if (nx >= 0 && nx <= 1 && ny >= 0 && ny <= 1) {
            this.placeElementAt(drag.elementType, nx, ny);
          }
        } else {
          // Simple click (no drag movement) — place at center
          this.placeElementAtCenter(drag.elementType);
        }
        break;
      }

      case 'move': {
        const drag = this.activeDrag;
        const region = this.layout.regions.find(r => r.id === drag.regionId);
        if (region) {
          const clamped = clampRegion({ ...region, x: drag.lastX, y: drag.lastY });
          region.x = clamped.x;
          region.y = clamped.y;
          this.layout.modified = Date.now();
          this.recreateElement(region.id);
          this.showSelectionHandles();
          this.updateStatus();
        }
        break;
      }

      case 'resize': {
        const drag = this.activeDrag;
        const region = this.layout.regions.find(r => r.id === drag.regionId);
        if (region) {
          region.x = drag.lastRegion.x;
          region.y = drag.lastRegion.y;
          region.width = drag.lastRegion.width;
          region.height = drag.lastRegion.height;
          this.layout.modified = Date.now();
          this.recreateElement(region.id);
          this.showSelectionHandles();
          this.updateStatus();
        }
        break;
      }
    }

    this.activeDrag = null;
    this.dragCapture.style.display = 'none';
    this.dragCapture.style.cursor = 'default';
    this.overlay.hideGhostRect();
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

    // Register event listeners
    window.addEventListener('keydown', this.keyHandler);
    window.addEventListener('resize', this.resizeHandler);

    // Listen for pointerdown on the canvas AND on the overlay (for handle/outline clicks)
    this.overlay.onPointerDownOutside = (e) => this.handleOverlayPointerDown(e);
    const canvas = this.ctx.renderer.domElement;
    canvas.addEventListener('pointerdown', this.onCanvasPointerDown);

    // Spawn all layout elements
    this.spawnAllElements();

    // Show overlay
    this.overlay.show();
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
    this.updateStatus();

    showToast(`Added ${elementType}`);
  }

  private placeElementAt(elementType: string, nx: number, ny: number): void {
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
   *
   *  Two entry points:
   *  1. Canvas pointerdown — clicks that pass through the overlay
   *  2. Overlay pointerdown — clicks on handles, outline, palette tiles
   *
   *  Both funnel into beginDrag() which activates the
   *  full-screen drag-capture overlay for move/up events.
   * ============================================ */

  /** Arrow function so `this` is bound for addEventListener. */
  private onCanvasPointerDown = (e: PointerEvent): void => {
    if (!this.active || this.subMode !== 'edit') return;
    if (this.activeDrag) return; // already dragging

    // Canvas click → hit-test for region selection
    const canvasRect = this.ctx.renderer.domElement.getBoundingClientRect();
    const nx = (e.clientX - canvasRect.left) / canvasRect.width;
    const ny = 1 - (e.clientY - canvasRect.top) / canvasRect.height;
    if (nx < 0 || nx > 1 || ny < 0 || ny > 1) return;

    this.selectRegionAt(nx, ny);
  };

  /**
   * Called from the overlay when a pointerdown occurs on:
   *  - A resize handle → start resize drag
   *  - The selection outline body → start move drag
   *  - A palette tile → start palette drag
   */
  private handleOverlayPointerDown(e: PointerEvent): void {
    if (!this.active || this.subMode !== 'edit') return;
    if (this.activeDrag) return;

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
        return true;
      }
    }
    this.selectedRegionId = null;
    this.overlay.clearHandles();
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

    const type = this.layout.regions[idx].elementType;
    this.disposeElement(this.selectedRegionId);
    this.layout.regions.splice(idx, 1);
    this.layout.modified = Date.now();
    this.selectedRegionId = null;
    this.overlay.clearHandles();
    this.updateStatus();

    showToast(`Removed ${type}`);
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
      this.updateStatus();
      showToast('Edit mode');
    }
  }

  /* ============================================
   *  PERSISTENCE ACTIONS
   * ============================================ */

  private newLayout(): void {
    this.disposeAllElements();
    this.layout = createBlankLayout(this.config.palette);
    this.selectedRegionId = null;
    this.overlay.clearHandles();
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
      this.palette = getPalette(this.layout.palette || this.config.palette);
      this.ctx.scene.background = this.palette.bg;
      this.spawnAllElements();
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
    this.palette = getPalette(this.layout.palette || this.config.palette);
    this.ctx.scene.background = this.palette.bg;
    this.spawnAllElements();
    this.updateStatus();
    showToast(`Imported: ${layout.name}`);
  }

  private clearLayout(): void {
    this.disposeAllElements();
    this.layout.regions = [];
    this.layout.modified = Date.now();
    this.selectedRegionId = null;
    this.overlay.clearHandles();
    this.updateStatus();
    showToast('Layout cleared');
  }

  /* ============================================
   *  EVENT HANDLERS
   * ============================================ */

  private handleKey(e: KeyboardEvent): void {
    if (!this.active) return;

    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        if (this.activeDrag) {
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
      case 'p':
      case 'P':
        if (!e.ctrlKey && !e.metaKey) {
          this.overlay.togglePalette();
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
  }

  /* ============================================
   *  HELPERS
   * ============================================ */

  private applyAspect(): void {
    const isMobile = this.isMobileCheck();
    const viewportH = isMobile ? window.innerHeight - TOOLBAR_HEIGHT : window.innerHeight;
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
    this.overlay.updateStatus(this.layout, this.snapEnabled);
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
