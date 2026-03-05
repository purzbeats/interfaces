import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Dijkstra's shortest-path wavefront on a grid graph.
 * Expands from source, coloring cells by distance.
 * When the target is reached the shortest path is highlighted.
 * Canvas rendered.
 */
export class DijkstraWaveElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'dijkstra-wave',
    meta: {
      shape: 'rectangular',
      roles: ['data-display', 'decorative'],
      moods: ['diagnostic', 'tactical'],
      bandAffinity: 'mid',
      sizes: ['needs-medium', 'needs-large'],
    } satisfies ElementMeta,
  };

  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private texture!: THREE.CanvasTexture;
  private mesh!: THREE.Mesh;

  private cols: number = 0;
  private rows: number = 0;
  private dist!: Float32Array;
  private prev!: Int32Array;
  private walls!: Uint8Array;
  private visited!: Uint8Array;
  private frontier: number[] = [];
  private pathCells: Set<number> = new Set();

  private srcCell: number = 0;
  private dstCell: number = 0;
  private maxDist: number = 0;
  private done: boolean = false;
  private stepsPerFrame: number = 4;
  private resetTimer: number = 0;
  private resetInterval: number = 8;
  private wallDensity: number = 0.2;
  private renderAccum = 0;

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;
    const variant = this.rng.int(0, 3);

    const presets = [
      { cellSize: 6,  steps: 4,  wallDensity: 0.2,  interval: 8 },
      { cellSize: 4,  steps: 8,  wallDensity: 0.15, interval: 6 },
      { cellSize: 8,  steps: 2,  wallDensity: 0.25, interval: 12 },
      { cellSize: 5,  steps: 6,  wallDensity: 0.3,  interval: 7 },
    ];
    const p = presets[variant];

    this.cols = Math.max(8, Math.floor(w / p.cellSize));
    this.rows = Math.max(8, Math.floor(h / p.cellSize));
    this.stepsPerFrame = p.steps;
    this.wallDensity = p.wallDensity;
    this.resetInterval = p.interval;

    this.initGrid();

    const cw = Math.max(64, Math.min(200, Math.round(w)));
    const ch = Math.max(64, Math.min(200, Math.round(h)));
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

  private initGrid(): void {
    const total = this.cols * this.rows;
    this.dist = new Float32Array(total);
    this.prev = new Int32Array(total);
    this.walls = new Uint8Array(total);
    this.visited = new Uint8Array(total);

    this.dist.fill(Infinity);
    this.prev.fill(-1);
    this.walls.fill(0);
    this.visited.fill(0);
    this.frontier = [];
    this.pathCells = new Set();
    this.done = false;
    this.maxDist = 0;
    this.resetTimer = 0;

    // Place walls
    for (let i = 0; i < total; i++) {
      if (this.rng.float(0, 1) < this.wallDensity) {
        this.walls[i] = 1;
      }
    }

    // Source and destination
    this.srcCell = this.pickOpen();
    this.dstCell = this.pickOpen();
    while (this.dstCell === this.srcCell) {
      this.dstCell = this.pickOpen();
    }

    this.walls[this.srcCell] = 0;
    this.walls[this.dstCell] = 0;
    this.dist[this.srcCell] = 0;
    this.visited[this.srcCell] = 1;
    this.frontier.push(this.srcCell);
  }

  private pickOpen(): number {
    const total = this.cols * this.rows;
    let idx = this.rng.int(0, total - 1);
    for (let i = 0; i < total; i++) {
      const c = (idx + i) % total;
      if (this.walls[c] === 0) return c;
    }
    return 0;
  }

  private neighbors(idx: number): number[] {
    const r = Math.floor(idx / this.cols);
    const c = idx % this.cols;
    const out: number[] = [];
    if (r > 0) out.push(idx - this.cols);
    if (r < this.rows - 1) out.push(idx + this.cols);
    if (c > 0) out.push(idx - 1);
    if (c < this.cols - 1) out.push(idx + 1);
    return out;
  }

  private stepBFS(): void {
    if (this.frontier.length === 0 || this.done) return;
    const next: number[] = [];
    for (const cell of this.frontier) {
      const d = this.dist[cell];
      for (const nb of this.neighbors(cell)) {
        if (this.walls[nb] === 1 || this.visited[nb] === 1) continue;
        this.visited[nb] = 1;
        this.dist[nb] = d + 1;
        this.prev[nb] = cell;
        if (d + 1 > this.maxDist) this.maxDist = d + 1;
        next.push(nb);
        if (nb === this.dstCell) {
          this.done = true;
          this.tracePath();
          return;
        }
      }
    }
    this.frontier = next;
    if (next.length === 0) {
      this.done = true;
    }
  }

  private tracePath(): void {
    this.pathCells.clear();
    let c = this.dstCell;
    while (c !== -1 && c !== this.srcCell) {
      this.pathCells.add(c);
      c = this.prev[c];
    }
    this.pathCells.add(this.srcCell);
  }

  private renderCanvas(): void {
    const ctx = this.ctx;
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    const bg = this.palette.bg;
    ctx.fillStyle = `rgb(${Math.round(bg.r * 255)},${Math.round(bg.g * 255)},${Math.round(bg.b * 255)})`;
    ctx.fillRect(0, 0, cw, ch);

    const cellW = cw / this.cols;
    const cellH = ch / this.rows;
    const pr = this.palette.primary;
    const sc = this.palette.secondary;
    const dm = this.palette.dim;
    const maxD = Math.max(this.maxDist, 1);

    for (let gy = 0; gy < this.rows; gy++) {
      for (let gx = 0; gx < this.cols; gx++) {
        const idx = gy * this.cols + gx;
        const px = gx * cellW;
        const py = gy * cellH;

        if (this.walls[idx] === 1) {
          ctx.fillStyle = `rgb(${Math.round(dm.r * 80)},${Math.round(dm.g * 80)},${Math.round(dm.b * 80)})`;
          ctx.fillRect(px, py, cellW + 0.5, cellH + 0.5);
        } else if (this.pathCells.has(idx)) {
          ctx.fillStyle = `rgb(${Math.round(sc.r * 255)},${Math.round(sc.g * 255)},${Math.round(sc.b * 255)})`;
          ctx.fillRect(px, py, cellW + 0.5, cellH + 0.5);
        } else if (this.visited[idx] === 1) {
          const t = Math.min(this.dist[idx] / maxD, 1);
          const r = Math.round((dm.r + (pr.r - dm.r) * (1 - t)) * 255);
          const g = Math.round((dm.g + (pr.g - dm.g) * (1 - t)) * 255);
          const b = Math.round((dm.b + (pr.b - dm.b) * (1 - t)) * 255);
          ctx.fillStyle = `rgb(${r},${g},${b})`;
          ctx.fillRect(px, py, cellW + 0.5, cellH + 0.5);
        }
      }
    }

    // Source and destination markers
    const sr = Math.floor(this.srcCell / this.cols);
    const scol = this.srcCell % this.cols;
    ctx.fillStyle = `rgb(${Math.round(sc.r * 255)},${Math.round(sc.g * 255)},${Math.round(sc.b * 255)})`;
    ctx.beginPath();
    ctx.arc(scol * cellW + cellW / 2, sr * cellH + cellH / 2, Math.max(2, cellW), 0, Math.PI * 2);
    ctx.fill();

    const dr = Math.floor(this.dstCell / this.cols);
    const dc = this.dstCell % this.cols;
    ctx.fillStyle = `rgb(${Math.round(pr.r * 255)},${Math.round(pr.g * 255)},${Math.round(pr.b * 255)})`;
    ctx.beginPath();
    ctx.arc(dc * cellW + cellW / 2, dr * cellH + cellH / 2, Math.max(2, cellW), 0, Math.PI * 2);
    ctx.fill();
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);

    if (this.done) {
      this.resetTimer += dt;
      if (this.resetTimer >= this.resetInterval) {
        this.initGrid();
      }
    } else {
      for (let i = 0; i < this.stepsPerFrame; i++) {
        this.stepBFS();
        if (this.done) break;
      }
    }

    (this.mesh.material as THREE.MeshBasicMaterial).opacity = opacity;

    this.renderAccum += dt;
    if (this.renderAccum < 0.066) return;
    this.renderAccum = 0;

    this.renderCanvas();
    this.texture.needsUpdate = true;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      this.initGrid();
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) {
      this.stepsPerFrame = 4;
      return;
    }
    this.stepsPerFrame = 4 + level * 3;
    if (level >= 4) {
      this.initGrid();
    }
  }
}
