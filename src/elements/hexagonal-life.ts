import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Conway's Game of Life on a hexagonal grid. Different neighbor counts (6
 * instead of 8) create unique emergent patterns. Canvas-based with
 * hex cell rendering.
 */
export class HexagonalLifeElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'hexagonal-life',
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
  private material!: THREE.MeshBasicMaterial;

  private gridW: number = 0;
  private gridH: number = 0;
  private cellsA!: Uint8Array;
  private cellsB!: Uint8Array;
  private hexSize: number = 5;
  private tickAccum: number = 0;
  private tickRate: number = 0.15;
  private birthRule: number[] = [2];
  private surviveRule: number[] = [3, 4];
  private generation: number = 0;
  private stagnantCount: number = 0;
  private lastPopulation: number = 0;
  private intensityLevel: number = 0;

  build(): void {
    const variant = this.rng.int(0, 3);
    const presets = [
      { hexSz: 5, tick: 0.15, birth: [2], survive: [3, 4], density: 0.3 },         // Standard hex life
      { hexSz: 4, tick: 0.1, birth: [2, 3], survive: [3, 4], density: 0.25 },      // Growth-heavy
      { hexSz: 6, tick: 0.2, birth: [2], survive: [2, 3, 4], density: 0.35 },      // Stable patterns
      { hexSz: 3, tick: 0.08, birth: [2, 4], survive: [3, 4, 5], density: 0.2 },   // Dense fast
    ];
    const p = presets[variant];

    this.hexSize = p.hexSz;
    this.tickRate = p.tick;
    this.birthRule = p.birth;
    this.surviveRule = p.survive;
    this.generation = 0;
    this.stagnantCount = 0;
    this.glitchAmount = 4;

    const { x, y, w, h } = this.px;

    // Calculate grid dimensions from hex size
    const hexW = this.hexSize * 2;
    const hexH = this.hexSize * Math.sqrt(3);
    this.gridW = Math.max(10, Math.floor(w / (hexW * 0.75)));
    this.gridH = Math.max(10, Math.floor(h / hexH));

    const total = this.gridW * this.gridH;
    this.cellsA = new Uint8Array(total);
    this.cellsB = new Uint8Array(total);

    // Random initial state
    for (let i = 0; i < total; i++) {
      this.cellsA[i] = this.rng.chance(p.density) ? 1 : 0;
    }

    // Canvas size matches the region
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.max(64, Math.min(200, Math.floor(w * 0.8)));
    this.canvas.height = Math.max(64, Math.min(200, Math.floor(h * 0.8)));
    this.ctx = this.get2DContext(this.canvas);

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;

    this.material = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      opacity: 0,
    });

    const geo = new THREE.PlaneGeometry(w, h);
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.position.set(x + w / 2, y + h / 2, 0);
    this.group.add(this.mesh);
  }

  private getHexNeighbors(col: number, row: number): number {
    let count = 0;
    const w = this.gridW;
    const h = this.gridH;
    const even = row % 2 === 0;

    // 6 hex neighbors (offset depends on even/odd row)
    const offsets = even
      ? [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1]]
      : [[-1, 0], [1, 0], [0, -1], [0, 1], [1, -1], [1, 1]];

    for (const [dc, dr] of offsets) {
      const nc = (col + dc + w) % w;
      const nr = (row + dr + h) % h;
      count += this.cellsA[nr * w + nc];
    }
    return count;
  }

  private step(): void {
    const w = this.gridW;
    const h = this.gridH;
    let population = 0;

    for (let r = 0; r < h; r++) {
      for (let c = 0; c < w; c++) {
        const idx = r * w + c;
        const alive = this.cellsA[idx];
        const neighbors = this.getHexNeighbors(c, r);

        if (alive) {
          this.cellsB[idx] = this.surviveRule.includes(neighbors) ? 1 : 0;
        } else {
          this.cellsB[idx] = this.birthRule.includes(neighbors) ? 1 : 0;
        }
        population += this.cellsB[idx];
      }
    }

    // Detect stagnation
    if (population === this.lastPopulation) {
      this.stagnantCount++;
    } else {
      this.stagnantCount = 0;
    }
    this.lastPopulation = population;

    // Reset if stagnant
    if (this.stagnantCount > 20 || population === 0) {
      const total = w * h;
      for (let i = 0; i < total; i++) {
        this.cellsB[i] = this.rng.chance(0.3) ? 1 : 0;
      }
      this.stagnantCount = 0;
    }

    // Swap
    const tmp = this.cellsA;
    this.cellsA = this.cellsB;
    this.cellsB = tmp;
    this.generation++;
  }

  private renderGrid(): void {
    const ctx = this.ctx;
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    const bg = this.palette.bg;

    ctx.fillStyle = `rgb(${Math.floor(bg.r * 255)},${Math.floor(bg.g * 255)},${Math.floor(bg.b * 255)})`;
    ctx.fillRect(0, 0, cw, ch);

    const hexW = cw / this.gridW;
    const hexH = ch / this.gridH;
    const r = Math.min(hexW, hexH) * 0.45;

    const pr = this.palette.primary;
    const dm = this.palette.dim;

    for (let row = 0; row < this.gridH; row++) {
      for (let col = 0; col < this.gridW; col++) {
        const alive = this.cellsA[row * this.gridW + col];
        const cx = col * hexW * 0.75 + hexW * 0.5;
        const cy = row * hexH + hexH * 0.5 + (col % 2 === 1 ? hexH * 0.5 : 0);

        if (alive) {
          ctx.fillStyle = `rgb(${Math.floor(pr.r * 255)},${Math.floor(pr.g * 255)},${Math.floor(pr.b * 255)})`;
          this.drawHex(ctx, cx, cy, r);
          ctx.fill();
        } else {
          ctx.strokeStyle = `rgba(${Math.floor(dm.r * 255)},${Math.floor(dm.g * 255)},${Math.floor(dm.b * 255)},0.15)`;
          ctx.lineWidth = 0.5;
          this.drawHex(ctx, cx, cy, r);
          ctx.stroke();
        }
      }
    }
  }

  private drawHex(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 3) * i - Math.PI / 6;
      const hx = cx + r * Math.cos(angle);
      const hy = cy + r * Math.sin(angle);
      if (i === 0) ctx.moveTo(hx, hy);
      else ctx.lineTo(hx, hy);
    }
    ctx.closePath();
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);
    this.material.opacity = opacity;

    this.tickAccum += dt;
    const rate = this.tickRate / (1 + this.intensityLevel * 0.3);
    if (this.tickAccum < rate) return;
    this.tickAccum = 0;

    this.step();
    this.renderGrid();
    this.texture.needsUpdate = true;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      const total = this.gridW * this.gridH;
      for (let i = 0; i < total; i++) {
        if (this.rng.chance(0.15)) {
          this.cellsA[i] = this.cellsA[i] ? 0 : 1;
        }
      }
    }
    if (action === 'pulse') {
      const total = this.gridW * this.gridH;
      for (let i = 0; i < total; i++) {
        this.cellsA[i] = this.rng.chance(0.35) ? 1 : 0;
      }
      this.stagnantCount = 0;
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    this.intensityLevel = level;
  }
}
