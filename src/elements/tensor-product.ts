import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Tensor product visualization as a grid of scaled vectors. Shows how two
 * vector spaces combine. Animated basis changes rotate the component vectors.
 * Each grid cell shows the outer product magnitude/direction.
 */
export class TensorProductElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'tensor-product',
    meta: { shape: 'rectangular', roles: ['data-display', 'decorative'], moods: ['diagnostic', 'ambient'], bandAffinity: 'mid', sizes: ['needs-medium', 'needs-large'] },
  };

  private arrowLine!: THREE.LineSegments;
  private arrowMat!: THREE.LineBasicMaterial;
  private positions!: Float32Array;
  private dimA: number = 0;
  private dimB: number = 0;
  private cellSize: number = 0;
  private originX: number = 0;
  private originY: number = 0;
  private basisSpeedA: number = 0;
  private basisSpeedB: number = 0;
  private vecA: number[] = [];
  private vecB: number[] = [];

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;

    const variant = this.rng.int(0, 3);
    const presets = [
      { dimA: 4, dimB: 4, cell: 0, speedA: 0.3, speedB: 0.2 },
      { dimA: 3, dimB: 5, cell: 0, speedA: 0.4, speedB: 0.15 },
      { dimA: 6, dimB: 6, cell: 0, speedA: 0.2, speedB: 0.25 },
      { dimA: 5, dimB: 3, cell: 0, speedA: 0.35, speedB: 0.3 },
    ];
    const pr = presets[variant];
    this.dimA = pr.dimA;
    this.dimB = pr.dimB;
    this.basisSpeedA = pr.speedA;
    this.basisSpeedB = pr.speedB;

    this.cellSize = Math.min(w / (this.dimA + 1), h / (this.dimB + 1));
    this.originX = x + (w - this.dimA * this.cellSize) / 2 + this.cellSize / 2;
    this.originY = y + (h - this.dimB * this.cellSize) / 2 + this.cellSize / 2;

    // Initialize basis vectors
    this.vecA = new Array(this.dimA).fill(0);
    this.vecB = new Array(this.dimB).fill(0);

    // Each tensor cell draws a line segment (arrow): 2 verts per cell
    const totalCells = this.dimA * this.dimB;
    this.positions = new Float32Array(totalCells * 6); // 2 verts * 3 coords
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));

    this.arrowMat = new THREE.LineBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
    });
    this.arrowLine = new THREE.LineSegments(geo, this.arrowMat);
    this.group.add(this.arrowLine);
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);

    // Animate basis vectors using rotating components
    for (let i = 0; i < this.dimA; i++) {
      this.vecA[i] = Math.sin(time * this.basisSpeedA * (i + 1) + i * 1.7);
    }
    for (let j = 0; j < this.dimB; j++) {
      this.vecB[j] = Math.cos(time * this.basisSpeedB * (j + 1) + j * 2.3);
    }

    // Compute tensor product: T[i][j] = vecA[i] * vecB[j]
    let idx = 0;
    const halfCell = this.cellSize * 0.4;

    for (let i = 0; i < this.dimA; i++) {
      for (let j = 0; j < this.dimB; j++) {
        const cx = this.originX + i * this.cellSize;
        const cy = this.originY + j * this.cellSize;
        const val = this.vecA[i] * this.vecB[j]; // range [-1, 1]

        // Vector direction encodes sign, length encodes magnitude
        const mag = Math.abs(val) * halfCell;
        const angle = val >= 0
          ? Math.atan2(this.vecB[j], this.vecA[i])
          : Math.atan2(-this.vecB[j], -this.vecA[i]);

        // Start point (center of cell)
        this.positions[idx++] = cx;
        this.positions[idx++] = cy;
        this.positions[idx++] = 0;
        // End point
        this.positions[idx++] = cx + Math.cos(angle) * mag;
        this.positions[idx++] = cy + Math.sin(angle) * mag;
        this.positions[idx++] = 0;
      }
    }

    (this.arrowLine.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    this.arrowMat.opacity = opacity * 0.8;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') this.glitchTimer = 0.5;
    if (action === 'alert') {
      this.basisSpeedA *= 2;
      this.basisSpeedB *= 2;
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level >= 3) {
      this.basisSpeedA += level * 0.05;
      this.basisSpeedB += level * 0.05;
    }
  }
}
