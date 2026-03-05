import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Snowflake growth on a hex grid via diffusion-limited aggregation.
 * Starts from center seed, particles attach to growing crystal.
 * Canvas rendered with 6-fold symmetry enforced.
 */
export class SnowflakeHexElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'snowflake-hex',
    meta: {
      shape: 'radial',
      roles: ['decorative'],
      moods: ['ambient'],
      bandAffinity: 'high',
      sizes: ['needs-medium', 'needs-large'],
    } satisfies ElementMeta,
  };

  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private texture!: THREE.CanvasTexture;
  private mesh!: THREE.Mesh;

  // Hex grid for DLA
  private gridRadius: number = 0;
  private grid!: Uint8Array; // 1 = crystal, 0 = empty
  private gridWidth: number = 0;
  private cellSize: number = 0;

  // Growth state
  private frontier: number[] = [];
  private growthTimer: number = 0;
  private growthInterval: number = 0;
  private stepsPerTick: number = 0;
  private maxCells: number = 0;
  private cellCount: number = 0;
  private resetTimer: number = 0;
  private phase: 'growing' | 'display' | 'fading' = 'growing';
  private fadeTimer: number = 0;

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;
    const variant = this.rng.int(0, 3);

    const presets = [
      { gridR: 30, cellSz: 3, interval: 0.03, steps: 2, maxRatio: 0.35 },
      { gridR: 45, cellSz: 2, interval: 0.02, steps: 3, maxRatio: 0.25 },
      { gridR: 20, cellSz: 5, interval: 0.05, steps: 1, maxRatio: 0.4 },
      { gridR: 35, cellSz: 3, interval: 0.015, steps: 4, maxRatio: 0.3 },
    ];
    const p = presets[variant];

    const dim = Math.min(w, h);
    this.gridRadius = p.gridR;
    this.cellSize = Math.max(1, Math.floor(dim / (p.gridR * 2.2)));
    this.growthInterval = p.interval;
    this.stepsPerTick = p.steps;

    // Axial hex grid stored in a square array
    this.gridWidth = this.gridRadius * 2 + 1;
    const gridSize = this.gridWidth * this.gridWidth;
    this.grid = new Uint8Array(gridSize);
    this.maxCells = Math.floor(gridSize * p.maxRatio);

    this.initCrystal();

    // Canvas
    const cw = Math.max(64, Math.min(512, Math.round(w)));
    const ch = Math.max(64, Math.min(512, Math.round(h)));
    this.canvas = document.createElement('canvas');
    this.canvas.width = cw;
    this.canvas.height = ch;
    this.ctx = this.get2DContext(this.canvas);

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
  }

  private gridIdx(q: number, r: number): number {
    return (r + this.gridRadius) * this.gridWidth + (q + this.gridRadius);
  }

  private inBounds(q: number, r: number): boolean {
    return Math.abs(q) <= this.gridRadius && Math.abs(r) <= this.gridRadius &&
           Math.abs(q + r) <= this.gridRadius;
  }

  private hexNeighbors(q: number, r: number): [number, number][] {
    return [[q+1,r],[q-1,r],[q,r+1],[q,r-1],[q+1,r-1],[q-1,r+1]];
  }

  private initCrystal(): void {
    this.grid.fill(0);
    this.frontier = [];
    this.cellCount = 0;
    this.phase = 'growing';
    this.fadeTimer = 0;

    // Seed center
    const idx = this.gridIdx(0, 0);
    this.grid[idx] = 1;
    this.cellCount = 1;

    // Add neighbors to frontier
    for (const [nq, nr] of this.hexNeighbors(0, 0)) {
      if (this.inBounds(nq, nr)) {
        this.frontier.push(this.gridIdx(nq, nr));
      }
    }
  }

  private growStep(): void {
    if (this.frontier.length === 0 || this.cellCount >= this.maxCells) {
      this.phase = 'display';
      this.resetTimer = 3;
      return;
    }

    // Pick a random frontier cell
    const fi = this.rng.int(0, this.frontier.length - 1);
    const idx = this.frontier[fi];
    this.frontier[fi] = this.frontier[this.frontier.length - 1];
    this.frontier.pop();

    if (this.grid[idx] === 1) return;

    // Recover q,r from idx
    const r = Math.floor(idx / this.gridWidth) - this.gridRadius;
    const q = (idx % this.gridWidth) - this.gridRadius;

    // DLA probability: more neighbors = higher chance
    let neighborCount = 0;
    for (const [nq, nr] of this.hexNeighbors(q, r)) {
      if (this.inBounds(nq, nr) && this.grid[this.gridIdx(nq, nr)] === 1) {
        neighborCount++;
      }
    }
    if (neighborCount === 0) return;

    const prob = 0.3 + neighborCount * 0.15;
    if (this.rng.float(0, 1) > prob) {
      this.frontier.push(idx); // put it back
      return;
    }

    // Place in all 6 symmetric positions
    const symmetricCoords: [number, number][] = [
      [q, r], [-r, -q], [r-q, -q], [-q, -r], [r, q], [q-r, q],
    ];

    for (const [sq, sr] of symmetricCoords) {
      if (!this.inBounds(sq, sr)) continue;
      const si = this.gridIdx(sq, sr);
      if (this.grid[si] === 1) continue;

      this.grid[si] = 1;
      this.cellCount++;

      // Add new frontier cells
      for (const [nq, nr] of this.hexNeighbors(sq, sr)) {
        if (this.inBounds(nq, nr) && this.grid[this.gridIdx(nq, nr)] === 0) {
          this.frontier.push(this.gridIdx(nq, nr));
        }
      }
    }
  }

  private renderCanvas(): void {
    const ctx = this.ctx;
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    ctx.clearRect(0, 0, cw, ch);

    const cx = cw / 2;
    const cy = ch / 2;
    const sz = Math.min(cw, ch) / (this.gridRadius * 2.4);

    const pr = this.palette.primary;
    const sc = this.palette.secondary;
    const dm = this.palette.dim;

    for (let r = -this.gridRadius; r <= this.gridRadius; r++) {
      for (let q = -this.gridRadius; q <= this.gridRadius; q++) {
        if (!this.inBounds(q, r)) continue;
        if (this.grid[this.gridIdx(q, r)] !== 1) continue;

        // Hex to pixel (flat-top)
        const px = cx + sz * (q + r * 0.5) * 1.73;
        const py = cy + sz * r * 1.5;

        const dist = Math.sqrt(q * q + r * r + q * r);
        const t = Math.min(dist / this.gridRadius, 1);

        const cr = Math.round((pr.r * (1 - t) + sc.r * t) * 255);
        const cg = Math.round((pr.g * (1 - t) + sc.g * t) * 255);
        const cb = Math.round((pr.b * (1 - t) + sc.b * t) * 255);

        ctx.fillStyle = `rgb(${cr},${cg},${cb})`;
        ctx.fillRect(px - sz * 0.5, py - sz * 0.5, sz, sz);
      }
    }
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);

    if (this.phase === 'growing') {
      this.growthTimer += dt;
      while (this.growthTimer >= this.growthInterval) {
        this.growthTimer -= this.growthInterval;
        for (let i = 0; i < this.stepsPerTick; i++) {
          this.growStep();
        }
      }
    } else if (this.phase === 'display') {
      this.resetTimer -= dt;
      if (this.resetTimer <= 0) {
        this.phase = 'fading';
        this.fadeTimer = 1.5;
      }
    } else if (this.phase === 'fading') {
      this.fadeTimer -= dt;
      if (this.fadeTimer <= 0) {
        this.initCrystal();
      }
    }

    this.renderCanvas();
    this.texture.needsUpdate = true;

    const fadeAlpha = this.phase === 'fading' ? Math.max(this.fadeTimer / 1.5, 0) : 1;
    (this.mesh.material as THREE.MeshBasicMaterial).opacity = opacity * fadeAlpha;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Shatter: remove random cells
      const removeCount = Math.floor(this.cellCount * 0.3);
      for (let i = 0; i < removeCount; i++) {
        const q = this.rng.int(-this.gridRadius, this.gridRadius);
        const r = this.rng.int(-this.gridRadius, this.gridRadius);
        if (this.inBounds(q, r)) {
          const idx = this.gridIdx(q, r);
          if (this.grid[idx] === 1) {
            this.grid[idx] = 0;
            this.cellCount--;
            this.frontier.push(idx);
          }
        }
      }
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) {
      this.stepsPerTick = 2;
      return;
    }
    this.stepsPerTick = 2 + level * 2;
    if (level >= 5) {
      this.initCrystal();
    }
  }
}
