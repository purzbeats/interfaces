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

    this.onExit();
  }

  /** Return to gallery, preserving gallery's page/filter state. */
  private backToGallery(): void {
    this.active = false;
    this.enteredFromGallery = false;
    if (this.fullscreen) {
      this.setFullscreen(false);
    }
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
    if (this.element) {
      this.ctx.scene.remove(this.wrapper);
      this.element.dispose();
      this.element = null;
      this.wrapper = new THREE.Group();
    }
  }

  private spawnElement(): void {
    this.clearElement();
    this.elapsed = 0;

    const type = this.types[this.currentIndex];
    this.palette = getPalette(this.config.palette);
    this.ctx.scene.background = this.palette.bg;

    const w = this.config.width;
    const h = this.config.height;

    // Inset region to leave room for the overlay bar at the bottom (GL y=0 is bottom)
    const bottomInset = this.fullscreen ? 0 : OVERLAY_BAR_PX / h;
    const region: Region = createRegion('showcase', 0, bottomInset, 1, 1 - bottomInset, 0.02);
    region.elementType = type;

    const rng = new SeededRandom(this.config.seed + this.currentIndex);
    this.element = createElement(type, region, this.palette, rng, w, h);

    this.wrapper = new THREE.Group();
    this.wrapper.add(this.element.group);
    this.ctx.scene.add(this.wrapper);

    // Immediately activate
    this.element.group.visible = true;
    this.element.stateMachine.transition('activating');

    this.updateOverlay();
  }

  update(dt: number): void {
    if (!this.active || !this.element) return;
    this.elapsed += dt;
    this.element.tick(dt, this.elapsed);
    this.pipeline.update(this.elapsed, this.config);
  }

  render(): void {
    if (!this.active) return;
    this.pipeline.composer.render();
  }

  private isMobile(): boolean {
    return window.matchMedia('(max-width: 767px) and (pointer: coarse)').matches;
  }

  private setFullscreen(on: boolean): void {
    this.fullscreen = on;
    this.overlay.style.display = on ? 'none' : '';
    // Hide/show the mobile toolbar
    const toolbar = document.getElementById('mobile-toolbar');
    if (toolbar) {
      toolbar.style.display = on ? 'none' : '';
    }
  }

  dispose(): void {
    this.swipeHandler?.destroy();
    this.swipeHandler = null;
    this.clearElement();
    this.overlay.remove();
    window.removeEventListener('keydown', this.keyHandler);
    window.removeEventListener('wheel', this.wheelHandler);
    window.removeEventListener('resize', this.resizeHandler);
  }
}
