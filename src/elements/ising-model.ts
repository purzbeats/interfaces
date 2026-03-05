import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * 2D Ising spin model with Metropolis algorithm. A grid of +/- spins flip
 * probabilistically based on neighbor alignment and temperature. Shows
 * phase transition from ordered to disordered states. Canvas-rendered.
 */
export class IsingModelElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'ising-model',
    meta: {
      shape: 'rectangular',
      roles: ['data-display', 'decorative'],
      moods: ['diagnostic', 'ambient'],
      bandAffinity: 'bass',
      sizes: ['needs-medium', 'needs-large'],
    } satisfies ElementMeta,
  };

  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private texture!: THREE.CanvasTexture;
  private mesh!: THREE.Mesh;
  private meshMat!: THREE.MeshBasicMaterial;
  private borderLines!: THREE.LineSegments;
  private borderMat!: THREE.LineBasicMaterial;

  private gridW: number = 0;
  private gridH: number = 0;
  private spins!: Int8Array;
  private temperature: number = 2.27; // near critical Tc
  private flipsPerFrame: number = 0;
  private cellSize: number = 0;
  private intensityLevel: number = 0;

  // Temperature sweep
  private tempMin: number = 0;
  private tempMax: number = 0;
  private tempSpeed: number = 0;
  private sweepEnabled: boolean = false;

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;
    const variant = this.rng.int(0, 3);
    const presets = [
      { grid: 48, temp: 2.27, flips: 600, sweep: false, tMin: 1.5, tMax: 3.5, tSpd: 0.1 },
      { grid: 64, temp: 1.5,  flips: 1200, sweep: true,  tMin: 1.0, tMax: 4.0, tSpd: 0.15 },
      { grid: 32, temp: 3.0,  flips: 300, sweep: false, tMin: 2.0, tMax: 4.5, tSpd: 0.08 },
      { grid: 80, temp: 2.27, flips: 2000, sweep: true,  tMin: 1.8, tMax: 3.0, tSpd: 0.05 },
    ];
    const p = presets[variant];

    this.gridW = p.grid;
    this.gridH = Math.round(p.grid * (h / w));
    if (this.gridH < 8) this.gridH = 8;
    this.temperature = p.temp;
    this.flipsPerFrame = p.flips;
    this.sweepEnabled = p.sweep;
    this.tempMin = p.tMin;
    this.tempMax = p.tMax;
    this.tempSpeed = p.tSpd;

    // Initialize spins randomly
    const total = this.gridW * this.gridH;
    this.spins = new Int8Array(total);
    for (let i = 0; i < total; i++) {
      this.spins[i] = this.rng.chance(0.5) ? 1 : -1;
    }

    // Canvas at grid resolution
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.gridW;
    this.canvas.height = this.gridH;
    this.ctx = this.get2DContext(this.canvas);
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.magFilter = THREE.NearestFilter;

    const geo = new THREE.PlaneGeometry(w, h);
    this.meshMat = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(geo, this.meshMat);
    this.mesh.position.set(x + w / 2, y + h / 2, 0);
    this.group.add(this.mesh);

    // Border
    const bv = new Float32Array([
      x, y, 0, x + w, y, 0, x + w, y, 0, x + w, y + h, 0,
      x + w, y + h, 0, x, y + h, 0, x, y + h, 0, x, y, 0,
    ]);
    const borderGeo = new THREE.BufferGeometry();
    borderGeo.setAttribute('position', new THREE.BufferAttribute(bv, 3));
    this.borderMat = new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    });
    this.borderLines = new THREE.LineSegments(borderGeo, this.borderMat);
    this.group.add(this.borderLines);
  }

  private metropolisStep(): void {
    const W = this.gridW;
    const H = this.gridH;
    const beta = 1.0 / this.temperature;

    for (let n = 0; n < this.flipsPerFrame; n++) {
      const i = this.rng.int(0, W - 1);
      const j = this.rng.int(0, H - 1);
      const idx = j * W + i;
      const s = this.spins[idx];

      // Sum of neighbors (periodic boundary)
      const left  = this.spins[j * W + ((i - 1 + W) % W)];
      const right = this.spins[j * W + ((i + 1) % W)];
      const up    = this.spins[((j - 1 + H) % H) * W + i];
      const down  = this.spins[((j + 1) % H) * W + i];
      const sumN = left + right + up + down;

      const dE = 2 * s * sumN;
      if (dE <= 0 || this.rng.next() < Math.exp(-beta * dE)) {
        this.spins[idx] = -s as (1 | -1);
      }
    }
  }

  private renderGrid(): void {
    const imgData = this.ctx.createImageData(this.gridW, this.gridH);
    const data = imgData.data;
    const pr = Math.round(this.palette.primary.r * 255);
    const pg = Math.round(this.palette.primary.g * 255);
    const pb = Math.round(this.palette.primary.b * 255);
    const br = Math.round(this.palette.bg.r * 255);
    const bg = Math.round(this.palette.bg.g * 255);
    const bb = Math.round(this.palette.bg.b * 255);

    for (let i = 0; i < this.spins.length; i++) {
      const off = i * 4;
      if (this.spins[i] === 1) {
        data[off] = pr; data[off + 1] = pg; data[off + 2] = pb;
      } else {
        data[off] = br; data[off + 1] = bg; data[off + 2] = bb;
      }
      data[off + 3] = 255;
    }
    this.ctx.putImageData(imgData, 0, 0);
    this.texture.needsUpdate = true;
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);

    // Temperature sweep
    if (this.sweepEnabled) {
      const range = this.tempMax - this.tempMin;
      const t = ((time * this.tempSpeed) % 2);
      this.temperature = t < 1
        ? this.tempMin + t * range
        : this.tempMax - (t - 1) * range;
    }

    this.metropolisStep();
    this.renderGrid();

    this.meshMat.opacity = opacity;
    this.borderMat.opacity = opacity * 0.25;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Quench: set temperature to zero (order immediately)
      this.temperature = 0.1;
      setTimeout(() => { this.temperature = 2.27; }, 1000);
    }
    if (action === 'alert') {
      // Heat: set very high temperature (disorder)
      this.temperature = 10;
      setTimeout(() => { this.temperature = 2.27; }, 1000);
    }
    if (action === 'pulse') {
      // Flip a block
      const bx = this.rng.int(0, this.gridW - 8);
      const by = this.rng.int(0, this.gridH - 8);
      for (let dy = 0; dy < 8; dy++) {
        for (let dx = 0; dx < 8; dx++) {
          const idx = (by + dy) * this.gridW + (bx + dx);
          if (idx < this.spins.length) this.spins[idx] *= -1;
        }
      }
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    this.intensityLevel = level;
    if (level === 0) {
      this.temperature = 2.27;
      return;
    }
    // Higher intensity -> higher temperature (more disorder)
    this.temperature = 2.27 + level * 0.5;
    this.flipsPerFrame = 600 + level * 200;
  }
}
