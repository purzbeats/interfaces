import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Animated topographic contour map with shifting elevation.
 * Lines rendered via marching-squares-like approach on a noise field.
 */
export class TopologyMapElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'topology-map',
    meta: { shape: 'rectangular', roles: ['scanner', 'decorative'], moods: ['tactical', 'ambient'], bandAffinity: 'mid', sizes: ['needs-medium', 'needs-large'] },
  };
  private contourLines: THREE.LineSegments[] = [];
  private noiseField: number[] = [];
  private fieldW: number = 0;
  private fieldH: number = 0;
  private contourLevels: number = 0;
  private driftSpeed: number = 0;
  private borderLines!: THREE.LineSegments;

  build(): void {
    const variant = this.rng.int(0, 3);
    const presets = [
      { fieldRes: 24, contourMin: 5, contourMax: 8, driftMin: 0.3, driftMax: 0.8 },    // Standard
      { fieldRes: 40, contourMin: 10, contourMax: 15, driftMin: 0.6, driftMax: 1.5 },   // Dense
      { fieldRes: 14, contourMin: 3, contourMax: 4, driftMin: 0.1, driftMax: 0.3 },     // Minimal
      { fieldRes: 30, contourMin: 6, contourMax: 12, driftMin: 1.0, driftMax: 2.5 },    // Exotic (fast drift)
    ];
    const p = presets[variant];

    this.glitchAmount = 5;
    const { x, y, w, h } = this.px;
    this.fieldW = p.fieldRes;
    this.fieldH = Math.max(12, Math.round(p.fieldRes * (h / w)));
    this.contourLevels = this.rng.int(p.contourMin, p.contourMax);
    this.driftSpeed = this.rng.float(p.driftMin, p.driftMax);
    this.noiseField = new Array(this.fieldW * this.fieldH).fill(0);

    // Pre-allocate contour line objects
    for (let lv = 0; lv < this.contourLevels; lv++) {
      // Max segments per contour level
      const maxSegs = this.fieldW * this.fieldH * 2;
      const positions = new Float32Array(maxSegs * 3);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geo.setDrawRange(0, 0);
      const bright = lv / this.contourLevels;
      const color = new THREE.Color().lerpColors(this.palette.dim, this.palette.primary, bright);
      const mat = new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity: 0,
      });
      const line = new THREE.LineSegments(geo, mat);
      this.group.add(line);
      this.contourLines.push(line);
    }

    // Border
    const bv = new Float32Array([
      x, y, 0, x + w, y, 0,
      x + w, y, 0, x + w, y + h, 0,
      x + w, y + h, 0, x, y + h, 0,
      x, y + h, 0, x, y, 0,
    ]);
    const borderGeo = new THREE.BufferGeometry();
    borderGeo.setAttribute('position', new THREE.BufferAttribute(bv, 3));
    this.borderLines = new THREE.LineSegments(borderGeo, new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.borderLines);
  }

  private simplex2D(x: number, y: number): number {
    // Simple noise approximation using sin combinations
    return (
      Math.sin(x * 1.7 + y * 0.9) * 0.3 +
      Math.sin(x * 0.8 - y * 1.3) * 0.25 +
      Math.sin(x * 2.1 + y * 2.5) * 0.15 +
      Math.sin(x * 0.4 + y * 3.1) * 0.1 +
      Math.sin(x * 3.3 - y * 0.7) * 0.1
    ) * 0.5 + 0.5; // normalize to [0,1]
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);

    const { x: rx, y: ry, w, h } = this.px;
    const t = time * this.driftSpeed;

    // Update noise field
    for (let fy = 0; fy < this.fieldH; fy++) {
      for (let fx = 0; fx < this.fieldW; fx++) {
        this.noiseField[fy * this.fieldW + fx] = this.simplex2D(fx * 0.4 + t, fy * 0.4 + t * 0.7);
      }
    }

    const cellW = w / (this.fieldW - 1);
    const cellH = h / (this.fieldH - 1);

    // Generate contour lines using linear interpolation between grid cells
    for (let lv = 0; lv < this.contourLevels; lv++) {
      const threshold = (lv + 1) / (this.contourLevels + 1);
      const pos = this.contourLines[lv].geometry.getAttribute('position') as THREE.BufferAttribute;
      let vi = 0;

      for (let fy = 0; fy < this.fieldH - 1; fy++) {
        for (let fx = 0; fx < this.fieldW - 1; fx++) {
          const tl = this.noiseField[fy * this.fieldW + fx];
          const tr = this.noiseField[fy * this.fieldW + fx + 1];
          const bl = this.noiseField[(fy + 1) * this.fieldW + fx];
          const br = this.noiseField[(fy + 1) * this.fieldW + fx + 1];

          // Find edges where contour crosses
          const edges: [number, number][] = [];

          // Top edge
          if ((tl >= threshold) !== (tr >= threshold)) {
            const frac = (threshold - tl) / (tr - tl);
            edges.push([rx + (fx + frac) * cellW, ry + fy * cellH]);
          }
          // Bottom edge
          if ((bl >= threshold) !== (br >= threshold)) {
            const frac = (threshold - bl) / (br - bl);
            edges.push([rx + (fx + frac) * cellW, ry + (fy + 1) * cellH]);
          }
          // Left edge
          if ((tl >= threshold) !== (bl >= threshold)) {
            const frac = (threshold - tl) / (bl - tl);
            edges.push([rx + fx * cellW, ry + (fy + frac) * cellH]);
          }
          // Right edge
          if ((tr >= threshold) !== (br >= threshold)) {
            const frac = (threshold - tr) / (br - tr);
            edges.push([rx + (fx + 1) * cellW, ry + (fy + frac) * cellH]);
          }

          // Connect pairs of crossing points
          if (edges.length >= 2 && vi + 1 < pos.count) {
            pos.setXYZ(vi, edges[0][0], edges[0][1], 0);
            pos.setXYZ(vi + 1, edges[1][0], edges[1][1], 0);
            vi += 2;
          }
        }
      }

      pos.needsUpdate = true;
      this.contourLines[lv].geometry.setDrawRange(0, vi);
      (this.contourLines[lv].material as THREE.LineBasicMaterial).opacity = opacity * 0.7;
    }

    (this.borderLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.2;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      this.driftSpeed *= 3;
      setTimeout(() => { this.driftSpeed /= 3; }, 400);
    }
    if (action === 'alert') {
      for (const line of this.contourLines) {
        (line.material as THREE.LineBasicMaterial).color.copy(this.palette.alert);
      }
    }
  }
}
