import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Site percolation on a grid. Random sites are occupied with probability p.
 * The spanning cluster (if it exists) is highlighted. Phase transition near p_c ~ 0.593.
 * Grid regenerates periodically, sweeping p through the critical region.
 */
export class PercolationGridElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'percolation-grid',
    meta: { shape: 'rectangular', roles: ['data-display', 'scanner'], moods: ['diagnostic', 'tactical'], bandAffinity: 'mid', sizes: ['works-small', 'needs-medium'] },
  };

  private mesh!: THREE.InstancedMesh;
  private mat!: THREE.MeshBasicMaterial;
  private cols: number = 0;
  private rows: number = 0;
  private cellSize: number = 0;
  private dummy = new THREE.Matrix4();
  private occupied!: Uint8Array;
  private cluster!: Int32Array;
  private sweepTimer: number = 0;
  private sweepPeriod: number = 6;
  private pTarget: number = 0.593;
  private originX: number = 0;
  private originY: number = 0;

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;

    const variant = this.rng.int(0, 3);
    const presets = [
      { cell: 6, period: 6 },
      { cell: 4, period: 4 },
      { cell: 8, period: 8 },
      { cell: 5, period: 5 },
    ];
    const pr = presets[variant];
    this.cellSize = pr.cell;
    this.sweepPeriod = pr.period;
    this.cols = Math.max(4, Math.floor(w / this.cellSize));
    this.rows = Math.max(4, Math.floor(h / this.cellSize));
    this.originX = x;
    this.originY = y;

    const count = this.cols * this.rows;
    this.occupied = new Uint8Array(count);
    this.cluster = new Int32Array(count);

    const geo = new THREE.PlaneGeometry(this.cellSize * 0.85, this.cellSize * 0.85);
    this.mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0 });
    this.mesh = new THREE.InstancedMesh(geo, this.mat, count);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);

    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const i = r * this.cols + c;
        this.dummy.makeTranslation(
          this.originX + c * this.cellSize + this.cellSize / 2,
          this.originY + r * this.cellSize + this.cellSize / 2,
          0,
        );
        this.mesh.setMatrixAt(i, this.dummy);
      }
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.group.add(this.mesh);
    this.generateGrid(0.593);
  }

  private generateGrid(p: number): void {
    const count = this.cols * this.rows;
    for (let i = 0; i < count; i++) {
      this.occupied[i] = this.rng.next() < p ? 1 : 0;
    }
    this.findClusters();
  }

  private findClusters(): void {
    const count = this.cols * this.rows;
    this.cluster.fill(-1);
    let label = 0;

    for (let i = 0; i < count; i++) {
      if (this.occupied[i] === 0 || this.cluster[i] >= 0) continue;
      // BFS flood fill
      const queue = [i];
      this.cluster[i] = label;
      let head = 0;
      while (head < queue.length) {
        const cur = queue[head++];
        const r = Math.floor(cur / this.cols);
        const c = cur % this.cols;
        const neighbors = [
          r > 0 ? (r - 1) * this.cols + c : -1,
          r < this.rows - 1 ? (r + 1) * this.cols + c : -1,
          c > 0 ? r * this.cols + c - 1 : -1,
          c < this.cols - 1 ? r * this.cols + c + 1 : -1,
        ];
        for (const n of neighbors) {
          if (n >= 0 && this.occupied[n] === 1 && this.cluster[n] < 0) {
            this.cluster[n] = label;
            queue.push(n);
          }
        }
      }
      label++;
    }
  }

  private findSpanningCluster(): number {
    // A cluster that touches both top and bottom rows
    const topClusters = new Set<number>();
    for (let c = 0; c < this.cols; c++) {
      const cl = this.cluster[c];
      if (cl >= 0) topClusters.add(cl);
    }
    for (let c = 0; c < this.cols; c++) {
      const cl = this.cluster[(this.rows - 1) * this.cols + c];
      if (cl >= 0 && topClusters.has(cl)) return cl;
    }
    return -1;
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);
    this.sweepTimer += dt;

    if (this.sweepTimer >= this.sweepPeriod) {
      this.sweepTimer -= this.sweepPeriod;
      // Sweep p through critical region
      const p = 0.5 + this.rng.float(0, 0.2);
      this.generateGrid(p);
    }

    const spanning = this.findSpanningCluster();
    const count = this.cols * this.rows;
    const colorArr = this.mesh.instanceColor!.array as Float32Array;
    const pr = this.palette.primary;
    const sr = this.palette.secondary;
    const dm = this.palette.dim;

    for (let i = 0; i < count; i++) {
      const j = i * 3;
      if (this.occupied[i] === 0) {
        colorArr[j] = dm.r * 0.2 * opacity;
        colorArr[j + 1] = dm.g * 0.2 * opacity;
        colorArr[j + 2] = dm.b * 0.2 * opacity;
      } else if (this.cluster[i] === spanning && spanning >= 0) {
        colorArr[j] = sr.r * opacity;
        colorArr[j + 1] = sr.g * opacity;
        colorArr[j + 2] = sr.b * opacity;
      } else {
        colorArr[j] = pr.r * 0.5 * opacity;
        colorArr[j + 1] = pr.g * 0.5 * opacity;
        colorArr[j + 2] = pr.b * 0.5 * opacity;
      }
    }
    this.mesh.instanceColor!.needsUpdate = true;
    this.mat.opacity = 1;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      this.glitchTimer = 0.5;
    } else if (action === 'alert') {
      this.generateGrid(0.593);
      this.pulseTimer = 1.0;
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level >= 3) {
      this.generateGrid(0.5 + level * 0.02);
    }
  }
}
