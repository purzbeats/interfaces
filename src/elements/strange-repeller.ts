import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Inverse strange attractor: compute escape-time for points and render as a
 * fractal boundary map. Parameters drift slowly creating evolving fractal
 * landscapes reminiscent of Julia set boundaries.
 */
export class StrangeRepellerElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'strange-repeller',
    meta: {
      shape: 'rectangular',
      roles: ['decorative', 'data-display'],
      moods: ['ambient', 'diagnostic'],
      bandAffinity: 'sub',
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
  private maxIter: number = 32;
  private paramA: number = 0;
  private paramB: number = 0;
  private driftSpeedA: number = 0;
  private driftSpeedB: number = 0;
  private mapType: number = 0;
  private zoom: number = 2.5;
  private centerX: number = 0;
  private centerY: number = 0;
  private intensityLevel: number = 0;
  private renderRow: number = 0;
  private rowsPerFrame: number = 4;
  private imageData!: ImageData;

  build(): void {
    const variant = this.rng.int(0, 3);
    const presets = [
      { maxIter: 32, mapType: 0, zoom: 2.5, dA: 0.15, dB: 0.12, rows: 4 },   // Quadratic Julia drift
      { maxIter: 48, mapType: 1, zoom: 3.0, dA: 0.08, dB: 0.1, rows: 3 },    // Burning Ship variant
      { maxIter: 28, mapType: 2, zoom: 2.0, dA: 0.2, dB: 0.15, rows: 6 },    // Henon escape
      { maxIter: 40, mapType: 3, zoom: 2.8, dA: 0.1, dB: 0.18, rows: 4 },    // Tricorn
    ];
    const p = presets[variant];

    this.maxIter = p.maxIter;
    this.mapType = p.mapType;
    this.zoom = p.zoom;
    this.driftSpeedA = p.dA;
    this.driftSpeedB = p.dB;
    this.rowsPerFrame = p.rows;
    this.paramA = this.rng.float(-0.8, 0.8);
    this.paramB = this.rng.float(-0.8, 0.8);

    const { x, y, w, h } = this.px;
    this.cw = Math.max(32, Math.floor(w * 0.4));
    this.ch = Math.max(32, Math.floor(h * 0.4));

    this.canvas = document.createElement('canvas');
    this.canvas.width = this.cw;
    this.canvas.height = this.ch;
    this.ctx = this.get2DContext(this.canvas);
    this.imageData = this.ctx.createImageData(this.cw, this.ch);

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

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    this.material.opacity = opacity;

    // Drift parameters
    this.paramA = 0.7885 * Math.cos(time * this.driftSpeedA);
    this.paramB = 0.7885 * Math.sin(time * this.driftSpeedB);

    // Progressive rendering: render a few rows per frame
    const rows = this.rowsPerFrame + this.intensityLevel;
    for (let r = 0; r < rows && this.renderRow < this.ch; r++) {
      this.renderScanline(this.renderRow);
      this.renderRow++;
    }

    if (this.renderRow >= this.ch) {
      this.renderRow = 0;
      this.ctx.putImageData(this.imageData, 0, 0);
      this.texture.needsUpdate = true;
    }
  }

  private renderScanline(row: number): void {
    const w = this.cw;
    const data = this.imageData.data;
    const maxIter = this.maxIter;
    const zoom = this.zoom;
    const cx = this.centerX;
    const cy = this.centerY;

    const pr = this.palette.primary.r;
    const pg = this.palette.primary.g;
    const pb = this.palette.primary.b;
    const sr = this.palette.secondary.r;
    const sg = this.palette.secondary.g;
    const sb = this.palette.secondary.b;
    const bgr = this.palette.bg.r;
    const bgg = this.palette.bg.g;
    const bgb = this.palette.bg.b;

    const y0 = (row / this.ch - 0.5) * zoom + cy;

    for (let col = 0; col < w; col++) {
      const x0 = (col / w - 0.5) * zoom * (w / this.ch) + cx;
      let iter = 0;
      let zx = x0;
      let zy = y0;

      switch (this.mapType) {
        case 0: // Julia set
          for (; iter < maxIter; iter++) {
            const zx2 = zx * zx;
            const zy2 = zy * zy;
            if (zx2 + zy2 > 4) break;
            const tmp = zx2 - zy2 + this.paramA;
            zy = 2 * zx * zy + this.paramB;
            zx = tmp;
          }
          break;
        case 1: // Burning Ship variant
          for (; iter < maxIter; iter++) {
            const zx2 = zx * zx;
            const zy2 = zy * zy;
            if (zx2 + zy2 > 4) break;
            const tmp = zx2 - zy2 + this.paramA;
            zy = Math.abs(2 * zx * zy) + this.paramB;
            zx = tmp;
          }
          break;
        case 2: // Henon escape
          for (; iter < maxIter; iter++) {
            if (zx * zx + zy * zy > 4) break;
            const tmp = 1 - this.paramA * zx * zx + zy;
            zy = this.paramB * zx;
            zx = tmp;
          }
          break;
        case 3: // Tricorn
          for (; iter < maxIter; iter++) {
            const zx2 = zx * zx;
            const zy2 = zy * zy;
            if (zx2 + zy2 > 4) break;
            const tmp = zx2 - zy2 + this.paramA;
            zy = -2 * zx * zy + this.paramB;
            zx = tmp;
          }
          break;
      }

      const idx = (row * w + col) * 4;
      if (iter === maxIter) {
        data[idx] = bgr * 255;
        data[idx + 1] = bgg * 255;
        data[idx + 2] = bgb * 255;
      } else {
        const t = iter / maxIter;
        const t2 = t * t;
        data[idx] = (pr * t2 + sr * (1 - t2)) * 255;
        data[idx + 1] = (pg * t2 + sg * (1 - t2)) * 255;
        data[idx + 2] = (pb * t2 + sb * (1 - t2)) * 255;
      }
      data[idx + 3] = 255;
    }
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      this.paramA += this.rng.float(-0.3, 0.3);
      this.paramB += this.rng.float(-0.3, 0.3);
    }
    if (action === 'pulse') {
      this.zoom *= 0.8;
      setTimeout(() => { this.zoom /= 0.8; }, 600);
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    this.intensityLevel = level;
    if (level >= 4) {
      this.driftSpeedA = 0.4 + level * 0.1;
      this.driftSpeedB = 0.35 + level * 0.1;
    } else {
      this.driftSpeedA = 0.15;
      this.driftSpeedB = 0.12;
    }
  }
}
