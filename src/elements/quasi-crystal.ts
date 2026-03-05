import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Quasicrystal interference pattern: multiple rotated sine gratings overlaid
 * producing Penrose-like aperiodic tiling patterns. Canvas-based with animated
 * phase drift creating mesmerizing moiré effects.
 */
export class QuasiCrystalElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'quasi-crystal',
    meta: {
      shape: 'rectangular',
      roles: ['decorative'],
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

  private gratingCount: number = 5;
  private gratingAngles: number[] = [];
  private frequency: number = 0.08;
  private phaseSpeed: number = 0.3;
  private colorMode: number = 0;
  private resScale: number = 0.5;
  private cw: number = 0;
  private ch: number = 0;
  private intensityLevel: number = 0;
  private renderAccum: number = 0;

  build(): void {
    const variant = this.rng.int(0, 3);
    const presets = [
      { gratings: 5, freq: 0.08, speed: 0.3, colorMode: 0 },   // Classic 5-fold
      { gratings: 7, freq: 0.06, speed: 0.2, colorMode: 1 },   // 7-fold dense
      { gratings: 5, freq: 0.12, speed: 0.5, colorMode: 2 },   // High-freq fast
      { gratings: 6, freq: 0.05, speed: 0.15, colorMode: 3 },  // 6-fold slow
    ];
    const p = presets[variant];

    this.gratingCount = p.gratings;
    this.frequency = p.freq;
    this.phaseSpeed = p.speed;
    this.colorMode = p.colorMode;

    // Compute grating angles evenly distributed
    this.gratingAngles = [];
    for (let i = 0; i < this.gratingCount; i++) {
      this.gratingAngles.push((Math.PI * i) / this.gratingCount + this.rng.float(-0.05, 0.05));
    }

    const { x, y, w, h } = this.px;
    const maxRes = 160;
    const scale = Math.min(1, maxRes / Math.max(w, h));
    this.cw = Math.max(32, Math.floor(w * scale));
    this.ch = Math.max(32, Math.floor(h * scale));

    this.canvas = document.createElement('canvas');
    this.canvas.width = this.cw;
    this.canvas.height = this.ch;
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

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    this.material.opacity = opacity;

    this.renderAccum += dt;
    if (this.renderAccum < 0.066) return;
    this.renderAccum = 0;

    const { cw, ch } = this;
    const ctx = this.ctx;
    const imageData = ctx.createImageData(cw, ch);
    const data = imageData.data;

    const pr = Math.floor(this.palette.primary.r * 255);
    const pg = Math.floor(this.palette.primary.g * 255);
    const pb = Math.floor(this.palette.primary.b * 255);
    const sr = Math.floor(this.palette.secondary.r * 255);
    const sg = Math.floor(this.palette.secondary.g * 255);
    const sb = Math.floor(this.palette.secondary.b * 255);
    const bgr = Math.floor(this.palette.bg.r * 255);
    const bgg = Math.floor(this.palette.bg.g * 255);
    const bgb = Math.floor(this.palette.bg.b * 255);

    const freq = this.frequency * (1 + this.intensityLevel * 0.1);
    const phase = time * this.phaseSpeed;
    const angles = this.gratingAngles;
    const n = this.gratingCount;

    for (let py = 0; py < ch; py++) {
      for (let px = 0; px < cw; px++) {
        let sum = 0;
        for (let g = 0; g < n; g++) {
          const cos = Math.cos(angles[g]);
          const sin = Math.sin(angles[g]);
          const d = px * cos + py * sin;
          sum += Math.cos(d * freq + phase + g * 0.7);
        }
        // Normalize to 0-1
        const v = (sum / n + 1) * 0.5;

        const idx = (py * cw + px) * 4;
        let r: number, g: number, b: number;

        switch (this.colorMode) {
          case 1: {
            // Threshold bands
            const band = Math.floor(v * 4) / 4;
            r = bgr + (pr - bgr) * band;
            g = bgg + (pg - bgg) * band;
            b = bgb + (pb - bgb) * band;
            break;
          }
          case 2: {
            // Two-color gradient
            r = pr * v + sr * (1 - v);
            g = pg * v + sg * (1 - v);
            b = pb * v + sb * (1 - v);
            break;
          }
          case 3: {
            // High contrast
            const t = v > 0.5 ? 1 : 0;
            r = bgr + (pr - bgr) * t;
            g = bgg + (pg - bgg) * t;
            b = bgb + (pb - bgb) * t;
            break;
          }
          default: {
            // Smooth gradient
            r = bgr + (pr - bgr) * v;
            g = bgg + (pg - bgg) * v;
            b = bgb + (pb - bgb) * v;
          }
        }

        data[idx] = r;
        data[idx + 1] = g;
        data[idx + 2] = b;
        data[idx + 3] = 255;
      }
    }

    ctx.putImageData(imageData, 0, 0);
    this.texture.needsUpdate = true;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Scramble grating angles
      for (let i = 0; i < this.gratingCount; i++) {
        this.gratingAngles[i] += this.rng.float(-0.5, 0.5);
      }
    }
    if (action === 'pulse') {
      this.frequency *= 1.5;
      setTimeout(() => { this.frequency /= 1.5; }, 500);
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    this.intensityLevel = level;
    if (level >= 4) {
      this.phaseSpeed = 0.8 + level * 0.2;
    } else {
      this.phaseSpeed = 0.3;
    }
  }
}
