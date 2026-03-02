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

const PAGE_SIZE = 16;
const COLS = 4;
const ROWS = 4;
const CELL_PAD = 0.01;

// All available filter tags, grouped by category
const SHAPE_TAGS = ['rectangular', 'linear', 'radial'] as const;
const ROLE_TAGS = ['gauge', 'scanner', 'data-display', 'text', 'decorative'] as const;
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
 * Gallery mode: 4×4 paginated grid of live element previews.
 * Click a tile to enter showcase mode focused on that element.
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
  private resizeHandler: () => void;
  private stashedChildren: THREE.Object3D[] = [];

  constructor(
    ctx: RendererContext,
    pipeline: PostFXPipeline,
    config: Config,
    showcase: ShowcaseMode,
    onExit: () => void,
  ) {
    this.ctx = ctx;
    this.pipeline = pipeline;
    this.config = config;
    this.showcase = showcase;
    this.onExit = onExit;
    this.allTypes = elementTypes().filter(t => t !== 'panel' && t !== 'separator');
    this.filteredTypes = this.allTypes;
    this.recomputePages();

    this.overlay = this.createOverlay();
    document.body.appendChild(this.overlay);
    this.overlay.style.display = 'none';

    this.keyHandler = (e: KeyboardEvent) => this.handleKey(e);
    this.clickHandler = (e: MouseEvent) => this.handleClick(e);
    this.resizeHandler = () => this.handleResize();
  }

  get isActive(): boolean {
    return this.active;
  }

  enter(): void {
    this.active = true;
    this.activeFilter = null;
    this.filteredTypes = this.allTypes;
    this.recomputePages();
    this.page = 0;
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
    this.ctx.renderer.domElement.addEventListener('click', this.clickHandler);
    window.addEventListener('resize', this.resizeHandler);

    this.spawnPage();
  }

  exit(): void {
    this.active = false;
    this.overlay.style.display = 'none';
    window.removeEventListener('keydown', this.keyHandler);
    this.ctx.renderer.domElement.removeEventListener('click', this.clickHandler);
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
    this.ctx.renderer.domElement.removeEventListener('click', this.clickHandler);
    window.removeEventListener('resize', this.resizeHandler);
    this.clearElements();

    // Restore stashed scene children so showcase can re-stash them
    for (const child of this.stashedChildren) {
      this.ctx.scene.add(child);
    }
    this.stashedChildren = [];

    // Map filtered type name back to showcase's global index
    const showcaseIndex = this.allTypes.indexOf(typeName);
    this.showcase.enter(showcaseIndex >= 0 ? showcaseIndex : 0);
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
    this.ctx.renderer.domElement.removeEventListener('click', this.clickHandler);
    window.removeEventListener('resize', this.resizeHandler);
  }

  // --- Private ---

  private recomputePages(): void {
    this.totalPages = Math.max(1, Math.ceil(this.filteredTypes.length / PAGE_SIZE));
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

  private updateOverlay(): void {
    const canvas = this.ctx.renderer.domElement;
    const canvasRect = canvas.getBoundingClientRect();
    const cellW = canvasRect.width / COLS;
    const cellH = canvasRect.height / ROWS;

    // Offset from viewport to canvas
    const ox = canvasRect.left;
    const oy = canvasRect.top;

    let html = '';

    // --- Filter bar at top ---
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

    // "ALL" chip
    const allActive = this.activeFilter === null;
    html += this.renderChip('ALL', allActive, 'gallery-filter-all');

    for (const tag of ALL_TAGS) {
      if (tag === '|') {
        html += `<span style="width:1px;height:16px;background:rgba(255,255,255,0.15);margin:0 2px;align-self:center;"></span>`;
        continue;
      }
      const isActive = this.activeFilter === tag;
      const display = tag.replace('-', ' ');
      html += this.renderChip(display, isActive, `gallery-filter-${tag}`);
    }

    html += `</div>`;

    // --- Labels for each cell ---
    const startIdx = this.page * PAGE_SIZE;
    const count = Math.min(PAGE_SIZE, this.filteredTypes.length - startIdx);
    for (let i = 0; i < count; i++) {
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      const name = this.filteredTypes[startIdx + i];
      const displayName = name.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

      const left = ox + col * cellW;
      const top = oy + (row + 1) * cellH - 24;

      html += `<div style="
        position:fixed;
        left:${left}px;
        top:${top}px;
        width:${cellW}px;
        text-align:center;
        font-size:10px;
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

    // --- Page indicator ---
    html += `<div style="
      position:fixed;
      bottom:12px;
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
      bottom:32px;
      left:0;
      right:0;
      text-align:center;
      font-size:10px;
      letter-spacing:1px;
      opacity:0.35;
    ">\u2190 \u2192 page \u00b7 Click to focus \u00b7 Esc exit</div>`;

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
      transition:all 0.15s ease;
      user-select:none;
    ">${label}</span>`;
  }

  private handleKey(e: KeyboardEvent): void {
    if (!this.active) return;
    switch (e.key) {
      case 'ArrowRight':
        e.preventDefault();
        if (this.page < this.totalPages - 1) {
          this.page++;
          this.spawnPage();
        }
        break;
      case 'ArrowLeft':
        e.preventDefault();
        if (this.page > 0) {
          this.page--;
          this.spawnPage();
        }
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
    const canvas = this.ctx.renderer.domElement;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const col = Math.max(0, Math.min(COLS - 1, Math.floor(x / (rect.width / COLS))));
    const row = Math.max(0, Math.min(ROWS - 1, Math.floor(y / (rect.height / ROWS))));
    const cellIndex = row * COLS + col;
    const filteredIndex = this.page * PAGE_SIZE + cellIndex;

    if (filteredIndex < this.filteredTypes.length) {
      this.exitToShowcase(this.filteredTypes[filteredIndex]);
    }
  }

  private applyAspect(): void {
    const { width, height, offsetX, offsetY } = computeAspectSize(
      this.config.aspectRatio,
      window.innerWidth,
      window.innerHeight,
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
    const startIdx = this.page * PAGE_SIZE;
    const count = Math.min(PAGE_SIZE, this.filteredTypes.length - startIdx);

    for (let i = 0; i < count; i++) {
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      const type = this.filteredTypes[startIdx + i];

      // Camera is (left=0, right=w, top=h, bottom=0) so y=0 is screen-bottom.
      // Flip row so row 0 renders at top of screen to match DOM labels.
      const flippedRow = (ROWS - 1 - row);
      const region: Region = createRegion(
        `gallery-${i}`,
        col / COLS,
        flippedRow / ROWS,
        1 / COLS,
        1 / ROWS,
        CELL_PAD,
      );
      region.elementType = type;

      const rng = new SeededRandom(this.config.seed + startIdx + i);
      const element = createElement(type, region, this.palette, rng, w, h);

      const wrapper = new THREE.Group();
      wrapper.add(element.group);
      this.ctx.scene.add(wrapper);

      // Immediately activate
      element.group.visible = true;
      element.stateMachine.transition('activating');

      this.elements.push(element);
      this.wrappers.push(wrapper);
    }

    this.updateOverlay();
  }
}
