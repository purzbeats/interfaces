import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Heat-map grid of color-interpolated cells with wandering hotspot and heat diffusion.
 * Canvas-based rendering.
 */
export class ThermalMapElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'thermal-map',
    meta: { shape: 'rectangular', roles: ['data-display', 'scanner'], moods: ['tactical', 'diagnostic'], sizes: ['needs-medium'] },
  };
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private texture!: THREE.CanvasTexture;
  private mesh!: THREE.Mesh;
  private borderLines!: THREE.LineSegments;
  private gridW: number = 0;
  private gridH: number = 0;
  private heatGrid: number[] = [];
  private hotspots: { x: number; y: number; vx: number; vy: number }[] = [];
  private renderAccum: number = 0;
  private readonly RENDER_INTERVAL = 1 / 12;

  build(): void {
    const { x, y, w, h } = this.px;
    this.gridW = Math.max(8, Math.min(80, Math.floor(w / 10)));
    this.gridH = Math.max(8, Math.min(60, Math.floor(h / 10)));
    this.heatGrid = new Array(this.gridW * this.gridH).fill(0);

    // Multiple hotspots for better coverage
    const hotspotCount = this.rng.int(2, 4);
    for (let i = 0; i < hotspotCount; i++) {
      this.hotspots.push({
        x: this.rng.float(0, this.gridW),
        y: this.rng.float(0, this.gridH),
        vx: this.rng.float(-5, 5),
        vy: this.rng.float(-5, 5),
      });
    }

    // Seed initial heat so it's visible immediately
    for (const hs of this.hotspots) {
      this.applyHeat(Math.floor(hs.x), Math.floor(hs.y));
    }
    // Run a few diffusion steps to spread initial heat
    for (let i = 0; i < 8; i++) this.diffuse();

    this.canvas = document.createElement('canvas');
    this.canvas.width = this.gridW;
    this.canvas.height = this.gridH;
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.magFilter = THREE.NearestFilter;

    const geo = new THREE.PlaneGeometry(w, h);
    this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      opacity: 0,
    }));
    this.mesh.position.set(x + w / 2, y + h / 2, 1);
    this.group.add(this.mesh);

    // Border
    const bv = new Float32Array([
      x, y, 0, x + w, y, 0,
      x + w, y, 0, x + w, y + h, 0,
      x + w, y + h, 0, x, y + h, 0,
      x, y + h, 0, x, y, 0,
    ]);
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.BufferAttribute(bv, 3));
    this.borderLines = new THREE.LineSegments(bg, new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.borderLines);
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);

    // Move hotspots
    for (const hs of this.hotspots) {
      hs.x += hs.vx * dt;
      hs.y += hs.vy * dt;
      if (hs.x < 0 || hs.x >= this.gridW) { hs.vx *= -1; hs.x = Math.max(0, Math.min(this.gridW - 1, hs.x)); }
      if (hs.y < 0 || hs.y >= this.gridH) { hs.vy *= -1; hs.y = Math.max(0, Math.min(this.gridH - 1, hs.y)); }
      hs.vx += this.rng.float(-1, 1) * dt * 3;
      hs.vy += this.rng.float(-1, 1) * dt * 3;
      hs.vx = Math.max(-6, Math.min(6, hs.vx));
      hs.vy = Math.max(-6, Math.min(6, hs.vy));
      this.applyHeat(Math.floor(hs.x), Math.floor(hs.y));
    }

    // Diffusion step
    this.diffuse();

    // Render canvas at reduced rate
    this.renderAccum += dt;
    if (this.renderAccum >= this.RENDER_INTERVAL) {
      this.renderAccum = 0;
      this.renderCanvas();
    }

    (this.mesh.material as THREE.MeshBasicMaterial).opacity = opacity * 0.9;
    (this.borderLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.3;
  }

  /** Apply heat in a radius around a cell. */
  private applyHeat(hx: number, hy: number): void {
    const radius = Math.max(2, Math.floor(Math.min(this.gridW, this.gridH) * 0.08));
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const gx = hx + dx;
        const gy = hy + dy;
        if (gx < 0 || gx >= this.gridW || gy < 0 || gy >= this.gridH) continue;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist <= radius) {
          const falloff = 1 - dist / radius;
          const idx = gy * this.gridW + gx;
          this.heatGrid[idx] = Math.min(1, this.heatGrid[idx] + falloff * 0.6);
        }
      }
    }
  }

  /** One diffusion + decay step. */
  private diffuse(): void {
    const newGrid = new Array(this.gridW * this.gridH);
    for (let gy = 0; gy < this.gridH; gy++) {
      for (let gx = 0; gx < this.gridW; gx++) {
        const idx = gy * this.gridW + gx;
        let sum = this.heatGrid[idx] * 4;
        let count = 4;
        if (gx > 0) { sum += this.heatGrid[idx - 1]; count++; }
        if (gx < this.gridW - 1) { sum += this.heatGrid[idx + 1]; count++; }
        if (gy > 0) { sum += this.heatGrid[idx - this.gridW]; count++; }
        if (gy < this.gridH - 1) { sum += this.heatGrid[idx + this.gridW]; count++; }
        newGrid[idx] = (sum / count) * 0.995; // slower decay
      }
    }
    this.heatGrid = newGrid;
  }

  private renderCanvas(): void {
    const { ctx, canvas } = this;
    const imgData = ctx.createImageData(canvas.width, canvas.height);
    const data = imgData.data;

    const primary = this.palette.primary;
    const secondary = this.palette.secondary;
    const alert = this.palette.alert;
    const bg = this.palette.bg;

    for (let i = 0; i < this.heatGrid.length; i++) {
      const v = Math.min(1, this.heatGrid[i]);
      let r: number, g: number, b: number;

      if (v < 0.5) {
        // bg -> primary
        const t = v * 2;
        r = bg.r + (primary.r - bg.r) * t;
        g = bg.g + (primary.g - bg.g) * t;
        b = bg.b + (primary.b - bg.b) * t;
      } else if (v < 0.8) {
        // primary -> secondary
        const t = (v - 0.5) / 0.3;
        r = primary.r + (secondary.r - primary.r) * t;
        g = primary.g + (secondary.g - primary.g) * t;
        b = primary.b + (secondary.b - primary.b) * t;
      } else {
        // secondary -> alert
        const t = (v - 0.8) / 0.2;
        r = secondary.r + (alert.r - secondary.r) * t;
        g = secondary.g + (alert.g - secondary.g) * t;
        b = secondary.b + (alert.b - secondary.b) * t;
      }

      data[i * 4] = Math.floor(r * 255);
      data[i * 4 + 1] = Math.floor(g * 255);
      data[i * 4 + 2] = Math.floor(b * 255);
      data[i * 4 + 3] = 255;
    }

    ctx.putImageData(imgData, 0, 0);
    this.texture.needsUpdate = true;
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) return;
    if (level >= 5) {
      // Max heat everywhere
      for (let i = 0; i < this.heatGrid.length; i++) {
        this.heatGrid[i] = 1.0;
      }
    } else {
      // Boost heat at hotspot locations
      const boost = level >= 3 ? 3 : 1;
      for (let n = 0; n < boost; n++) {
        for (const hs of this.hotspots) {
          this.applyHeat(Math.round(hs.x), Math.round(hs.y));
        }
      }
    }
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Scramble heat values
      for (let i = 0; i < this.heatGrid.length; i++) {
        this.heatGrid[i] = this.rng.float(0, 1);
      }
    }
    if (action === 'alert') {
      // Max heat everywhere
      for (let i = 0; i < this.heatGrid.length; i++) {
        this.heatGrid[i] = 1;
      }
    }
  }

  dispose(): void {
    this.texture.dispose();
    super.dispose();
  }
}
