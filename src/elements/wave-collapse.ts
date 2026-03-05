import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Wave Function Collapse visualization.
 * A grid of cells collapses from superposition to definite states,
 * animated cell-by-cell with propagation waves — procedural generation made visible.
 */
export class WaveCollapseElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'wave-collapse',
    meta: { shape: 'rectangular', roles: ['data-display', 'structural'], moods: ['diagnostic', 'ambient'], bandAffinity: 'high', sizes: ['needs-medium', 'needs-large'] },
  };

  private cols = 0;
  private rows = 0;
  private cellW = 0;
  private cellH = 0;
  private tileCount = 6;
  private possibilities!: Uint8Array; // bitmask of possible tiles per cell
  private collapsed!: Int8Array; // -1 = uncollapsed, 0..tileCount-1 = collapsed

  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private texture!: THREE.CanvasTexture;
  private mesh!: THREE.Mesh;

  private collapseQueue: number[] = [];
  private collapseRate = 5;
  private collapseAccum = 0;
  private phase: 'collapsing' | 'display' | 'reset' = 'collapsing';
  private displayTimer = 0;
  private renderDirty = true;
  private waveRipple = -1;

  build(): void {
    const variant = this.rng.int(0, 3);
    const presets = [
      { cellTarget: 20, tiles: 6, rate: 5 },
      { cellTarget: 32, tiles: 8, rate: 12 },
      { cellTarget: 12, tiles: 4, rate: 3 },
      { cellTarget: 25, tiles: 10, rate: 20 },
    ];
    const p = presets[variant];
    this.glitchAmount = 4;

    const { x, y, w, h } = this.px;
    this.tileCount = p.tiles;
    this.collapseRate = p.rate;

    const cellSize = Math.max(6, Math.min(w, h) / p.cellTarget);
    this.cellW = cellSize;
    this.cellH = cellSize;
    this.cols = Math.max(3, Math.floor(w / cellSize));
    this.rows = Math.max(3, Math.floor(h / cellSize));

    const total = this.cols * this.rows;
    const allBits = (1 << this.tileCount) - 1;
    this.possibilities = new Uint8Array(total).fill(allBits);
    this.collapsed = new Int8Array(total).fill(-1);

    this.canvas = document.createElement('canvas');
    this.canvas.width = this.cols;
    this.canvas.height = this.rows;
    this.ctx = this.get2DContext(this.canvas);

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.magFilter = THREE.NearestFilter;

    const geo = new THREE.PlaneGeometry(this.cols * this.cellW, this.rows * this.cellH);
    this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, opacity: 0 }));
    this.mesh.position.set(x + (this.cols * this.cellW) / 2, y + (this.rows * this.cellH) / 2, 0);
    this.group.add(this.mesh);

    this.phase = 'collapsing';
  }

  private countBits(n: number): number {
    let c = 0;
    while (n) { c += n & 1; n >>= 1; }
    return c;
  }

  private collapseNext(): boolean {
    const total = this.cols * this.rows;
    // Find cell with minimum entropy (fewest possibilities, not yet collapsed)
    let minEntropy = this.tileCount + 1;
    let candidates: number[] = [];

    for (let i = 0; i < total; i++) {
      if (this.collapsed[i] !== -1) continue;
      const bits = this.countBits(this.possibilities[i]);
      if (bits === 0) continue; // contradiction
      if (bits < minEntropy) {
        minEntropy = bits;
        candidates = [i];
      } else if (bits === minEntropy) {
        candidates.push(i);
      }
    }

    if (candidates.length === 0) return true; // done

    // Collapse random candidate
    const cell = candidates[this.rng.int(0, candidates.length - 1)];
    const possible = this.possibilities[cell];

    // Pick random tile from possibilities
    const options: number[] = [];
    for (let t = 0; t < this.tileCount; t++) {
      if (possible & (1 << t)) options.push(t);
    }
    if (options.length === 0) return true;

    const chosen = options[this.rng.int(0, options.length - 1)];
    this.collapsed[cell] = chosen;
    this.possibilities[cell] = 1 << chosen;

    // Propagate constraints to neighbors (simplified: neighbors can't be same tile)
    const col = cell % this.cols;
    const row = Math.floor(cell / this.cols);
    const mask = ~(1 << chosen) & ((1 << this.tileCount) - 1);
    const neighbors = [];
    if (row > 0) neighbors.push(cell - this.cols);
    if (row < this.rows - 1) neighbors.push(cell + this.cols);
    if (col > 0) neighbors.push(cell - 1);
    if (col < this.cols - 1) neighbors.push(cell + 1);

    for (const n of neighbors) {
      if (this.collapsed[n] === -1) {
        this.possibilities[n] &= mask | (this.possibilities[n] & ~(1 << chosen));
      }
    }

    this.waveRipple = cell;
    this.renderDirty = true;
    return false;
  }

  private renderCanvas(time: number): void {
    const img = this.ctx.getImageData(0, 0, this.cols, this.rows);
    const data = img.data;
    const pr = this.palette.primary.r * 255;
    const pg2 = this.palette.primary.g * 255;
    const pb = this.palette.primary.b * 255;
    const sr = this.palette.secondary.r * 255;
    const sg = this.palette.secondary.g * 255;
    const sb = this.palette.secondary.b * 255;
    const dr = this.palette.dim.r * 255;
    const dg = this.palette.dim.g * 255;
    const db = this.palette.dim.b * 255;

    for (let i = 0; i < this.cols * this.rows; i++) {
      const idx = i * 4;
      if (this.collapsed[i] >= 0) {
        // Collapsed: color based on tile type
        const t = this.collapsed[i] / this.tileCount;
        const flicker = 0.85 + 0.15 * Math.sin(time * 3 + i * 0.5);
        data[idx] = (pr * (1 - t) + sr * t) * flicker;
        data[idx + 1] = (pg2 * (1 - t) + sg * t) * flicker;
        data[idx + 2] = (pb * (1 - t) + sb * t) * flicker;
        data[idx + 3] = 255;
      } else {
        // Uncollapsed: dim with entropy indication
        const bits = this.countBits(this.possibilities[i]);
        const entropy = bits / this.tileCount;
        const shimmer = 0.1 + 0.05 * Math.sin(time * 5 + i * 1.3);
        data[idx] = dr * entropy * shimmer;
        data[idx + 1] = dg * entropy * shimmer;
        data[idx + 2] = db * entropy * shimmer;
        data[idx + 3] = 255;
      }
    }

    this.ctx.putImageData(img, 0, 0);
    this.texture.needsUpdate = true;
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);

    if (this.phase === 'collapsing') {
      this.collapseAccum += dt * this.collapseRate;
      const steps = Math.floor(this.collapseAccum);
      this.collapseAccum -= steps;
      for (let i = 0; i < steps; i++) {
        if (this.collapseNext()) {
          this.phase = 'display';
          this.displayTimer = 4;
          break;
        }
      }
    } else if (this.phase === 'display') {
      this.displayTimer -= dt;
      if (this.displayTimer <= 0) this.phase = 'reset';
    } else {
      // Reset
      const total = this.cols * this.rows;
      const allBits = (1 << this.tileCount) - 1;
      this.possibilities = new Uint8Array(total).fill(allBits);
      this.collapsed = new Int8Array(total).fill(-1);
      this.phase = 'collapsing';
    }

    this.renderCanvas(time);
    (this.mesh.material as THREE.MeshBasicMaterial).opacity = opacity * 0.85;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch' || action === 'alert') {
      // Force reset
      this.phase = 'reset';
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level >= 3) this.collapseRate = 30;
    if (level >= 5) this.collapseRate = 100;
  }
}
