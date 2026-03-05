import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Abelian sandpile model — self-organized criticality.
 * Grains pile up at center and topple in cascading avalanches,
 * producing fractal patterns in the 4-color toppling states.
 */
export class SandPileElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'sand-pile',
    meta: { shape: 'rectangular', roles: ['data-display', 'decorative'], moods: ['diagnostic', 'ambient'], bandAffinity: 'bass', sizes: ['needs-medium', 'needs-large'] },
  };

  private cols = 0;
  private rows = 0;
  private grid!: Int32Array;
  private addRate = 50;

  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private texture!: THREE.CanvasTexture;
  private mesh!: THREE.Mesh;
  private renderAccum = 0;

  build(): void {
    const variant = this.rng.int(0, 3);
    const presets = [
      { cellTarget: 100, addRate: 50 },
      { cellTarget: 160, addRate: 100 },
      { cellTarget: 60, addRate: 20 },
      { cellTarget: 130, addRate: 150 },
    ];
    const p = presets[variant];
    this.glitchAmount = 4;

    const { x, y, w, h } = this.px;
    const cellSize = Math.max(2, Math.min(w, h) / p.cellTarget);
    this.cols = Math.floor(w / cellSize);
    this.rows = Math.floor(h / cellSize);
    this.addRate = p.addRate;

    this.grid = new Int32Array(this.cols * this.rows);

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

  private topple(): boolean {
    let toppled = false;
    for (let y2 = 1; y2 < this.rows - 1; y2++) {
      for (let x2 = 1; x2 < this.cols - 1; x2++) {
        const idx = y2 * this.cols + x2;
        if (this.grid[idx] >= 4) {
          this.grid[idx] -= 4;
          this.grid[idx - 1]++;
          this.grid[idx + 1]++;
          this.grid[idx - this.cols]++;
          this.grid[idx + this.cols]++;
          toppled = true;
        }
      }
    }
    return toppled;
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);

    // Add grains at center
    const cx = Math.floor(this.cols / 2);
    const cy = Math.floor(this.rows / 2);
    for (let i = 0; i < this.addRate; i++) {
      const ox = this.rng.int(-2, 2);
      const oy = this.rng.int(-2, 2);
      const nx = cx + ox;
      const ny = cy + oy;
      if (nx >= 0 && nx < this.cols && ny >= 0 && ny < this.rows) {
        this.grid[ny * this.cols + nx]++;
      }
    }

    // Topple until stable (capped iterations — settles gradually across frames)
    for (let iter = 0; iter < 25; iter++) {
      if (!this.topple()) break;
    }

    // Render
    this.renderAccum += dt;
    if (this.renderAccum >= 0.06) {
      this.renderAccum = 0;
      const img = this.ctx.getImageData(0, 0, this.cols, this.rows);
      const data = img.data;

      // 4 colors for 0,1,2,3 grains
      const colors = [
        [0, 0, 0],
        [Math.floor(this.palette.dim.r * 255), Math.floor(this.palette.dim.g * 255), Math.floor(this.palette.dim.b * 255)],
        [Math.floor(this.palette.primary.r * 255), Math.floor(this.palette.primary.g * 255), Math.floor(this.palette.primary.b * 255)],
        [Math.floor(this.palette.secondary.r * 255), Math.floor(this.palette.secondary.g * 255), Math.floor(this.palette.secondary.b * 255)],
      ];

      for (let i = 0; i < this.grid.length; i++) {
        const v = Math.min(3, this.grid[i]);
        const c = colors[v];
        const idx = i * 4;
        data[idx] = c[0]; data[idx + 1] = c[1]; data[idx + 2] = c[2]; data[idx + 3] = 255;
      }
      this.ctx.putImageData(img, 0, 0);
      this.texture.needsUpdate = true;
    }

    (this.mesh.material as THREE.MeshBasicMaterial).opacity = opacity * 0.9;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      for (let i = 0; i < this.grid.length; i++) this.grid[i] += this.rng.int(0, 3);
    }
    if (action === 'alert') {
      // Mega pile at center
      const cx = Math.floor(this.cols / 2);
      const cy = Math.floor(this.rows / 2);
      this.grid[cy * this.cols + cx] += 10000;
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level >= 3) this.addRate = 200;
    if (level >= 5) this.addRate = 500;
  }
}
