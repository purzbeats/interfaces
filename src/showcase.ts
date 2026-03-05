import * as THREE from 'three';
import { SeededRandom } from './random';
import { createRegion, type Region } from './layout/region';
import { createElement, elementTypes } from './elements/registry';
import { getPalette, type Palette } from './color/palettes';
import { type BaseElement } from './elements/base-element';
import { resizeRenderer, type RendererContext } from './renderer/setup';
import { type PostFXPipeline } from './postfx/pipeline';
import { type Config, computeAspectSize } from './config';
import { getMeta } from './elements/tags';
import { TOOLBAR_HEIGHT } from './gui/mobile-toolbar';

const OVERLAY_BAR_PX = 72; // reserved height for the info bar below the element

class TouchSwipeHandler {
  private startX = 0;
  private startY = 0;
  private el: HTMLElement;
  private onSwipe: (dir: 'left' | 'right' | 'down' | 'up' | 'tap' | 'doubletap') => void;
  private boundStart: (e: TouchEvent) => void;
  private boundEnd: (e: TouchEvent) => void;
  private lastTapTime: number = 0;
  private singleTapTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(el: HTMLElement, onSwipe: (dir: 'left' | 'right' | 'down' | 'up' | 'tap' | 'doubletap') => void) {
    this.el = el;
    this.onSwipe = onSwipe;
    this.boundStart = (e) => this.handleStart(e);
    this.boundEnd = (e) => this.handleEnd(e);
    this.el.addEventListener('touchstart', this.boundStart, { passive: true });
    this.el.addEventListener('touchend', this.boundEnd, { passive: true });
  }

  private handleStart(e: TouchEvent): void {
    const t = e.touches[0];
    this.startX = t.clientX;
    this.startY = t.clientY;
  }

  private handleEnd(e: TouchEvent): void {
    const t = e.changedTouches[0];
    const dx = t.clientX - this.startX;
    const dy = t.clientY - this.startY;
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);

    if (absDx < 10 && absDy < 10) {
      // Tap detected — check for double-tap
      const now = performance.now();
      if (now - this.lastTapTime < 300) {
        // Double-tap
        if (this.singleTapTimer !== null) {
          clearTimeout(this.singleTapTimer);
          this.singleTapTimer = null;
        }
        this.lastTapTime = 0;
        this.onSwipe('doubletap');
      } else {
        this.lastTapTime = now;
        this.singleTapTimer = setTimeout(() => {
          this.singleTapTimer = null;
          this.onSwipe('tap');
        }, 300);
      }
    } else if (dy > 60 && absDy > absDx) {
      this.onSwipe('down');
    } else if (dy < -60 && absDy > absDx) {
      this.onSwipe('up');
    } else if (dx < -40 && absDx > absDy) {
      this.onSwipe('left');
    } else if (dx > 40 && absDx > absDy) {
      this.onSwipe('right');
    }
  }

  destroy(): void {
    if (this.singleTapTimer !== null) clearTimeout(this.singleTapTimer);
    this.el.removeEventListener('touchstart', this.boundStart);
    this.el.removeEventListener('touchend', this.boundEnd);
  }
}

/**
 * Showcase mode: cycles through every element type fullscreen
 * with a title card overlay. Left/Right arrows to navigate.
 */
export class ShowcaseMode {
  private ctx: RendererContext;
  private pipeline: PostFXPipeline;
  private config: Config;
  private types: string[];
  private currentIndex: number = 0;
  private element: BaseElement | null = null;
  private elements: BaseElement[] = [];
  private wrapper: THREE.Group = new THREE.Group();
  private palette!: Palette;
  private elapsed: number = 0;
  private overlay: HTMLDivElement;
  private active: boolean = false;
  private onExit: () => void;
  private onBackToGallery: (() => void) | null = null;
  private enteredFromGallery: boolean = false;
  private keyHandler: (e: KeyboardEvent) => void;
  private wheelHandler: (e: WheelEvent) => void;
  private resizeHandler: () => void;
  private stashedChildren: THREE.Object3D[] = [];
  private swipeHandler: TouchSwipeHandler | null = null;
  private fullscreen: boolean = false;

