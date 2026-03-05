import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Classic DOOM-style fire effect. Bottom row of hot pixels propagate upward
 * with random cooling. Pure canvas pixel manipulation with a custom palette
 * derived from the interface colors. Supports wind and heat source variations.
 */
export class PixelFireElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'pixel-fire',
    meta: {
      shape: 'rectangular',
      roles: ['decorative'],
      moods: ['tactical', 'ambient'],
      bandAffinity: 'bass',
      sizes: ['works-small', 'needs-medium'],
    } satisfies ElementMeta,
  };

  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private texture!: THREE.CanvasTexture;
  private mesh!: THREE.Mesh;
  private meshMat!: THREE.MeshBasicMaterial;
  private borderLines!: THREE.LineSegments;
  private borderMat!: THREE.LineBasicMaterial;

  private fireW = 0;
  private fireH = 0;
  private fireBuffer!: Uint8Array;
  private paletteRGB!: Uint8Array;  // 37 colors * 3 channels
  private paletteSize = 37;
  private coolRate = 0;
  private spreadW = 0;
  private windBias = 0;
  private windFreq = 0;
  private baseHeat = 0;
  private intensityLevel = 0;

  // RNG state for fire (need fast, can use simple LCG since visual only)
  private rngState = 0;

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;
    this.rngState = this.rng.int(1, 0x7FFFFFFF);

    const variant = this.rng.int(0, 3);
    const presets = [
      { cellSize: 3, cool: 2, spread: 1, wind: 0, wFreq: 0, heat: 36 },
      { cellSize: 2, cool: 1, spread: 1, wind: 0, wFreq: 0, heat: 36 },
      { cellSize: 4, cool: 3, spread: 2, wind: 0.5, wFreq: 1.2, heat: 34 },
      { cellSize: 3, cool: 2, spread: 2, wind: 0.3, wFreq: 0.8, heat: 35 },
    ];
    const p = presets[variant];
    this.coolRate = p.cool;
    this.spreadW = p.spread;
    this.windBias = p.wind;
    this.windFreq = p.wFreq;
    this.baseHeat = p.heat;

    this.fireW = Math.max(8, Math.floor(w / p.cellSize));
    this.fireH = Math.max(8, Math.floor(h / p.cellSize));
    this.fireBuffer = new Uint8Array(this.fireW * this.fireH);

    // Build fire palette from interface colors
    this.paletteRGB = new Uint8Array(this.paletteSize * 3);
    const pr = this.palette.primary;
    const sr = this.palette.secondary;
    const bg = this.palette.bg;

    for (let i = 0; i < this.paletteSize; i++) {
      const t = i / (this.paletteSize - 1);
      let r: number, g: number, b: number;
      if (t < 0.25) {
        // Black to bg
        const s = t / 0.25;
        r = bg.r * s * 0.3;
        g = bg.g * s * 0.3;
        b = bg.b * s * 0.3;
      } else if (t < 0.5) {
        // bg to secondary
        const s = (t - 0.25) / 0.25;
        r = bg.r * 0.3 + (sr.r - bg.r * 0.3) * s;
        g = bg.g * 0.3 + (sr.g - bg.g * 0.3) * s;
        b = bg.b * 0.3 + (sr.b - bg.b * 0.3) * s;
      } else if (t < 0.8) {
        // secondary to primary
        const s = (t - 0.5) / 0.3;
        r = sr.r + (pr.r - sr.r) * s;
        g = sr.g + (pr.g - sr.g) * s;
        b = sr.b + (pr.b - sr.b) * s;
      } else {
        // primary to white
        const s = (t - 0.8) / 0.2;
        r = pr.r + (1 - pr.r) * s;
        g = pr.g + (1 - pr.g) * s;
        b = pr.b + (1 - pr.b) * s;
      }
      this.paletteRGB[i * 3]     = Math.floor(Math.min(1, r) * 255);
      this.paletteRGB[i * 3 + 1] = Math.floor(Math.min(1, g) * 255);
      this.paletteRGB[i * 3 + 2] = Math.floor(Math.min(1, b) * 255);
    }

    // Seed bottom row
    for (let fx = 0; fx < this.fireW; fx++) {
      this.fireBuffer[(this.fireH - 1) * this.fireW + fx] = this.baseHeat;
    }

    this.canvas = document.createElement('canvas');
    this.canvas.width = this.fireW;
    this.canvas.height = this.fireH;
    this.ctx = this.get2DContext(this.canvas);
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.magFilter = THREE.NearestFilter;

    const geo = new THREE.PlaneGeometry(w, h);
    this.meshMat = new THREE.MeshBasicMaterial({
      map: this.texture, transparent: true, opacity: 0, depthWrite: false,
    });
    this.mesh = new THREE.Mesh(geo, this.meshMat);
    this.mesh.position.set(x + w / 2, y + h / 2, 0);
    this.group.add(this.mesh);

    // Border
    const bv = new Float32Array([
      x, y, 0, x + w, y, 0, x + w, y, 0, x + w, y + h, 0,
      x + w, y + h, 0, x, y + h, 0, x, y + h, 0, x, y, 0,
    ]);
    const bGeo = new THREE.BufferGeometry();
    bGeo.setAttribute('position', new THREE.BufferAttribute(bv, 3));
    this.borderMat = new THREE.LineBasicMaterial({
      color: this.palette.dim, transparent: true, opacity: 0,
    });
    this.borderLines = new THREE.LineSegments(bGeo, this.borderMat);
    this.group.add(this.borderLines);
  }

  private fastRand(): number {
    this.rngState = (this.rngState * 1664525 + 1013904223) & 0x7FFFFFFF;
    return this.rngState;
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);

    // Wind effect
    const wind = Math.round(Math.sin(time * this.windFreq) * this.windBias * this.spreadW);

    // Fire propagation: bottom-up, each pixel reads from below with spread
    for (let fy = 0; fy < this.fireH - 1; fy++) {
      for (let fx = 0; fx < this.fireW; fx++) {
        const spread = (this.fastRand() % (this.spreadW * 2 + 1)) - this.spreadW + wind;
        const srcX = Math.min(this.fireW - 1, Math.max(0, fx + spread));
        const srcIdx = (fy + 1) * this.fireW + srcX;
        const dstIdx = fy * this.fireW + fx;
        const cool = this.fastRand() % (this.coolRate + 1);
        this.fireBuffer[dstIdx] = Math.max(0, this.fireBuffer[srcIdx] - cool);
      }
    }

    // Vary bottom row
    for (let fx = 0; fx < this.fireW; fx++) {
      const variation = this.fastRand() % 7;
      this.fireBuffer[(this.fireH - 1) * this.fireW + fx] = Math.max(0, this.baseHeat - variation);
    }

    // Render to canvas
    const imgData = this.ctx.createImageData(this.fireW, this.fireH);
    const data = imgData.data;
    for (let i = 0; i < this.fireW * this.fireH; i++) {
      const val = Math.min(this.paletteSize - 1, this.fireBuffer[i]);
      const pi = i * 4;
      data[pi]     = this.paletteRGB[val * 3];
      data[pi + 1] = this.paletteRGB[val * 3 + 1];
      data[pi + 2] = this.paletteRGB[val * 3 + 2];
      data[pi + 3] = val > 0 ? Math.min(255, 150 + Math.floor((val / (this.paletteSize - 1)) * 105)) : 0;
    }
    this.ctx.putImageData(imgData, 0, 0);
    this.texture.needsUpdate = true;

    this.meshMat.opacity = opacity;
    this.borderMat.opacity = opacity * 0.2;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Flash: entire buffer max heat
      this.fireBuffer.fill(this.paletteSize - 1);
    }
    if (action === 'alert') {
      // Extinguish then relight
      for (let i = 0; i < this.fireW * (this.fireH - 1); i++) {
        this.fireBuffer[i] = 0;
      }
    }
    if (action === 'pulse') {
      // Heat pulse: boost middle section
      const midY = Math.floor(this.fireH * 0.6);
      for (let fx = 0; fx < this.fireW; fx++) {
        this.fireBuffer[midY * this.fireW + fx] = this.paletteSize - 1;
      }
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    this.intensityLevel = level;
    if (level === 0) {
      this.baseHeat = 36;
      this.coolRate = 2;
      return;
    }
    this.baseHeat = Math.min(this.paletteSize - 1, 36);
    this.coolRate = Math.max(1, 3 - level);
    if (level >= 3) {
      // Heat secondary rows
      for (let fx = 0; fx < this.fireW; fx++) {
        if (this.fireH > 2) {
          this.fireBuffer[(this.fireH - 2) * this.fireW + fx] = this.paletteSize - 2;
        }
      }
    }
  }
}
