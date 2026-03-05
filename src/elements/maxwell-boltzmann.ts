import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Gas particles in a box with a histogram of speeds evolving toward
 * the Maxwell-Boltzmann distribution. Canvas-rendered with both
 * particle view and speed histogram side by side.
 */
export class MaxwellBoltzmannElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'maxwell-boltzmann',
    meta: { shape: 'rectangular', roles: ['data-display', 'scanner'], moods: ['diagnostic', 'tactical'], bandAffinity: 'mid', sizes: ['needs-medium', 'needs-large'] },
  };

  private count = 0;
  private posX!: Float32Array;
  private posY!: Float32Array;
  private velX!: Float32Array;
  private velY!: Float32Array;
  private temperature = 1;
  private histBins = 20;
  private histogram!: Float32Array;

  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private texture!: THREE.CanvasTexture;
  private mesh!: THREE.Mesh;
  private renderAccum = 0;

  build(): void {
    this.glitchAmount = 4;
    const variant = this.rng.int(0, 3);
    const presets = [
      { count: 150, temp: 1.0, bins: 20 },
      { count: 300, temp: 1.5, bins: 25 },
      { count: 80, temp: 0.6, bins: 15 },
      { count: 200, temp: 2.0, bins: 30 },
    ];
    const p = presets[variant];

    const { x, y, w, h } = this.px;
    this.count = p.count;
    this.temperature = p.temp;
    this.histBins = p.bins;
    this.histogram = new Float32Array(this.histBins);

    this.posX = new Float32Array(this.count);
    this.posY = new Float32Array(this.count);
    this.velX = new Float32Array(this.count);
    this.velY = new Float32Array(this.count);

    const speedScale = Math.min(w, h) * 0.3;
    for (let i = 0; i < this.count; i++) {
      this.posX[i] = this.rng.float(0, 1);
      this.posY[i] = this.rng.float(0, 1);
      // Maxwell-Boltzmann-like initial distribution using Box-Muller with rng
      const u1 = Math.max(0.001, this.rng.float(0, 1));
      const u2 = this.rng.float(0, 1);
      const mag = Math.sqrt(-2 * Math.log(u1)) * this.temperature;
      this.velX[i] = mag * Math.cos(2 * Math.PI * u2) * speedScale;
      this.velY[i] = mag * Math.sin(2 * Math.PI * u2) * speedScale;
    }

    const res = Math.min(512, Math.max(w, h));
    const scale = res / Math.max(w, h);
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.ceil(w * scale);
    this.canvas.height = Math.ceil(h * scale);
    this.ctx = this.get2DContext(this.canvas);

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.NearestFilter;
    const geo = new THREE.PlaneGeometry(w, h);
    this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      map: this.texture, transparent: true, opacity: 0,
    }));
    this.mesh.position.set(x + w / 2, y + h / 2, 0);
    this.group.add(this.mesh);
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);
    const cdt = Math.min(dt, 0.033);
    const speedScale = Math.min(this.px.w, this.px.h) * 0.3;

    // Physics: elastic collisions with walls
    for (let i = 0; i < this.count; i++) {
      this.posX[i] += (this.velX[i] / speedScale) * cdt;
      this.posY[i] += (this.velY[i] / speedScale) * cdt;

      if (this.posX[i] < 0) { this.posX[i] = -this.posX[i]; this.velX[i] = Math.abs(this.velX[i]); }
      if (this.posX[i] > 1) { this.posX[i] = 2 - this.posX[i]; this.velX[i] = -Math.abs(this.velX[i]); }
      if (this.posY[i] < 0) { this.posY[i] = -this.posY[i]; this.velY[i] = Math.abs(this.velY[i]); }
      if (this.posY[i] > 1) { this.posY[i] = 2 - this.posY[i]; this.velY[i] = -Math.abs(this.velY[i]); }
    }

    // Build speed histogram
    this.histogram.fill(0);
    const maxSpeed = speedScale * 4 * this.temperature;
    for (let i = 0; i < this.count; i++) {
      const speed = Math.sqrt(this.velX[i] * this.velX[i] + this.velY[i] * this.velY[i]);
      const bin = Math.min(this.histBins - 1, Math.floor((speed / maxSpeed) * this.histBins));
      this.histogram[bin]++;
    }

    // Render
    this.renderAccum += dt;
    if (this.renderAccum >= 0.05) {
      this.renderAccum = 0;
      const cw = this.canvas.width, ch = this.canvas.height;
      this.ctx.fillStyle = '#000';
      this.ctx.fillRect(0, 0, cw, ch);

      const pr = Math.round(this.palette.primary.r * 255);
      const pg = Math.round(this.palette.primary.g * 255);
      const pb = Math.round(this.palette.primary.b * 255);
      const sr = Math.round(this.palette.secondary.r * 255);
      const sg = Math.round(this.palette.secondary.g * 255);
      const sb = Math.round(this.palette.secondary.b * 255);

      // Left half: particles
      const halfW = cw * 0.5;
      this.ctx.fillStyle = `rgb(${pr},${pg},${pb})`;
      for (let i = 0; i < this.count; i++) {
        const px = this.posX[i] * halfW;
        const py = this.posY[i] * ch;
        this.ctx.fillRect(px - 1, py - 1, 2, 2);
      }

      // Border between sections
      const dr = Math.round(this.palette.dim.r * 255);
      const dg = Math.round(this.palette.dim.g * 255);
      const db = Math.round(this.palette.dim.b * 255);
      this.ctx.strokeStyle = `rgb(${dr},${dg},${db})`;
      this.ctx.beginPath();
      this.ctx.moveTo(halfW, 0);
      this.ctx.lineTo(halfW, ch);
      this.ctx.stroke();

      // Right half: histogram
      let maxCount = 1;
      for (let b = 0; b < this.histBins; b++) {
        if (this.histogram[b] > maxCount) maxCount = this.histogram[b];
      }

      const barW = (cw - halfW - 10) / this.histBins;
      const histX = halfW + 5;
      this.ctx.fillStyle = `rgb(${sr},${sg},${sb})`;
      for (let b = 0; b < this.histBins; b++) {
        const barH = (this.histogram[b] / maxCount) * (ch - 20);
        this.ctx.fillRect(histX + b * barW, ch - 10 - barH, barW - 1, barH);
      }

      // Theoretical MB curve overlay
      this.ctx.strokeStyle = `rgba(${pr},${pg},${pb},0.8)`;
      this.ctx.lineWidth = 1.5;
      this.ctx.beginPath();
      const kT = this.temperature * speedScale;
      for (let b = 0; b <= this.histBins; b++) {
        const v = (b / this.histBins) * maxSpeed;
        // 2D Maxwell-Boltzmann: f(v) = (v / kT^2) * exp(-v^2 / (2 kT^2))
        const fv = (v / (kT * kT)) * Math.exp(-(v * v) / (2 * kT * kT));
        const peakF = (1 / (kT * Math.E));
        const normF = Math.min(1, fv / peakF);
        const px2 = histX + b * barW;
        const py2 = ch - 10 - normF * (ch - 20);
        if (b === 0) this.ctx.moveTo(px2, py2); else this.ctx.lineTo(px2, py2);
      }
      this.ctx.stroke();

      this.texture.needsUpdate = true;
    }

    (this.mesh.material as THREE.MeshBasicMaterial).opacity = opacity * 0.9;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Thermalise: randomize all velocities
      const speedScale = Math.min(this.px.w, this.px.h) * 0.3;
      for (let i = 0; i < this.count; i++) {
        const u1 = Math.max(0.001, this.rng.float(0, 1));
        const u2 = this.rng.float(0, 1);
        const mag = Math.sqrt(-2 * Math.log(u1)) * this.temperature * 2;
        this.velX[i] = mag * Math.cos(2 * Math.PI * u2) * speedScale;
        this.velY[i] = mag * Math.sin(2 * Math.PI * u2) * speedScale;
      }
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) { this.temperature = 1; return; }
    this.temperature = 1 + level * 0.3;
  }
}
