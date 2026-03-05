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

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;

    const variant = this.rng.int(0, 3);
    const presets = [
      // Snowflake: birth on exactly 2 neighbors, survive on 3,5
      { hexSz: 6, maxAge: 8, birth: [2], survive: [3, 5], interval: 0.12, maxGen: 150, seed: 'single' as const },
      // Organic growth: birth 1,2, survive 1,2,3,4
      { hexSz: 5, maxAge: 12, birth: [1, 2], survive: [1, 2, 3, 4], interval: 0.08, maxGen: 200, seed: 'multi' as const },
      // Crystal: birth 2, survive 3,4,5
      { hexSz: 7, maxAge: 6, birth: [2], survive: [3, 4, 5], interval: 0.15, maxGen: 120, seed: 'single' as const },
      // Chaotic: birth 2,3, survive 2,3,4
      { hexSz: 4, maxAge: 16, birth: [2, 3], survive: [2, 3, 4], interval: 0.06, maxGen: 250, seed: 'random' as const },
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
    this.canvas.width = Math.ceil(w);
    this.canvas.height = Math.ceil(h);
    this.ctx = this.get2DContext(this.canvas);

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
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
        // Single center seed with small cross pattern
        this.grid[cy * this.gridCols + cx] = 1;
        if (cx > 0) this.grid[cy * this.gridCols + cx - 1] = 1;
        if (cx < this.gridCols - 1) this.grid[cy * this.gridCols + cx + 1] = 1;
        if (cy > 0) this.grid[(cy - 1) * this.gridCols + cx] = 1;
        if (cy < this.gridRows - 1) this.grid[(cy + 1) * this.gridCols + cx] = 1;
        break;
      case 'multi':
        // Multiple seed points
        for (let i = 0; i < 5; i++) {
          const sx = this.rng.int(3, this.gridCols - 4);
          const sy = this.rng.int(3, this.gridRows - 4);
          this.grid[sy * this.gridCols + sx] = 1;
        }
        break;
      case 'random':
        // Random center region
        for (let dy = -4; dy <= 4; dy++) {
          for (let dx = -4; dx <= 4; dx++) {
            const gx = cx + dx, gy = cy + dy;
            if (gx >= 0 && gx < this.gridCols && gy >= 0 && gy < this.gridRows) {
              if (this.rng.chance(0.35)) {
                this.grid[gy * this.gridCols + gx] = 1;
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
    const s = this.hexSize;
    const pr = this.palette.primary;
    const sr = this.palette.secondary;
    const dm = this.palette.dim;

    this.ctx.fillStyle = 'black';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    for (let gy = 0; gy < this.gridRows; gy++) {
      for (let gx = 0; gx < this.gridCols; gx++) {
        const val = this.grid[gy * this.gridCols + gx];
        const xOff = (gy % 2) * s * 0.866;
        const px = gx * s * 1.732 + xOff + s;
        const py = gy * s * 1.5 + s;

        if (val > 0) {
          // Age-based coloring: young = primary, old = secondary, very old = dim
          const ageT = Math.min(1, val / this.maxAge);
          let r: number, g: number, b: number;
          if (ageT < 0.5) {
            const t = ageT * 2;
            r = pr.r + (sr.r - pr.r) * t;
            g = pr.g + (sr.g - pr.g) * t;
            b = pr.b + (sr.b - pr.b) * t;
          } else {
            const t = (ageT - 0.5) * 2;
            r = sr.r + (dm.r - sr.r) * t;
            g = sr.g + (dm.g - sr.g) * t;
            b = sr.b + (dm.b - sr.b) * t;
          }
          this.ctx.fillStyle = `rgb(${Math.floor(r * 255)},${Math.floor(g * 255)},${Math.floor(b * 255)})`;
        } else {
          this.ctx.fillStyle = `rgba(${Math.floor(dm.r * 255)},${Math.floor(dm.g * 255)},${Math.floor(dm.b * 255)},0.08)`;
        }

        this.ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const angle = (Math.PI / 3) * i - Math.PI / 6;
          const hx = px + s * 0.88 * Math.cos(angle);
          const hy = py + s * 0.88 * Math.sin(angle);
          if (i === 0) this.ctx.moveTo(hx, hy);
          else this.ctx.lineTo(hx, hy);
        }
        this.ctx.closePath();
        this.ctx.fill();
      }
    }
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

    this.renderHexGrid();
    this.meshMat.opacity = opacity;
    this.borderMat.opacity = opacity * 0.2;
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
