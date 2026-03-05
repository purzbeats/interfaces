import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Animated Julia set fractal with drifting parameter c.
 * As c traces a path on the complex plane, the fractal morphs
 * continuously between connected and dust-like states.
 */
export class JuliaSetElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'julia-set',
    meta: { shape: 'rectangular', roles: ['decorative', 'data-display'], moods: ['ambient', 'diagnostic'], bandAffinity: 'mid', sizes: ['needs-medium', 'needs-large'] },
  };

  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private texture!: THREE.CanvasTexture;
  private mesh!: THREE.Mesh;
  private cw = 0; private ch = 0;
  private cReal = -0.7; private cImag = 0.27;
  private maxIter = 40;
  private renderAccum = 0;

  build(): void {
    const variant = this.rng.int(0, 3);
    const presets = [
      { res: 160, maxIter: 40, cr: -0.7, ci: 0.27 },
      { res: 220, maxIter: 60, cr: -0.8, ci: 0.156 },
      { res: 120, maxIter: 30, cr: 0.285, ci: 0.01 },
      { res: 180, maxIter: 50, cr: -0.4, ci: 0.6 },
    ];
    const p = presets[variant];
    this.glitchAmount = 4;
    this.maxIter = p.maxIter;
    this.cReal = p.cr; this.cImag = p.ci;

    const { x, y, w, h } = this.px;
    const aspect = w / h;
    this.cw = Math.round(p.res * Math.max(1, aspect));
    this.ch = Math.round(p.res / Math.max(1, 1 / aspect));

    this.canvas = document.createElement('canvas');
    this.canvas.width = this.cw;
    this.canvas.height = this.ch;
    this.ctx = this.get2DContext(this.canvas);
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.NearestFilter;

    const geo = new THREE.PlaneGeometry(w, h);
    this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, opacity: 0 }));
    this.mesh.position.set(x + w / 2, y + h / 2, 0);
    this.group.add(this.mesh);
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);

    // Drift c along a Lissajous path
    this.cReal = -0.7 + 0.3 * Math.sin(time * 0.15);
    this.cImag = 0.27 + 0.3 * Math.cos(time * 0.2);

    this.renderAccum += dt;
    if (this.renderAccum < 0.1) {
      (this.mesh.material as THREE.MeshBasicMaterial).opacity = opacity * 0.9;
      return;
    }
    this.renderAccum = 0;

    const img = this.ctx.getImageData(0, 0, this.cw, this.ch);
    const data = img.data;
    const pr = this.palette.primary.r * 255, pg = this.palette.primary.g * 255, pb = this.palette.primary.b * 255;
    const sr = this.palette.secondary.r * 255, sg = this.palette.secondary.g * 255, sb = this.palette.secondary.b * 255;

    for (let py = 0; py < this.ch; py++) {
      for (let px = 0; px < this.cw; px++) {
        let zr = (px / this.cw - 0.5) * 3.5;
        let zi = (py / this.ch - 0.5) * 2.5;
        let iter = 0;
        while (zr * zr + zi * zi < 4 && iter < this.maxIter) {
          const tmp = zr * zr - zi * zi + this.cReal;
          zi = 2 * zr * zi + this.cImag;
          zr = tmp;
          iter++;
        }
        const idx = (py * this.cw + px) * 4;
        if (iter === this.maxIter) {
          data[idx] = 0; data[idx + 1] = 0; data[idx + 2] = 0;
        } else {
          const t = iter / this.maxIter;
          const t2 = t * t;
          data[idx] = pr * t2 + sr * (1 - t2) * t;
          data[idx + 1] = pg * t2 + sg * (1 - t2) * t;
          data[idx + 2] = pb * t2 + sb * (1 - t2) * t;
        }
        data[idx + 3] = 255;
      }
    }
    this.ctx.putImageData(img, 0, 0);
    this.texture.needsUpdate = true;
    (this.mesh.material as THREE.MeshBasicMaterial).opacity = opacity * 0.9;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') { this.cReal += this.rng.float(-0.3, 0.3); this.cImag += this.rng.float(-0.3, 0.3); }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level >= 3) this.maxIter = 80;
  }
}
