import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Langton's Ant — Turing machine on a 2D grid.
 * Simple rules (turn right on white, left on black, flip color) produce
 * complex emergent highway patterns after initial chaos.
 */
export class LangtonAntElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'langton-ant',
    meta: { shape: 'rectangular', roles: ['data-display', 'decorative'], moods: ['diagnostic', 'ambient'], bandAffinity: 'high', sizes: ['needs-medium', 'needs-large'] },
  };

  private cols = 0;
  private rows = 0;
  private grid!: Uint8Array;
  private antX: number[] = [];
  private antY: number[] = [];
  private antDir: number[] = []; // 0=N 1=E 2=S 3=W
  private antCount = 1;
  private stepsPerFrame = 50;

  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private texture!: THREE.CanvasTexture;
  private mesh!: THREE.Mesh;
  private renderAccum = 0;
  private totalSteps = 0;

  build(): void {
    const variant = this.rng.int(0, 3);
    const presets = [
      { cellTarget: 100, ants: 1, steps: 50, colors: 2 },
      { cellTarget: 150, ants: 3, steps: 120, colors: 2 },
      { cellTarget: 60, ants: 1, steps: 20, colors: 2 },
      { cellTarget: 120, ants: 4, steps: 200, colors: 2 },
    ];
    const p = presets[variant];
    this.glitchAmount = 4;

    const { x, y, w, h } = this.px;
    const cellSize = Math.max(2, Math.min(w, h) / p.cellTarget);
    this.cols = Math.floor(w / cellSize);
    this.rows = Math.floor(h / cellSize);
    this.stepsPerFrame = p.steps;
    this.antCount = p.ants;

    this.grid = new Uint8Array(this.cols * this.rows);

    for (let i = 0; i < this.antCount; i++) {
      this.antX.push(Math.floor(this.cols / 2) + this.rng.int(-5, 5));
      this.antY.push(Math.floor(this.rows / 2) + this.rng.int(-5, 5));
      this.antDir.push(this.rng.int(0, 3));
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
    const dx = [0, 1, 0, -1];
    const dy = [-1, 0, 1, 0];

    for (let a = 0; a < this.antCount; a++) {
      const idx = this.antY[a] * this.cols + this.antX[a];
      if (idx < 0 || idx >= this.grid.length) continue;

      // Turn based on cell color
      if (this.grid[idx] === 0) {
        this.antDir[a] = (this.antDir[a] + 1) % 4; // right
      } else {
        this.antDir[a] = (this.antDir[a] + 3) % 4; // left
      }

      // Flip cell
      this.grid[idx] ^= 1;

      // Move
      this.antX[a] += dx[this.antDir[a]];
      this.antY[a] += dy[this.antDir[a]];

      // Wrap
      if (this.antX[a] < 0) this.antX[a] += this.cols;
      if (this.antX[a] >= this.cols) this.antX[a] -= this.cols;
      if (this.antY[a] < 0) this.antY[a] += this.rows;
      if (this.antY[a] >= this.rows) this.antY[a] -= this.rows;
    }
    this.totalSteps++;
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);

    for (let i = 0; i < this.stepsPerFrame; i++) this.step();

    this.renderAccum += dt;
    if (this.renderAccum >= 0.06) {
      this.renderAccum = 0;
      const img = this.ctx.getImageData(0, 0, this.cols, this.rows);
      const data = img.data;
      const pr = Math.floor(this.palette.primary.r * 255);
      const pg2 = Math.floor(this.palette.primary.g * 255);
      const pb = Math.floor(this.palette.primary.b * 255);

      for (let i = 0; i < this.grid.length; i++) {
        const idx = i * 4;
        if (this.grid[i]) {
          data[idx] = pr; data[idx + 1] = pg2; data[idx + 2] = pb; data[idx + 3] = 255;
        } else {
          data[idx] = 0; data[idx + 1] = 0; data[idx + 2] = 0; data[idx + 3] = 255;
        }
      }

      // Mark ant positions
      const sr = Math.floor(this.palette.secondary.r * 255);
      const sg = Math.floor(this.palette.secondary.g * 255);
      const sb = Math.floor(this.palette.secondary.b * 255);
      for (let a = 0; a < this.antCount; a++) {
        const idx = (this.antY[a] * this.cols + this.antX[a]) * 4;
        if (idx >= 0 && idx < data.length) {
          data[idx] = sr; data[idx + 1] = sg; data[idx + 2] = sb;
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
      for (let i = 0; i < this.grid.length; i++) {
        if (this.rng.chance(0.1)) this.grid[i] ^= 1;
      }
    }
    if (action === 'alert') {
      this.grid.fill(0);
      this.totalSteps = 0;
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level >= 3) this.stepsPerFrame = 200;
    if (level >= 5) this.stepsPerFrame = 500;
  }
}
