import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Grid of pendulums that swing with slightly different frequencies,
 * creating mesmerizing wave patterns as they go in and out of phase.
 */
export class PendulumGridElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'pendulum-grid',
    meta: {
      shape: 'rectangular',
      roles: ['decorative'],
      moods: ['ambient'],
      sizes: ['needs-medium', 'needs-large'],
    },
  };

  private strings!: THREE.LineSegments;
  private topBar!: THREE.LineSegments;
  private bobPoints!: THREE.Points;
  private bobMat!: THREE.PointsMaterial;

  private pendulumCount: number = 0;
  private cols: number = 0;
  private rows: number = 0;
  private frequencies!: Float32Array;
  private phases!: Float32Array;
  private pivotX!: Float32Array;
  private pivotY!: Float32Array;
  private stringLength!: Float32Array;
  private maxAngle: number = 0;
  private bobRadius: number = 0;

  build(): void {
    const { x, y, w, h } = this.px;

    // Choose grid size based on available space
    const aspect = w / h;
    if (aspect > 1.3) {
      this.cols = 4;
      this.rows = 3;
    } else if (aspect < 0.7) {
      this.cols = 3;
      this.rows = 4;
    } else {
      this.cols = 3;
      this.rows = 3;
    }

    this.pendulumCount = this.cols * this.rows;
    this.maxAngle = this.rng.float(0.5, 0.9);
    this.bobRadius = Math.min(w / this.cols, h / this.rows) * 0.08;

    this.frequencies = new Float32Array(this.pendulumCount);
    this.phases = new Float32Array(this.pendulumCount);
    this.pivotX = new Float32Array(this.pendulumCount);
    this.pivotY = new Float32Array(this.pendulumCount);
    this.stringLength = new Float32Array(this.pendulumCount);

    const cellW = w / this.cols;
    const cellH = h / this.rows;
    const barY = y + cellH * 0.15;

    // Assign pivot positions and slightly different frequencies
    const baseFreq = this.rng.float(1.5, 2.5);
    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        const idx = row * this.cols + col;
        this.pivotX[idx] = x + cellW * (col + 0.5);
        this.pivotY[idx] = barY + row * cellH;
        this.stringLength[idx] = cellH * 0.65;
        // Slightly different frequencies create wave interference
        this.frequencies[idx] = baseFreq + (col + row * this.cols) * 0.08;
        this.phases[idx] = this.rng.float(0, Math.PI * 2);
      }
    }

    // Top bar (horizontal lines across each row)
    const barVerts: number[] = [];
    for (let row = 0; row < this.rows; row++) {
      const by = barY + row * cellH;
      barVerts.push(
        x + cellW * 0.2, by, 0,
        x + w - cellW * 0.2, by, 0,
      );
    }
    const barGeo = new THREE.BufferGeometry();
    barGeo.setAttribute('position', new THREE.Float32BufferAttribute(barVerts, 3));
    this.topBar = new THREE.LineSegments(barGeo, new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.topBar);

    // Strings (one line segment per pendulum)
    const stringGeo = new THREE.BufferGeometry();
    stringGeo.setAttribute('position', new THREE.Float32BufferAttribute(
      new Float32Array(this.pendulumCount * 2 * 3), 3,
    ));
    this.strings = new THREE.LineSegments(stringGeo, new THREE.LineBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.strings);

    // Bobs (single Points mesh)
    const bobGeo = new THREE.BufferGeometry();
    bobGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.pendulumCount * 3), 3));
    this.bobMat = new THREE.PointsMaterial({
      color: this.palette.secondary,
      transparent: true,
      opacity: 0,
      size: Math.max(4, this.bobRadius * 2),
      sizeAttenuation: false,
    });
    this.bobPoints = new THREE.Points(bobGeo, this.bobMat);
    this.group.add(this.bobPoints);
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);

    const sPos = this.strings.geometry.getAttribute('position') as THREE.BufferAttribute;
    const bPos = this.bobPoints.geometry.getAttribute('position') as THREE.BufferAttribute;

    for (let i = 0; i < this.pendulumCount; i++) {
      const angle = Math.sin(time * this.frequencies[i] + this.phases[i]) * this.maxAngle;
      const bobX = this.pivotX[i] + Math.sin(angle) * this.stringLength[i];
      const bobY = this.pivotY[i] + Math.cos(angle) * this.stringLength[i];

      // String from pivot to bob
      sPos.setXYZ(i * 2, this.pivotX[i], this.pivotY[i], 0);
      sPos.setXYZ(i * 2 + 1, bobX, bobY, 0);

      // Bob position
      bPos.setXYZ(i, bobX, bobY, 1);
    }

    sPos.needsUpdate = true;
    bPos.needsUpdate = true;

    (this.topBar.material as THREE.LineBasicMaterial).opacity = opacity * 0.4;
    (this.strings.material as THREE.LineBasicMaterial).opacity = opacity * 0.65;
    this.bobMat.opacity = opacity * 0.75;
  }
}
