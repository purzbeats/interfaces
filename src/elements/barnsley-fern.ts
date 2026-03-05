import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Barnsley fern IFS fractal built point-by-point with the classic 4-transform
 * system. Points accumulate into the fern shape. Wind and parameter
 * variations create different fern species.
 */
export class BarnsleyFernElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'barnsley-fern',
    meta: {
      shape: 'rectangular',
      roles: ['decorative', 'data-display'],
      moods: ['ambient'],
      bandAffinity: 'bass',
      sizes: ['works-small', 'needs-medium', 'needs-large'],
    },
  };

  private pointsMesh!: THREE.Points;
  private borderLines!: THREE.LineSegments;

  private curX: number = 0;
  private curY: number = 0;
  private pointCount: number = 0;
  private maxPoints: number = 30000;
  private addRate: number = 200;
  private intensityLevel: number = 0;

  // IFS transform coefficients
  private transforms: { a: number; b: number; c: number; d: number; e: number; f: number; p: number }[] = [];

  // Mapping from fern coords to pixel coords
  private scaleX: number = 1;
  private scaleY: number = 1;
  private offsetX: number = 0;
  private offsetY: number = 0;

  build(): void {
    const variant = this.rng.int(0, 3);
    const presets = [
      { // Classic Barnsley fern
        transforms: [
          { a: 0, b: 0, c: 0, d: 0.16, e: 0, f: 0, p: 0.01 },
          { a: 0.85, b: 0.04, c: -0.04, d: 0.85, e: 0, f: 1.6, p: 0.85 },
          { a: 0.2, b: -0.26, c: 0.23, d: 0.22, e: 0, f: 1.6, p: 0.07 },
          { a: -0.15, b: 0.28, c: 0.26, d: 0.24, e: 0, f: 0.44, p: 0.07 },
        ],
        maxPts: 30000, rate: 200,
      },
      { // Thelypteridaceae fern
        transforms: [
          { a: 0, b: 0, c: 0, d: 0.25, e: 0, f: -0.14, p: 0.02 },
          { a: 0.85, b: 0.02, c: -0.02, d: 0.83, e: 0, f: 1.0, p: 0.84 },
          { a: 0.09, b: -0.28, c: 0.3, d: 0.11, e: 0, f: 0.6, p: 0.07 },
          { a: -0.09, b: 0.28, c: 0.3, d: 0.09, e: 0, f: 0.7, p: 0.07 },
        ],
        maxPts: 25000, rate: 180,
      },
      { // Culcita fern
        transforms: [
          { a: 0, b: 0, c: 0, d: 0.25, e: 0, f: -0.4, p: 0.02 },
          { a: 0.95, b: 0.005, c: -0.005, d: 0.93, e: -0.002, f: 0.5, p: 0.84 },
          { a: 0.035, b: -0.2, c: 0.16, d: 0.04, e: -0.09, f: 0.02, p: 0.07 },
          { a: -0.04, b: 0.2, c: 0.16, d: 0.04, e: 0.083, f: 0.12, p: 0.07 },
        ],
        maxPts: 28000, rate: 160,
      },
      { // Fishbone fern
        transforms: [
          { a: 0, b: 0, c: 0, d: 0.2, e: 0, f: -0.12, p: 0.01 },
          { a: 0.845, b: 0.035, c: -0.035, d: 0.82, e: 0, f: 1.6, p: 0.85 },
          { a: 0.3, b: -0.32, c: 0.28, d: 0.26, e: 0, f: 0.44, p: 0.07 },
          { a: -0.3, b: 0.32, c: 0.28, d: 0.26, e: 0, f: 0.44, p: 0.07 },
        ],
        maxPts: 32000, rate: 220,
      },
    ];
    const p = presets[variant];

    this.transforms = p.transforms;
    this.maxPoints = p.maxPts;
    this.addRate = p.rate;
    this.pointCount = 0;
    this.curX = 0;
    this.curY = 0;
    this.glitchAmount = 4;

    const { x, y, w, h } = this.px;

    // Fern coordinates roughly span x: [-2.5, 2.5], y: [0, 10]
    this.scaleX = w / 6;
    this.scaleY = h / 11;
    this.offsetX = x + w / 2;
    this.offsetY = y + h - 5;

    // Points mesh
    const positions = new Float32Array(this.maxPoints * 3);
    const colors = new Float32Array(this.maxPoints * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setDrawRange(0, 0);

    this.pointsMesh = new THREE.Points(geo, new THREE.PointsMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0,
      size: 1.0,
      sizeAttenuation: false,
    }));
    this.group.add(this.pointsMesh);

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

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);

    const rate = this.addRate + this.intensityLevel * 100;
    const pos = this.pointsMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const col = this.pointsMesh.geometry.getAttribute('color') as THREE.BufferAttribute;

    const pr = this.palette.primary;
    const sr = this.palette.secondary;
    const dm = this.palette.dim;

    for (let i = 0; i < rate && this.pointCount < this.maxPoints; i++) {
      // Pick a transform based on probability
      const r = this.rng.next();
      let cumP = 0;
      let ti = 0;
      for (let j = 0; j < this.transforms.length; j++) {
        cumP += this.transforms[j].p;
        if (r <= cumP) { ti = j; break; }
      }

      const t = this.transforms[ti];
      const nx = t.a * this.curX + t.b * this.curY + t.e;
      const ny = t.c * this.curX + t.d * this.curY + t.f;
      this.curX = nx;
      this.curY = ny;

      // Map to pixel coords
      const px = this.offsetX + this.curX * this.scaleX;
      const py = this.offsetY - this.curY * this.scaleY;

      const idx = this.pointCount;
      pos.setXYZ(idx, px, py, 0.2);

      // Color by height (y coord normalized)
      const ht = Math.min(1, this.curY / 10);
      col.setXYZ(idx,
        dm.r + (pr.r - dm.r) * ht,
        dm.g + (pr.g - dm.g) * ht,
        dm.b + (pr.b - dm.b) * ht,
      );

      this.pointCount++;
    }

    if (this.pointCount >= this.maxPoints) {
      this.pointCount = 0;
      this.curX = 0;
      this.curY = 0;
    }

    pos.needsUpdate = true;
    col.needsUpdate = true;
    this.pointsMesh.geometry.setDrawRange(0, this.pointCount);

    (this.pointsMesh.material as THREE.PointsMaterial).opacity = opacity * 0.8;
    (this.borderLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.2;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Perturb transform coefficients
      for (const t of this.transforms) {
        t.a += this.rng.float(-0.02, 0.02);
        t.d += this.rng.float(-0.02, 0.02);
      }
    }
    if (action === 'pulse') {
      this.pointCount = 0;
      this.pointsMesh.geometry.setDrawRange(0, 0);
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    this.intensityLevel = level;
  }
}
