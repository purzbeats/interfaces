import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Lattice Boltzmann fluid simulation. Simplified 2D fluid with obstacles
 * rendered as velocity magnitude heatmap. Flow past obstacles creates
 * vortex streets and turbulent wakes.
 */
export class CellularFluidElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'cellular-fluid',
    meta: {
      shape: 'rectangular',
      roles: ['data-display', 'decorative'],
      moods: ['tactical', 'ambient'],
      bandAffinity: 'bass',
      sizes: ['needs-medium', 'needs-large'],
    },
  };

  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private texture!: THREE.CanvasTexture;
  private mesh!: THREE.Mesh;
  private material!: THREE.MeshBasicMaterial;

  private gw: number = 0;
  private gh: number = 0;
  private ux!: Float32Array;  // velocity x
  private uy!: Float32Array;  // velocity y
  private rho!: Float32Array; // density
  private barrier!: Uint8Array;

  // D2Q9 distribution functions
  private f!: Float32Array[];
  private fTemp!: Float32Array[];

  // D2Q9 lattice vectors and weights
  private static readonly ex = [0, 1, 0, -1, 0, 1, -1, -1, 1];
  private static readonly ey = [0, 0, 1, 0, -1, 1, 1, -1, -1];
  private static readonly w = [4/9, 1/9, 1/9, 1/9, 1/9, 1/36, 1/36, 1/36, 1/36];
  private static readonly opp = [0, 3, 4, 1, 2, 7, 8, 5, 6]; // opposite directions

  private omega: number = 1.5; // relaxation parameter (1/tau)
  private inletSpeed: number = 0.08;
  private stepsPerFrame: number = 3;
  private intensityLevel: number = 0;

  build(): void {
    const variant = this.rng.int(0, 3);
    const presets = [
      { omega: 1.5, speed: 0.08, steps: 3, obstType: 0, resDiv: 4 },   // Circle obstacle
      { omega: 1.7, speed: 0.1, steps: 4, obstType: 1, resDiv: 4 },    // Multi obstacles
      { omega: 1.3, speed: 0.06, steps: 2, obstType: 2, resDiv: 3 },   // Plate obstacle
      { omega: 1.6, speed: 0.12, steps: 5, obstType: 3, resDiv: 5 },   // Channel flow
    ];
    const p = presets[variant];

    this.omega = p.omega;
    this.inletSpeed = p.speed;
    this.stepsPerFrame = p.steps;
    this.glitchAmount = 4;

    const { x, y, w, h } = this.px;
    this.gw = Math.max(40, Math.floor(w / p.resDiv));
    this.gh = Math.max(30, Math.floor(h / p.resDiv));

    const total = this.gw * this.gh;
    this.ux = new Float32Array(total);
    this.uy = new Float32Array(total);
    this.rho = new Float32Array(total);
    this.barrier = new Uint8Array(total);

    // Initialize distribution functions
    this.f = [];
    this.fTemp = [];
    for (let q = 0; q < 9; q++) {
      this.f.push(new Float32Array(total));
      this.fTemp.push(new Float32Array(total));
    }

    // Set barriers based on obstacle type
    this.setObstacles(p.obstType);

    // Initialize equilibrium flow
    for (let j = 0; j < this.gh; j++) {
      for (let i = 0; i < this.gw; i++) {
        const idx = j * this.gw + i;
        if (this.barrier[idx]) continue;
        this.rho[idx] = 1.0;
        this.ux[idx] = this.inletSpeed;
        this.uy[idx] = 0;
        for (let q = 0; q < 9; q++) {
          this.f[q][idx] = this.feq(q, this.rho[idx], this.ux[idx], this.uy[idx]);
        }
      }
    }

    this.canvas = document.createElement('canvas');
    this.canvas.width = this.gw;
    this.canvas.height = this.gh;
    this.ctx = this.get2DContext(this.canvas);

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

  private setObstacles(type: number): void {
    const gw = this.gw;
    const gh = this.gh;

    switch (type) {
      case 0: { // Single circle
        const cx = Math.floor(gw * 0.25);
        const cy = Math.floor(gh * 0.5);
        const r = Math.floor(Math.min(gw, gh) * 0.1);
        for (let j = 0; j < gh; j++) {
          for (let i = 0; i < gw; i++) {
            if ((i - cx) * (i - cx) + (j - cy) * (j - cy) < r * r) {
              this.barrier[j * gw + i] = 1;
            }
          }
        }
        break;
      }
      case 1: { // Multiple small circles
        for (let k = 0; k < 3; k++) {
          const cx = Math.floor(gw * (0.2 + k * 0.2));
          const cy = Math.floor(gh * (0.3 + (k % 2) * 0.4));
          const r = Math.floor(Math.min(gw, gh) * 0.06);
          for (let j = 0; j < gh; j++) {
            for (let i = 0; i < gw; i++) {
              if ((i - cx) * (i - cx) + (j - cy) * (j - cy) < r * r) {
                this.barrier[j * gw + i] = 1;
              }
            }
          }
        }
        break;
      }
      case 2: { // Flat plate
        const px = Math.floor(gw * 0.3);
        const py1 = Math.floor(gh * 0.3);
        const py2 = Math.floor(gh * 0.7);
        for (let j = py1; j < py2; j++) {
          this.barrier[j * gw + px] = 1;
          this.barrier[j * gw + px + 1] = 1;
        }
        break;
      }
      case 3: { // Channel with constriction
        const narrow = Math.floor(gh * 0.15);
        const px = Math.floor(gw * 0.4);
        for (let j = 0; j < narrow; j++) {
          this.barrier[j * gw + px] = 1;
          this.barrier[(gh - 1 - j) * gw + px] = 1;
        }
        break;
      }
    }
  }

  private feq(q: number, rho: number, ux: number, uy: number): number {
    const { ex, ey, w } = CellularFluidElement;
    const eu = ex[q] * ux + ey[q] * uy;
    const u2 = ux * ux + uy * uy;
    return w[q] * rho * (1 + 3 * eu + 4.5 * eu * eu - 1.5 * u2);
  }

  private step(): void {
    const gw = this.gw;
    const gh = this.gh;
    const { ex, ey, opp } = CellularFluidElement;

    // Collision step
    for (let j = 0; j < gh; j++) {
      for (let i = 0; i < gw; i++) {
        const idx = j * gw + i;
        if (this.barrier[idx]) continue;

        // Compute macroscopic quantities
        let r = 0, vx = 0, vy = 0;
        for (let q = 0; q < 9; q++) {
          r += this.f[q][idx];
          vx += ex[q] * this.f[q][idx];
          vy += ey[q] * this.f[q][idx];
        }
        if (r > 0) { vx /= r; vy /= r; }
        this.rho[idx] = r;
        this.ux[idx] = vx;
        this.uy[idx] = vy;

        // BGK collision
        for (let q = 0; q < 9; q++) {
          this.f[q][idx] += this.omega * (this.feq(q, r, vx, vy) - this.f[q][idx]);
        }
      }
    }

    // Streaming step
    for (let q = 0; q < 9; q++) {
      for (let j = 0; j < gh; j++) {
        for (let i = 0; i < gw; i++) {
          const ni = i + ex[q];
          const nj = j + ey[q];
          if (ni >= 0 && ni < gw && nj >= 0 && nj < gh) {
            this.fTemp[q][nj * gw + ni] = this.f[q][j * gw + i];
          }
        }
      }
    }

    // Swap and apply boundary conditions
    const tmp = this.f;
    this.f = this.fTemp;
    this.fTemp = tmp;

    // Bounce-back on barriers
    for (let j = 0; j < gh; j++) {
      for (let i = 0; i < gw; i++) {
        const idx = j * gw + i;
        if (!this.barrier[idx]) continue;
        for (let q = 0; q < 9; q++) {
          this.f[opp[q]][idx] = this.f[q][idx];
        }
      }
    }

    // Inlet boundary (left edge)
    for (let j = 1; j < gh - 1; j++) {
      const idx = j * gw;
      for (let q = 0; q < 9; q++) {
        this.f[q][idx] = this.feq(q, 1.0, this.inletSpeed, 0);
      }
    }
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);
    this.material.opacity = opacity;

    const steps = this.stepsPerFrame + this.intensityLevel;
    for (let s = 0; s < steps; s++) {
      this.step();
    }

    // Render velocity magnitude to canvas
    this.renderToCanvas();
    this.texture.needsUpdate = true;
  }

  private renderToCanvas(): void {
    const ctx = this.ctx;
    const gw = this.gw;
    const gh = this.gh;
    const imageData = ctx.createImageData(gw, gh);
    const data = imageData.data;

    const pr = this.palette.primary;
    const sr = this.palette.secondary;
    const bg = this.palette.bg;

    for (let j = 0; j < gh; j++) {
      for (let i = 0; i < gw; i++) {
        const idx = j * gw + i;
        const pidx = idx * 4;

        if (this.barrier[idx]) {
          data[pidx] = this.palette.dim.r * 255;
          data[pidx + 1] = this.palette.dim.g * 255;
          data[pidx + 2] = this.palette.dim.b * 255;
          data[pidx + 3] = 255;
          continue;
        }

        const speed = Math.sqrt(this.ux[idx] * this.ux[idx] + this.uy[idx] * this.uy[idx]);
        const t = Math.min(1, speed / (this.inletSpeed * 2));

        if (t < 0.5) {
          const s = t * 2;
          data[pidx] = (bg.r + (pr.r - bg.r) * s) * 255;
          data[pidx + 1] = (bg.g + (pr.g - bg.g) * s) * 255;
          data[pidx + 2] = (bg.b + (pr.b - bg.b) * s) * 255;
        } else {
          const s = (t - 0.5) * 2;
          data[pidx] = (pr.r + (sr.r - pr.r) * s) * 255;
          data[pidx + 1] = (pr.g + (sr.g - pr.g) * s) * 255;
          data[pidx + 2] = (pr.b + (sr.b - pr.b) * s) * 255;
        }
        data[pidx + 3] = 255;
      }
    }

    ctx.putImageData(imageData, 0, 0);
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Add random velocity perturbation
      const total = this.gw * this.gh;
      for (let i = 0; i < total; i++) {
        if (!this.barrier[i] && this.rng.chance(0.05)) {
          this.uy[i] += this.rng.float(-0.1, 0.1);
        }
      }
    }
    if (action === 'pulse') {
      this.inletSpeed *= 1.5;
      setTimeout(() => { this.inletSpeed /= 1.5; }, 800);
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    this.intensityLevel = level;
    this.inletSpeed = 0.08 * (1 + level * 0.15);
  }
}