  // Performance debug overlay
  private perfOverlay: HTMLDivElement | null = null;
  private perfVisible: boolean = false;
  private frameTimes: number[] = [];
  private lastFrameTime: number = 0;
  private updateDurations: number[] = [];
  private renderDurations: number[] = [];

  constructor(ctx: RendererContext, pipeline: PostFXPipeline, config: Config, onExit: () => void) {
    this.ctx = ctx;
    this.pipeline = pipeline;
    this.config = config;
    this.onExit = onExit;
    // Exclude 'panel' and 'separator' — they are structural, not interesting solo
    this.types = elementTypes().filter(t => t !== 'panel' && t !== 'separator');

    this.overlay = this.createOverlay();
    document.body.appendChild(this.overlay);
    this.overlay.style.display = 'none';

    this.keyHandler = (e: KeyboardEvent) => this.handleKey(e);
    this.wheelHandler = (e: WheelEvent) => this.handleWheel(e);
    this.resizeHandler = () => this.handleResize();
  }

  private createOverlay(): HTMLDivElement {
    const el = document.createElement('div');
    el.id = 'showcase-overlay';
    Object.assign(el.style, {
      position: 'fixed',
      left: '0',
      right: '0',
      height: `${OVERLAY_BAR_PX}px`,
      display: 'flex',
      alignItems: 'center',
      padding: '0 24px',
      background: 'rgba(0,0,0,0.85)',
      borderTop: '1px solid rgba(255,255,255,0.1)',
      color: '#fff',
      fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", monospace',
      zIndex: '900',
      pointerEvents: 'none',
      transition: 'opacity 0.3s ease',
      boxSizing: 'border-box',
    });
    return el;
  }

  private updateOverlay(): void {
    const mobile = this.isMobile();
    const bottomOffset = mobile ? TOOLBAR_HEIGHT : 0;
    this.overlay.style.bottom = `${bottomOffset}px`;

    const name = this.types[this.currentIndex];
    const meta = getMeta(name);
    const displayName = name.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    const total = this.types.length;
    const num = this.currentIndex + 1;

    const tags: string[] = [];
    if (meta) {
      tags.push(meta.shape);
      tags.push(...meta.roles);
      tags.push(...meta.moods);
      tags.push(...meta.sizes);
    }

    let hints: string;
    if (mobile) {
      hints = 'swipe \u2194 navigate \u00b7 double-tap fullscreen';
    } else {
      const parts: string[] = ['\u2190 \u2192 or scroll', 'F fullscreen'];
      if (this.enteredFromGallery) parts.push('B back');
      parts.push('G exit');
      hints = parts.join(' \u00b7 ');
    }

    this.overlay.innerHTML = `
      <div style="flex:1; min-width:0;">
        <div style="font-size:10px; letter-spacing:3px; text-transform:uppercase; opacity:0.5; margin-bottom:2px;">
          ELEMENT ${num} / ${total}
        </div>
        <div style="font-size:20px; font-weight:bold; letter-spacing:2px; text-transform:uppercase; overflow:hidden; white-space:nowrap; text-overflow:ellipsis;">
          ${displayName}
        </div>
        <div style="font-size:10px; opacity:0.45; margin-top:4px; letter-spacing:1px;">
          ${tags.join(' \u00b7 ')}
        </div>
      </div>
      <div style="font-size:10px; opacity:0.4; text-align:right; white-space:nowrap; flex-shrink:0;">
        ${hints}
      </div>
    `;
  }

  /** Get the list of element type names. */
  getTypes(): string[] { return this.types; }

  /** Get the current element type name. */
  getCurrentType(): string { return this.types[this.currentIndex]; }

  /** Re-spawn the current element (e.g. after toggling fullscreen). */
  respawn(): void { if (this.active) this.spawnElement(); }

