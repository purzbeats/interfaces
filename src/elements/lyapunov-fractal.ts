import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Lyapunov exponent fractal. For a binary sequence like "AB", iterate
 * the logistic map x_{n+1} = r*x*(1-x) with r alternating between
 * parameters a and b according to the sequence. Color pixels by the
 * Lyapunov exponent: positive = chaos (bright), negative = stable (dim).
 * Canvas rendered with slow animation of parameter space.
 */
export class LyapunovFractalElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'lyapunov-fractal',
    meta: {
      shape: 'rectangular',
      roles: ['data-display', 'decorative'],
      moods: ['ambient', 'diagnostic'],
      bandAffinity: 'mid',
      sizes: ['needs-medium', 'needs-large'],
    },
  };

  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private texture!: THREE.CanvasTexture;
  private mesh!: THREE.Mesh;
  private cw = 0;
  private ch = 0;

  private sequence: number[] = [];
  private aMin = 0; private aMax = 0;
  private bMin = 0; private bMax = 0;
  private iterations = 0;
  private warmup = 0;
  private panSpeed = 0;
  private redrawTimer = 0;
  private redrawInterval = 0;
  private imageData!: ImageData;

  build(): void {
    this.glitchAmount = 4;
    const variant = this.rng.int(0, 3);
    const { x, y, w, h } = this.px;

    const presets = [
      { seq: [0, 1],          aRange: [2.0, 4.0], bRange: [2.0, 4.0], iter: 60,  warm: 20, pan: 0.03, interval: 1.5 },
      { seq: [0, 0, 1],      aRange: [2.5, 3.8], bRange: [2.5, 4.0], iter: 50,  warm: 15, pan: 0.05, interval: 2.0 },
      { seq: [0, 1, 1, 0],   aRange: [1.5, 4.0], bRange: [1.5, 4.0], iter: 80,  warm: 25, pan: 0.02, interval: 1.0 },
      { seq: [0, 1, 0, 1, 1],aRange: [2.8, 3.9], bRange: [2.8, 3.9], iter: 55,  warm: 18, pan: 0.04, interval: 1.8 },
    ];
    const p = presets[variant];

    this.sequence = p.seq;
    this.aMin = p.aRange[0]; this.aMax = p.aRange[1];
    this.bMin = p.bRange[0]; this.bMax = p.bRange[1];
    this.iterations = p.iter;
    this.warmup = p.warm;
    this.panSpeed = p.pan;
    this.redrawInterval = p.interval;
    this.redrawTimer = 0;

    const maxRes = 140;
    const aspect = w / h;
    this.cw = Math.min(maxRes, Math.ceil(w));
    this.ch = Math.max(1, Math.ceil(this.cw / aspect));
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.cw;
    this.canvas.height = this.ch;
    this.ctx = this.get2DContext(this.canvas);
    this.imageData = this.ctx.createImageData(this.cw, this.ch);

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.LinearFilter;
    const geo = new THREE.PlaneGeometry(w, h);
    this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      map: this.texture, transparent: true, opacity: 0,
    }));
    this.mesh.position.set(x + w / 2, y + h / 2, 0);
    this.group.add(this.mesh);

    this.renderFractal(0);
  }

  private computeLyapunov(a: number, b: number): number {
    const seq = this.sequence;
    const seqLen = seq.length;
    let xVal = 0.5;
    let lyap = 0;

    // Warmup iterations
    for (let i = 0; i < this.warmup; i++) {
      const r = seq[i % seqLen] === 0 ? a : b;
      xVal = r * xVal * (1 - xVal);
      if (xVal <= 0 || xVal >= 1) { xVal = 0.5; }
    }

    // Compute Lyapunov exponent
    for (let i = 0; i < this.iterations; i++) {
      const r = seq[(this.warmup + i) % seqLen] === 0 ? a : b;
      xVal = r * xVal * (1 - xVal);
      if (xVal <= 0 || xVal >= 1) { xVal = 0.5; }
      const deriv = Math.abs(r * (1 - 2 * xVal));
      if (deriv > 0) lyap += Math.log(deriv);
    }

    return lyap / this.iterations;
  }

  private renderFractal(timeOffset: number): void {
    const data = this.imageData.data;
    const pr = (this.palette.primary.r * 255) | 0;
    const pg = (this.palette.primary.g * 255) | 0;
    const pb = (this.palette.primary.b * 255) | 0;
    const sr = (this.palette.secondary.r * 255) | 0;
    const sg = (this.palette.secondary.g * 255) | 0;
    const sb = (this.palette.secondary.b * 255) | 0;
    const dr = (this.palette.dim.r * 255) | 0;
    const dg = (this.palette.dim.g * 255) | 0;
    const db = (this.palette.dim.b * 255) | 0;

    const panA = Math.sin(timeOffset * this.panSpeed) * 0.2;
    const panB = Math.cos(timeOffset * this.panSpeed * 0.7) * 0.2;

    for (let py = 0; py < this.ch; py++) {
      const b = this.bMin + panB + (py / this.ch) * (this.bMax - this.bMin);
      for (let px = 0; px < this.cw; px++) {
        const a = this.aMin + panA + (px / this.cw) * (this.aMax - this.aMin);
        const lyap = this.computeLyapunov(a, b);
        const idx = (py * this.cw + px) * 4;

        if (lyap > 0) {
          // Chaotic: bright primary color
          const t = Math.min(lyap / 1.5, 1);
          data[idx]     = (pr * t) | 0;
          data[idx + 1] = (pg * t) | 0;
          data[idx + 2] = (pb * t) | 0;
        } else {
          // Stable: secondary/dim color
          const t = Math.min(Math.abs(lyap) / 2.0, 1);
          data[idx]     = (dr + (sr - dr) * t) | 0;
          data[idx + 1] = (dg + (sg - dg) * t) | 0;
          data[idx + 2] = (db + (sb - db) * t) | 0;
        }
        data[idx + 3] = 255;
      }
    }
    this.ctx.putImageData(this.imageData, 0, 0);
    this.texture.needsUpdate = true;
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    this.redrawTimer += dt;

    if (this.redrawTimer >= this.redrawInterval) {
      this.redrawTimer = 0;
      this.renderFractal(time);
    }

    (this.mesh.material as THREE.MeshBasicMaterial).opacity = opacity;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Scramble sequence temporarily
      const len = this.sequence.length;
      for (let i = 0; i < len; i++) {
        this.sequence[i] = this.rng.int(0, 1);
      }
      this.redrawTimer = this.redrawInterval;
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) {
      this.panSpeed = 0.03;
      return;
    }
    this.panSpeed = 0.03 + level * 0.02;
    this.redrawInterval = Math.max(0.3, 1.5 - level * 0.2);
  }
}
