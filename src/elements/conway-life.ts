import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Conway's Game of Life with color-coded cell age.
 * Classic cellular automaton rendered as a living grid where
 * older cells glow brighter and dying cells flash — digital petri dish.
 */
export class ConwayLifeElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'conway-life',
    meta: { shape: 'rectangular', roles: ['data-display', 'decorative'], moods: ['diagnostic', 'ambient'], bandAffinity: 'mid', sizes: ['needs-medium', 'needs-large'] },
  };

  private cols = 0;
  private rows = 0;
  private grid!: Uint8Array;
  private nextGrid!: Uint8Array;
  private age!: Float32Array;

  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private texture!: THREE.CanvasTexture;
  private mesh!: THREE.Mesh;

  private stepAccum = 0;
  private stepInterval = 0.1;
  private generation = 0;
  private staleCount = 0;
  private lastPop = 0;

  build(): void {
    const variant = this.rng.int(0, 3);
    const presets = [
      { cellTarget: 60, interval: 0.1, density: 0.3 },
      { cellTarget: 100, interval: 0.06, density: 0.35 },
      { cellTarget: 35, interval: 0.15, density: 0.25 },
      { cellTarget: 80, interval: 0.04, density: 0.4 },
    ];
    const p = presets[variant];
    this.glitchAmount = 4;

    const { x, y, w, h } = this.px;
    const cellSize = Math.max(3, Math.min(w, h) / p.cellTarget);
    this.cols = Math.floor(w / cellSize);
    this.rows = Math.floor(h / cellSize);
    this.stepInterval = p.interval;

    const total = this.cols * this.rows;
    this.grid = new Uint8Array(total);
    this.nextGrid = new Uint8Array(total);
    this.age = new Float32Array(total);

    // Random initial state
    for (let i = 0; i < total; i++) {
      this.grid[i] = this.rng.chance(p.density) ? 1 : 0;
    }

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
    let pop = 0;
    for (let y2 = 0; y2 < this.rows; y2++) {
      for (let x2 = 0; x2 < this.cols; x2++) {
        let neighbors = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = (x2 + dx + this.cols) % this.cols;
            const ny = (y2 + dy + this.rows) % this.rows;
            neighbors += this.grid[ny * this.cols + nx];
          }
        }

        const idx = y2 * this.cols + x2;
        const alive = this.grid[idx];

        if (alive) {
          this.nextGrid[idx] = (neighbors === 2 || neighbors === 3) ? 1 : 0;
        } else {
          this.nextGrid[idx] = neighbors === 3 ? 1 : 0;
        }

        if (this.nextGrid[idx]) {
          this.age[idx] = Math.min(1, this.age[idx] + 0.05);
          pop++;
        } else {
          this.age[idx] *= 0.8; // fade
        }
      }
    }

    // Swap
    const tmp = this.grid;
    this.grid = this.nextGrid;
    this.nextGrid = tmp;

    this.generation++;

    // Detect stale patterns and reseed
    if (Math.abs(pop - this.lastPop) < 3) this.staleCount++;
    else this.staleCount = 0;
    this.lastPop = pop;

    if (this.staleCount > 30 || pop < 5) {
      this.reseed();
    }
  }

  private reseed(): void {
    const total = this.cols * this.rows;
    for (let i = 0; i < total; i++) {
      if (this.rng.chance(0.3)) this.grid[i] = 1;
    }
    this.staleCount = 0;
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);

    this.stepAccum += dt;
    if (this.stepAccum >= this.stepInterval) {
      this.stepAccum -= this.stepInterval;
      this.step();

      // Render
      const img = this.ctx.getImageData(0, 0, this.cols, this.rows);
      const data = img.data;
      const pr = this.palette.primary.r * 255;
      const pg2 = this.palette.primary.g * 255;
      const pb = this.palette.primary.b * 255;
      const sr = this.palette.secondary.r * 255;
      const sg = this.palette.secondary.g * 255;
      const sb = this.palette.secondary.b * 255;

      for (let i = 0; i < this.cols * this.rows; i++) {
        const idx = i * 4;
        const a = this.age[i];
        if (this.grid[i]) {
          // Alive: primary → secondary with age
          data[idx] = pr * (1 - a) + sr * a;
          data[idx + 1] = pg2 * (1 - a) + sg * a;
          data[idx + 2] = pb * (1 - a) + sb * a;
          data[idx + 3] = 255;
        } else if (a > 0.01) {
          // Recently dead: fading ghost
          data[idx] = pr * a * 0.3;
          data[idx + 1] = pg2 * a * 0.3;
          data[idx + 2] = pb * a * 0.3;
          data[idx + 3] = 255;
        } else {
          data[idx] = data[idx + 1] = data[idx + 2] = 0;
          data[idx + 3] = 255;
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
      // Flip random cells
      for (let i = 0; i < this.grid.length; i++) {
        if (this.rng.chance(0.2)) this.grid[i] ^= 1;
      }
    }
    if (action === 'alert') this.reseed();
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level >= 3) this.stepInterval = 0.04;
    if (level >= 5) this.reseed();
  }
}
