import * as THREE from 'three';
import { SeededRandom } from './random';
import { createRegion, type Region } from './layout/region';
import { createElement, elementTypes } from './elements/registry';
import { getPalette, type Palette } from './color/palettes';
import { type BaseElement } from './elements/base-element';
import { resizeRenderer, type RendererContext } from './renderer/setup';
import { type PostFXPipeline } from './postfx/pipeline';
import { type Config, computeAspectSize } from './config';
import { type ShowcaseMode } from './showcase';
import { getMeta } from './elements/tags';
import { TOOLBAR_HEIGHT } from './gui/mobile-toolbar';

const DESKTOP_COLS = 4;
const DESKTOP_ROWS = 4;
const MOBILE_COLS = 2;
const MOBILE_ROWS = 2;
const CELL_PAD = 0.01;
const SWIPE_THRESHOLD = 50; // minimum px for a swipe

// Reserved pixel heights for overlay zones (above/below the grid)
const FILTER_BAR_PX = 36;
const BOTTOM_AREA_PX = 56;        // page indicator + hint text
const BOTTOM_AREA_MOBILE_PX = 108; // + PREV/NEXT buttons
const LABEL_HEIGHT_PX = 20;       // per-cell label below each cell

// All available filter tags, grouped by category
const SHAPE_TAGS = ['rectangular', 'linear', 'radial'] as const;
const ROLE_TAGS = ['gauge', 'scanner', 'data-display', 'text', 'decorative', 'border'] as const;
const MOOD_TAGS = ['tactical', 'diagnostic', 'ambient'] as const;
const ALL_TAGS = [...SHAPE_TAGS, '|', ...ROLE_TAGS, '|', ...MOOD_TAGS] as const;

function matchesTag(type: string, tag: string): boolean {
  const meta = getMeta(type);
  if (!meta) return false;
  return (
    meta.shape === tag ||
    meta.roles.includes(tag as any) ||
    meta.moods.includes(tag as any)
  );
}

/**
 * Gallery mode: paginated grid of live element previews.
 * 4×4 on desktop, 2×2 on mobile. Click/tap a tile to enter showcase.
 * Tag filters at the top narrow the displayed elements.
 */
export class GalleryMode {
  private ctx: RendererContext;
  private pipeline: PostFXPipeline;
  private config: Config;
  private showcase: ShowcaseMode;
  private allTypes: string[];
  private filteredTypes: string[];
  private activeFilter: string | null = null;
  private page: number = 0;
  private totalPages: number = 0;
  private elements: BaseElement[] = [];
  private wrappers: THREE.Group[] = [];
  private palette!: Palette;
  private elapsed: number = 0;
  private overlay: HTMLDivElement;
  private active: boolean = false;
  private onExit: () => void;
  private keyHandler: (e: KeyboardEvent) => void;
  private clickHandler: (e: MouseEvent) => void;
  private touchStartHandler: (e: TouchEvent) => void;
  private touchEndHandler: (e: TouchEvent) => void;
  private resizeHandler: () => void;
  private wheelHandler: (e: WheelEvent) => void;
  private stashedChildren: THREE.Object3D[] = [];
  private isMobileCheck: () => boolean;
  private swipeStartX: number = 0;
  private swipeStartY: number = 0;

  // Current grid dimensions (responsive)
  private cols: number = DESKTOP_COLS;
  private rows: number = DESKTOP_ROWS;
  private pageSize: number = DESKTOP_COLS * DESKTOP_ROWS;

  constructor(
    ctx: RendererContext,
    pipeline: PostFXPipeline,
    config: Config,
    showcase: ShowcaseMode,
    onExit: () => void,
    isMobile: () => boolean,
  ) {
    this.ctx = ctx;
    this.pipeline = pipeline;
    this.config = config;
    this.showcase = showcase;
    this.onExit = onExit;
    this.isMobileCheck = isMobile;
    this.allTypes = elementTypes().filter(t => t !== 'panel' && t !== 'separator');
    this.filteredTypes = this.allTypes;
    this.updateGridDimensions();
    this.recomputePages();

    this.overlay = this.createOverlay();
    document.body.appendChild(this.overlay);
    this.overlay.style.display = 'none';

    this.keyHandler = (e: KeyboardEvent) => this.handleKey(e);
    this.clickHandler = (e: MouseEvent) => this.handleClick(e);
    this.touchStartHandler = (e: TouchEvent) => this.handleTouchStart(e);
    this.touchEndHandler = (e: TouchEvent) => this.handleTouchEnd(e);
    this.resizeHandler = () => this.handleResize();
    this.wheelHandler = (e: WheelEvent) => this.handleWheel(e);
  }

