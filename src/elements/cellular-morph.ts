import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

interface MorphPreset {
  activatorDiffuse: number;
  inhibitorDiffuse: number;
  feedRate: number;
  killRate: number;
  stepsPerFrame: number;
}

/**
 * Morphogenesis pattern via activator-inhibitor dynamics (Gray-Scott model variant).
 * Discrete cell model producing spotted/striped patterns. Canvas rendered.
 */
export class CellularMorphElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'cellular-morph',
    meta: {
      shape: 'rectangular',
      roles: ['decorative', 'data-display'],
      moods: ['ambient', 'diagnostic'],
      sizes: ['needs-medium', 'needs-large'],
      bandAffinity: 'bass',
    } satisfies ElementMeta,
  };

  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private texture!: THREE.CanvasTexture;
  private mesh!: THREE.Mesh;
  private mat!: THREE.MeshBasicMaterial;

  private gw = 0;
  private gh = 0;
  private u!: Float32Array;
  private v!: Float32Array;
  private uNext!: Float32Array;
  private vNext!: Float32Array;

  private activatorDiffuse = 0.16;
  private inhibitorDiffuse = 0.08;
  private feedRate = 0.055;
  private killRate = 0.062;
  private stepsPerFrame = 4;
  private intensityLevel = 0;
  private frameCount = 0;

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;

    const variant = this.rng.int(0, 3);
    const presets: MorphPreset[] = [
      // Spots
      { activatorDiffuse: 0.16, inhibitorDiffuse: 0.08, feedRate: 0.055, killRate: 0.062, stepsPerFrame: 8 },
      // Stripes
      { activatorDiffuse: 0.14, inhibitorDiffuse: 0.06, feedRate: 0.035, killRate: 0.065, stepsPerFrame: 10 },
      // Coral/maze
      { activatorDiffuse: 0.16, inhibitorDiffuse: 0.08, feedRate: 0.060, killRate: 0.062, stepsPerFrame: 8 },
      // Bubbles
      { activatorDiffuse: 0.12, inhibitorDiffuse: 0.06, feedRate: 0.040, killRate: 0.060, stepsPerFrame: 9 },
    ];
    const p = presets[variant];
    this.activatorDiffuse = p.activatorDiffuse;
    this.inhibitorDiffuse = p.inhibitorDiffuse;
    this.feedRate = p.feedRate;
    this.killRate = p.killRate;
    this.stepsPerFrame = p.stepsPerFrame;

    const maxRes = 240;
    const scale = Math.min(1, maxRes / Math.max(w, h));
    this.gw = Math.max(64, Math.round(w * scale));
    this.gh = Math.max(64, Math.round(h * scale));

    this.canvas = document.createElement('canvas');
    this.canvas.width = this.gw;
    this.canvas.height = this.gh;
    this.ctx = this.get2DContext(this.canvas);
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.magFilter = THREE.NearestFilter;

    // Initialize grids
    const size = this.gw * this.gh;
    this.u = new Float32Array(size);
    this.v = new Float32Array(size);
    this.uNext = new Float32Array(size);
    this.vNext = new Float32Array(size);

    // Start with u=1, v=0 everywhere
    this.u.fill(1);
    this.v.fill(0);

    // Seed some patches of v
    const seedCount = 8 + this.rng.int(0, 8);
    for (let s = 0; s < seedCount; s++) {
      const sx = this.rng.int(this.gw * 0.1, this.gw * 0.9);
      const sy = this.rng.int(this.gh * 0.1, this.gh * 0.9);
      const minSeed = Math.max(4, Math.round(Math.min(this.gw, this.gh) * 0.02));
      const maxSeed = Math.max(minSeed + 1, Math.round(Math.min(this.gw, this.gh) * 0.06));
      const sr = this.rng.int(minSeed, maxSeed);
      for (let dy = -sr; dy <= sr; dy++) {
        for (let dx = -sr; dx <= sr; dx++) {
          const px = sx + dx;
          const py = sy + dy;
          if (px >= 0 && px < this.gw && py >= 0 && py < this.gh) {
            if (dx * dx + dy * dy <= sr * sr) {
              const idx = py * this.gw + px;
              this.u[idx] = 0.5 + this.rng.float(-0.05, 0.05);
              this.v[idx] = 0.25 + this.rng.float(-0.05, 0.05);
            }
          }
        }
      }
    }

    const planeGeo = new THREE.PlaneGeometry(w, h);
    this.mat = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      opacity: 0,
    });
    this.mesh = new THREE.Mesh(planeGeo, this.mat);
    this.mesh.position.set(x + w / 2, y + h / 2, 0);
    this.group.add(this.mesh);
  }

  private step(): void {
    const w = this.gw;
    const h = this.gh;
    const du = this.activatorDiffuse;
    const dv = this.inhibitorDiffuse;
    const f = this.feedRate;
    const k = this.killRate;
    const dt = 1.0;

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = y * w + x;
        const uVal = this.u[idx];
        const vVal = this.v[idx];

        // Laplacian (5-point stencil with wrapping)
        const xm = x > 0 ? x - 1 : w - 1;
        const xp = x < w - 1 ? x + 1 : 0;
        const ym = y > 0 ? y - 1 : h - 1;
        const yp = y < h - 1 ? y + 1 : 0;

        const lapU = this.u[y * w + xm] + this.u[y * w + xp]
                   + this.u[ym * w + x] + this.u[yp * w + x]
                   - 4 * uVal;
        const lapV = this.v[y * w + xm] + this.v[y * w + xp]
                   + this.v[ym * w + x] + this.v[yp * w + x]
                   - 4 * vVal;

        const uvv = uVal * vVal * vVal;
        this.uNext[idx] = uVal + (du * lapU - uvv + f * (1 - uVal)) * dt;
        this.vNext[idx] = vVal + (dv * lapV + uvv - (f + k) * vVal) * dt;

        // Clamp
        this.uNext[idx] = Math.max(0, Math.min(1, this.uNext[idx]));
        this.vNext[idx] = Math.max(0, Math.min(1, this.vNext[idx]));
      }
    }

    // Swap buffers
    const tmpU = this.u;
    const tmpV = this.v;
    this.u = this.uNext;
    this.v = this.vNext;
    this.uNext = tmpU;
    this.vNext = tmpV;
  }

  private drawGrid(): void {
    const ctx = this.ctx;
    const imgData = ctx.createImageData(this.gw, this.gh);
    const data = imgData.data;

    const bg = this.palette.bg;
    const pri = this.palette.primary;
    const sec = this.palette.secondary;

    for (let i = 0; i < this.gw * this.gh; i++) {
      const vVal = this.v[i];
      const pidx = i * 4;

      // Map v concentration to color: low v = bg, high v = primary blend
      const t = Math.min(1, vVal * 3);
      data[pidx] = Math.floor((bg.r + (pri.r - bg.r) * t + (sec.r - bg.r) * t * t * 0.5) * 255);
      data[pidx + 1] = Math.floor((bg.g + (pri.g - bg.g) * t + (sec.g - bg.g) * t * t * 0.5) * 255);
      data[pidx + 2] = Math.floor((bg.b + (pri.b - bg.b) * t + (sec.b - bg.b) * t * t * 0.5) * 255);
      data[pidx + 3] = Math.floor((0.6 + t * 0.4) * 255);
    }

    ctx.putImageData(imgData, 0, 0);
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);
    const steps = this.stepsPerFrame + Math.floor(this.intensityLevel * 0.5);

    for (let s = 0; s < steps; s++) {
      this.step();
    }

    this.frameCount++;
    this.drawGrid();
    this.texture.needsUpdate = true;
    this.mat.opacity = opacity;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Inject random v perturbations
      const patchCount = 5 + this.rng.int(0, 5);
      for (let p = 0; p < patchCount; p++) {
        const sx = this.rng.int(0, this.gw - 1);
        const sy = this.rng.int(0, this.gh - 1);
        const sr = this.rng.int(2, 6);
        for (let dy = -sr; dy <= sr; dy++) {
          for (let dx = -sr; dx <= sr; dx++) {
            const px = sx + dx;
            const py = sy + dy;
            if (px >= 0 && px < this.gw && py >= 0 && py < this.gh) {
              if (dx * dx + dy * dy <= sr * sr) {
                const idx = py * this.gw + px;
                this.v[idx] = this.rng.float(0.2, 0.35);
                this.u[idx] = this.rng.float(0.4, 0.6);
              }
            }
          }
        }
      }
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    this.intensityLevel = level;
  }
}
