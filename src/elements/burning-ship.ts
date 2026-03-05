import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Burning Ship fractal — like Mandelbrot but with absolute values:
 *   z = (|Re(z)| + i|Im(z)|)^2 + c
 * Canvas rendered with escape-time coloring. Continuous zoom animation
 * toward interesting regions of the fractal.
 */
export class BurningShipElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'burning-ship',
    meta: {
      shape: 'rectangular',
      roles: ['data-display', 'decorative'],
      moods: ['ambient', 'tactical'],
      bandAffinity: 'bass',
      sizes: ['needs-medium', 'needs-large'],
    },
  };

  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private texture!: THREE.CanvasTexture;
  private mesh!: THREE.Mesh;
  private imageData!: ImageData;
  private cw = 0;
  private ch = 0;

  private maxIter = 80;
  private centerX = -1.76;
  private centerY = -0.028;
  private zoomBase = 0.02;
  private zoomSpeed = 0.08;
  private zoomPhase = 0;
  private colorScheme = 0;
  private needsRedraw = true;
  private lastDrawnTime = -1;
  private redrawInterval = 0.12;

  // Zoom targets — interesting regions of the Burning Ship
  private targetX = -1.76;
  private targetY = -0.028;
  private driftSpeed = 0.02;

  build(): void {
    this.glitchAmount = 4;
    const variant = this.rng.int(0, 4);
    const { x, y, w, h } = this.px;

    const presets = [
      { maxIter: 80,  centerX: -1.76,  centerY: -0.028, zoomBase: 0.02,  zoomSpeed: 0.08, colorScheme: 0 },
      { maxIter: 80,  centerX: -1.772, centerY: -0.042, zoomBase: 0.005, zoomSpeed: 0.06, colorScheme: 1 },
      { maxIter: 60,  centerX: -0.5,   centerY: -0.5,   zoomBase: 2.0,   zoomSpeed: 0.10, colorScheme: 2 },
      { maxIter: 100, centerX: -1.755, centerY: -0.022, zoomBase: 0.01,  zoomSpeed: 0.05, colorScheme: 3 },
    ];
    const p = presets[variant];
    this.maxIter = p.maxIter;
    this.centerX = p.centerX;
    this.centerY = p.centerY;
    this.targetX = p.centerX;
    this.targetY = p.centerY;
    this.zoomBase = p.zoomBase;
    this.zoomSpeed = p.zoomSpeed;
    this.colorScheme = p.colorScheme;

    const maxRes = 160;
    const aspect = w / h;
    this.cw = Math.min(maxRes, Math.ceil(w * 0.4));
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
  }

  /** Map iteration count to color */
  private iterToColor(iter: number, maxIter: number): [number, number, number] {
    if (iter >= maxIter) {
      const bg = this.palette.bg;
      return [(bg.r * 255) | 0, (bg.g * 255) | 0, (bg.b * 255) | 0];
    }

    const t = iter / maxIter;

    // Different color mapping schemes based on palette
    const pr = this.palette.primary;
    const sr = this.palette.secondary;
    const dm = this.palette.dim;

    switch (this.colorScheme) {
      case 0: {
        // Smooth gradient primary -> secondary -> dim
        if (t < 0.5) {
          const s = t * 2;
          return [
            ((pr.r * (1 - s) + sr.r * s) * 255) | 0,
            ((pr.g * (1 - s) + sr.g * s) * 255) | 0,
            ((pr.b * (1 - s) + sr.b * s) * 255) | 0,
          ];
        } else {
          const s = (t - 0.5) * 2;
          return [
            ((sr.r * (1 - s) + dm.r * s) * 255) | 0,
            ((sr.g * (1 - s) + dm.g * s) * 255) | 0,
            ((sr.b * (1 - s) + dm.b * s) * 255) | 0,
          ];
        }
      }
      case 1: {
        // Banded: repeating stripes
        const band = (iter % 8) / 8;
        return [
          ((pr.r * band + dm.r * (1 - band)) * 255) | 0,
          ((pr.g * band + dm.g * (1 - band)) * 255) | 0,
          ((pr.b * band + dm.b * (1 - band)) * 255) | 0,
        ];
      }
      case 2: {
        // Logarithmic smooth
        const logT = Math.log(1 + iter) / Math.log(1 + maxIter);
        return [
          ((pr.r * logT) * 255) | 0,
          ((pr.g * logT) * 255) | 0,
          ((pr.b * logT + sr.b * (1 - logT) * 0.3) * 255) | 0,
        ];
      }
      default: {
        // HSL rotation
        const hue = t * 3 % 1;
        const c = new THREE.Color().setHSL(hue, 0.7, 0.3 + t * 0.4);
        return [(c.r * 255) | 0, (c.g * 255) | 0, (c.b * 255) | 0];
      }
    }
  }

  private renderFractal(time: number): void {
    const data = this.imageData.data;

    // Continuous zoom
    this.zoomPhase = time * this.zoomSpeed;
    const zoomCycle = Math.sin(this.zoomPhase) * 0.5 + 0.5; // 0-1
    const zoom = this.zoomBase * Math.pow(10, zoomCycle * 2); // zoom in and out

    const aspect = this.cw / this.ch;
    const halfW = zoom * aspect;
    const halfH = zoom;

    // Slowly drift center toward target
    this.centerX += (this.targetX - this.centerX) * this.driftSpeed;
    this.centerY += (this.targetY - this.centerY) * this.driftSpeed;

    for (let py = 0; py < this.ch; py++) {
      for (let px = 0; px < this.cw; px++) {
        const cr = this.centerX + (px / this.cw - 0.5) * halfW * 2;
        const ci = this.centerY + (py / this.ch - 0.5) * halfH * 2;

        let zr = 0, zi = 0;
        let iter = 0;

        for (; iter < this.maxIter; iter++) {
          // Burning Ship: take absolute values before squaring
          const azr = Math.abs(zr);
          const azi = Math.abs(zi);

          const newR = azr * azr - azi * azi + cr;
          const newI = 2 * azr * azi + ci;

          zr = newR;
          zi = newI;

          if (zr * zr + zi * zi > 4) break;
        }

        const idx = (py * this.cw + px) * 4;
        const [r, g, b] = this.iterToColor(iter, this.maxIter);
        data[idx] = r;
        data[idx + 1] = g;
        data[idx + 2] = b;
        data[idx + 3] = 255;
      }
    }

    this.ctx.putImageData(this.imageData, 0, 0);

    // Draw border
    const dimC = this.palette.dim;
    this.ctx.strokeStyle = `rgba(${(dimC.r * 255) | 0},${(dimC.g * 255) | 0},${(dimC.b * 255) | 0},0.5)`;
    this.ctx.lineWidth = 1;
    this.ctx.strokeRect(0, 0, this.cw, this.ch);
    // Zoom indicator
    const primC = this.palette.primary;
    this.ctx.fillStyle = `rgba(${(primC.r * 255) | 0},${(primC.g * 255) | 0},${(primC.b * 255) | 0},0.5)`;
    this.ctx.font = `${Math.max(7, this.ch * 0.06)}px monospace`;
    this.ctx.fillText(`z:${zoom.toExponential(1)}`, 2, this.ch - 3);
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);

    if (time - this.lastDrawnTime > this.redrawInterval || this.needsRedraw) {
      this.renderFractal(time);
      this.texture.needsUpdate = true;
      this.lastDrawnTime = time;
      this.needsRedraw = false;
    }

    (this.mesh.material as THREE.MeshBasicMaterial).opacity = opacity;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Jump to a random interesting region
      const regions = [
        [-1.76, -0.028],
        [-1.772, -0.042],
        [-1.755, -0.02],
        [-0.515, -0.65],
        [-1.78, -0.01],
      ];
      const r = regions[this.rng.int(0, regions.length)];
      this.targetX = r[0] + this.rng.float(-0.01, 0.01);
      this.targetY = r[1] + this.rng.float(-0.01, 0.01);
      this.needsRedraw = true;
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level >= 2) {
      this.zoomSpeed = 0.08 + level * 0.02;
      this.needsRedraw = true;
    }
    if (level === 0) {
      this.zoomSpeed = 0.08;
    }
  }
}
