import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

interface NoiseWarpPreset {
  warpStrength: number;
  noiseScale: number;
  timeSpeed: number;
  octaves: number;
}

/**
 * Domain-warped noise. Noise distorts input coordinates of another noise function,
 * creating organic flowing abstract patterns. Canvas rendered with palette color mapping.
 */
export class NoiseWarpElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'noise-warp',
    meta: {
      shape: 'rectangular',
      roles: ['decorative'],
      moods: ['ambient'],
      sizes: ['works-small', 'needs-medium', 'needs-large'],
      bandAffinity: 'sub',
    } satisfies ElementMeta,
  };

  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private texture!: THREE.CanvasTexture;
  private mesh!: THREE.Mesh;
  private mat!: THREE.MeshBasicMaterial;

  private cw = 0;
  private ch = 0;
  private warpStrength = 3.0;
  private noiseScale = 0.02;
  private timeSpeed = 0.3;
  private octaves = 3;
  private intensityLevel = 0;

  // Permutation table for noise
  private perm!: Uint8Array;

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;

    const variant = this.rng.int(0, 3);
    const presets: NoiseWarpPreset[] = [
      { warpStrength: 3.0, noiseScale: 0.02, timeSpeed: 0.3, octaves: 3 },
      { warpStrength: 5.0, noiseScale: 0.015, timeSpeed: 0.5, octaves: 4 },
      { warpStrength: 2.0, noiseScale: 0.03, timeSpeed: 0.2, octaves: 2 },
      { warpStrength: 4.0, noiseScale: 0.025, timeSpeed: 0.8, octaves: 3 },
    ];
    const p = presets[variant];
    this.warpStrength = p.warpStrength;
    this.noiseScale = p.noiseScale;
    this.timeSpeed = p.timeSpeed;
    this.octaves = p.octaves;

    this.cw = Math.min(Math.round(w / 2), 160);
    this.ch = Math.min(Math.round(h / 2), 160);
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.cw;
    this.canvas.height = this.ch;
    this.ctx = this.get2DContext(this.canvas);
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.magFilter = THREE.LinearFilter;

    // Build seeded permutation table
    this.perm = new Uint8Array(512);
    const base = new Uint8Array(256);
    for (let i = 0; i < 256; i++) base[i] = i;
    // Fisher-Yates shuffle with seeded rng
    for (let i = 255; i > 0; i--) {
      const j = this.rng.int(0, i);
      const tmp = base[i];
      base[i] = base[j];
      base[j] = tmp;
    }
    for (let i = 0; i < 256; i++) {
      this.perm[i] = base[i];
      this.perm[i + 256] = base[i];
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

  /** Value noise using permutation table */
  private noise2D(x: number, y: number): number {
    const xi = Math.floor(x) & 255;
    const yi = Math.floor(y) & 255;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);

    // Smooth interpolation
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);

    const aa = this.perm[this.perm[xi] + yi];
    const ab = this.perm[this.perm[xi] + yi + 1];
    const ba = this.perm[this.perm[xi + 1] + yi];
    const bb = this.perm[this.perm[xi + 1] + yi + 1];

    const x1 = aa / 255 + (ba / 255 - aa / 255) * u;
    const x2 = ab / 255 + (bb / 255 - ab / 255) * u;

    return x1 + (x2 - x1) * v;
  }

  /** Fractal Brownian motion */
  private fbm(x: number, y: number, octaves: number): number {
    let value = 0;
    let amplitude = 0.5;
    let frequency = 1;
    let maxVal = 0;

    for (let i = 0; i < octaves; i++) {
      value += amplitude * this.noise2D(x * frequency, y * frequency);
      maxVal += amplitude;
      amplitude *= 0.5;
      frequency *= 2.0;
    }

    return value / maxVal;
  }

  /** Domain-warped noise: apply noise to distort input coords */
  private warpedNoise(x: number, y: number, time: number): number {
    const scale = this.noiseScale;
    const warp = this.warpStrength * (1 + this.intensityLevel * 0.3);

    // First warp layer
    const qx = this.fbm(x * scale + time * 0.1, y * scale + 0.3, this.octaves);
    const qy = this.fbm(x * scale + 5.2 + time * 0.15, y * scale + 1.3, this.octaves);

    // Second warp layer (domain warping the warp)
    const rx = this.fbm(
      (x * scale + qx * warp) + time * 0.08 + 1.7,
      (y * scale + qy * warp) + time * 0.12 + 9.2,
      this.octaves,
    );
    const ry = this.fbm(
      (x * scale + qx * warp) + time * 0.06 + 8.3,
      (y * scale + qy * warp) + time * 0.1 + 2.8,
      this.octaves,
    );

    return this.fbm(
      x * scale + rx * warp * 0.8,
      y * scale + ry * warp * 0.8,
      this.octaves,
    );
  }

  private drawWarp(time: number): void {
    const ctx = this.ctx;
    const imgData = ctx.createImageData(this.cw, this.ch);
    const data = imgData.data;

    const bg = this.palette.bg;
    const pri = this.palette.primary;
    const sec = this.palette.secondary;
    const dim = this.palette.dim;

    for (let py = 0; py < this.ch; py++) {
      for (let px = 0; px < this.cw; px++) {
        const val = this.warpedNoise(px, py, time);
        const pidx = (py * this.cw + px) * 4;

        // Map noise value to palette gradient:
        // 0.0-0.3: bg -> dim, 0.3-0.6: dim -> primary, 0.6-1.0: primary -> secondary
        let r: number, g: number, b: number;
        if (val < 0.3) {
          const t = val / 0.3;
          r = bg.r + (dim.r - bg.r) * t;
          g = bg.g + (dim.g - bg.g) * t;
          b = bg.b + (dim.b - bg.b) * t;
        } else if (val < 0.6) {
          const t = (val - 0.3) / 0.3;
          r = dim.r + (pri.r - dim.r) * t;
          g = dim.g + (pri.g - dim.g) * t;
          b = dim.b + (pri.b - dim.b) * t;
        } else {
          const t = (val - 0.6) / 0.4;
          r = pri.r + (sec.r - pri.r) * t;
          g = pri.g + (sec.g - pri.g) * t;
          b = pri.b + (sec.b - pri.b) * t;
        }

        data[pidx] = Math.floor(Math.max(0, Math.min(1, r)) * 255);
        data[pidx + 1] = Math.floor(Math.max(0, Math.min(1, g)) * 255);
        data[pidx + 2] = Math.floor(Math.max(0, Math.min(1, b)) * 255);
        data[pidx + 3] = Math.floor((0.4 + val * 0.5) * 255);
      }
    }

    ctx.putImageData(imgData, 0, 0);
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    const animTime = time * this.timeSpeed;

    this.drawWarp(animTime);
    this.texture.needsUpdate = true;
    this.mat.opacity = opacity;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Rebuild permutation table for completely different pattern
      const base = new Uint8Array(256);
      for (let i = 0; i < 256; i++) base[i] = i;
      for (let i = 255; i > 0; i--) {
        const j = this.rng.int(0, i);
        const tmp = base[i];
        base[i] = base[j];
        base[j] = tmp;
      }
      for (let i = 0; i < 256; i++) {
        this.perm[i] = base[i];
        this.perm[i + 256] = base[i];
      }
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    this.intensityLevel = level;
  }
}
