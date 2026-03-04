import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Grid of small squares representing bits (on/off).
 * "On" bits gradually decay (fade) from top to bottom over time.
 * New random rows appear at top; decayed bits occasionally repair briefly.
 */
export class BitDecayElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'bit-decay',
    meta: { shape: 'rectangular', roles: ['data-display'], moods: ['diagnostic'], sizes: ['works-small', 'needs-medium'] },
  };

  private cols: number = 0;
  private rows: number = 0;
  private cellW: number = 0;
  private cellH: number = 0;
  /** Per-cell brightness 0..1 (row-major) */
  private brightness: Float32Array = new Float32Array(0);
  /** Per-cell "on" state (1 = on, 0 = off) */
  private bits: Uint8Array = new Uint8Array(0);
  /** Per-cell repair flash timer (>0 means flashing) */
  private repairTimers: Float32Array = new Float32Array(0);

  private meshes: THREE.Mesh[] = [];
  private materials: THREE.MeshBasicMaterial[] = [];

  private rowTimer: number = 0;
  private rowInterval: number = 0;
  private decaySpeed: number = 0;
  private repairChance: number = 0;

  build(): void {
    const { x, y, w, h } = this.px;

    const cellSize = this.rng.pick([4, 5, 6, 8]);
    this.cellW = cellSize;
    this.cellH = cellSize;
    this.cols = Math.max(4, Math.floor(w / this.cellW));
    this.rows = Math.max(4, Math.floor(h / this.cellH));
    this.rowInterval = this.rng.float(0.3, 0.8);
    this.decaySpeed = this.rng.float(0.15, 0.4);
    this.repairChance = this.rng.float(0.002, 0.01);

    const count = this.cols * this.rows;
    this.brightness = new Float32Array(count);
    this.bits = new Uint8Array(count);
    this.repairTimers = new Float32Array(count);

    // Initialize with random bits
    for (let i = 0; i < count; i++) {
      this.bits[i] = this.rng.chance(0.5) ? 1 : 0;
      this.brightness[i] = this.bits[i] === 1 ? 1.0 : 0.1;
    }

    // Create one mesh per cell using a shared geometry
    const geo = new THREE.PlaneGeometry(this.cellW * 0.8, this.cellH * 0.8);

    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        const mat = new THREE.MeshBasicMaterial({
          color: this.palette.primary,
          transparent: true,
          opacity: 0,
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(
          x + col * this.cellW + this.cellW / 2,
          y + row * this.cellH + this.cellH / 2,
          0,
        );
        this.group.add(mesh);
        this.meshes.push(mesh);
        this.materials.push(mat);
      }
    }

    this.rowTimer = 0;
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);
    const count = this.cols * this.rows;

    // Decay: each cell fades based on its row position (top rows slower, bottom faster)
    for (let row = 0; row < this.rows; row++) {
      const rowDecayFactor = 0.3 + (row / this.rows) * 0.7;
      for (let col = 0; col < this.cols; col++) {
        const i = row * this.cols + col;
        if (this.bits[i] === 1 && this.brightness[i] > 0.1) {
          this.brightness[i] -= dt * this.decaySpeed * rowDecayFactor;
          if (this.brightness[i] < 0.1) this.brightness[i] = 0.1;
        }
      }
    }

    // Random repair flashes on decayed bits
    for (let i = 0; i < count; i++) {
      if (this.repairTimers[i] > 0) {
        this.repairTimers[i] -= dt;
        if (this.repairTimers[i] <= 0) {
          this.repairTimers[i] = 0;
        }
      } else if (this.bits[i] === 1 && this.brightness[i] < 0.4 && Math.random() < this.repairChance) {
        this.repairTimers[i] = this.rng.float(0.08, 0.2);
      }
    }

    // Periodically push new row at top, shift everything down
    this.rowTimer += dt;
    if (this.rowTimer >= this.rowInterval) {
      this.rowTimer -= this.rowInterval;

      // Shift rows down
      for (let row = this.rows - 1; row > 0; row--) {
        for (let col = 0; col < this.cols; col++) {
          const dst = row * this.cols + col;
          const src = (row - 1) * this.cols + col;
          this.bits[dst] = this.bits[src];
          this.brightness[dst] = this.brightness[src];
          this.repairTimers[dst] = this.repairTimers[src];
        }
      }
      // New random top row
      for (let col = 0; col < this.cols; col++) {
        this.bits[col] = Math.random() < 0.5 ? 1 : 0;
        this.brightness[col] = this.bits[col] === 1 ? 1.0 : 0.1;
        this.repairTimers[col] = 0;
      }
    }

    // Update materials
    const pr = this.palette.primary;
    const dr = this.palette.dim;
    const sr = this.palette.secondary;

    for (let i = 0; i < count; i++) {
      let b = this.brightness[i];
      let color = pr;

      if (this.repairTimers[i] > 0) {
        b = 1.0;
        color = sr;
      }

      this.materials[i].color.set(
        color.r * b + dr.r * (1 - b),
        color.g * b + dr.g * (1 - b),
        color.b * b + dr.b * (1 - b),
      );
      this.materials[i].opacity = opacity * (0.15 + b * 0.85);
    }
  }
}
