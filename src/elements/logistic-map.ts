import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Bifurcation diagram of the logistic map. x_{n+1} = r*x_n*(1-x_n)
 * plotted for varying r, showing period doubling cascade to chaos.
 * Animated sweep reveals the diagram progressively.
 */
export class LogisticMapElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'logistic-map',
    meta: {
      shape: 'rectangular',
      roles: ['data-display', 'decorative'],
      moods: ['diagnostic', 'ambient'],
      bandAffinity: 'mid',
      sizes: ['needs-medium', 'needs-large'],
    },
  };

  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private texture!: THREE.CanvasTexture;
  private mesh!: THREE.Mesh;
  private material!: THREE.MeshBasicMaterial;

  private cw: number = 0;
  private ch: number = 0;
  private rMin: number = 2.5;
  private rMax: number = 4.0;
  private currentCol: number = 0;
  private colsPerFrame: number = 4;
  private warmup: number = 200;
  private plotIters: number = 100;
  private intensityLevel: number = 0;
  private scanlineX: number = 0;
  private highlightR: number = 3.57; // onset of chaos

  build(): void {
    const variant = this.rng.int(0, 3);
    const presets = [
      { rMin: 2.5, rMax: 4.0, warmup: 200, plotIters: 100, cols: 4, highlight: 3.57 },   // Full view
      { rMin: 3.4, rMax: 3.7, warmup: 500, plotIters: 200, cols: 2, highlight: 3.57 },   // Period-doubling zoom
      { rMin: 3.8, rMax: 4.0, warmup: 300, plotIters: 150, cols: 3, highlight: 3.83 },   // Chaotic regime
      { rMin: 3.52, rMax: 3.60, warmup: 800, plotIters: 300, cols: 1, highlight: 3.57 }, // Deep zoom
    ];
    const p = presets[variant];

    this.rMin = p.rMin;
    this.rMax = p.rMax;
    this.warmup = p.warmup;
    this.plotIters = p.plotIters;
    this.colsPerFrame = p.cols;
    this.highlightR = p.highlight;
    this.currentCol = 0;
    this.glitchAmount = 4;

    const { x, y, w, h } = this.px;
    this.cw = Math.max(64, Math.floor(w * 0.7));
    this.ch = Math.max(48, Math.floor(h * 0.7));

    this.canvas = document.createElement('canvas');
    this.canvas.width = this.cw;
    this.canvas.height = this.ch;
    this.ctx = this.get2DContext(this.canvas);

    // Clear
    const bg = this.palette.bg;
    this.ctx.fillStyle = `rgb(${Math.floor(bg.r * 255)},${Math.floor(bg.g * 255)},${Math.floor(bg.b * 255)})`;
    this.ctx.fillRect(0, 0, this.cw, this.ch);

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.magFilter = THREE.NearestFilter;

    this.material = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      opacity: 0,
    });

    const geo = new THREE.PlaneGeometry(w, h);
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.position.set(x + w / 2, y + h / 2, 0);
    this.group.add(this.mesh);
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);
    this.material.opacity = opacity;

    const cols = this.colsPerFrame + this.intensityLevel;

    for (let c = 0; c < cols && this.currentCol < this.cw; c++) {
      this.renderColumn(this.currentCol);
      this.currentCol++;
    }

    // Draw scan line
    if (this.currentCol < this.cw) {
      const ctx = this.ctx;
      const sr = this.palette.secondary;
      ctx.strokeStyle = `rgba(${Math.floor(sr.r * 255)},${Math.floor(sr.g * 255)},${Math.floor(sr.b * 255)},0.5)`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(this.currentCol, 0);
      ctx.lineTo(this.currentCol, this.ch);
      ctx.stroke();
    }

    if (this.currentCol >= this.cw) {
      // Draw axis labels region
      this.drawOverlay();
      // Reset after pause
      setTimeout(() => {
        this.currentCol = 0;
        const bg = this.palette.bg;
        this.ctx.fillStyle = `rgb(${Math.floor(bg.r * 255)},${Math.floor(bg.g * 255)},${Math.floor(bg.b * 255)})`;
        this.ctx.fillRect(0, 0, this.cw, this.ch);
      }, 4000);
    }

    this.texture.needsUpdate = true;
  }

  private renderColumn(col: number): void {
    const r = this.rMin + (col / this.cw) * (this.rMax - this.rMin);
    let x = this.rng.float(0.1, 0.9); // random initial condition

    // Warmup iterations (discard transient)
    for (let i = 0; i < this.warmup; i++) {
      x = r * x * (1 - x);
    }

    const ctx = this.ctx;
    const pr = this.palette.primary;
    const sr = this.palette.secondary;

    // Is this near the highlight region?
    const nearHighlight = Math.abs(r - this.highlightR) < 0.02;
    const cr = nearHighlight ? sr : pr;

    // Plot iterations
    for (let i = 0; i < this.plotIters; i++) {
      x = r * x * (1 - x);
      const py = this.ch - x * this.ch; // y: 0 at bottom, 1 at top

      // Draw point as a small dot
      ctx.fillStyle = `rgba(${Math.floor(cr.r * 255)},${Math.floor(cr.g * 255)},${Math.floor(cr.b * 255)},0.15)`;
      ctx.fillRect(col, py, 1, 1);
    }
  }

  private drawOverlay(): void {
    const ctx = this.ctx;
    const dm = this.palette.dim;

    // Draw r axis ticks
    ctx.fillStyle = `rgba(${Math.floor(dm.r * 255)},${Math.floor(dm.g * 255)},${Math.floor(dm.b * 255)},0.5)`;
    ctx.font = `${Math.max(8, this.ch * 0.06)}px monospace`;
    ctx.textAlign = 'center';

    const ticks = 5;
    for (let i = 0; i <= ticks; i++) {
      const r = this.rMin + (i / ticks) * (this.rMax - this.rMin);
      const px = (i / ticks) * this.cw;
      ctx.fillText(r.toFixed(2), px, this.ch - 2);
    }
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Scramble some columns
      for (let i = 0; i < 20; i++) {
        const col = this.rng.int(0, this.cw - 1);
        const bg = this.palette.bg;
        this.ctx.fillStyle = `rgb(${Math.floor(bg.r * 255)},${Math.floor(bg.g * 255)},${Math.floor(bg.b * 255)})`;
        this.ctx.fillRect(col, 0, 3, this.ch);
      }
      this.texture.needsUpdate = true;
    }
    if (action === 'pulse') {
      this.currentCol = 0;
      const bg = this.palette.bg;
      this.ctx.fillStyle = `rgb(${Math.floor(bg.r * 255)},${Math.floor(bg.g * 255)},${Math.floor(bg.b * 255)})`;
      this.ctx.fillRect(0, 0, this.cw, this.ch);
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    this.intensityLevel = level;
  }
}
