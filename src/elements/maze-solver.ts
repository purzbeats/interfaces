import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Procedural maze generation + animated solver.
 * Walls grow via recursive backtracker, then a pathfinding agent
 * traces through with a luminous trail — tactical route planning display.
 */
export class MazeSolverElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'maze-solver',
    meta: { shape: 'rectangular', roles: ['data-display', 'structural'], moods: ['tactical', 'diagnostic'], bandAffinity: 'mid', sizes: ['needs-medium', 'needs-large'] },
  };

  private cols = 0;
  private rows = 0;
  private cellW = 0;
  private cellH = 0;
  private walls!: Uint8Array; // bitmask: 1=N, 2=E, 4=S, 8=W

  private wallLines!: THREE.LineSegments;
  private wallMat!: THREE.LineBasicMaterial;
  private pathLine!: THREE.Line;
  private pathMat!: THREE.LineBasicMaterial;
  private solverDot!: THREE.Points;

  private path: number[] = [];
  private pathProgress = 0;
  private pathSpeed = 8;
  private phase: 'generate' | 'solve' | 'done' = 'generate';
  private genStack: number[] = [];
  private visited!: Uint8Array;
  private genTimer = 0;
  private solveTimer = 0;
  private resetTimer = 0;

  build(): void {
    const variant = this.rng.int(0, 3);
    const presets = [
      { cellTarget: 15, speed: 8, genRate: 60 },
      { cellTarget: 25, speed: 12, genRate: 120 },
      { cellTarget: 10, speed: 5, genRate: 30 },
      { cellTarget: 20, speed: 15, genRate: 90 },
    ];
    const p = presets[variant];
    this.glitchAmount = 4;
    this.pathSpeed = p.speed;

    const { x, y, w, h } = this.px;
    const cellSize = Math.max(8, Math.min(w, h) / p.cellTarget);
    this.cellW = cellSize;
    this.cellH = cellSize;
    this.cols = Math.floor(w / cellSize);
    this.rows = Math.floor(h / cellSize);
    if (this.cols < 3) this.cols = 3;
    if (this.rows < 3) this.rows = 3;

    const total = this.cols * this.rows;
    this.walls = new Uint8Array(total);
    this.walls.fill(15); // all walls up
    this.visited = new Uint8Array(total);

    // Start generation from top-left
    this.visited[0] = 1;
    this.genStack = [0];

    // Wall geometry (max possible walls)
    const maxSegs = (this.cols + 1) * this.rows + this.cols * (this.rows + 1);
    const wallPos = new Float32Array(maxSegs * 6);
    const wallGeo = new THREE.BufferGeometry();
    wallGeo.setAttribute('position', new THREE.BufferAttribute(wallPos, 3));
    this.wallMat = new THREE.LineBasicMaterial({ color: this.palette.dim, transparent: true, opacity: 0 });
    this.wallLines = new THREE.LineSegments(wallGeo, this.wallMat);
    this.group.add(this.wallLines);

    // Path line
    const pathMax = total * 3;
    const pathPos = new Float32Array(pathMax);
    const pathGeo = new THREE.BufferGeometry();
    pathGeo.setAttribute('position', new THREE.BufferAttribute(pathPos, 3));
    pathGeo.setDrawRange(0, 0);
    this.pathMat = new THREE.LineBasicMaterial({ color: this.palette.secondary, transparent: true, opacity: 0 });
    this.pathLine = new THREE.Line(pathGeo, this.pathMat);
    this.group.add(this.pathLine);

    // Solver dot
    const dotPos = new Float32Array(3);
    const dotGeo = new THREE.BufferGeometry();
    dotGeo.setAttribute('position', new THREE.BufferAttribute(dotPos, 3));
    this.solverDot = new THREE.Points(dotGeo, new THREE.PointsMaterial({
      color: this.palette.primary, transparent: true, opacity: 0, size: 4, sizeAttenuation: false,
    }));
    this.group.add(this.solverDot);

    this.updateWallGeometry();
  }

  private cellCenter(cell: number): [number, number] {
    const { x, y } = this.px;
    const col = cell % this.cols;
    const row = Math.floor(cell / this.cols);
    return [x + (col + 0.5) * this.cellW, y + (row + 0.5) * this.cellH];
  }

  private getNeighbors(cell: number): Array<{ cell: number; wall: number; opposite: number }> {
    const col = cell % this.cols;
    const row = Math.floor(cell / this.cols);
    const n: Array<{ cell: number; wall: number; opposite: number }> = [];
    if (row > 0) n.push({ cell: cell - this.cols, wall: 1, opposite: 4 });
    if (col < this.cols - 1) n.push({ cell: cell + 1, wall: 2, opposite: 8 });
    if (row < this.rows - 1) n.push({ cell: cell + this.cols, wall: 4, opposite: 1 });
    if (col > 0) n.push({ cell: cell - 1, wall: 8, opposite: 2 });
    return n;
  }

  private stepGeneration(steps: number): boolean {
    for (let s = 0; s < steps && this.genStack.length > 0; s++) {
      const current = this.genStack[this.genStack.length - 1];
      const neighbors = this.getNeighbors(current).filter(n => !this.visited[n.cell]);

      if (neighbors.length === 0) {
        this.genStack.pop();
      } else {
        const next = neighbors[this.rng.int(0, neighbors.length - 1)];
        this.walls[current] &= ~next.wall;
        this.walls[next.cell] &= ~next.opposite;
        this.visited[next.cell] = 1;
        this.genStack.push(next.cell);
      }
    }
    return this.genStack.length === 0;
  }

  private solveMaze(): void {
    // BFS from top-left to bottom-right
    const start = 0;
    const end = this.cols * this.rows - 1;
    const prev = new Int32Array(this.cols * this.rows).fill(-1);
    const visited = new Uint8Array(this.cols * this.rows);
    const queue = [start];
    visited[start] = 1;

    while (queue.length > 0) {
      const c = queue.shift()!;
      if (c === end) break;
      for (const n of this.getNeighbors(c)) {
        if (!visited[n.cell] && !(this.walls[c] & n.wall)) {
          visited[n.cell] = 1;
          prev[n.cell] = c;
          queue.push(n.cell);
        }
      }
    }

    // Reconstruct path
    this.path = [];
    let c = end;
    while (c !== -1) {
      this.path.unshift(c);
      c = prev[c];
    }

    // Write path positions
    const pathPos = this.pathLine.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < this.path.length; i++) {
      const [cx, cy] = this.cellCenter(this.path[i]);
      pathPos.setXYZ(i, cx, cy, 0.5);
    }
    pathPos.needsUpdate = true;
    this.pathProgress = 0;
  }

  private updateWallGeometry(): void {
    const { x, y } = this.px;
    const pos = this.wallLines.geometry.getAttribute('position') as THREE.BufferAttribute;
    let idx = 0;

    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const cell = r * this.cols + c;
        const lx = x + c * this.cellW;
        const ly = y + r * this.cellH;

        if (this.walls[cell] & 1) { // North
          pos.setXYZ(idx++, lx, ly, 0); pos.setXYZ(idx++, lx + this.cellW, ly, 0);
        }
        if (this.walls[cell] & 2) { // East
          pos.setXYZ(idx++, lx + this.cellW, ly, 0); pos.setXYZ(idx++, lx + this.cellW, ly + this.cellH, 0);
        }
        if (r === this.rows - 1 && (this.walls[cell] & 4)) { // South (bottom edge)
          pos.setXYZ(idx++, lx, ly + this.cellH, 0); pos.setXYZ(idx++, lx + this.cellW, ly + this.cellH, 0);
        }
        if (c === 0 && (this.walls[cell] & 8)) { // West (left edge)
          pos.setXYZ(idx++, lx, ly, 0); pos.setXYZ(idx++, lx, ly + this.cellH, 0);
        }
      }
    }

    pos.needsUpdate = true;
    this.wallLines.geometry.setDrawRange(0, idx);
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);

    if (this.phase === 'generate') {
      this.genTimer += dt;
      const stepsPerSec = 60;
      const steps = Math.max(1, Math.floor(this.genTimer * stepsPerSec));
      this.genTimer -= steps / stepsPerSec;
      const done = this.stepGeneration(steps);
      this.updateWallGeometry();
      if (done) {
        this.phase = 'solve';
        this.solveMaze();
      }
    } else if (this.phase === 'solve') {
      this.pathProgress += this.pathSpeed * dt;
      const drawCount = Math.min(this.path.length, Math.floor(this.pathProgress));
      this.pathLine.geometry.setDrawRange(0, drawCount);

      // Move solver dot
      if (drawCount > 0 && drawCount <= this.path.length) {
        const ci = Math.min(drawCount - 1, this.path.length - 1);
        const [cx, cy] = this.cellCenter(this.path[ci]);
        const dotPos = this.solverDot.geometry.getAttribute('position') as THREE.BufferAttribute;
        dotPos.setXYZ(0, cx, cy, 1);
        dotPos.needsUpdate = true;
      }

      if (drawCount >= this.path.length) {
        this.phase = 'done';
        this.resetTimer = 3;
      }
    } else {
      this.resetTimer -= dt;
      if (this.resetTimer <= 0) {
        // Reset maze
        this.walls.fill(15);
        this.visited.fill(0);
        this.visited[0] = 1;
        this.genStack = [0];
        this.path = [];
        this.pathLine.geometry.setDrawRange(0, 0);
        this.phase = 'generate';
      }
    }

    this.wallMat.opacity = opacity * 0.6;
    this.pathMat.opacity = opacity * 0.9;
    (this.solverDot.material as THREE.PointsMaterial).opacity = this.phase === 'solve' ? opacity : 0;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'alert' || action === 'glitch') {
      // Force regeneration
      this.walls.fill(15);
      this.visited.fill(0);
      this.visited[0] = 1;
      this.genStack = [0];
      this.path = [];
      this.pathLine.geometry.setDrawRange(0, 0);
      this.phase = 'generate';
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level >= 3) this.pathSpeed = 20;
    if (level >= 5) this.pathSpeed = 40;
  }
}
