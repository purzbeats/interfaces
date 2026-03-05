import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Animated Voronoi diagram with drifting seed points.
 * Cells shift and shatter as seeds move, with luminous boundaries
 * and pulsing cell fills — like cracked glass on a control panel.
 */
export class VoronoiShatterElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'voronoi-shatter',
    meta: { shape: 'rectangular', roles: ['decorative', 'structural'], moods: ['ambient', 'tactical'], bandAffinity: 'mid', sizes: ['needs-medium', 'needs-large'] },
  };

  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private texture!: THREE.CanvasTexture;
  private mesh!: THREE.Mesh;

  private seedCount = 0;
  private seedX!: Float32Array;
  private seedY!: Float32Array;
  private seedVx!: Float32Array;
  private seedVy!: Float32Array;

  private cw = 0;
  private ch = 0;
  private renderAccum = 0;
  private shatterTimer = 0;

  build(): void {
    const variant = this.rng.int(0, 3);
    const presets = [
      { seeds: 24, speed: 15 },
      { seeds: 48, speed: 25 },
      { seeds: 12, speed: 8 },
      { seeds: 36, speed: 40 },
    ];
    const p = presets[variant];
    this.glitchAmount = 4;

    const { x, y, w, h } = this.px;
    // Render at reduced resolution for performance
    const scale = Math.max(1, Math.floor(Math.min(w, h) / 200));
    this.cw = Math.ceil(w / scale);
    this.ch = Math.ceil(h / scale);

    this.canvas = document.createElement('canvas');
    this.canvas.width = this.cw;
    this.canvas.height = this.ch;
    this.ctx = this.get2DContext(this.canvas);

    this.seedCount = p.seeds + this.rng.int(-3, 3);
    this.seedX = new Float32Array(this.seedCount);
    this.seedY = new Float32Array(this.seedCount);
    this.seedVx = new Float32Array(this.seedCount);
    this.seedVy = new Float32Array(this.seedCount);

    for (let i = 0; i < this.seedCount; i++) {
      this.seedX[i] = this.rng.float(0, this.cw);
      this.seedY[i] = this.rng.float(0, this.ch);
      const a = this.rng.float(0, Math.PI * 2);
      const spd = this.rng.float(p.speed * 0.5, p.speed);
      this.seedVx[i] = Math.cos(a) * spd;
      this.seedVy[i] = Math.sin(a) * spd;
    }

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.magFilter = THREE.NearestFilter;

    const geo = new THREE.PlaneGeometry(w, h);
    const mat = new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, opacity: 0 });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.set(x + w / 2, y + h / 2, 0);
    this.group.add(this.mesh);
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);

    // Move seeds
    for (let i = 0; i < this.seedCount; i++) {
      this.seedX[i] += this.seedVx[i] * dt;
      this.seedY[i] += this.seedVy[i] * dt;
      if (this.seedX[i] < 0) { this.seedX[i] = 0; this.seedVx[i] *= -1; }
      if (this.seedX[i] > this.cw) { this.seedX[i] = this.cw; this.seedVx[i] *= -1; }
      if (this.seedY[i] < 0) { this.seedY[i] = 0; this.seedVy[i] *= -1; }
      if (this.seedY[i] > this.ch) { this.seedY[i] = this.ch; this.seedVy[i] *= -1; }
    }

    if (this.shatterTimer > 0) this.shatterTimer -= dt;

    // Throttled rendering
    this.renderAccum += dt;
    if (this.renderAccum < 0.05) {
      (this.mesh.material as THREE.MeshBasicMaterial).opacity = opacity * 0.85;
      return;
    }
    this.renderAccum = 0;

    const ctx = this.ctx;
    const img = ctx.getImageData(0, 0, this.cw, this.ch);
    const data = img.data;

    const pr = Math.floor(this.palette.primary.r * 255);
    const pg = Math.floor(this.palette.primary.g * 255);
    const pb = Math.floor(this.palette.primary.b * 255);
    const sr = Math.floor(this.palette.secondary.r * 255);
    const sg = Math.floor(this.palette.secondary.g * 255);
    const sb = Math.floor(this.palette.secondary.b * 255);
    const dr = Math.floor(this.palette.dim.r * 255);
    const dg = Math.floor(this.palette.dim.g * 255);
    const db = Math.floor(this.palette.dim.b * 255);

    const shatter = this.shatterTimer > 0;

    // For each pixel, find closest and second-closest seed
    for (let py = 0; py < this.ch; py++) {
      for (let px = 0; px < this.cw; px++) {
        let min1 = Infinity, min2 = Infinity;
        let closest = 0;
        for (let s = 0; s < this.seedCount; s++) {
          const ddx = px - this.seedX[s];
          const ddy = py - this.seedY[s];
          const d = ddx * ddx + ddy * ddy;
          if (d < min1) { min2 = min1; min1 = d; closest = s; }
          else if (d < min2) { min2 = d; }
        }

        const edgeDist = Math.sqrt(min2) - Math.sqrt(min1);
        const idx = (py * this.cw + px) * 4;

        if (edgeDist < (shatter ? 3.0 : 1.5)) {
          // Edge: bright primary
          const bright = shatter ? 1.0 : 0.7;
          data[idx] = pr * bright;
          data[idx + 1] = pg * bright;
          data[idx + 2] = pb * bright;
          data[idx + 3] = 255;
        } else {
          // Cell interior: dim with per-cell tint
          const pulse = 0.15 + 0.1 * Math.sin(time * 2 + closest * 1.7);
          const useSec = closest % 3 === 0;
          data[idx] = useSec ? sr * pulse : dr * pulse * 1.5;
          data[idx + 1] = useSec ? sg * pulse : dg * pulse * 1.5;
          data[idx + 2] = useSec ? sb * pulse : db * pulse * 1.5;
          data[idx + 3] = 255;
        }
      }
    }

    ctx.putImageData(img, 0, 0);
    this.texture.needsUpdate = true;
    (this.mesh.material as THREE.MeshBasicMaterial).opacity = opacity * 0.85;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      for (let i = 0; i < this.seedCount; i++) {
        this.seedVx[i] = (this.rng.next() - 0.5) * 100;
        this.seedVy[i] = (this.rng.next() - 0.5) * 100;
      }
    }
    if (action === 'alert') {
      this.shatterTimer = 1.5;
      for (let i = 0; i < this.seedCount; i++) {
        this.seedVx[i] *= 3;
        this.seedVy[i] *= 3;
      }
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level >= 4) this.shatterTimer = 0.8;
  }
}
