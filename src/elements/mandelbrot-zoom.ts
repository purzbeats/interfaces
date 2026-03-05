import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Continuous Mandelbrot zoom into a visually interesting region.
 * Canvas-based progressive renderer that slowly zooms deeper each frame,
 * revealing infinite fractal detail at the boundary.
 */
export class MandelbrotZoomElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'mandelbrot-zoom',
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
  private targetX: number = -0.7436447860;
  private targetY: number = 0.1318259043;
  private zoom: number = 3.0;
  private zoomSpeed: number = 0.005;
  private maxIter: number = 64;
  private renderRow: number = 0;
  private rowsPerFrame: number = 6;
  private imageData!: ImageData;
  private intensityLevel: number = 0;
  private zoomMin: number = 3.0;
  private colorCycle: number = 0;

  // Interesting zoom targets
  private static readonly TARGETS = [
    { x: -0.7436447860, y: 0.1318259043 },  // Seahorse valley
    { x: -0.1592, y: 1.0328 },              // Mini-brot
    { x: -0.7498, y: 0.012 },               // Elephant valley
    { x: 0.3602, y: -0.6413 },              // Spiral
  ];

  build(): void {
    const variant = this.rng.int(0, 3);
    const presets = [
      { maxIter: 64, zoomSpd: 0.005, rows: 6, target: 0 },   // Seahorse slow
      { maxIter: 80, zoomSpd: 0.008, rows: 4, target: 1 },   // Mini-brot
      { maxIter: 48, zoomSpd: 0.012, rows: 8, target: 2 },   // Elephant fast
      { maxIter: 96, zoomSpd: 0.003, rows: 3, target: 3 },   // Spiral hi-detail
    ];
    const p = presets[variant];

    this.maxIter = p.maxIter;
    this.zoomSpeed = p.zoomSpd;
    this.rowsPerFrame = p.rows;
    const t = MandelbrotZoomElement.TARGETS[p.target];
    this.targetX = t.x;
    this.targetY = t.y;
    this.zoom = 3.0;
    this.zoomMin = 3.0;
    this.glitchAmount = 4;

    const { x, y, w, h } = this.px;
    this.cw = Math.max(48, Math.floor(w * 0.45));
    this.ch = Math.max(48, Math.floor(h * 0.45));

    this.canvas = document.createElement('canvas');
    this.canvas.width = this.cw;
    this.canvas.height = this.ch;
    this.ctx = this.get2DContext(this.canvas);
    this.imageData = this.ctx.createImageData(this.cw, this.ch);

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;

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

    this.colorCycle = time * 0.3;

    // Zoom in continuously
    this.zoom *= (1 - this.zoomSpeed * (1 + this.intensityLevel * 0.5));
    // Reset when very deep (precision limits)
    if (this.zoom < 1e-12) {
      this.zoom = this.zoomMin;
    }

    // Increase iterations as we zoom deeper
    const depthFactor = Math.log2(this.zoomMin / this.zoom);
    const dynamicIter = Math.min(256, this.maxIter + Math.floor(depthFactor * 4));

    // Progressive scanline rendering
    const rows = this.rowsPerFrame + this.intensityLevel;
    for (let r = 0; r < rows; r++) {
      this.renderScanline(this.renderRow, dynamicIter);
      this.renderRow++;
      if (this.renderRow >= this.ch) {
        this.renderRow = 0;
        this.ctx.putImageData(this.imageData, 0, 0);
        this.texture.needsUpdate = true;
      }
    }
  }

  private renderScanline(row: number, maxIter: number): void {
    const w = this.cw;
    const data = this.imageData.data;
    const aspect = w / this.ch;
    const zoomW = this.zoom * aspect;
    const zoomH = this.zoom;

    const pr = this.palette.primary;
    const sr = this.palette.secondary;
    const dm = this.palette.dim;
    const bg = this.palette.bg;

    const y0 = this.targetY + (row / this.ch - 0.5) * zoomH;

    for (let col = 0; col < w; col++) {
      const x0 = this.targetX + (col / w - 0.5) * zoomW;

      let zx = 0, zy = 0;
      let iter = 0;
      let zx2 = 0, zy2 = 0;

      while (zx2 + zy2 <= 4 && iter < maxIter) {
        zy = 2 * zx * zy + y0;
        zx = zx2 - zy2 + x0;
        zx2 = zx * zx;
        zy2 = zy * zy;
        iter++;
      }

      const idx = (row * w + col) * 4;
      if (iter === maxIter) {
        data[idx] = bg.r * 255;
        data[idx + 1] = bg.g * 255;
        data[idx + 2] = bg.b * 255;
      } else {
        // Smooth iteration count for smooth coloring
        const log_zn = Math.log(zx2 + zy2) / 2;
        const nu = Math.log(log_zn / Math.LN2) / Math.LN2;
        const smooth = iter + 1 - nu;
        const t = (smooth + this.colorCycle) % maxIter / maxIter;

        // Three-color gradient
        let r: number, g: number, b: number;
        if (t < 0.33) {
          const s = t / 0.33;
          r = bg.r + (pr.r - bg.r) * s;
          g = bg.g + (pr.g - bg.g) * s;
          b = bg.b + (pr.b - bg.b) * s;
        } else if (t < 0.66) {
          const s = (t - 0.33) / 0.33;
          r = pr.r + (sr.r - pr.r) * s;
          g = pr.g + (sr.g - pr.g) * s;
          b = pr.b + (sr.b - pr.b) * s;
        } else {
          const s = (t - 0.66) / 0.34;
          r = sr.r + (dm.r - sr.r) * s;
          g = sr.g + (dm.g - sr.g) * s;
          b = sr.b + (dm.b - sr.b) * s;
        }

        data[idx] = r * 255;
        data[idx + 1] = g * 255;
        data[idx + 2] = b * 255;
      }
      data[idx + 3] = 255;
    }
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Jump to a random nearby location
      this.targetX += this.rng.float(-0.01, 0.01) * this.zoom;
      this.targetY += this.rng.float(-0.01, 0.01) * this.zoom;
    }
    if (action === 'pulse') {
      // Reset zoom
      this.zoom = this.zoomMin;
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    this.intensityLevel = level;
  }
}
