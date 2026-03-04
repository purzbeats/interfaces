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
  private holeMeshes: THREE.Mesh[] = [];
  private guideLines!: THREE.LineSegments;
  private scrollOffset = 0;
  private scrollSpeed = 12;
  private holeW = 0;
  private holeH = 0;
  private gridX = 0;
  private gridY = 0;
  private cellW = 0;
  private cellH = 0;
  private topRow = 0; // tracks which logical row is at the top

  build(): void {
    const { x, y, w, h } = this.px;

    // Determine grid size
    this.cellW = Math.max(6, Math.min(14, w / 12));
    this.cellH = Math.max(5, Math.min(10, h / 10));
    const padding = w * 0.05;
    const gridW = w - padding * 2;
    const gridH = h - padding * 2;
    this.gridX = x + padding;
    this.gridY = y + padding;

    this.cols = Math.max(4, Math.floor(gridW / this.cellW));
    this.rows = Math.max(3, Math.floor(gridH / this.cellH) + 2); // +2 for scroll buffer

    this.holeW = this.cellW * 0.6;
    this.holeH = this.cellH * 0.55;
    this.scrollSpeed = this.rng.float(6, 18);

    // Column guide lines
    const guideVerts: number[] = [];
    for (let c = 0; c <= this.cols; c++) {
      const gx = this.gridX + c * this.cellW;
      guideVerts.push(gx, this.gridY, 0, gx, this.gridY + gridH, 0);
    }
    const guideGeo = new THREE.BufferGeometry();
    guideGeo.setAttribute('position', new THREE.Float32BufferAttribute(guideVerts, 3));
    this.guideLines = new THREE.LineSegments(guideGeo, new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.guideLines);

    // Create hole meshes (one per grid cell including buffer rows)
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const geo = new THREE.PlaneGeometry(this.holeW, this.holeH);
        const mat = new THREE.MeshBasicMaterial({
          color: this.palette.primary,
          transparent: true,
          opacity: 0,
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(0, 0, 1);
        this.holeMeshes.push(mesh);
        this.group.add(mesh);
      }
    }
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

    // Scroll
    this.scrollOffset += this.scrollSpeed * dt;
    if (this.scrollOffset >= this.cellH) {
      this.scrollOffset -= this.cellH;
      this.topRow++;
    }

    const { h } = this.px;
    const visibleH = h - h * 0.1; // gridH

    // Guide lines
    (this.guideLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.12;

    // Position holes
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const idx = r * this.cols + c;
        const mesh = this.holeMeshes[idx];
        const mat = mesh.material as THREE.MeshBasicMaterial;

        const logicalRow = this.topRow + r;
        const screenY = this.gridY + visibleH - (r * this.cellH - this.scrollOffset) - this.cellH / 2;
        const screenX = this.gridX + c * this.cellW + this.cellW / 2;

        mesh.position.set(screenX, screenY, 1);

        const punched = this.isPunched(logicalRow, c);

        // Hide holes that are out of bounds
        const inBounds = screenY >= this.gridY && screenY <= this.gridY + visibleH;

        if (inBounds) {
          mat.opacity = opacity * (punched ? 0.7 : 0.08);
          mat.color.copy(punched ? this.palette.primary : this.palette.dim);
        } else {
          mat.opacity = 0;
        }
      }
    }
  }
}
