import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Sliding bead abacus rows.
 * 3-5 horizontal wires with small circle beads that cluster left or right,
 * shifting periodically.
 */
export class AbacusRowElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'abacus-row',
    meta: {
      shape: 'linear',
      roles: ['data-display', 'decorative'],
      moods: ['ambient'],
      sizes: ['works-small', 'needs-medium'],
    },
  };

  private wireLines!: THREE.LineSegments;
  private beadMeshes: THREE.Mesh[][] = [];
  private wireCount = 0;
  private beadsPerWire: number[] = [];
  /** Target position (0 = all left, 1 = all right) per wire */
  private wireTargets: number[] = [];
  /** Current lerped position per wire */
  private wirePositions: number[] = [];
  private shiftTimer = 0;
  private shiftInterval = 2.0;

  // Layout cache
  private wireStartX = 0;
  private wireEndX = 0;
  private wireYs: number[] = [];
  private beadRadius = 0;

  build(): void {
    const { x, y, w, h } = this.px;

    this.wireCount = w > 100 ? 5 : h > 50 ? 4 : 3;
    this.shiftInterval = this.rng.float(1.5, 4.0);

    const padding = w * 0.06;
    this.wireStartX = x + padding;
    this.wireEndX = x + w - padding;
    const wireLen = this.wireEndX - this.wireStartX;

    const vPadding = h * 0.12;
    const wireSpacing = this.wireCount > 1 ? (h - vPadding * 2) / (this.wireCount - 1) : 0;

    this.beadRadius = Math.min(wireSpacing * 0.2, wireLen * 0.02, 5);
    if (this.beadRadius < 1.5) this.beadRadius = 1.5;

    // Build wire lines
    const wireVerts = new Float32Array(this.wireCount * 6);
    this.wireYs = [];
    for (let i = 0; i < this.wireCount; i++) {
      const wy = y + vPadding + wireSpacing * i;
      this.wireYs.push(wy);
      wireVerts.set([
        this.wireStartX, wy, 0,
        this.wireEndX, wy, 0,
      ], i * 6);
    }
    const wireGeo = new THREE.BufferGeometry();
    wireGeo.setAttribute('position', new THREE.BufferAttribute(wireVerts, 3));
    this.wireLines = new THREE.LineSegments(wireGeo, new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.wireLines);

    // Create beads per wire
    const beadCounts = [3, 5, 4, 2, 6];
    for (let i = 0; i < this.wireCount; i++) {
      const count = beadCounts[i % beadCounts.length] + this.rng.int(-1, 1);
      const clamped = Math.max(2, Math.min(6, count));
      this.beadsPerWire.push(clamped);

      const row: THREE.Mesh[] = [];
      for (let b = 0; b < clamped; b++) {
        const geo = new THREE.CircleGeometry(this.beadRadius, 10);
        const mat = new THREE.MeshBasicMaterial({
          color: this.palette.primary,
          transparent: true,
          opacity: 0,
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(this.wireStartX, this.wireYs[i], 1);
        row.push(mesh);
        this.group.add(mesh);
      }
      this.beadMeshes.push(row);

      // Initial random positions
      this.wireTargets.push(this.rng.float(0, 1) > 0.5 ? 1 : 0);
      this.wirePositions.push(this.wireTargets[i]);
    }
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);

    // Shift targets periodically
    this.shiftTimer += dt;
    if (this.shiftTimer >= this.shiftInterval) {
      this.shiftTimer = 0;
      // Pick a random wire to toggle
      const idx = this.rng.int(0, this.wireCount - 1);
      this.wireTargets[idx] = this.wireTargets[idx] > 0.5 ? 0 : 1;
    }

    // Lerp positions
    for (let i = 0; i < this.wireCount; i++) {
      this.wirePositions[i] += (this.wireTargets[i] - this.wirePositions[i]) * dt * 3.0;
    }

    // Wire opacity
    (this.wireLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.3;

    // Position beads
    const wireLen = this.wireEndX - this.wireStartX;
    const beadDiam = this.beadRadius * 2.4;

    for (let i = 0; i < this.wireCount; i++) {
      const count = this.beadsPerWire[i];
      const clusterWidth = count * beadDiam;
      const t = this.wirePositions[i]; // 0=left, 1=right

      // When t=0, beads cluster at left; t=1, cluster at right
      const clusterStart = this.wireStartX + t * (wireLen - clusterWidth);

      for (let b = 0; b < count; b++) {
        const bead = this.beadMeshes[i][b];
        const bx = clusterStart + beadDiam * 0.5 + b * beadDiam;
        bead.position.set(bx, this.wireYs[i], 1);
        (bead.material as THREE.MeshBasicMaterial).opacity = opacity * 0.75;
      }
    }
  }
}
