import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Pixel sorting glitch effect — columns (or rows) of small squares arranged by
 * simulated brightness values that periodically "sort" by sliding into order.
 * Mimics the classic pixel-sort glitch art aesthetic.
 *
 * Variants:
 *   0 - Vertical sort   (columns slide up/down)
 *   1 - Horizontal sort (rows slide left/right)
 *   2 - Diagonal sort   (offset by both axes)
 *   3 - Wave sort       (sinusoidal displacement drives sorting position)
 */

interface SortColumn {
  /** Simulated brightness value per cell [0..1] */
  brightness: number[];
  /** Current visual Y offset for each cell (in pixels) */
  offsets: number[];
  /** Target sorted Y offset per cell */
  targetOffsets: number[];
  /** Whether this column is currently sorting */
  sorting: boolean;
  sortProgress: number; // 0..1
  sortDuration: number;
  nextSortTime: number;
}

export class PixelSortElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'pixel-sort',
    meta: {
      shape: 'rectangular',
      roles: ['decorative'],
      moods: ['tactical', 'ambient'],
      sizes: ['works-small', 'needs-medium'],
      bandAffinity: 'high',
    },
  };

  private columns: SortColumn[] = [];
  private cellW: number = 0;
  private cellH: number = 0;
  private numCols: number = 0;
  private numRows: number = 0;
  private variant: number = 0;
  private intensityLevel: number = 0;
  private borderMat!: THREE.LineBasicMaterial;
  private globalTime: number = 0;

  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private texture!: THREE.CanvasTexture;
  private mesh!: THREE.Mesh;
  private canvasW = 0;
  private canvasH = 0;
  private renderAccum = 0;
  private readonly renderInterval = 1 / 15; // ~15fps throttle
  /** Alert color override tracking */
  private alertActive = false;

  build(): void {
    this.variant = this.rng.int(0, 3);
    const { x, y, w, h } = this.px;

    // Preset parameters per variant
    const presets = [
      { cols: 24, rows: 32, sortChance: 0.15, sortDur: [0.4, 1.2] },  // vertical
      { cols: 32, rows: 20, sortChance: 0.12, sortDur: [0.3, 1.0] },  // horizontal
      { cols: 20, rows: 20, sortChance: 0.18, sortDur: [0.5, 1.5] },  // diagonal
      { cols: 22, rows: 28, sortChance: 0.20, sortDur: [0.6, 1.8] },  // wave
    ];
    const p = presets[this.variant];

    // Choose cols/rows so cells are always square
    const aspect = w / h;
    if (aspect >= 1) {
      this.numRows = p.rows;
      this.numCols = Math.max(4, Math.round(this.numRows * aspect));
    } else {
      this.numCols = p.cols;
      this.numRows = Math.max(4, Math.round(this.numCols / aspect));
    }
    this.cellW = w / this.numCols;
    this.cellH = h / this.numRows;

    for (let col = 0; col < this.numCols; col++) {
      const brightness: number[] = [];
      const offsets: number[] = [];
      const targetOffsets: number[] = [];

      for (let row = 0; row < this.numRows; row++) {
        brightness.push(this.rng.float(0, 1));
        offsets.push(0);
        targetOffsets.push(0);
      }

      // Stagger next sort time per column
      const sortDelay = this.rng.float(0, 3.0);
      this.columns.push({
        brightness,
        offsets,
        targetOffsets,
        sorting: false,
        sortProgress: 0,
        sortDuration: this.rng.float(p.sortDur[0], p.sortDur[1]),
        nextSortTime: sortDelay,
      });
    }

    // Canvas for rendering all cells
    const scale = Math.min(1, 256 / Math.max(w, h));
    this.canvasW = Math.max(32, Math.round(w * scale));
    this.canvasH = Math.max(32, Math.round(h * scale));

    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvasW;
    this.canvas.height = this.canvasH;
    this.ctx = this.get2DContext(this.canvas);

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.magFilter = THREE.NearestFilter;

    const geo = new THREE.PlaneGeometry(w, h);
    this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    }));
    this.mesh.position.set(x + w / 2, y + h / 2, 0);
    this.group.add(this.mesh);

    // Border
    const bv = new Float32Array([
      x, y, 0, x + w, y, 0,
      x + w, y, 0, x + w, y + h, 0,
      x + w, y + h, 0, x, y + h, 0,
      x, y + h, 0, x, y, 0,
    ]);
    const borderGeo = new THREE.BufferGeometry();
    borderGeo.setAttribute('position', new THREE.BufferAttribute(bv, 3));
    this.borderMat = new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    });
    const border = new THREE.LineSegments(borderGeo, this.borderMat);
    this.group.add(border);
  }

  private computeSortedOffsets(col: SortColumn, colIdx: number): number[] {
    const n = this.numRows;
    const indices = Array.from({ length: n }, (_, i) => i);

    if (this.variant === 0) {
      // vertical: sort ascending by brightness
      indices.sort((a, b) => col.brightness[a] - col.brightness[b]);
    } else if (this.variant === 1) {
      // horizontal: sort descending (bright cells travel right)
      indices.sort((a, b) => col.brightness[b] - col.brightness[a]);
    } else if (this.variant === 2) {
      // diagonal: sort with offset by column index
      const phaseShift = (colIdx / this.numCols) * Math.PI * 2;
      indices.sort((a, b) => {
        const va = col.brightness[a] + Math.sin(a * 0.5 + phaseShift) * 0.3;
        const vb = col.brightness[b] + Math.sin(b * 0.5 + phaseShift) * 0.3;
        return va - vb;
      });
    } else {
      // wave: sort but target offsets use sinusoidal displacement
      indices.sort((a, b) => col.brightness[a] - col.brightness[b]);
    }

    // Map sorted position index → pixel offset from original row position
    const result = new Array(n).fill(0);
    for (let sortedPos = 0; sortedPos < n; sortedPos++) {
      const origIdx = indices[sortedPos];
      const maxDisp = this.numRows * this.cellH * 0.4;
      result[origIdx] = Math.max(-maxDisp, Math.min(maxDisp, (sortedPos - origIdx) * this.cellH));
    }
    return result;
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    this.globalTime = time;
    (this.mesh.material as THREE.MeshBasicMaterial).opacity = opacity;

    const sortChancePerSec = 0.15 + this.intensityLevel * 0.08;

    // Update sort state (always runs, not throttled)
    for (let colIdx = 0; colIdx < this.columns.length; colIdx++) {
      const col = this.columns[colIdx];

      if (!col.sorting) {
        col.nextSortTime -= dt;
        if (col.nextSortTime <= 0) {
          if (this.rng.chance(sortChancePerSec)) {
            col.sorting = true;
            col.sortProgress = 0;
            col.sortDuration = this.rng.float(0.3, 1.5);
            const sorted = this.computeSortedOffsets(col, colIdx);
            for (let r = 0; r < this.numRows; r++) {
              col.targetOffsets[r] = sorted[r];
            }
          }
          col.nextSortTime = this.rng.float(0.2, 2.0);
        }
      } else {
        col.sortProgress += dt / col.sortDuration;
        if (col.sortProgress >= 1) {
          col.sortProgress = 1;
          col.sorting = false;
          for (let r = 0; r < this.numRows; r++) {
            if (this.rng.chance(0.3)) {
              col.brightness[r] = this.rng.float(0, 1);
            }
            col.offsets[r] = col.targetOffsets[r];
            col.targetOffsets[r] = 0;
          }
          col.nextSortTime = this.rng.float(0.5, 3.0);
        }
      }
    }

    this.borderMat.opacity = opacity * 0.25;

    // Throttle canvas rendering to ~15fps
    this.renderAccum += dt;
    if (this.renderAccum < this.renderInterval) return;
    this.renderAccum = 0;

    const { w, h } = this.px;
    const ctx = this.ctx;
    const cw = this.canvasW;
    const ch = this.canvasH;
    const scaleX = cw / w;
    const scaleY = ch / h;

    ctx.clearRect(0, 0, cw, ch);

    // Pre-compute color strings
    const prim = this.palette.primary;
    const sec = this.palette.secondary;
    const dim = this.palette.dim;
    const alert = this.alertActive ? this.palette.alert : null;
    const primStr = `${Math.round(prim.r * 255)},${Math.round(prim.g * 255)},${Math.round(prim.b * 255)}`;
    const secStr = `${Math.round(sec.r * 255)},${Math.round(sec.g * 255)},${Math.round(sec.b * 255)}`;
    const dimStr = `${Math.round(dim.r * 255)},${Math.round(dim.g * 255)},${Math.round(dim.b * 255)}`;
    const alertStr = alert ? `${Math.round(alert.r * 255)},${Math.round(alert.g * 255)},${Math.round(alert.b * 255)}` : '';

    const cellWCanvas = this.cellW * 0.9 * scaleX;
    const cellHCanvas = this.cellH * 0.9 * scaleY;

    for (let colIdx = 0; colIdx < this.columns.length; colIdx++) {
      const col = this.columns[colIdx];

      for (let row = 0; row < this.numRows; row++) {
        const b = col.brightness[row];

        let yOff = 0;
        let xOff = 0;

        if (col.sorting) {
          const t = col.sortProgress;
          const ease = t * t * (3 - 2 * t);
          const fromOff = col.offsets[row];
          const toOff = col.targetOffsets[row];
          yOff = fromOff + (toOff - fromOff) * ease;
        } else {
          yOff = col.offsets[row];
        }

        if (this.variant === 3) {
          const waveOffset = Math.sin(time * 2.1 + colIdx * 0.4 + row * 0.2) * this.cellH * 0.5;
          yOff += waveOffset * (col.sorting ? col.sortProgress : 0);
        } else if (this.variant === 1) {
          xOff = yOff;
          yOff = 0;
        } else if (this.variant === 2) {
          xOff = yOff * 0.4;
          yOff = yOff * 0.7;
        }

        // Cell position in element-local coords, then to canvas
        const cx = (colIdx * this.cellW + this.cellW * 0.5 + xOff) * scaleX - cellWCanvas / 2;
        const cy = (row * this.cellH + this.cellH * 0.5 + yOff) * scaleY - cellHCanvas / 2;

        // Determine color
        let colorStr: string;
        if (alert && b > 0.7) {
          colorStr = alertStr;
        } else if (b > 0.66) {
          colorStr = primStr;
        } else if (b > 0.33) {
          colorStr = secStr;
        } else {
          colorStr = dimStr;
        }

        // Vary opacity by brightness
        let cellOpacity = 0.3 + b * 0.7;
        if (this.intensityLevel >= 3 && b > 0.8) {
          const flicker = 0.7 + 0.3 * Math.sin(time * 20 + colIdx * 1.3 + row * 0.7);
          cellOpacity *= flicker;
        }

        ctx.fillStyle = `rgba(${colorStr},${cellOpacity})`;
        ctx.fillRect(cx, cy, cellWCanvas, cellHCanvas);
      }
    }

    this.texture.needsUpdate = true;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Force-trigger sort on all columns simultaneously
      for (let i = 0; i < this.columns.length; i++) {
        const col = this.columns[i];
        col.sorting = true;
        col.sortProgress = 0;
        col.sortDuration = this.rng.float(0.1, 0.4);
        const sorted = this.computeSortedOffsets(col, i);
        for (let r = 0; r < this.numRows; r++) {
          col.targetOffsets[r] = sorted[r];
        }
      }
    }
    if (action === 'alert') {
      // Flash bright cells to alert color (handled in canvas render)
      this.alertActive = true;
      setTimeout(() => {
        this.alertActive = false;
      }, 2000);
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    this.intensityLevel = level;
    if (level === 0) return;
    // At high intensity, trigger wave sort cascades
    if (level >= 3) {
      const numToTrigger = Math.floor(this.columns.length * (level / 5) * 0.5);
      for (let k = 0; k < numToTrigger; k++) {
        const idx = this.rng.int(0, this.columns.length - 1);
        const col = this.columns[idx];
        if (!col.sorting) {
          col.sorting = true;
          col.sortProgress = 0;
          col.sortDuration = this.rng.float(0.2, 0.6);
          const sorted = this.computeSortedOffsets(col, idx);
          for (let r = 0; r < this.numRows; r++) {
            col.targetOffsets[r] = sorted[r];
          }
        }
      }
    }
  }

  dispose(): void {
    this.columns = [];
    if (this.texture) this.texture.dispose();
    super.dispose();
  }
}