  get isActive(): boolean {
    return this.active;
  }

  private get isMobile(): boolean {
    return this.isMobileCheck();
  }

  private updateGridDimensions(): void {
    if (this.isMobile) {
      this.cols = MOBILE_COLS;
      this.rows = MOBILE_ROWS;
    } else {
      this.cols = DESKTOP_COLS;
      this.rows = DESKTOP_ROWS;
    }
    this.pageSize = this.cols * this.rows;
  }

  enter(resume: boolean = false): void {
    this.active = true;
    if (!resume) {
      this.activeFilter = null;
      this.filteredTypes = this.allTypes;
      this.page = 0;
    }
    this.updateGridDimensions();
    this.recomputePages();
    if (this.page >= this.totalPages) this.page = Math.max(0, this.totalPages - 1);
    this.overlay.style.display = '';

    // Stash scene children
    this.stashedChildren = [...this.ctx.scene.children];
    for (const child of this.stashedChildren) {
      this.ctx.scene.remove(child);
    }

    this.applyAspect();
    resizeRenderer(this.ctx, this.config.width, this.config.height);
    this.pipeline.resize(this.config.width, this.config.height);

    window.addEventListener('keydown', this.keyHandler);
    window.addEventListener('wheel', this.wheelHandler, { passive: false });
    this.ctx.renderer.domElement.addEventListener('click', this.clickHandler);
    const canvas = this.ctx.renderer.domElement;
    canvas.addEventListener('touchstart', this.touchStartHandler, { passive: true });
    canvas.addEventListener('touchend', this.touchEndHandler, { passive: false });
    window.addEventListener('resize', this.resizeHandler);

    this.spawnPage();
  }

  exit(): void {
    this.active = false;
    this.overlay.style.display = 'none';
    window.removeEventListener('keydown', this.keyHandler);
    window.removeEventListener('wheel', this.wheelHandler);
    this.ctx.renderer.domElement.removeEventListener('click', this.clickHandler);
    this.ctx.renderer.domElement.removeEventListener('touchstart', this.touchStartHandler);
    this.ctx.renderer.domElement.removeEventListener('touchend', this.touchEndHandler);
    window.removeEventListener('resize', this.resizeHandler);
    this.clearElements();

    // Restore stashed scene children
    for (const child of this.stashedChildren) {
      this.ctx.scene.add(child);
    }
    this.stashedChildren = [];

    this.onExit();
  }

  private exitToShowcase(typeName: string): void {
    this.active = false;
    this.overlay.style.display = 'none';
    window.removeEventListener('keydown', this.keyHandler);
    window.removeEventListener('wheel', this.wheelHandler);
    this.ctx.renderer.domElement.removeEventListener('click', this.clickHandler);
    this.ctx.renderer.domElement.removeEventListener('touchstart', this.touchStartHandler);
    this.ctx.renderer.domElement.removeEventListener('touchend', this.touchEndHandler);
    window.removeEventListener('resize', this.resizeHandler);
    this.clearElements();

    // Restore stashed scene children so showcase can re-stash them
    for (const child of this.stashedChildren) {
      this.ctx.scene.add(child);
    }
    this.stashedChildren = [];

    // Map filtered type name back to showcase's global index
    const showcaseIndex = this.allTypes.indexOf(typeName);
    this.showcase.setBackToGallery(() => this.enter(true));
    this.showcase.enter(showcaseIndex >= 0 ? showcaseIndex : 0, true);
  }

