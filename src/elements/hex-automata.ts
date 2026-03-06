import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Hexagonal cellular automaton with custom rules producing snowflake-like
 * growth patterns from a single seed. Uses totalistic rules on a hex grid
 * (6 neighbors per cell). Multi-state cells create age-based coloring.
 * Periodically resets with new seeds when the pattern stabilizes or fills.
 */
export class HexAutomataElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'hex-automata',
    meta: {
      shape: 'rectangular',
      roles: ['data-display', 'decorative'],
      moods: ['diagnostic', 'ambient'],
      bandAffinity: 'mid',
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

  private gridCols = 0;
  private gridRows = 0;
  private grid!: Uint8Array;     // 0 = dead, 1+ = age
  private gridNext!: Uint8Array;
  private maxAge = 0;
  private birthRule!: Set<number>;
  private surviveRule!: Set<number>;
  private stepAccum = 0;
  private stepInterval = 0;
  private hexSize = 0;
  private stableCounter = 0;
  private prevAliveCount = 0;
  private generation = 0;
  private maxGenerations = 0;
  private intensityLevel = 0;
  private seedMode: 'single' | 'multi' | 'random' = 'single';
  private renderAccum = 0;
  private canvasScale = 1;

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;

    const variant = this.rng.int(0, 3);
    const presets = [
      // Snowflake: birth on exactly 2 neighbors, survive on 3,5
      { hexSz: 5, maxAge: 8, birth: [2], survive: [3, 5], interval: 0.08, maxGen: 200, seed: 'multi' as const },
      // Organic growth: birth 1,2, survive 1,2,3,4
      { hexSz: 4, maxAge: 12, birth: [1, 2], survive: [1, 2, 3, 4], interval: 0.06, maxGen: 250, seed: 'random' as const },
      // Crystal: birth 2, survive 3,4,5
      { hexSz: 5, maxAge: 6, birth: [2], survive: [3, 4, 5], interval: 0.1, maxGen: 180, seed: 'multi' as const },
      // Chaotic: birth 2,3, survive 2,3,4
      { hexSz: 3, maxAge: 16, birth: [2, 3], survive: [2, 3, 4], interval: 0.04, maxGen: 300, seed: 'random' as const },
    ];
    const p = presets[variant];
    this.hexSize = p.hexSz;
    this.maxAge = p.maxAge;
    this.birthRule = new Set(p.birth);
    this.surviveRule = new Set(p.survive);
    this.stepInterval = p.interval;
    this.maxGenerations = p.maxGen;
    this.seedMode = p.seed;

    const hexW = this.hexSize * 1.732;
    const hexH = this.hexSize * 1.5;
    this.gridCols = Math.max(6, Math.floor(w / hexW));
    this.gridRows = Math.max(6, Math.floor(h / hexH));
    const total = this.gridCols * this.gridRows;
    this.grid = new Uint8Array(total);
    this.gridNext = new Uint8Array(total);

    this.seedGrid();

    this.canvas = document.createElement('canvas');
    const maxRes = 200;
    this.canvasScale = Math.min(1, maxRes / Math.max(w, h));
    const canvasScale = this.canvasScale;
    this.canvas.width = Math.ceil(w * canvasScale);
    this.canvas.height = Math.ceil(h * canvasScale);
    this.ctx = this.get2DContext(this.canvas);

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.magFilter = THREE.NearestFilter;
    const geo = new THREE.PlaneGeometry(w, h);
    this.meshMat = new THREE.MeshBasicMaterial({
      map: this.texture, transparent: true, opacity: 0, depthWrite: false,
    });
    this.mesh = new THREE.Mesh(geo, this.meshMat);
    this.mesh.position.set(x + w / 2, y + h / 2, 0);
    this.group.add(this.mesh);

    // Border
    const bv = new Float32Array([
      x, y, 0, x + w, y, 0, x + w, y, 0, x + w, y + h, 0,
      x + w, y + h, 0, x, y + h, 0, x, y + h, 0, x, y, 0,
    ]);
    const bGeo = new THREE.BufferGeometry();
    bGeo.setAttribute('position', new THREE.BufferAttribute(bv, 3));
    this.borderMat = new THREE.LineBasicMaterial({
      color: this.palette.dim, transparent: true, opacity: 0,
    });
    this.borderLines = new THREE.LineSegments(bGeo, this.borderMat);
    this.group.add(this.borderLines);
  }

  private seedGrid(): void {
    this.grid.fill(0);
    this.generation = 0;
    this.stableCounter = 0;
    this.prevAliveCount = 0;

    const cx = Math.floor(this.gridCols / 2);
    const cy = Math.floor(this.gridRows / 2);

    switch (this.seedMode) {
      case 'single':
        // Center seed with larger hex-ring pattern
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            const gx = cx + dx, gy = cy + dy;
            if (gx >= 0 && gx < this.gridCols && gy >= 0 && gy < this.gridRows) {
              if (Math.abs(dx) + Math.abs(dy) <= 3) {
                this.grid[gy * this.gridCols + gx] = 1;
              }
            }
          }
        }
        break;
      case 'multi':
        // Multiple seed clusters
        for (let i = 0; i < 12; i++) {
          const sx = this.rng.int(2, this.gridCols - 3);
          const sy = this.rng.int(2, this.gridRows - 3);
          this.grid[sy * this.gridCols + sx] = 1;
          // Add neighbors for each seed
          if (sx > 0) this.grid[sy * this.gridCols + sx - 1] = 1;
          if (sx < this.gridCols - 1) this.grid[sy * this.gridCols + sx + 1] = 1;
          if (sy > 0) this.grid[(sy - 1) * this.gridCols + sx] = 1;
        }
        break;
      case 'random':
        // Random scattered region, wider area
        {
          const spread = Math.max(5, Math.floor(Math.min(this.gridCols, this.gridRows) * 0.35));
          for (let dy = -spread; dy <= spread; dy++) {
            for (let dx = -spread; dx <= spread; dx++) {
              const gx = cx + dx, gy = cy + dy;
              if (gx >= 0 && gx < this.gridCols && gy >= 0 && gy < this.gridRows) {
                if (this.rng.chance(0.3)) {
                  this.grid[gy * this.gridCols + gx] = 1;
                }
              }
            }
          }
        }
        break;
    }
  }

  private hexNeighborCount(gx: number, gy: number): number {
    let count = 0;
    const even = gy % 2 === 0;
    const offsets = even
      ? [[-1, 0], [1, 0], [0, -1], [1, -1], [0, 1], [1, 1]]
      : [[-1, 0], [1, 0], [-1, -1], [0, -1], [-1, 1], [0, 1]];
    for (const [dx, dy] of offsets) {
      const nx = gx + dx, ny = gy + dy;
      if (nx >= 0 && nx < this.gridCols && ny >= 0 && ny < this.gridRows) {
        if (this.grid[ny * this.gridCols + nx] > 0) count++;
      }
    }
    return count;
  }

  private step(): void {
    for (let gy = 0; gy < this.gridRows; gy++) {
      for (let gx = 0; gx < this.gridCols; gx++) {
        const idx = gy * this.gridCols + gx;
        const alive = this.grid[idx] > 0;
        const neighbors = this.hexNeighborCount(gx, gy);
        if (alive) {
          if (this.surviveRule.has(neighbors)) {
            this.gridNext[idx] = Math.min(this.maxAge, this.grid[idx] + 1);
          } else {
            this.gridNext[idx] = 0;
          }
        } else {
          this.gridNext[idx] = this.birthRule.has(neighbors) ? 1 : 0;
        }
      }
    }
    const tmp = this.grid;
    this.grid = this.gridNext;
    this.gridNext = tmp;
    this.generation++;
  }

  private renderHexGrid(): void {
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    const s = this.hexSize * this.canvasScale;
    const pr = this.palette.primary;
    const sr = this.palette.secondary;
    const dm = this.palette.dim;

    // Use ImageData for fast pixel-level rendering instead of per-cell canvas paths
    const imgData = this.ctx.createImageData(cw, ch);
    const data = imgData.data;

    // Background: black
    // (Uint8ClampedArray defaults to 0 which is already black with alpha 0)
    // Set alpha to 255 for all pixels as base
    for (let i = 3; i < data.length; i += 4) data[i] = 255;

    // Pre-compute cell colors
    const dmR = Math.floor(dm.r * 255 * 0.18);
    const dmG = Math.floor(dm.g * 255 * 0.18);
    const dmB = Math.floor(dm.b * 255 * 0.18);

    for (let gy = 0; gy < this.gridRows; gy++) {
      for (let gx = 0; gx < this.gridCols; gx++) {
        const val = this.grid[gy * this.gridCols + gx];
        const xOff = (gy % 2) * s * 0.866;
        const cx = gx * s * 1.732 + xOff + s;
        const cy = gy * s * 1.5 + s;

        let cr: number, cg: number, cb: number;
        if (val > 0) {
          const ageT = Math.min(1, val / this.maxAge);
          if (ageT < 0.5) {
            const t = ageT * 2;
            cr = Math.floor((pr.r + (sr.r - pr.r) * t) * 255);
            cg = Math.floor((pr.g + (sr.g - pr.g) * t) * 255);
            cb = Math.floor((pr.b + (sr.b - pr.b) * t) * 255);
          } else {
            const t = (ageT - 0.5) * 2;
            cr = Math.floor((sr.r + (dm.r - sr.r) * t) * 255);
            cg = Math.floor((sr.g + (dm.g - sr.g) * t) * 255);
            cb = Math.floor((sr.b + (dm.b - sr.b) * t) * 255);
          }
        } else {
          cr = dmR; cg = dmG; cb = dmB;
        }

        // Fill hex area as a rect approximation (fast, looks fine at low res)
        const hr = s * 0.88;
        const x0 = Math.max(0, Math.floor(cx - hr));
        const x1 = Math.min(cw - 1, Math.floor(cx + hr));
        const y0 = Math.max(0, Math.floor(cy - hr * 0.866));
        const y1 = Math.min(ch - 1, Math.floor(cy + hr * 0.866));
        for (let py = y0; py <= y1; py++) {
          // Narrow the row width to approximate hex shape
          const dy = Math.abs(py - cy) / (hr * 0.866);
          const rowHalf = hr * (1 - dy * 0.5); // taper toward top/bottom
          const rx0 = Math.max(x0, Math.floor(cx - rowHalf));
          const rx1 = Math.min(x1, Math.floor(cx + rowHalf));
          for (let px = rx0; px <= rx1; px++) {
            const idx = (py * cw + px) * 4;
            data[idx] = cr;
            data[idx + 1] = cg;
            data[idx + 2] = cb;
          }
        }
      }
    }

    this.ctx.putImageData(imgData, 0, 0);
    this.texture.needsUpdate = true;
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);
    this.stepAccum += dt;

    if (this.stepAccum >= this.stepInterval) {
      this.stepAccum = 0;
      this.step();

      // Check stability or max generations
      let alive = 0;
      for (let i = 0; i < this.grid.length; i++) {
        if (this.grid[i] > 0) alive++;
      }

      if (alive === this.prevAliveCount) {
        this.stableCounter++;
      } else {
        this.stableCounter = 0;
      }
      this.prevAliveCount = alive;

      // Reset if stable for too long, dead, or max generations reached
      if (this.stableCounter > 20 || alive === 0 || this.generation >= this.maxGenerations) {
        this.seedGrid();
      }
    }

    this.meshMat.opacity = opacity;
    this.borderMat.opacity = opacity * 0.2;
    this.renderAccum += dt;
    if (this.renderAccum < 0.066) return;
    this.renderAccum = 0;
    this.renderHexGrid();
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Random injection of live cells
      for (let i = 0; i < this.grid.length; i++) {
        if (this.rng.chance(0.08)) this.grid[i] = 1;
      }
    }
    if (action === 'pulse') {
      // Reset with new seed
      this.seedGrid();
    }
    if (action === 'alert') {
      // Invert all cells
      for (let i = 0; i < this.grid.length; i++) {
        this.grid[i] = this.grid[i] > 0 ? 0 : 1;
      }
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    this.intensityLevel = level;
    if (level === 0) return;
    this.stepInterval = Math.max(0.02, 0.12 - level * 0.02);
    if (level >= 4) {
      // Inject random cells
      for (let i = 0; i < 10; i++) {
        const idx = this.rng.int(0, this.grid.length - 1);
        this.grid[idx] = 1;
      }
    }
  }
}
