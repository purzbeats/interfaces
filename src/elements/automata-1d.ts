import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * 1D elementary cellular automaton (Wolfram rules) with scrolling display.
 * Each row is computed from the previous, scrolling downward endlessly.
 * Rule 30, 90, 110, 184 produce dramatically different patterns.
 */
export class Automata1DElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'automata-1d',
    meta: { shape: 'rectangular', roles: ['data-display', 'decorative'], moods: ['diagnostic', 'ambient'], bandAffinity: 'high', sizes: ['works-small', 'needs-medium', 'needs-large'] },
  };

  private cols = 0;
  private rows = 0;
  private grid!: Uint8Array;
  private currentRow!: Uint8Array;
  private rule = 110;
  private scrollHead = 0;

  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private texture!: THREE.CanvasTexture;
  private mesh!: THREE.Mesh;
  private stepAccum = 0;
  private stepInterval = 0.05;

  build(): void {
    const variant = this.rng.int(0, 3);
    const rules = [110, 30, 90, 184];
    const presets = [
      { cellTarget: 80, interval: 0.05 },
      { cellTarget: 150, interval: 0.03 },
      { cellTarget: 50, interval: 0.08 },
      { cellTarget: 120, interval: 0.02 },
    ];
    const p = presets[variant];
    this.rule = rules[variant];
    this.glitchAmount = 4;

    const { x, y, w, h } = this.px;
    const cellSize = Math.max(2, Math.min(w, h) / p.cellTarget);
    this.cols = Math.floor(w / cellSize);
    this.rows = Math.floor(h / cellSize);
    this.stepInterval = p.interval;

    this.grid = new Uint8Array(this.cols * this.rows);
    this.currentRow = new Uint8Array(this.cols);
    // Single seed at center
    this.currentRow[Math.floor(this.cols / 2)] = 1;

    this.canvas = document.createElement('canvas');
    this.canvas.width = this.cols;
    this.canvas.height = this.rows;
    this.ctx = this.get2DContext(this.canvas);

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.magFilter = THREE.NearestFilter;

    const geo = new THREE.PlaneGeometry(this.cols * cellSize, this.rows * cellSize);
    this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, opacity: 0 }));
    this.mesh.position.set(x + (this.cols * cellSize) / 2, y + (this.rows * cellSize) / 2, 0);
    this.group.add(this.mesh);
  }

  private step(): void {
    // Write current row to grid
    const offset = this.scrollHead * this.cols;
    for (let i = 0; i < this.cols; i++) this.grid[offset + i] = this.currentRow[i];

    // Compute next row using rule
    const nextRow = new Uint8Array(this.cols);
    for (let i = 0; i < this.cols; i++) {
      const left = this.currentRow[(i - 1 + this.cols) % this.cols];
      const center = this.currentRow[i];
      const right = this.currentRow[(i + 1) % this.cols];
      const neighborhood = (left << 2) | (center << 1) | right; // 0-7
      nextRow[i] = (this.rule >> neighborhood) & 1;
    }
    this.currentRow = nextRow;
    this.scrollHead = (this.scrollHead + 1) % this.rows;
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);

    this.stepAccum += dt;
    let stepped = false;
    while (this.stepAccum >= this.stepInterval) {
      this.stepAccum -= this.stepInterval;
      this.step();
      stepped = true;
    }

    if (stepped) {
      const img = this.ctx.getImageData(0, 0, this.cols, this.rows);
      const data = img.data;
      const pr = Math.floor(this.palette.primary.r * 255);
      const pg2 = Math.floor(this.palette.primary.g * 255);
      const pb = Math.floor(this.palette.primary.b * 255);

      for (let r = 0; r < this.rows; r++) {
        const srcRow = (this.scrollHead + r) % this.rows;
        for (let c = 0; c < this.cols; c++) {
          const si = srcRow * this.cols + c;
          const di = (r * this.cols + c) * 4;
          if (this.grid[si]) {
            data[di] = pr; data[di + 1] = pg2; data[di + 2] = pb; data[di + 3] = 255;
          } else {
            data[di] = 0; data[di + 1] = 0; data[di + 2] = 0; data[di + 3] = 255;
          }
        }
      }
      this.ctx.putImageData(img, 0, 0);
      this.texture.needsUpdate = true;
    }

    (this.mesh.material as THREE.MeshBasicMaterial).opacity = opacity * 0.9;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Randomize current row
      for (let i = 0; i < this.cols; i++) this.currentRow[i] = this.rng.chance(0.5) ? 1 : 0;
    }
    if (action === 'alert') {
      // Switch to a random rule
      const rules = [30, 45, 54, 60, 73, 90, 105, 110, 150, 184];
      this.rule = rules[this.rng.int(0, rules.length - 1)];
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level >= 3) this.stepInterval = 0.02;
    if (level >= 5) {
      const rules = [30, 90, 110, 184];
      this.rule = rules[this.rng.int(0, rules.length - 1)];
    }
  }
}
