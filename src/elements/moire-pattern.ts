import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Moiré interference pattern — two overlapping sets of parallel lines
 * drawn at slightly different angles. One set slowly rotates relative to the
 * other, producing a classic moiré shimmer.
 *
 * Variants:
 *   0 - Straight lines (both sets)
 *   1 - Circular rings (concentric) — one set slightly elliptical
 *   2 - Grid (both horizontal and vertical lines, two overlapping grids)
 *   3 - Dense (many fine lines, faster rotation)
 */

export class MoirePatternElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'moire-pattern',
    meta: {
      shape: 'rectangular',
      roles: ['decorative'],
      moods: ['ambient', 'tactical'],
      sizes: ['needs-medium', 'needs-large'],
      bandAffinity: 'mid',
      audioSensitivity: 0.8,
    },
  };

  // Two line-set groups, each a LineSegments object
  private setA!: THREE.LineSegments;
  private setB!: THREE.LineSegments;
  private setA2!: THREE.LineSegments; // grid variant second axis
  private setB2!: THREE.LineSegments; // grid variant second axis
  private matA!: THREE.LineBasicMaterial;
  private matB!: THREE.LineBasicMaterial;
  private matA2!: THREE.LineBasicMaterial;
  private matB2!: THREE.LineBasicMaterial;
  private borderMat!: THREE.LineBasicMaterial;

  private variant: number = 0;
  private numLines: number = 0;
  private lineSpacing: number = 0;
  private baseAngleA: number = 0;
  private baseAngleB: number = 0;
  private rotationSpeed: number = 0;
  private intensityLevel: number = 0;
  private baseRotSpeed: number = 0;

  // For circular variant: ring radii
  private ringRadii: number[] = [];

  build(): void {
    this.variant = this.rng.int(0, 3);
    const { x, y, w, h } = this.px;

    const presets = [
      { numLines: 30, spacingRatio: 0.04, rotSpeedMin: 0.08, rotSpeedMax: 0.18, angleA: 0,          angleB: Math.PI / 12 },   // lines
      { numLines: 18, spacingRatio: 0.06, rotSpeedMin: 0.05, rotSpeedMax: 0.12, angleA: 0,          angleB: 0               }, // circles
      { numLines: 20, spacingRatio: 0.055, rotSpeedMin: 0.04, rotSpeedMax: 0.10, angleA: Math.PI/4, angleB: Math.PI / 4 + Math.PI / 18 }, // grid
      { numLines: 55, spacingRatio: 0.022, rotSpeedMin: 0.15, rotSpeedMax: 0.35, angleA: 0,         angleB: Math.PI / 20 },   // dense
    ];
    const pr = presets[this.variant];

    this.numLines = pr.numLines;
    this.lineSpacing = Math.min(w, h) * pr.spacingRatio;
    this.baseAngleA = pr.angleA;
    this.baseAngleB = pr.angleB;
    this.baseRotSpeed = this.rng.float(pr.rotSpeedMin, pr.rotSpeedMax);
    this.rotationSpeed = this.baseRotSpeed;

    const cx = x + w * 0.5;
    const cy = y + h * 0.5;
    const diagonal = Math.sqrt(w * w + h * h);
    const halfDiag = diagonal * 0.5 + 4;

    const clipPlanes = [
      new THREE.Plane(new THREE.Vector3(1, 0, 0), -x),       // left
      new THREE.Plane(new THREE.Vector3(-1, 0, 0), x + w),   // right
      new THREE.Plane(new THREE.Vector3(0, 1, 0), -y),       // bottom
      new THREE.Plane(new THREE.Vector3(0, -1, 0), y + h),   // top
    ];

    const makeLineSet = (angle: number): Float32Array => {
      const verts: number[] = [];
      const halfCount = Math.ceil(halfDiag / this.lineSpacing) + 2;
      for (let i = -halfCount; i <= halfCount; i++) {
        const perp = i * this.lineSpacing;
        // Direction perpendicular to angle
        const perpX = Math.cos(angle + Math.PI / 2) * perp;
        const perpY = Math.sin(angle + Math.PI / 2) * perp;
        // Line extends along angle direction
        const dx = Math.cos(angle) * halfDiag;
        const dy = Math.sin(angle) * halfDiag;
        verts.push(
          cx + perpX - dx, cy + perpY - dy, 0,
          cx + perpX + dx, cy + perpY + dy, 0,
        );
      }
      return new Float32Array(verts);
    };

    const makeCircleSet = (scale: number): Float32Array => {
      const verts: number[] = [];
      const maxR = halfDiag;
      const resolution = 64;
      let r = this.lineSpacing;
      this.ringRadii = [];
      while (r < maxR) {
        this.ringRadii.push(r);
        for (let i = 0; i < resolution; i++) {
          const a1 = (i / resolution) * Math.PI * 2;
          const a2 = ((i + 1) / resolution) * Math.PI * 2;
          verts.push(
            cx + Math.cos(a1) * r, cy + Math.sin(a1) * r * scale, 0,
            cx + Math.cos(a2) * r, cy + Math.sin(a2) * r * scale, 0,
          );
        }
        r += this.lineSpacing;
      }
      return new Float32Array(verts);
    };

    const makeMat = (color: THREE.Color, opacity: number): THREE.LineBasicMaterial =>
      new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false, clippingPlanes: clipPlanes });

    if (this.variant === 1) {
      // Circular rings: set A = circles, set B = slightly elliptical
      const vertsA = makeCircleSet(1.0);
      const geoA = new THREE.BufferGeometry();
      geoA.setAttribute('position', new THREE.BufferAttribute(vertsA, 3));
      this.matA = makeMat(this.palette.primary, 0);
      this.setA = new THREE.LineSegments(geoA, this.matA);
      this.group.add(this.setA);

      const vertsB = makeCircleSet(0.88);
      const geoB = new THREE.BufferGeometry();
      geoB.setAttribute('position', new THREE.BufferAttribute(vertsB, 3));
      this.matB = makeMat(this.palette.secondary, 0);
      this.setB = new THREE.LineSegments(geoB, this.matB);
      this.group.add(this.setB);
    } else if (this.variant === 2) {
      // Grid: A = horizontal+vertical at angle, B = same at slightly different angle
      const makeGridSet = (angle: number): Float32Array => {
        const h1 = makeLineSet(angle);
        const h2 = makeLineSet(angle + Math.PI / 2);
        const combined = new Float32Array(h1.length + h2.length);
        combined.set(h1, 0);
        combined.set(h2, h1.length);
        return combined;
      };
      const vertsA = makeGridSet(0);
      const geoA = new THREE.BufferGeometry();
      geoA.setAttribute('position', new THREE.BufferAttribute(vertsA, 3));
      this.matA = makeMat(this.palette.primary, 0);
      this.setA = new THREE.LineSegments(geoA, this.matA);
      this.group.add(this.setA);

      const vertsB = makeGridSet(Math.PI / 18); // 10 degrees offset
      const geoB = new THREE.BufferGeometry();
      geoB.setAttribute('position', new THREE.BufferAttribute(vertsB, 3));
      this.matB = makeMat(this.palette.secondary, 0);
      this.setB = new THREE.LineSegments(geoB, this.matB);
      this.group.add(this.setB);
    } else {
      // Lines (variants 0 and 3)
      const vertsA = makeLineSet(this.baseAngleA);
      const geoA = new THREE.BufferGeometry();
      geoA.setAttribute('position', new THREE.BufferAttribute(vertsA, 3));
      this.matA = makeMat(this.palette.primary, 0);
      this.setA = new THREE.LineSegments(geoA, this.matA);
      this.group.add(this.setA);

      const vertsB = makeLineSet(this.baseAngleB);
      const geoB = new THREE.BufferGeometry();
      geoB.setAttribute('position', new THREE.BufferAttribute(vertsB, 3));
      this.matB = makeMat(this.palette.secondary, 0);
      this.setB = new THREE.LineSegments(geoB, this.matB);
      this.group.add(this.setB);
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
    this.borderMat = new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
      clippingPlanes: clipPlanes,
    });
    this.group.add(new THREE.LineSegments(borderGeo, this.borderMat));
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    const { x, y, w, h } = this.px;
    const cx = x + w * 0.5;
    const cy = y + h * 0.5;

    // Moiré shimmer: slightly vary opacity with the interference pattern phase
    const shimmerPhase = Math.sin(time * this.rotationSpeed * 3.5) * 0.5 + 0.5;
    const baseOpA = opacity * (0.5 + shimmerPhase * 0.25);
    const baseOpB = opacity * (0.5 + (1 - shimmerPhase) * 0.25);

    if (this.variant === 1) {
      // Circular: rotate the elliptical set around the centre
      this.setB.rotation.z = time * this.rotationSpeed;
      this.matA.opacity = baseOpA * 0.7;
      this.matB.opacity = baseOpB * 0.55;
    } else if (this.variant === 2) {
      // Grid: rotate the second grid set
      this.setA.rotation.z = 0;
      this.setB.rotation.z = time * this.rotationSpeed;
      this.matA.opacity = baseOpA * 0.55;
      this.matB.opacity = baseOpB * 0.45;
    } else {
      // Lines: rotate set B continuously
      this.setA.rotation.z = this.baseAngleA;
      this.setB.rotation.z = this.baseAngleB + time * this.rotationSpeed;
      // Keep pivot at centre
      this.setA.position.set(cx, cy, 0);
      this.setB.position.set(cx, cy, 0);
      this.matA.opacity = baseOpA * 0.65;
      this.matB.opacity = baseOpB * 0.55;
    }

    this.borderMat.opacity = opacity * 0.3;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      const savedSpeed = this.rotationSpeed;
      this.rotationSpeed = savedSpeed * 8;
      setTimeout(() => { this.rotationSpeed = savedSpeed; }, 400);
    }
    if (action === 'alert') {
      this.matA.color.copy(this.palette.alert);
      this.matB.color.copy(this.palette.alert);
      setTimeout(() => {
        this.matA.color.copy(this.palette.primary);
        this.matB.color.copy(this.palette.secondary);
      }, 2000);
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    this.intensityLevel = level;
    if (level === 0) {
      this.rotationSpeed = this.baseRotSpeed;
      return;
    }
    this.rotationSpeed = this.baseRotSpeed * (1 + level * 0.5);
    if (level >= 4) {
      this.matA.color.copy(this.palette.alert);
      this.matB.color.copy(this.palette.secondary);
    } else {
      this.matA.color.copy(this.palette.primary);
      this.matB.color.copy(this.palette.secondary);
    }
  }
}