  enter(startIndex?: number, fromGallery: boolean = false): void {
    this.active = true;
    this.enteredFromGallery = fromGallery;
    this.currentIndex = startIndex ?? 0;
    this.overlay.style.display = '';

    // Stash all existing scene children so they don't render behind us
    this.stashedChildren = [...this.ctx.scene.children];
    for (const child of this.stashedChildren) {
      this.ctx.scene.remove(child);
    }

    // Ensure renderer matches the aspect-constrained dimensions
    this.applyAspect();
    resizeRenderer(this.ctx, this.config.width, this.config.height);
    this.pipeline.resize(this.config.width, this.config.height);

    window.addEventListener('keydown', this.keyHandler);
    window.addEventListener('wheel', this.wheelHandler, { passive: false });
    window.addEventListener('resize', this.resizeHandler);
    this.swipeHandler = new TouchSwipeHandler(
      this.ctx.renderer.domElement,
      (dir) => {
        switch (dir) {
          case 'left':
            if (!this.fullscreen) {
              this.currentIndex = (this.currentIndex + 1) % this.types.length;
              this.spawnElement();
            }
            break;
          case 'right':
            if (!this.fullscreen) {
              this.currentIndex = (this.currentIndex - 1 + this.types.length) % this.types.length;
              this.spawnElement();
            }
            break;
          case 'down':
            if (!this.fullscreen) {
              this.setFullscreen(true);
              this.spawnElement();
            }
            break;
          case 'up':
            if (this.fullscreen) {
              this.setFullscreen(false);
              this.spawnElement();
            }
            break;
          case 'tap':
            if (this.fullscreen) {
              this.setFullscreen(false);
            } else {
              this.exit();
            }
            break;
          case 'doubletap':
            this.setFullscreen(!this.fullscreen);
            this.spawnElement();
            break;
        }
      }
    );
    this.spawnElement();
  }

  exit(): void {
    this.active = false;
    this.enteredFromGallery = false;
    if (this.fullscreen) {
      this.setFullscreen(false);
    }
    this.perfOverlay?.remove();
    this.perfOverlay = null;
    this.perfVisible = false;
    this.overlay.style.display = 'none';
    window.removeEventListener('keydown', this.keyHandler);
    window.removeEventListener('wheel', this.wheelHandler);
    window.removeEventListener('resize', this.resizeHandler);
    this.swipeHandler?.destroy();
    this.swipeHandler = null;
    this.clearElement();

    // Restore stashed scene children
    for (const child of this.stashedChildren) {
      this.ctx.scene.add(child);
    }
    this.stashedChildren = [];

    this.clearURL();
    this.onExit();
  }

  /** Return to gallery, preserving gallery's page/filter state. */
  private backToGallery(): void {
    this.active = false;
    this.enteredFromGallery = false;
    if (this.fullscreen) {
      this.setFullscreen(false);
    }
    this.perfOverlay?.remove();
    this.perfOverlay = null;
    this.perfVisible = false;
    this.overlay.style.display = 'none';
    window.removeEventListener('keydown', this.keyHandler);
    window.removeEventListener('wheel', this.wheelHandler);
    window.removeEventListener('resize', this.resizeHandler);
    this.swipeHandler?.destroy();
    this.swipeHandler = null;
    this.clearElement();

    // Restore stashed scene children so gallery can re-stash them
    for (const child of this.stashedChildren) {
      this.ctx.scene.add(child);
    }
    this.stashedChildren = [];

    this.onBackToGallery?.();
  }

  get isActive(): boolean {
    return this.active;
  }

  /** Set a callback for returning to gallery. Called by GalleryMode when entering showcase from grid. */
  setBackToGallery(cb: (() => void) | null): void {
    this.onBackToGallery = cb;
  }

  private handleWheel(e: WheelEvent): void {
    if (!this.active || this.fullscreen) return;
    e.preventDefault();
    if (e.deltaY > 0) {
      this.currentIndex = (this.currentIndex + 1) % this.types.length;
    } else if (e.deltaY < 0) {
      this.currentIndex = (this.currentIndex - 1 + this.types.length) % this.types.length;
    }
    this.spawnElement();
  }