  update(dt: number): void {
    if (!this.active) return;
    this.elapsed += dt;
    for (const el of this.elements) {
      el.tick(dt, this.elapsed);
    }
    this.pipeline.update(this.elapsed, this.config);
  }

  render(): void {
    if (!this.active) return;
    this.pipeline.composer.render();
  }

  dispose(): void {
    this.clearElements();
    this.overlay.remove();
    window.removeEventListener('keydown', this.keyHandler);
    window.removeEventListener('wheel', this.wheelHandler);
    this.ctx.renderer.domElement.removeEventListener('click', this.clickHandler);
    this.ctx.renderer.domElement.removeEventListener('touchstart', this.touchStartHandler);
    this.ctx.renderer.domElement.removeEventListener('touchend', this.touchEndHandler);
    window.removeEventListener('resize', this.resizeHandler);
  }

  // --- Private ---

  private recomputePages(): void {
    this.totalPages = Math.max(1, Math.ceil(this.filteredTypes.length / this.pageSize));
  }

  private setFilter(tag: string | null): void {
    this.activeFilter = tag;
    if (tag === null) {
      this.filteredTypes = this.allTypes;
    } else {
      this.filteredTypes = this.allTypes.filter(t => matchesTag(t, tag));
    }
    this.recomputePages();
    this.page = 0;
    this.spawnPage();
  }

  private nextPage(): void {
    if (this.page < this.totalPages - 1) {
      this.page++;
      this.spawnPage();
    }
  }

  private prevPage(): void {
    if (this.page > 0) {
      this.page--;
      this.spawnPage();
    }
  }

  private createOverlay(): HTMLDivElement {
    const el = document.createElement('div');
    el.id = 'gallery-overlay';
    Object.assign(el.style, {
      position: 'fixed',
      top: '0',
      left: '0',
      right: '0',
      bottom: '0',
      pointerEvents: 'none',
      zIndex: '900',
      fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", monospace',
      color: '#fff',
    });
    return el;
  }

  /** Compute pixel + normalized grid metrics for the inset grid area. */
  private gridMetrics(canvasRect: DOMRect) {
    const mobile = this.isMobile;
    const bottomPx = mobile && this.totalPages > 1 ? BOTTOM_AREA_MOBILE_PX : BOTTOM_AREA_PX;
    const topPx = FILTER_BAR_PX;
    // Available height for grid cells + their labels
    const totalAvailH = canvasRect.height - topPx - bottomPx;
    // Each row gets a cell + a label strip below it
    const rowSlotH = totalAvailH / this.rows;
    const labelH = LABEL_HEIGHT_PX;
    const cellH = rowSlotH - labelH;
    // Normalized (0–1) for WebGL regions
    const topNorm = topPx / canvasRect.height;
    const bottomNorm = bottomPx / canvasRect.height;
    const cellW = canvasRect.width / this.cols;
    return { topPx, bottomPx, topNorm, bottomNorm, cellH, cellW, rowSlotH, labelH, totalAvailH };
  }

