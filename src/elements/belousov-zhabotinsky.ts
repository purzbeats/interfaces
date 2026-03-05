import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Belousov-Zhabotinsky spiral wave chemical oscillator.
 * Grid-based 3-state cellular automaton (excited/refractory/resting)
 * producing rotating spiral waves characteristic of BZ reactions.
 */
export class BelousovZhabotinskyElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'belousov-zhabotinsky',
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

  private gridW: number = 0;
  private gridH: number = 0;
  private stateA!: Float32Array; // current state values (0=resting .. maxStates=excited)
  private stateB!: Float32Array; // swap buffer
  private maxStates: number = 8;
  private tickAccum: number = 0;
  private tickRate: number = 0.05;
  private k1: number = 2;
  private k2: number = 3;
  private g: number = 1;
  private intensityLevel: number = 0;

  build(): void {
    const variant = this.rng.int(0, 3);
    const presets = [
      { maxStates: 8,  k1: 2, k2: 3, g: 1, tickRate: 0.05, resDiv: 4 },  // Standard spirals
      { maxStates: 12, k1: 3, k2: 4, g: 2, tickRate: 0.04, resDiv: 3 },  // Fine detail
      { maxStates: 6,  k1: 1, k2: 2, g: 1, tickRate: 0.07, resDiv: 5 },  // Fast coarse
      { maxStates: 16, k1: 4, k2: 5, g: 3, tickRate: 0.03, resDiv: 4 },  // Slow complex
    ];
    const p = presets[variant];

    this.maxStates = p.maxStates;
    this.k1 = p.k1;
    this.k2 = p.k2;
    this.g = p.g;
    this.tickRate = p.tickRate;

    const { x, y, w, h } = this.px;
    this.gridW = Math.max(32, Math.floor(w / p.resDiv));
    this.gridH = Math.max(32, Math.floor(h / p.resDiv));

    const total = this.gridW * this.gridH;
    this.stateA = new Float32Array(total);
    this.stateB = new Float32Array(total);

    // Seed initial state with a few excited spots and random noise
    for (let i = 0; i < total; i++) {
      this.stateA[i] = this.rng.chance(0.02) ? this.rng.int(1, this.maxStates) : 0;
    }

    // Seed spiral nucleation sites
    const numSeeds = this.rng.int(2, 5);
    for (let s = 0; s < numSeeds; s++) {
      const sx = this.rng.int(5, this.gridW - 5);
      const sy = this.rng.int(5, this.gridH - 5);
      for (let dy = -3; dy <= 3; dy++) {
        for (let dx = -3; dx <= 3; dx++) {
          const gx = sx + dx;
          const gy = sy + dy;
          if (gx >= 0 && gx < this.gridW && gy >= 0 && gy < this.gridH) {
            const angle = Math.atan2(dy, dx);
            this.stateA[gy * this.gridW + gx] = Math.floor(((angle + Math.PI) / (2 * Math.PI)) * this.maxStates);
          }
        }
      }
    }

    this.canvas = document.createElement('canvas');
    this.canvas.width = this.gridW;
    this.canvas.height = this.gridH;
    this.ctx = this.get2DContext(this.canvas);

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

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);
    this.material.opacity = opacity;

    this.tickAccum += dt;
    const rate = this.tickRate / (1 + this.intensityLevel * 0.3);
    if (this.tickAccum < rate) return;
    this.tickAccum = 0;

    this.stepSimulation();
    this.renderToCanvas();
    this.texture.needsUpdate = true;
  }

  private stepSimulation(): void {
    const w = this.gridW;
    const h = this.gridH;
    const maxS = this.maxStates;
    const src = this.stateA;
    const dst = this.stateB;

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = y * w + x;
        const s = src[idx];

        if (s === maxS) {
          // Excited cell becomes refractory (state maxS-1, counting down)
          dst[idx] = 0;
        } else if (s > 0) {
          // Refractory: count down toward resting
          dst[idx] = s - 1;
        } else {
          // Resting: check neighbors for infection
          let infectedCount = 0;
          let illCount = 0;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (dx === 0 && dy === 0) continue;
              const nx = (x + dx + w) % w;
              const ny = (y + dy + h) % h;
              const ns = src[ny * w + nx];
              if (ns === maxS) infectedCount++;
              if (ns > 0) illCount++;
            }
          }
          // Greenberg-Hastings style rule with infection threshold
          if (infectedCount >= this.k1 || illCount >= this.k2) {
            dst[idx] = Math.min(maxS, s + this.g + Math.floor(illCount / 3));
          } else {
            dst[idx] = 0;
          }
        }
      }
    }

    // Swap buffers
    const tmp = this.stateA;
    this.stateA = this.stateB;
    this.stateB = tmp;
  }

  private renderToCanvas(): void {
    const ctx = this.ctx;
    const w = this.gridW;
    const h = this.gridH;
    const imageData = ctx.createImageData(w, h);
    const data = imageData.data;
    const maxS = this.maxStates;

    const pr = this.palette.primary.r;
    const pg = this.palette.primary.g;
    const pb = this.palette.primary.b;
    const sr = this.palette.secondary.r;
    const sg = this.palette.secondary.g;
    const sb = this.palette.secondary.b;
    const bgr = this.palette.bg.r;
    const bgg = this.palette.bg.g;
    const bgb = this.palette.bg.b;

    for (let i = 0; i < w * h; i++) {
      const s = this.stateA[i];
      const t = s / maxS;
      const idx = i * 4;

      if (s === maxS) {
        // Fully excited: secondary color
        data[idx] = sr * 255;
        data[idx + 1] = sg * 255;
        data[idx + 2] = sb * 255;
      } else if (s > 0) {
        // Refractory: blend primary to bg
        data[idx] = (bgr + (pr - bgr) * t) * 255;
        data[idx + 1] = (bgg + (pg - bgg) * t) * 255;
        data[idx + 2] = (bgb + (pb - bgb) * t) * 255;
      } else {
        // Resting: background
        data[idx] = bgr * 255;
        data[idx + 1] = bgg * 255;
        data[idx + 2] = bgb * 255;
      }
      data[idx + 3] = 255;
    }

    ctx.putImageData(imageData, 0, 0);
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Add random noise to the grid
      const total = this.gridW * this.gridH;
      for (let i = 0; i < total; i++) {
        if (this.rng.chance(0.1)) {
          this.stateA[i] = this.rng.int(0, this.maxStates);
        }
      }
    }
    if (action === 'pulse') {
      // Create a new excitation wave from center
      const cx = Math.floor(this.gridW / 2);
      const cy = Math.floor(this.gridH / 2);
      for (let dy = -4; dy <= 4; dy++) {
        for (let dx = -4; dx <= 4; dx++) {
          const gx = cx + dx;
          const gy = cy + dy;
          if (gx >= 0 && gx < this.gridW && gy >= 0 && gy < this.gridH) {
            if (dx * dx + dy * dy <= 16) {
              this.stateA[gy * this.gridW + gx] = this.maxStates;
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
