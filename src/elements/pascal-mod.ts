import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Pascal's triangle colored by value mod N.
 * Low mod values (2, 3, 5, 7) create Sierpinski-like fractal patterns.
 * Canvas-rendered; triangle builds row by row then resets.
 */
export class PascalModElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'pascal-mod',
    meta: {
      shape: 'rectangular',
      roles: ['data-display', 'decorative'],
      moods: ['ambient', 'diagnostic'],
      bandAffinity: 'mid',
      sizes: ['needs-medium', 'needs-large'],
    },
  };

  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private texture!: THREE.CanvasTexture;
  private mesh!: THREE.Mesh;

  private modN: number = 2;
  private maxRows: number = 64;
  private currentRow: number = 0;
  private buildSpeed: number = 2;
  private cellSize: number = 4;
  private accumulator: number = 0;
  private rowsPerTick: number = 1;
  private prevRow: number[] = [];
  private colorMap: THREE.Color[] = [];

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;

    const variant = this.rng.int(0, 3);
    const presets = [
      { modN: 2, maxRows: 64, buildSpeed: 3, cellSize: 4 },
      { modN: 3, maxRows: 80, buildSpeed: 2, cellSize: 3 },
      { modN: 5, maxRows: 100, buildSpeed: 4, cellSize: 3 },
      { modN: 7, maxRows: 128, buildSpeed: 5, cellSize: 2 },
    ];
    const p = presets[variant];

    this.modN = p.modN;
    this.maxRows = Math.min(p.maxRows, Math.floor(h / p.cellSize));
    this.buildSpeed = p.buildSpeed;
    this.cellSize = p.cellSize;
    this.rowsPerTick = Math.max(1, Math.floor(this.buildSpeed));

    // Build color map for each mod residue
    this.colorMap = [];
    for (let i = 0; i < this.modN; i++) {
      const t = i / (this.modN - 1 || 1);
      const c = new THREE.Color().copy(this.palette.bg).lerp(this.palette.primary, t);
      if (i === 0) c.copy(this.palette.bg);
      this.colorMap.push(c);
    }

    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.max(1, Math.floor(w));
    this.canvas.height = Math.max(1, Math.floor(h));
    this.ctx = this.get2DContext(this.canvas);
    this.ctx.fillStyle = `rgb(${Math.floor(this.palette.bg.r * 255)},${Math.floor(this.palette.bg.g * 255)},${Math.floor(this.palette.bg.b * 255)})`;
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.magFilter = THREE.NearestFilter;

    const geo = new THREE.PlaneGeometry(w, h);
    const mat = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      opacity: 0,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.set(x + w / 2, y + h / 2, 0);
    this.group.add(this.mesh);

    this.currentRow = 0;
    this.prevRow = [1];
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);
    (this.mesh.material as THREE.MeshBasicMaterial).opacity = opacity;

    this.accumulator += dt * this.buildSpeed;
    const rowsToDraw = Math.floor(this.accumulator);
    this.accumulator -= rowsToDraw;

    for (let r = 0; r < Math.max(1, rowsToDraw); r++) {
      if (this.currentRow >= this.maxRows) {
        // Reset
        this.currentRow = 0;
        this.prevRow = [1];
        this.ctx.fillStyle = `rgb(${Math.floor(this.palette.bg.r * 255)},${Math.floor(this.palette.bg.g * 255)},${Math.floor(this.palette.bg.b * 255)})`;
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      }

      this.drawRow(this.currentRow);
      this.currentRow++;
    }

    this.texture.needsUpdate = true;
  }

  private drawRow(row: number): void {
    const cw = this.canvas.width;
    const cs = this.cellSize;
    const rowLen = row + 1;

    // Compute new row from prevRow using Pascal recurrence mod N
    const newRow: number[] = [];
    for (let j = 0; j < rowLen; j++) {
      const left = j > 0 ? this.prevRow[j - 1] : 0;
      const right = j < this.prevRow.length ? this.prevRow[j] : 0;
      newRow.push((left + right) % this.modN);
    }
    // First row is always [1]
    if (row === 0) {
      newRow[0] = 1;
    }

    // Center the triangle
    const startX = Math.floor((cw - rowLen * cs) / 2);
    const py = row * cs;

    for (let j = 0; j < rowLen; j++) {
      const val = newRow[j];
      const col = this.colorMap[val];
      this.ctx.fillStyle = `rgb(${Math.floor(col.r * 255)},${Math.floor(col.g * 255)},${Math.floor(col.b * 255)})`;
      this.ctx.fillRect(startX + j * cs, py, cs, cs);
    }

    this.prevRow = newRow;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Shift to next modulus
      this.modN = [2, 3, 5, 7][(([2, 3, 5, 7].indexOf(this.modN) + 1) % 4)];
      this.colorMap = [];
      for (let i = 0; i < this.modN; i++) {
        const t = i / (this.modN - 1 || 1);
        const c = new THREE.Color().copy(this.palette.bg).lerp(this.palette.primary, t);
        if (i === 0) c.copy(this.palette.bg);
        this.colorMap.push(c);
      }
      this.currentRow = 0;
      this.prevRow = [1];
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) return;
    if (level >= 3) {
      this.buildSpeed = 2 + level * 1.5;
    }
    if (level >= 5) {
      this.modN = [2, 3, 5, 7][this.rng.int(0, 3)];
      this.currentRow = 0;
      this.prevRow = [1];
    }
  }
}
