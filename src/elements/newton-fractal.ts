import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Newton's method fractal — basins of attraction for z^n - 1 = 0.
 * Each pixel is colored by which root it converges to under Newton's method.
 * Canvas rendered with escape-time coloring. Animates by varying the
 * exponent parameter and viewport.
 */
export class NewtonFractalElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'newton-fractal',
    meta: {
      shape: 'rectangular',
      roles: ['data-display', 'decorative'],
      moods: ['ambient', 'diagnostic'],
      bandAffinity: 'high',
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

  private exponent = 3;
  private maxIter = 30;
  private tolerance = 0.001;
  private centerX = 0;
  private centerY = 0;
  private viewSize = 3;
  private zoomSpeed = 0.1;
  private rotationSpeed = 0.05;
  private needsRedraw = true;
  private lastDrawnTime = -1;
  private redrawInterval = 0.15;

  // Root colors (derived from palette)
  private rootColors: [number, number, number][] = [];

  build(): void {
    this.glitchAmount = 4;
    const variant = this.rng.int(0, 4);
    const { x, y, w, h } = this.px;

    const presets = [
      { exponent: 3, maxIter: 24, viewSize: 3.0, zoomSpeed: 0.08, rotationSpeed: 0.05 },
      { exponent: 4, maxIter: 28, viewSize: 3.5, zoomSpeed: 0.06, rotationSpeed: 0.03 },
      { exponent: 5, maxIter: 20, viewSize: 2.5, zoomSpeed: 0.12, rotationSpeed: 0.08 },
      { exponent: 3, maxIter: 30, viewSize: 2.0, zoomSpeed: 0.10, rotationSpeed: 0.04 },
    ];
    const p = presets[variant];
    this.exponent = p.exponent;
    this.maxIter = p.maxIter;
    this.viewSize = p.viewSize;
    this.zoomSpeed = p.zoomSpeed;
    this.rotationSpeed = p.rotationSpeed;

    const maxRes = 140;
    const aspect = w / h;
    this.cw = Math.min(maxRes, Math.ceil(w * 0.5));
    this.ch = Math.max(1, Math.ceil(this.cw / aspect));
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.cw;
    this.canvas.height = this.ch;
    this.ctx = this.get2DContext(this.canvas);
    this.imageData = this.ctx.createImageData(this.cw, this.ch);

    // Generate root colors from palette
    this.rootColors = [];
    const palColors = [this.palette.primary, this.palette.secondary, this.palette.dim];
    for (let i = 0; i < this.exponent; i++) {
      const base = palColors[i % palColors.length];
      // Shift hue slightly for each root
      const c = new THREE.Color().copy(base);
      c.offsetHSL(i * 0.15, 0, 0);
      this.rootColors.push([(c.r * 255) | 0, (c.g * 255) | 0, (c.b * 255) | 0]);
    }

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.LinearFilter;
    const geo = new THREE.PlaneGeometry(w, h);
    this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      map: this.texture, transparent: true, opacity: 0,
    }));
    this.mesh.position.set(x + w / 2, y + h / 2, 0);
    this.group.add(this.mesh);
  }

  /** Complex power: (a+bi)^n */
  private cpow(a: number, b: number, n: number): [number, number] {
    const r = Math.sqrt(a * a + b * b);
    if (r === 0) return [0, 0];
    const theta = Math.atan2(b, a);
    const rn = Math.pow(r, n);
    return [rn * Math.cos(n * theta), rn * Math.sin(n * theta)];
  }

  /** Newton iteration for z^n - 1 = 0: z_new = z - (z^n - 1) / (n * z^(n-1)) */
  private newtonStep(zr: number, zi: number, n: number): [number, number] {
    const [pnr, pni] = this.cpow(zr, zi, n);        // z^n
    const [pn1r, pn1i] = this.cpow(zr, zi, n - 1);  // z^(n-1)

    // f(z) = z^n - 1
    const fr = pnr - 1;
    const fi = pni;

    // f'(z) = n * z^(n-1)
    const dpr = n * pn1r;
    const dpi = n * pn1i;

    // f(z) / f'(z)
    const denom = dpr * dpr + dpi * dpi;
    if (denom < 1e-12) return [zr, zi];
    const qr = (fr * dpr + fi * dpi) / denom;
    const qi = (fi * dpr - fr * dpi) / denom;

    return [zr - qr, zi - qi];
  }

  /** Find which root z converged to */
  private findRoot(zr: number, zi: number, n: number): number {
    for (let k = 0; k < n; k++) {
      const angle = (2 * Math.PI * k) / n;
      const rr = Math.cos(angle);
      const ri = Math.sin(angle);
      const dr = zr - rr;
      const di = zi - ri;
      if (dr * dr + di * di < this.tolerance * 10) return k;
    }
    return 0;
  }

  private renderFractal(time: number): void {
    const n = this.exponent;
    const data = this.imageData.data;
    const zoom = 1 + Math.sin(time * this.zoomSpeed) * 0.3;
    const vs = this.viewSize / zoom;
    const rot = time * this.rotationSpeed;
    const cosR = Math.cos(rot);
    const sinR = Math.sin(rot);

    const bgR = (this.palette.bg.r * 255) | 0;
    const bgG = (this.palette.bg.g * 255) | 0;
    const bgB = (this.palette.bg.b * 255) | 0;

    for (let py = 0; py < this.ch; py++) {
      for (let px = 0; px < this.cw; px++) {
        // Map pixel to complex plane
        let cr = (px / this.cw - 0.5) * vs + this.centerX;
        let ci = (py / this.ch - 0.5) * vs + this.centerY;

        // Apply rotation
        const tr = cr * cosR - ci * sinR;
        const ti = cr * sinR + ci * cosR;
        cr = tr;
        ci = ti;

        let zr = cr, zi = ci;
        let iter = 0;

        for (; iter < this.maxIter; iter++) {
          const [nr, ni] = this.newtonStep(zr, zi, n);
          const dr = nr - zr;
          const di = ni - zi;
          if (dr * dr + di * di < this.tolerance) {
            iter++;
            break;
          }
          zr = nr;
          zi = ni;

          // Bail if diverging
          if (zr * zr + zi * zi > 100) break;
        }

        const idx = (py * this.cw + px) * 4;

        if (iter >= this.maxIter || zr * zr + zi * zi > 100) {
          data[idx] = bgR;
          data[idx + 1] = bgG;
          data[idx + 2] = bgB;
          data[idx + 3] = 255;
        } else {
          const root = this.findRoot(zr, zi, n);
          const [rr, rg, rb] = this.rootColors[root];
          // Shade by iteration count for smooth coloring
          const shade = 1 - iter / this.maxIter;
          const bright = 0.3 + shade * 0.7;
          data[idx] = (rr * bright) | 0;
          data[idx + 1] = (rg * bright) | 0;
          data[idx + 2] = (rb * bright) | 0;
          data[idx + 3] = 255;
        }
      }
    }

    this.ctx.putImageData(this.imageData, 0, 0);
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);

    // Throttle expensive fractal rendering
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
      this.centerX = this.rng.float(-0.5, 0.5);
      this.centerY = this.rng.float(-0.5, 0.5);
      this.needsRedraw = true;
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level >= 2) {
      this.rotationSpeed = 0.05 + level * 0.02;
      this.needsRedraw = true;
    }
    if (level === 0) {
      this.rotationSpeed = 0.05;
    }
  }
}
