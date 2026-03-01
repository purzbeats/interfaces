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
  private keyHandler: (e: KeyboardEvent) => void;
  private resizeHandler: () => void;
  private stashedChildren: THREE.Object3D[] = [];

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
    this.resizeHandler = () => this.handleResize();
  }

  private createOverlay(): HTMLDivElement {
    const el = document.createElement('div');
    el.id = 'showcase-overlay';
    Object.assign(el.style, {
      position: 'fixed',
      bottom: '0',
      left: '0',
      right: '0',
      padding: '24px 32px',
      background: 'linear-gradient(transparent, rgba(0,0,0,0.85))',
      color: '#fff',
      fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", monospace',
      zIndex: '900',
      pointerEvents: 'none',
      transition: 'opacity 0.3s ease',
    });
    return el;
  }

  private updateOverlay(): void {
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

    this.overlay.innerHTML = `
      <div style="display:flex; align-items:flex-end; justify-content:space-between; gap:16px;">
        <div>
          <div style="font-size:11px; letter-spacing:3px; text-transform:uppercase; opacity:0.5; margin-bottom:4px;">
            ELEMENT ${num} / ${total}
          </div>
          <div style="font-size:28px; font-weight:bold; letter-spacing:2px; text-transform:uppercase;">
            ${displayName}
          </div>
          <div style="font-size:11px; opacity:0.45; margin-top:6px; letter-spacing:1px;">
            ${tags.join(' \u00b7 ')}
          </div>
        </div>
        <div style="font-size:11px; opacity:0.4; text-align:right; white-space:nowrap;">
          \u2190 \u2192 navigate &nbsp;\u00b7&nbsp; G exit
        </div>
      </div>
    `;
  }

  enter(startIndex?: number): void {
    this.active = true;
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
    window.addEventListener('resize', this.resizeHandler);
    this.spawnElement();
  }

  exit(): void {
    this.active = false;
    this.overlay.style.display = 'none';
    window.removeEventListener('keydown', this.keyHandler);
    window.removeEventListener('resize', this.resizeHandler);
    this.clearElement();

    // Restore stashed scene children
    for (const child of this.stashedChildren) {
      this.ctx.scene.add(child);
    }
    this.stashedChildren = [];

    this.onExit();
  }

  get isActive(): boolean {
    return this.active;
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

    // Use aspect-constrained dimensions from config
    const w = this.config.width;
    const h = this.config.height;

    // Fullscreen region with small padding
    const region: Region = createRegion('showcase', 0, 0, 1, 1, 0.02);
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

  dispose(): void {
    this.clearElement();
    this.overlay.remove();
    window.removeEventListener('keydown', this.keyHandler);
    window.removeEventListener('resize', this.resizeHandler);
  }
}
