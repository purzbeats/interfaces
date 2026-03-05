import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Rhodonea / rose curves: r = cos(k * theta). Different rational k = p/q
 * values produce different petal counts. Animates k morphing between values.
 * Line geometry with smooth transitions.
 */
export class RoseCurveElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'rose-curve',
    meta: {
      shape: 'radial',
      roles: ['decorative'],
      moods: ['ambient', 'diagnostic'],
      bandAffinity: 'mid',
      sizes: ['needs-medium', 'needs-large'],
    },
  };

  private line!: THREE.Line;
  private lineMat!: THREE.LineBasicMaterial;
  private trailLine!: THREE.Line;
  private trailMat!: THREE.LineBasicMaterial;
  private positions!: Float32Array;
  private trailPositions!: Float32Array;

  private cx = 0;
  private cy = 0;
  private maxRadius = 0;
  private pointCount = 0;
  private morphSpeed = 0;
  private rotSpeed = 0;

  // k values to morph between (as p/q pairs)
  private kValues: number[] = [];
  private kIndex = 0;
  private morphProgress = 0;

  build(): void {
    this.glitchAmount = 4;
    const variant = this.rng.int(0, 3);
    const { x, y, w, h } = this.px;

    this.cx = x + w / 2;
    this.cy = y + h / 2;
    this.maxRadius = Math.min(w, h) * 0.42;

    const presets = [
      { points: 600, morph: 0.3,  rot: 0.1,  ks: [2, 3, 5, 7] },
      { points: 800, morph: 0.2,  rot: 0.05, ks: [3/2, 5/3, 7/4, 2] },
      { points: 500, morph: 0.4,  rot: 0.15, ks: [4, 5, 6, 8] },
      { points: 700, morph: 0.15, rot: 0.08, ks: [2/3, 4/3, 5/2, 7/3] },
    ];
    const p = presets[variant];

    this.pointCount = p.points;
    this.morphSpeed = p.morph;
    this.rotSpeed = p.rot;
    this.kValues = p.ks;
    this.kIndex = 0;
    this.morphProgress = 0;

    // Main rose curve
    this.positions = new Float32Array(this.pointCount * 3);
    for (let i = 0; i < this.pointCount; i++) {
      this.positions[i * 3 + 2] = 0;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.lineMat = new THREE.LineBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
    });
    this.line = new THREE.Line(geo, this.lineMat);
    this.group.add(this.line);

    // Trail / ghost of previous shape
    this.trailPositions = new Float32Array(this.pointCount * 3);
    for (let i = 0; i < this.pointCount; i++) {
      this.trailPositions[i * 3 + 2] = 0;
    }
    const trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute('position', new THREE.BufferAttribute(this.trailPositions, 3));
    this.trailMat = new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    });
    this.trailLine = new THREE.Line(trailGeo, this.trailMat);
    this.group.add(this.trailLine);
  }

  private computeRose(k: number, rotation: number, buf: Float32Array): void {
    // For rational k = p/q, the curve closes after q*pi radians
    // Use enough theta range to close the curve
    const thetaMax = Math.PI * 2 * Math.ceil(k + 1);

    for (let i = 0; i < this.pointCount; i++) {
      const theta = (i / (this.pointCount - 1)) * thetaMax + rotation;
      const r = this.maxRadius * Math.cos(k * theta);
      buf[i * 3] = this.cx + r * Math.cos(theta);
      buf[i * 3 + 1] = this.cy + r * Math.sin(theta);
      buf[i * 3 + 2] = 0;
    }
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);

    // Advance morph
    this.morphProgress += dt * this.morphSpeed;
    if (this.morphProgress >= 1) {
      this.morphProgress -= 1;
      this.kIndex = (this.kIndex + 1) % this.kValues.length;
    }

    const kA = this.kValues[this.kIndex];
    const kB = this.kValues[(this.kIndex + 1) % this.kValues.length];

    // Smooth interpolation using smoothstep
    const t = this.morphProgress;
    const smooth = t * t * (3 - 2 * t);
    const kCurrent = kA + (kB - kA) * smooth;

    const rotation = time * this.rotSpeed;

    // Compute current rose
    this.computeRose(kCurrent, rotation, this.positions);
    (this.line.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    this.lineMat.opacity = opacity * 0.8;

    // Trail: previous k value
    this.computeRose(kA, rotation * 0.95, this.trailPositions);
    (this.trailLine.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    this.trailMat.opacity = opacity * 0.2 * (1 - smooth);
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Jump to a random k index
      this.kIndex = this.rng.int(0, this.kValues.length - 1);
      this.morphProgress = 0;
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) {
      this.morphSpeed = 0.3;
      this.rotSpeed = 0.1;
      return;
    }
    this.morphSpeed = 0.3 + level * 0.1;
    this.rotSpeed = 0.1 + level * 0.04;
  }
}
