import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Punched card reader: a grid of small rectangles scrolling vertically.
 * Punched holes are bright, unpunched are very dim.
 * Column guide lines run behind in dim color.
 */
export class PunchCardElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'punch-card',
    meta: {
      shape: 'rectangular',
      roles: ['data-display'],
      moods: ['diagnostic'],
      sizes: ['works-small', 'needs-medium'],
    },
  };

  private cols = 0;
  private rows = 0;
  private scrollOffset = 0;
  private scrollSpeed = 12;
  private cellW = 0;
  private cellH = 0;
  private topRow = 0; // tracks which logical row is at the top

  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private texture!: THREE.CanvasTexture;
  private mesh!: THREE.Mesh;
  private canvasW = 0;
  private canvasH = 0;
  private renderAccum = 0;
  private readonly renderInterval = 1 / 15; // ~15fps throttle

  build(): void {
    const { x, y, w, h } = this.px;

    // Determine grid size
    this.cellW = Math.max(6, Math.min(14, w / 12));
    this.cellH = Math.max(5, Math.min(10, h / 10));
    const padding = w * 0.05;
    const gridW = w - padding * 2;
    const gridH = h - padding * 2;

    this.cols = Math.max(4, Math.floor(gridW / this.cellW));
    this.rows = Math.max(3, Math.floor(gridH / this.cellH) + 2); // +2 for scroll buffer

    this.scrollSpeed = this.rng.float(6, 18);

    // Canvas size: cap at 256px, map grid proportionally
    const scale = Math.min(1, 256 / Math.max(gridW, gridH));
    this.canvasW = Math.max(32, Math.round(gridW * scale));
    this.canvasH = Math.max(32, Math.round(gridH * scale));

    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvasW;
    this.canvas.height = this.canvasH;
    this.ctx = this.get2DContext(this.canvas);

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.magFilter = THREE.NearestFilter;

    const geo = new THREE.PlaneGeometry(gridW, gridH);
    this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      opacity: 0,
    }));
    this.mesh.position.set(x + padding + gridW / 2, y + padding + gridH / 2, 1);
    this.group.add(this.mesh);
  }

  /** Deterministic hash for punch pattern */
  private isPunched(row: number, col: number): boolean {
    // Simple integer hash
    let h = ((row * 7919) ^ (col * 104729)) & 0xFFFFFF;
    h = ((h >> 8) ^ h) * 0x5bd1e995;
    h = (h >> 13) ^ h;
    return (h & 0x7) < 3; // ~37.5% punched
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);
    (this.mesh.material as THREE.MeshBasicMaterial).opacity = opacity;

    // Scroll
    this.scrollOffset += this.scrollSpeed * dt;
    if (this.scrollOffset >= this.cellH) {
      this.scrollOffset -= this.cellH;
      this.topRow++;
    }

    // Throttle canvas rendering to ~15fps
    this.renderAccum += dt;
    if (this.renderAccum < this.renderInterval) return;
    this.renderAccum = 0;

    const { w, h } = this.px;
    const padding = w * 0.05;
    const gridW = w - padding * 2;
    const gridH = h - padding * 2;

    const ctx = this.ctx;
    const cw = this.canvasW;
    const ch = this.canvasH;

    // Clear
    ctx.clearRect(0, 0, cw, ch);

    // Draw column guide lines
    const dimR = Math.round(this.palette.dim.r * 255);
    const dimG = Math.round(this.palette.dim.g * 255);
    const dimB = Math.round(this.palette.dim.b * 255);
    ctx.strokeStyle = `rgba(${dimR},${dimG},${dimB},${opacity * 0.12})`;
    ctx.lineWidth = 1;
    for (let c = 0; c <= this.cols; c++) {
      const gx = (c * this.cellW / gridW) * cw;
      ctx.beginPath();
      ctx.moveTo(gx, 0);
      ctx.lineTo(gx, ch);
      ctx.stroke();
    }

    // Scale factors from grid space to canvas space
    const scaleX = cw / gridW;
    const scaleY = ch / gridH;
    const holeW = this.cellW * 0.6 * scaleX;
    const holeH = this.cellH * 0.55 * scaleY;

    const primaryR = Math.round(this.palette.primary.r * 255);
    const primaryG = Math.round(this.palette.primary.g * 255);
    const primaryB = Math.round(this.palette.primary.b * 255);

    // Draw holes
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const logicalRow = this.topRow + r;
        // screenY in grid-local coords (0..gridH), with 0 at top of grid
        const screenYLocal = gridH - (r * this.cellH - this.scrollOffset) - this.cellH / 2;
        const screenXLocal = c * this.cellW + this.cellW / 2;

        // Check in-bounds in grid-local coords
        if (screenYLocal < 0 || screenYLocal > gridH) continue;

        const punched = this.isPunched(logicalRow, c);
        const cellOpacity = opacity * (punched ? 0.7 : 0.08);

        if (punched) {
          ctx.fillStyle = `rgba(${primaryR},${primaryG},${primaryB},${cellOpacity})`;
        } else {
          ctx.fillStyle = `rgba(${dimR},${dimG},${dimB},${cellOpacity})`;
        }

        const cx = screenXLocal * scaleX - holeW / 2;
        const cy = screenYLocal * scaleY - holeH / 2;
        ctx.fillRect(cx, cy, holeW, holeH);
      }
    }

    this.texture.needsUpdate = true;
  }
}
