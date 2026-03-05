import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Gray-Scott reaction-diffusion system.
 * Two chemicals U and V interact to produce spots, stripes, and labyrinthine patterns.
 * Canvas rendered with real numerical PDE simulation.
 */
export class ReactionDiffuseElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'reaction-diffuse',
    meta: { shape: 'rectangular', roles: ['decorative', 'data-display'], moods: ['ambient'], bandAffinity: 'sub', sizes: ['needs-medium', 'needs-large'] },
  };

  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private texture!: THREE.CanvasTexture;
  private mesh!: THREE.Mesh;
  private gw = 0;
  private gh = 0;
  private U: Float32Array = new Float32Array(0);
  private V: Float32Array = new Float32Array(0);
  private feed = 0.037;
  private kill = 0.06;
  private Du = 0.16;
  private Dv = 0.08;
  private stepsPerFrame = 8;

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;

    const variant = this.rng.int(0, 3);
    // Different feed/kill rates produce different patterns
    const presets = [
      { feed: 0.037, kill: 0.06, Du: 0.16, Dv: 0.08, steps: 8 },   // spots
      { feed: 0.03, kill: 0.062, Du: 0.16, Dv: 0.08, steps: 10 },  // stripes
      { feed: 0.025, kill: 0.06, Du: 0.16, Dv: 0.08, steps: 8 },   // labyrinth
      { feed: 0.04, kill: 0.063, Du: 0.16, Dv: 0.08, steps: 12 },  // mitosis
    ];
    const p = presets[variant];
    this.feed = p.feed;
    this.kill = p.kill;
    this.Du = p.Du;
    this.Dv = p.Dv;
    this.stepsPerFrame = p.steps;

    // Use smaller grid for performance
    this.gw = Math.max(32, Math.min(128, Math.round(w / 4)));
    this.gh = Math.max(32, Math.min(128, Math.round(h / 4)));
    const size = this.gw * this.gh;
    this.U = new Float32Array(size);
    this.V = new Float32Array(size);

    // Initialize: U=1 everywhere, V=0 everywhere, seed V in center region
    this.U.fill(1);
    this.V.fill(0);
    this.seedPattern();

    this.canvas = document.createElement('canvas');
    this.canvas.width = this.gw;
    this.canvas.height = this.gh;
    this.ctx = this.get2DContext(this.canvas);
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.magFilter = THREE.NearestFilter;

    const geo = new THREE.PlaneGeometry(w, h);
    const mat = new THREE.MeshBasicMaterial({ map: this.texture, transparent: true });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.set(x + w / 2, y + h / 2, 0);
    this.group.add(this.mesh);
  }

  private seedPattern(): void {
    const cx = Math.floor(this.gw / 2);
    const cy = Math.floor(this.gh / 2);
    const radius = Math.min(this.gw, this.gh) / 8;

    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dy * dy > radius * radius) continue;
        const ix = cx + Math.round(dx);
        const iy = cy + Math.round(dy);
        if (ix >= 0 && ix < this.gw && iy >= 0 && iy < this.gh) {
          const idx = iy * this.gw + ix;
          this.U[idx] = 0.5 + this.rng.float(-0.05, 0.05);
          this.V[idx] = 0.25 + this.rng.float(-0.05, 0.05);
        }
      }
    }

    // Add a few random seed points
    const seeds = 3 + this.rng.int(0, 4);
    for (let s = 0; s < seeds; s++) {
      const sx = this.rng.int(4, this.gw - 5);
      const sy = this.rng.int(4, this.gh - 5);
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const idx = (sy + dy) * this.gw + (sx + dx);
          if (idx >= 0 && idx < this.U.length) {
            this.U[idx] = 0.5;
            this.V[idx] = 0.25;
          }
        }
      }
    }
  }

  private step(): void {
    const w = this.gw;
    const h = this.gh;
    const size = w * h;
    const newU = new Float32Array(size);
    const newV = new Float32Array(size);
    const dt = 1.0;
    const f = this.feed;
    const k = this.kill;

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = y * w + x;
        // 5-point Laplacian with periodic boundaries
        const left = y * w + ((x - 1 + w) % w);
        const right = y * w + ((x + 1) % w);
        const up = ((y - 1 + h) % h) * w + x;
        const down = ((y + 1) % h) * w + x;

        const lapU = this.U[left] + this.U[right] + this.U[up] + this.U[down] - 4 * this.U[idx];
        const lapV = this.V[left] + this.V[right] + this.V[up] + this.V[down] - 4 * this.V[idx];

        const u = this.U[idx];
        const v = this.V[idx];
        const uvv = u * v * v;

        newU[idx] = u + dt * (this.Du * lapU - uvv + f * (1 - u));
        newV[idx] = v + dt * (this.Dv * lapV + uvv - (f + k) * v);

        // Clamp
        newU[idx] = Math.max(0, Math.min(1, newU[idx]));
        newV[idx] = Math.max(0, Math.min(1, newV[idx]));
      }
    }

    this.U.set(newU);
    this.V.set(newV);
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);
    (this.mesh.material as THREE.MeshBasicMaterial).opacity = opacity;

    // Run simulation steps
    for (let s = 0; s < this.stepsPerFrame; s++) {
      this.step();
    }

    // Render to canvas
    const imageData = this.ctx.createImageData(this.gw, this.gh);
    const pr = this.palette.primary.r;
    const pg = this.palette.primary.g;
    const pb = this.palette.primary.b;
    const br = this.palette.bg.r;
    const bgr = this.palette.bg.g;
    const bb = this.palette.bg.b;

    for (let i = 0; i < this.U.length; i++) {
      const v = this.V[i];
      const u = this.U[i];
      const t = v * 3; // Scale V for visibility
      const clamped = Math.min(1, t);
      imageData.data[i * 4] = Math.round((br + (pr - br) * clamped) * 255);
      imageData.data[i * 4 + 1] = Math.round((bgr + (pg - bgr) * clamped) * 255);
      imageData.data[i * 4 + 2] = Math.round((bb + (pb - bb) * clamped) * 255);
      imageData.data[i * 4 + 3] = 255;
    }

    this.ctx.putImageData(imageData, 0, 0);
    this.texture.needsUpdate = true;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Add random perturbation seeds
      for (let s = 0; s < 5; s++) {
        const sx = this.rng.int(2, this.gw - 3);
        const sy = this.rng.int(2, this.gh - 3);
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const idx = (sy + dy) * this.gw + (sx + dx);
            if (idx >= 0 && idx < this.U.length) {
              this.V[idx] = 0.5;
            }
          }
        }
      }
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level >= 3) {
      this.stepsPerFrame = Math.min(20, 8 + level * 2);
    }
  }
}