  private handleKey(e: KeyboardEvent): void {
    if (!this.active) return;
    switch (e.key) {
      case 'ArrowRight':
        e.preventDefault();
        this.currentIndex = (this.currentIndex + 1) % this.types.length;
        this.spawnElement();
        break;
      case 'ArrowLeft':
        e.preventDefault();
        this.currentIndex = (this.currentIndex - 1 + this.types.length) % this.types.length;
        this.spawnElement();
        break;
      case 'd':
      case 'D':
        e.preventDefault();
        this.togglePerfOverlay();
        break;
      case 'f':
      case 'F':
        e.preventDefault();
        this.setFullscreen(!this.fullscreen);
        this.spawnElement(); // re-create with/without bottom inset
        break;
      case 'b':
      case 'B':
        if (this.enteredFromGallery && this.onBackToGallery) {
          e.preventDefault();
          this.backToGallery();
        }
        break;
      case 'g':
      case 'G':
      case 'Escape':
        e.preventDefault();
        this.exit();
        break;
    }
  }

  private applyAspect(): void {
    const { width, height, offsetX, offsetY } = computeAspectSize(
      this.config.aspectRatio,
      window.innerWidth,
      window.innerHeight
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
    this.spawnElement();
  }

  private clearElement(): void {
    if (this.element || this.elements.length > 0) {
      this.ctx.scene.remove(this.wrapper);
      this.element?.dispose();
      this.element = null;
      for (const el of this.elements) el.dispose();
      this.elements = [];
      this.wrapper = new THREE.Group();
    }
  }

  private spawnElement(): void {
    this.clearElement();
    this.elapsed = 0;
    // Reset perf stats for fresh element
    this.frameTimes = [];
    this.updateDurations = [];
    this.renderDurations = [];
    this.lastFrameTime = 0;

    const type = this.types[this.currentIndex];
    this.palette = getPalette(this.config.palette);
    this.ctx.scene.background = this.palette.bg;

    const w = this.config.width;
    const h = this.config.height;

    this.wrapper = new THREE.Group();

    if (this.fullscreen) {
      // Multi-aspect proof sheet layout
      this.spawnMultiAspect(type, w, h);
    } else {
      // Single element with overlay bar
      const bottomInset = OVERLAY_BAR_PX / h;
      const region: Region = createRegion('showcase', 0, bottomInset, 1, 1 - bottomInset, 0.02);
      region.elementType = type;

      const rng = new SeededRandom(this.config.seed + this.currentIndex);
      this.element = createElement(type, region, this.palette, rng, w, h);

      this.wrapper.add(this.element.group);

      this.element.group.visible = true;
      this.element.stateMachine.transition('active');
    }

    this.ctx.scene.add(this.wrapper);
    this.updateOverlay();
    this.updateURL();
  }

  /** Update URL to reflect current showcase state for shareable links. */
  private updateURL(): void {
    const url = new URL(window.location.href);
    url.searchParams.set('element', this.types[this.currentIndex]);
    url.searchParams.set('view', this.fullscreen ? 'multi' : 'single');
    url.searchParams.set('seed', String(this.config.seed));
    url.searchParams.set('palette', this.config.palette);
    window.history.replaceState({}, '', url.toString());
  }

  /** Remove showcase URL params when exiting. */
  private clearURL(): void {
    const url = new URL(window.location.href);
    url.searchParams.delete('element');
    url.searchParams.delete('view');
    window.history.replaceState({}, '', url.toString());
  }

  /**
   * Spawn 7 instances of the same element at different aspect ratios:
   * Top row: 16:9 wide
   * Bottom row: 9:16 tall | 1:1 square | 2x2 grid of small squares
   */
  private spawnMultiAspect(type: string, w: number, h: number): void {
    const g = 0.008; // gap between panels
    const topH = 0.42;
    const botY = topH + g;
    const botH = 1 - botY;

    // Column widths for bottom row
    const col1W = 0.22;
    const col2W = 0.38;
    const col3W = 1 - col1W - col2W - g * 2;

    const col1X = 0;
    const col2X = col1W + g;
    const col3X = col2X + col2W + g;

    // Define all 7 panel regions: [id, x, y, width, height]
    const panels: [string, number, number, number, number][] = [
      // Top: 16:9 wide
      ['wide', 0, 1 - topH, 1, topH],
      // Bottom-left: 9:16 tall
      ['tall', col1X, 0, col1W, botH - g],
      // Bottom-center: 1:1 square
      ['square', col2X, 0, col2W, botH - g],
      // Bottom-right: 2x2 grid of small squares
      ['sm-tl', col3X, (botH - g) / 2 + g / 2, (col3W - g) / 2, (botH - g) / 2 - g / 2],
      ['sm-tr', col3X + (col3W - g) / 2 + g, (botH - g) / 2 + g / 2, (col3W - g) / 2, (botH - g) / 2 - g / 2],
      ['sm-bl', col3X, 0, (col3W - g) / 2, (botH - g) / 2 - g / 2],
      ['sm-br', col3X + (col3W - g) / 2 + g, 0, (col3W - g) / 2, (botH - g) / 2 - g / 2],
    ];

    for (let i = 0; i < panels.length; i++) {
      const [id, x, y, pw, ph] = panels[i];
      const region = createRegion(`showcase-${id}`, x, y, pw, ph, 0.02);
      region.elementType = type;

      const rng = new SeededRandom(this.config.seed + this.currentIndex + i * 997);
      const el = createElement(type, region, this.palette, rng, w, h);

      this.wrapper.add(el.group);
      el.group.visible = true;
      el.stateMachine.transition('active');
      this.elements.push(el);
    }
  }

  update(dt: number): void {
    if (!this.active) return;
    if (!this.element && this.elements.length === 0) return;
    this.elapsed += dt;

    const now = performance.now();

    // Track frame interval
    if (this.lastFrameTime > 0) {
      this.frameTimes.push(now - this.lastFrameTime);
      if (this.frameTimes.length > 120) this.frameTimes.shift();
    }
    this.lastFrameTime = now;

    // Measure element update time
    const updateStart = performance.now();
    this.element?.tick(dt, this.elapsed);
    for (const el of this.elements) el.tick(dt, this.elapsed);
    const updateEnd = performance.now();
    this.updateDurations.push(updateEnd - updateStart);
    if (this.updateDurations.length > 120) this.updateDurations.shift();

    this.pipeline.update(this.elapsed, this.config);

    if (this.perfVisible) this.refreshPerfOverlay();
  }

  render(): void {
    if (!this.active) return;
    const renderStart = performance.now();
    this.pipeline.composer.render();
    const renderEnd = performance.now();
    this.renderDurations.push(renderEnd - renderStart);
    if (this.renderDurations.length > 120) this.renderDurations.shift();
  }

  private isMobile(): boolean {
    return window.matchMedia('(max-width: 767px) and (pointer: coarse)').matches;
  }

  private togglePerfOverlay(): void {
    this.perfVisible = !this.perfVisible;
    if (this.perfVisible) {
      this.frameTimes = [];
      this.updateDurations = [];
      this.renderDurations = [];
      this.lastFrameTime = 0;
      this.createPerfOverlay();
    } else {
      this.perfOverlay?.remove();
      this.perfOverlay = null;
    }
  }

  private createPerfOverlay(): void {
    this.perfOverlay?.remove();
    const el = document.createElement('div');
    el.id = 'perf-overlay';
    Object.assign(el.style, {
      position: 'fixed',
      top: '8px',
      right: '8px',
      background: 'rgba(0,0,0,0.85)',
      border: '1px solid rgba(255,255,255,0.2)',
      borderRadius: '4px',
      padding: '8px 12px',
      color: '#fff',
      fontFamily: '"JetBrains Mono", "Fira Code", monospace',
      fontSize: '11px',
      lineHeight: '1.6',
      zIndex: '9999',
      pointerEvents: 'none',
      minWidth: '200px',
    });
    document.body.appendChild(el);
    this.perfOverlay = el;
  }

  private refreshPerfOverlay(): void {
    if (!this.perfOverlay) return;

    const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
    const max = (arr: number[]) => arr.length > 0 ? Math.max(...arr) : 0;
    const pct = (arr: number[], p: number) => {
      if (arr.length === 0) return 0;
      const sorted = [...arr].sort((a, b) => a - b);
      return sorted[Math.min(Math.floor(sorted.length * p), sorted.length - 1)];
    };

    const avgFrame = avg(this.frameTimes);
    const fps = avgFrame > 0 ? 1000 / avgFrame : 0;
    const avgUpdate = avg(this.updateDurations);
    const maxUpdate = max(this.updateDurations);
    const p99Update = pct(this.updateDurations, 0.99);
    const avgRender = avg(this.renderDurations);
    const maxRender = max(this.renderDurations);

    const typeName = this.types[this.currentIndex];
    const total = avgUpdate + avgRender;
    const budget = 16.67; // 60fps
    const headroom = budget - total;

    // Color code based on headroom
    const fpsColor = fps >= 55 ? '#0f0' : fps >= 30 ? '#ff0' : '#f44';
    const updateColor = avgUpdate < 4 ? '#0f0' : avgUpdate < 8 ? '#ff0' : '#f44';
    const renderColor = avgRender < 4 ? '#0f0' : avgRender < 8 ? '#ff0' : '#f44';
    const headroomColor = headroom > 4 ? '#0f0' : headroom > 0 ? '#ff0' : '#f44';

    const instanceCount = this.fullscreen ? this.elements.length : (this.element ? 1 : 0);

    // Build mini bar chart of recent frame times (last 60 frames)
    const recent = this.frameTimes.slice(-60);
    let sparkline = '';
    if (recent.length > 0) {
      const barMax = Math.max(33, max(recent)); // 33ms = 30fps ceiling
      sparkline = '<div style="display:flex;align-items:flex-end;height:20px;gap:1px;margin:4px 0 2px;">';
      for (const ft of recent) {
        const h = Math.max(1, (ft / barMax) * 20);
        const c = ft < 16.67 ? '#0f0' : ft < 33.3 ? '#ff0' : '#f44';
        sparkline += `<div style="width:2px;height:${h}px;background:${c};"></div>`;
      }
      sparkline += '</div>';
    }

    this.perfOverlay.innerHTML = `
      <div style="font-size:9px;letter-spacing:2px;text-transform:uppercase;opacity:0.5;margin-bottom:4px;">
        PERF &middot; ${typeName} &middot; ${instanceCount} instance${instanceCount !== 1 ? 's' : ''}
      </div>
      <div style="color:${fpsColor}"><b>${fps.toFixed(1)} FPS</b> <span style="opacity:0.5">(${avgFrame.toFixed(1)}ms/frame)</span></div>
      <div style="color:${updateColor}">Update: ${avgUpdate.toFixed(2)}ms avg, ${maxUpdate.toFixed(1)}ms max, ${p99Update.toFixed(1)}ms p99</div>
      <div style="color:${renderColor}">Render: ${avgRender.toFixed(2)}ms avg, ${maxRender.toFixed(1)}ms max</div>
      <div style="color:${headroomColor}">Budget: ${total.toFixed(1)}ms / ${budget.toFixed(1)}ms (${headroom > 0 ? '+' : ''}${headroom.toFixed(1)}ms)</div>
      ${sparkline}
      <div style="font-size:9px;opacity:0.35;margin-top:2px;">D toggle &middot; green &lt;4ms &middot; yellow &lt;8ms &middot; red &gt;8ms</div>
    `;
  }

  setFullscreen(on: boolean): void {
    this.fullscreen = on;
    this.overlay.style.display = on ? 'none' : '';
    // Hide/show the mobile toolbar
    const toolbar = document.getElementById('mobile-toolbar');
    if (toolbar) {
      toolbar.style.display = on ? 'none' : '';
    }
    if (this.active) this.updateURL();
  }

  dispose(): void {
    this.swipeHandler?.destroy();
    this.swipeHandler = null;
    this.clearElement();
    this.perfOverlay?.remove();
    this.perfOverlay = null;
    this.overlay.remove();
    window.removeEventListener('keydown', this.keyHandler);
    window.removeEventListener('wheel', this.wheelHandler);
    window.removeEventListener('resize', this.resizeHandler);
  }
}