  private updateOverlay(): void {
    const canvas = this.ctx.renderer.domElement;
    const canvasRect = canvas.getBoundingClientRect();
    const mobile = this.isMobile;
    const bottomOffset = mobile ? TOOLBAR_HEIGHT : 0;
    const gm = this.gridMetrics(canvasRect);

    // Offset from viewport to canvas
    const ox = canvasRect.left;
    const oy = canvasRect.top;

    let html = '';

    // --- Filter bar at top ---
    if (mobile) {
      // Horizontally scrollable single-row strip on mobile
      html += `<div style="
        position:fixed;
        top:${oy + 4}px;
        left:${ox}px;
        width:${canvasRect.width}px;
        pointer-events:auto;
        display:flex;
        flex-wrap:nowrap;
        gap:4px;
        padding:4px 8px;
        box-sizing:border-box;
        overflow-x:auto;
        overflow-y:hidden;
        -webkit-overflow-scrolling:touch;
        background:rgba(0,0,0,0.75);
        backdrop-filter:blur(4px);
        scrollbar-width:none;
      ">`;
    } else {
      html += `<div style="
        position:fixed;
        top:${oy + 6}px;
        left:${ox}px;
        width:${canvasRect.width}px;
        text-align:center;
        pointer-events:auto;
        display:flex;
        flex-wrap:wrap;
        justify-content:center;
        gap:4px 6px;
        padding:0 12px;
        box-sizing:border-box;
      ">`;
    }

    // "ALL" chip
    const allActive = this.activeFilter === null;
    html += this.renderChip('ALL', allActive, 'gallery-filter-all');

    for (const tag of ALL_TAGS) {
      if (tag === '|') {
        if (!mobile) {
          html += `<span style="width:1px;height:16px;background:rgba(255,255,255,0.15);margin:0 2px;align-self:center;"></span>`;
        }
        continue;
      }
      const isActive = this.activeFilter === tag;
      const display = tag.replace('-', ' ');
      html += this.renderChip(display, isActive, `gallery-filter-${tag}`);
    }

    html += `</div>`;

    // --- Labels for each cell (below each cell, in the label strip) ---
    const startIdx = this.page * this.pageSize;
    const count = Math.min(this.pageSize, this.filteredTypes.length - startIdx);
    for (let i = 0; i < count; i++) {
      const col = i % this.cols;
      const row = Math.floor(i / this.cols);
      const name = this.filteredTypes[startIdx + i];
      const displayName = name.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

      const left = ox + col * gm.cellW;
      const top = oy + gm.topPx + row * gm.rowSlotH + gm.cellH;

      html += `<div style="
        position:fixed;
        left:${left}px;
        top:${top}px;
        width:${gm.cellW}px;
        height:${gm.labelH}px;
        display:flex;
        align-items:center;
        justify-content:center;
        text-align:center;
        font-size:${mobile ? '11px' : '10px'};
        letter-spacing:1px;
        text-transform:uppercase;
        opacity:0.7;
        text-shadow: 0 1px 3px rgba(0,0,0,0.8);
        overflow:hidden;
        white-space:nowrap;
        text-overflow:ellipsis;
        padding:0 4px;
        box-sizing:border-box;
      ">${displayName}</div>`;
    }

    // --- Touch nav buttons (mobile only) ---
    if (mobile && this.totalPages > 1) {
      const btnStyle = `
        display:inline-block;
        padding:10px 20px;
        font-size:13px;
        font-family:inherit;
        letter-spacing:2px;
        text-transform:uppercase;
        background:rgba(255,255,255,0.08);
        border:1px solid rgba(255,255,255,0.25);
        border-radius:4px;
        color:#fff;
        cursor:pointer;
        user-select:none;
        pointer-events:auto;
        min-width:80px;
        text-align:center;
        transition:transform 0.1s ease, background 0.15s ease;
      `;
      const prevOpacity = this.page > 0 ? '0.8' : '0.2';
      const nextOpacity = this.page < this.totalPages - 1 ? '0.8' : '0.2';

      html += `<div style="
        position:fixed;
        bottom:${bottomOffset + 52}px;
        left:0;
        right:0;
        text-align:center;
        display:flex;
        justify-content:center;
        gap:16px;
        pointer-events:none;
      ">`;
      html += `<span id="gallery-prev-btn" style="${btnStyle}opacity:${prevOpacity};">\u2039 PREV</span>`;
      html += `<span id="gallery-next-btn" style="${btnStyle}opacity:${nextOpacity};">NEXT \u203a</span>`;
      html += `</div>`;
    }

    // --- Page indicator ---
    html += `<div style="
      position:fixed;
      bottom:${bottomOffset + 12}px;
      left:0;
      right:0;
      text-align:center;
      font-size:11px;
      letter-spacing:3px;
      text-transform:uppercase;
      opacity:0.5;
    ">${this.filteredTypes.length} elements \u00b7 PAGE ${this.page + 1} / ${this.totalPages}</div>`;

    // --- Navigation hint ---
    html += `<div style="
      position:fixed;
      bottom:${bottomOffset + 32}px;
      left:0;
      right:0;
      text-align:center;
      font-size:10px;
      letter-spacing:1px;
      opacity:0.35;
    ">${mobile ? 'Swipe or tap buttons to page \u00b7 Tap card to focus' : '\u2190 \u2192 page \u00b7 Click to focus \u00b7 Esc exit'}</div>`;

    this.overlay.innerHTML = html;

    // --- Wire up filter click handlers ---
    this.overlay.querySelector('#gallery-filter-all')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.setFilter(null);
    });
    for (const tag of ALL_TAGS) {
      if (tag === '|') continue;
      this.overlay.querySelector(`#gallery-filter-${tag}`)?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.setFilter(this.activeFilter === tag ? null : tag);
      });
    }

    // --- Wire up touch nav buttons ---
    const wireTouchFeedback = (el: Element | null) => {
      if (!el) return;
      el.addEventListener('touchstart', () => {
        (el as HTMLElement).style.transform = 'scale(0.92)';
        (el as HTMLElement).style.background = 'rgba(255,255,255,0.18)';
      });
      el.addEventListener('touchend', () => {
        (el as HTMLElement).style.transform = 'scale(1)';
        (el as HTMLElement).style.background = 'rgba(255,255,255,0.08)';
      });
    };
    const prevBtn = this.overlay.querySelector('#gallery-prev-btn');
    const nextBtn = this.overlay.querySelector('#gallery-next-btn');
    wireTouchFeedback(prevBtn);
    wireTouchFeedback(nextBtn);
    prevBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.prevPage();
    });
    nextBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.nextPage();
    });
  }

  private renderChip(label: string, active: boolean, id: string): string {
    const bg = active ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.05)';
    const border = active ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.15)';
    const opacity = active ? '1' : '0.55';
    return `<span id="${id}" style="
      display:inline-block;
      padding:2px 8px;
      font-size:9px;
      letter-spacing:1px;
      text-transform:uppercase;
      background:${bg};
      border:1px solid ${border};
      border-radius:3px;
      cursor:pointer;
      opacity:${opacity};
      transition:all 0.15s ease, transform 0.1s ease;
      user-select:none;
      white-space:nowrap;
      flex-shrink:0;
    ">${label}</span>`;
  }

  private handleWheel(e: WheelEvent): void {
    if (!this.active) return;
    e.preventDefault();
    if (e.deltaY > 0) {
      this.nextPage();
    } else if (e.deltaY < 0) {
      this.prevPage();
    }
  }

  private handleKey(e: KeyboardEvent): void {
    if (!this.active) return;
    switch (e.key) {
      case 'ArrowRight':
        e.preventDefault();
        this.nextPage();
        break;
      case 'ArrowLeft':
        e.preventDefault();
        this.prevPage();
        break;
      case 'b':
      case 'B':
      case 'Escape':
        e.preventDefault();
        this.exit();
        break;
    }
  }

  private handleClick(e: MouseEvent): void {
    if (!this.active) return;
    this.hitTestCell(e.clientX, e.clientY);
  }

  private handleTouchStart(e: TouchEvent): void {
    if (!this.active || e.touches.length !== 1) return;
    this.swipeStartX = e.touches[0].clientX;
    this.swipeStartY = e.touches[0].clientY;
  }

  private handleTouchEnd(e: TouchEvent): void {
    if (!this.active) return;
    const touch = e.changedTouches[0];
    if (!touch) return;

    const dx = touch.clientX - this.swipeStartX;
    const dy = touch.clientY - this.swipeStartY;

    // If horizontal swipe is dominant and exceeds threshold, navigate pages
    if (Math.abs(dx) > SWIPE_THRESHOLD && Math.abs(dx) > Math.abs(dy) * 1.5) {
      e.preventDefault();
      if (dx < 0) {
        this.nextPage();
      } else {
        this.prevPage();
      }
      return;
    }

    // Otherwise treat as a cell tap
    if (Math.abs(dx) < 15 && Math.abs(dy) < 15) {
      e.preventDefault();
      this.hitTestCell(touch.clientX, touch.clientY);
    }
  }

  private hitTestCell(clientX: number, clientY: number): void {
    const canvas = this.ctx.renderer.domElement;
    const rect = canvas.getBoundingClientRect();
    const gm = this.gridMetrics(rect);
    const x = clientX - rect.left;
    const y = clientY - rect.top;

    // Check if click is within the inset grid area
    if (y < gm.topPx || y > rect.height - gm.bottomPx) return;

    const gridY = y - gm.topPx;
    const col = Math.max(0, Math.min(this.cols - 1, Math.floor(x / gm.cellW)));
    const row = Math.max(0, Math.min(this.rows - 1, Math.floor(gridY / gm.rowSlotH)));

    // Ignore clicks on the label strip below the cell
    const yInSlot = gridY - row * gm.rowSlotH;
    if (yInSlot > gm.cellH) return;

    const cellIndex = row * this.cols + col;
    const filteredIndex = this.page * this.pageSize + cellIndex;

    if (filteredIndex < this.filteredTypes.length) {
      this.exitToShowcase(this.filteredTypes[filteredIndex]);
    }
  }

  private applyAspect(): void {
    const mobile = this.isMobile;
    const viewportH = mobile ? window.innerHeight - TOOLBAR_HEIGHT : window.innerHeight;
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

  private handleResize(): void {
    if (!this.active) return;
    this.updateGridDimensions();
    this.recomputePages();
    // Clamp page if grid size changed
    if (this.page >= this.totalPages) this.page = Math.max(0, this.totalPages - 1);
    this.applyAspect();
    resizeRenderer(this.ctx, this.config.width, this.config.height);
    this.pipeline.resize(this.config.width, this.config.height);
    this.spawnPage();
  }

  private clearElements(): void {
    for (let i = 0; i < this.elements.length; i++) {
      this.ctx.scene.remove(this.wrappers[i]);
      this.elements[i].dispose();
    }
    this.elements = [];
    this.wrappers = [];
  }

  private spawnPage(): void {
    this.clearElements();
    this.elapsed = 0;

    this.palette = getPalette(this.config.palette);
    this.ctx.scene.background = this.palette.bg;

    const w = this.config.width;
    const h = this.config.height;
    const startIdx = this.page * this.pageSize;
    const count = Math.min(this.pageSize, this.filteredTypes.length - startIdx);

    // Compute inset grid area in normalized coords
    const canvasRect = this.ctx.renderer.domElement.getBoundingClientRect();
    const gm = this.gridMetrics(canvasRect);
    // GL coords: y=0 bottom, y=1 top. topNorm = filter bar at top of screen = top of GL.
    const gridBottom = gm.bottomNorm; // pagination area at screen bottom
    const gridCellH = (gm.cellH / canvasRect.height); // cell height in normalized coords
    const gridLabelH = (gm.labelH / canvasRect.height); // label strip height in normalized
    const gridRowSlotH = gridCellH + gridLabelH;
    const gridCellW = 1 / this.cols;

    for (let i = 0; i < count; i++) {
      const col = i % this.cols;
      const row = Math.floor(i / this.cols);
      const type = this.filteredTypes[startIdx + i];

      // GL y=0 is screen-bottom. Row 0 should be at top of grid area.
      // Top of grid area in GL = 1 - topNorm.
      // Row 0 cell top = 1 - topNorm, row 0 cell bottom = 1 - topNorm - gridCellH
      const flippedRow = (this.rows - 1 - row);
      const cellY = gridBottom + flippedRow * gridRowSlotH + gridLabelH; // skip label strip below
      const region: Region = createRegion(
        `gallery-${i}`,
        col * gridCellW,
        cellY,
        gridCellW,
        gridCellH,
        CELL_PAD,
      );
      region.elementType = type;

      const rng = new SeededRandom(this.config.seed + startIdx + i);
      const element = createElement(type, region, this.palette, rng, w, h);

      const wrapper = new THREE.Group();
      wrapper.add(element.group);
      this.ctx.scene.add(wrapper);

      // Immediately activate — skip boot animation in gallery
      element.group.visible = true;
      element.stateMachine.transition('active');

      this.elements.push(element);
      this.wrappers.push(wrapper);
    }

    this.updateOverlay();
  }
}
