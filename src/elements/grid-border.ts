import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Grid border — fine grid lines that appear only near the edges of the region,
 * fading toward center. Creates a measurement/calibration feel.
 * Variants: all edges, top+bottom only, diagonal grid near edges, dot grid near edges.
 */
export class GridBorderElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'grid-border',
    meta: {
      shape: 'rectangular',
      roles: ['decorative', 'border'],
      moods: ['diagnostic', 'tactical'],
      bandAffinity: 'high',
      sizes: ['works-small', 'needs-medium'],
    } satisfies ElementMeta,
  };

  private variant = 0;
  private lines!: THREE.LineSegments;
  private points: THREE.Points | null = null;
  private breatheSpeed = 0;

  build(): void {
    this.variant = this.rng.int(0, 3);
    this.breatheSpeed = this.rng.float(0.4, 1.0);

    const { x, y, w, h } = this.px;
    const minDim = Math.min(w, h);
    // Edge band depth — grid lines only extend this far inward
    const edgeDepth = minDim * 0.15;
    // Grid spacing proportional to tile
    const spacing = Math.max(1, minDim * 0.03);

    if (this.variant === 3) {
      // Dot grid near edges
      this.buildDotGrid(x, y, w, h, edgeDepth, spacing);
    } else {
      this.buildLineGrid(x, y, w, h, edgeDepth, spacing);
    }
  }

  private buildLineGrid(
    x: number, y: number, w: number, h: number,
    edgeDepth: number, spacing: number,
  ): void {
    const verts: number[] = [];

    if (this.variant === 0 || this.variant === 1) {
      // Horizontal lines near top edge
      for (let dy = 0; dy <= edgeDepth; dy += spacing) {
        verts.push(x, y + dy, 0, x + w, y + dy, 0);
      }
      // Horizontal lines near bottom edge
      for (let dy = 0; dy <= edgeDepth; dy += spacing) {
        verts.push(x, y + h - dy, 0, x + w, y + h - dy, 0);
      }
      // Vertical lines near top/bottom edges (short ticks)
      for (let dx = 0; dx <= w; dx += spacing) {
        verts.push(x + dx, y, 0, x + dx, y + edgeDepth, 0);
        verts.push(x + dx, y + h - edgeDepth, 0, x + dx, y + h, 0);
      }
    }

    if (this.variant === 0) {
      // Also add left/right edge lines
      for (let dx = 0; dx <= edgeDepth; dx += spacing) {
        verts.push(x + dx, y, 0, x + dx, y + h, 0);
        verts.push(x + w - dx, y, 0, x + w - dx, y + h, 0);
      }
      for (let dy = 0; dy <= h; dy += spacing) {
        verts.push(x, y + dy, 0, x + edgeDepth, y + dy, 0);
        verts.push(x + w - edgeDepth, y + dy, 0, x + w, y + dy, 0);
      }
    }

    if (this.variant === 2) {
      // Diagonal grid lines near all edges
      const diagSpacing = spacing * 1.5;
      // Top edge diagonals
      for (let d = -edgeDepth; d <= w + edgeDepth; d += diagSpacing) {
        const x1 = Math.max(x, x + d);
        const y1 = Math.max(y, y + (x + d - x1));
        const x2 = Math.min(x + w, x + d + edgeDepth);
        const y2 = Math.min(y + edgeDepth, y + edgeDepth - (x2 - (x + d + edgeDepth)));
        if (x1 < x + w && x2 > x) {
          verts.push(x1, y + Math.max(0, d < 0 ? -d : 0), 0, x2, y + Math.min(edgeDepth, edgeDepth), 0);
        }
      }
      // Bottom edge diagonals
      for (let d = -edgeDepth; d <= w + edgeDepth; d += diagSpacing) {
        const startX = Math.max(x, x + d);
        const endX = Math.min(x + w, x + d + edgeDepth);
        if (startX < endX) {
          verts.push(startX, y + h - edgeDepth, 0, endX, y + h, 0);
        }
      }
      // Left edge diagonals
      for (let d = -edgeDepth; d <= h + edgeDepth; d += diagSpacing) {
        const startY = Math.max(y, y + d);
        const endY = Math.min(y + h, y + d + edgeDepth);
        if (startY < endY) {
          verts.push(x, startY, 0, x + edgeDepth, endY, 0);
        }
      }
      // Right edge diagonals
      for (let d = -edgeDepth; d <= h + edgeDepth; d += diagSpacing) {
        const startY = Math.max(y, y + d);
        const endY = Math.min(y + h, y + d + edgeDepth);
        if (startY < endY) {
          verts.push(x + w - edgeDepth, startY, 0, x + w, endY, 0);
        }
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    const mat = new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    });
    this.lines = new THREE.LineSegments(geo, mat);
    this.group.add(this.lines);
  }

  private buildDotGrid(
    x: number, y: number, w: number, h: number,
    edgeDepth: number, spacing: number,
  ): void {
    const positions: number[] = [];

    for (let dx = 0; dx <= w; dx += spacing) {
      for (let dy = 0; dy <= edgeDepth; dy += spacing) {
        // Top edge dots
        positions.push(x + dx, y + dy, 0);
        // Bottom edge dots
        positions.push(x + dx, y + h - dy, 0);
      }
    }
    for (let dy = edgeDepth; dy <= h - edgeDepth; dy += spacing) {
      for (let dx = 0; dx <= edgeDepth; dx += spacing) {
        // Left edge dots
        positions.push(x + dx, y + dy, 0);
        // Right edge dots
        positions.push(x + w - dx, y + dy, 0);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const minDim = Math.min(w, h);
    const mat = new THREE.PointsMaterial({
      color: this.palette.dim,
      size: Math.max(1, minDim * 0.008),
      transparent: true,
      opacity: 0,
      sizeAttenuation: false,
    });
    this.points = new THREE.Points(geo, mat);
    this.group.add(this.points);

    // Also add a thin outer border line
    const borderVerts = [
      x, y, 0, x + w, y, 0,
      x + w, y, 0, x + w, y + h, 0,
      x + w, y + h, 0, x, y + h, 0,
      x, y + h, 0, x, y, 0,
    ];
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(borderVerts, 3));
    this.lines = new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.lines);
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    const breathe = 0.5 + 0.5 * Math.sin(time * this.breatheSpeed);
    const baseOp = opacity * (0.06 + 0.06 * breathe);

    const lineMat = this.lines.material as THREE.LineBasicMaterial;
    lineMat.opacity = baseOp;

    if (this.points) {
      const ptMat = this.points.material as THREE.PointsMaterial;
      ptMat.opacity = baseOp * 1.2;
    }
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'alert') {
      (this.lines.material as THREE.LineBasicMaterial).color.copy(this.palette.alert);
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
  }
}
