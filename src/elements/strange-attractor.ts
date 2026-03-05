import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Clifford/De Jong strange attractor with millions of iterations rendered as a density map.
 * Parameters drift slowly producing ever-morphing fractal shapes.
 */
export class StrangeAttractorElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'strange-attractor',
    meta: { shape: 'rectangular', roles: ['data-display', 'decorative'], moods: ['diagnostic', 'ambient'], bandAffinity: 'mid', sizes: ['needs-medium', 'needs-large'] },
  };

  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private texture!: THREE.CanvasTexture;
  private mesh!: THREE.Mesh;
  private borderLines!: THREE.LineSegments;

  private a = 0; private b = 0; private c = 0; private d = 0;
  private targetA = 0; private targetB = 0; private targetC = 0; private targetD = 0;
  private driftTimer = 0;
  private cw = 0; private ch = 0;
  private density!: Float32Array;
  private itersPerFrame = 8000;
  private sx = 0; private sy = 0;
  private renderAccum = 0;

  build(): void {
    const variant = this.rng.int(0, 3);
    const presets = [
      { a: -1.4, b: 1.6, c: 1.0, d: 0.7, iters: 8000 },
      { a: 1.7, b: 1.7, c: 0.6, d: 1.2, iters: 12000 },
      { a: -1.8, b: -2.0, c: -0.5, d: -0.9, iters: 6000 },
      { a: 2.01, b: -2.53, c: 1.61, d: -0.33, iters: 15000 },
    ];
    const p = presets[variant];
    this.glitchAmount = 4;

    const { x, y, w, h } = this.px;
    const scale = Math.max(1, Math.floor(Math.min(w, h) / 250));
    this.cw = Math.ceil(w / scale);
    this.ch = Math.ceil(h / scale);

    this.a = p.a + this.rng.float(-0.1, 0.1);
    this.b = p.b + this.rng.float(-0.1, 0.1);
    this.c = p.c + this.rng.float(-0.1, 0.1);
    this.d = p.d + this.rng.float(-0.1, 0.1);
    this.targetA = this.a; this.targetB = this.b;
    this.targetC = this.c; this.targetD = this.d;
    this.itersPerFrame = p.iters;
    this.sx = 0; this.sy = 0;

    this.density = new Float32Array(this.cw * this.ch);

    this.canvas = document.createElement('canvas');
    this.canvas.width = this.cw;
    this.canvas.height = this.ch;
    this.ctx = this.get2DContext(this.canvas);

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.magFilter = THREE.NearestFilter;

    const geo = new THREE.PlaneGeometry(w, h);
    this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, opacity: 0 }));
    this.mesh.position.set(x + w / 2, y + h / 2, 0);
    this.group.add(this.mesh);

    // Border
    const bv = new Float32Array([x, y, 0.5, x + w, y, 0.5, x + w, y, 0.5, x + w, y + h, 0.5, x + w, y + h, 0.5, x, y + h, 0.5, x, y + h, 0.5, x, y, 0.5]);
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.BufferAttribute(bv, 3));
    this.borderLines = new THREE.LineSegments(bg, new THREE.LineBasicMaterial({ color: this.palette.dim, transparent: true, opacity: 0 }));
    this.group.add(this.borderLines);
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);

    // Drift parameters toward targets
    this.driftTimer -= dt;
    if (this.driftTimer <= 0) {
      this.driftTimer = this.rng.float(3, 8);
      this.targetA = this.a + this.rng.float(-0.3, 0.3);
      this.targetB = this.b + this.rng.float(-0.3, 0.3);
      this.targetC = this.c + this.rng.float(-0.3, 0.3);
      this.targetD = this.d + this.rng.float(-0.3, 0.3);
    }
    const drift = 0.2 * dt;
    this.a += (this.targetA - this.a) * drift;
    this.b += (this.targetB - this.b) * drift;
    this.c += (this.targetC - this.c) * drift;
    this.d += (this.targetD - this.d) * drift;

    // Fade density
    for (let i = 0; i < this.density.length; i++) this.density[i] *= 0.97;

    // Iterate attractor (Clifford variant)
    for (let i = 0; i < this.itersPerFrame; i++) {
      const nx = Math.sin(this.a * this.sy) + this.c * Math.cos(this.a * this.sx);
      const ny = Math.sin(this.b * this.sx) + this.d * Math.cos(this.b * this.sy);
      this.sx = nx;
      this.sy = ny;

      // Map to canvas coords (attractor range is roughly -3..3)
      const px = Math.floor((nx + 3) / 6 * this.cw);
      const py = Math.floor((ny + 3) / 6 * this.ch);
      if (px >= 0 && px < this.cw && py >= 0 && py < this.ch) {
        this.density[py * this.cw + px] = Math.min(1, this.density[py * this.cw + px] + 0.02);
      }
    }

    // Render to canvas
    this.renderAccum += dt;
    if (this.renderAccum >= 0.06) {
      this.renderAccum = 0;
      const img = this.ctx.getImageData(0, 0, this.cw, this.ch);
      const data = img.data;
      const pr = this.palette.primary.r * 255;
      const pg2 = this.palette.primary.g * 255;
      const pb = this.palette.primary.b * 255;
      const sr = this.palette.secondary.r * 255;
      const sg = this.palette.secondary.g * 255;
      const sb = this.palette.secondary.b * 255;

      for (let i = 0; i < this.density.length; i++) {
        const v = this.density[i];
        const idx = i * 4;
        if (v < 0.3) {
          data[idx] = pr * v * 2;
          data[idx + 1] = pg2 * v * 2;
          data[idx + 2] = pb * v * 2;
        } else {
          const t = (v - 0.3) / 0.7;
          data[idx] = pr * (1 - t) + sr * t;
          data[idx + 1] = pg2 * (1 - t) + sg * t;
          data[idx + 2] = pb * (1 - t) + sb * t;
        }
        data[idx + 3] = 255;
      }
      this.ctx.putImageData(img, 0, 0);
      this.texture.needsUpdate = true;
    }

    (this.mesh.material as THREE.MeshBasicMaterial).opacity = opacity * 0.9;
    (this.borderLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.2;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      this.a += this.rng.float(-1, 1);
      this.b += this.rng.float(-1, 1);
      this.density.fill(0);
    }
    if (action === 'alert') {
      this.targetA = this.rng.float(-2.5, 2.5);
      this.targetB = this.rng.float(-2.5, 2.5);
      this.targetC = this.rng.float(-2.5, 2.5);
      this.targetD = this.rng.float(-2.5, 2.5);
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level >= 3) this.itersPerFrame = 20000;
    if (level >= 5) this.density.fill(0);
  }
}
