import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Cycloid traced by a point on a rolling circle. Shows the rolling circle,
 * the contact point on the baseline, and the traced curve. Animates rolling.
 * Presets: regular cycloid, curtate (point inside), prolate (point outside),
 * and epicycloid variant.
 */
export class CycloidTraceElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'cycloid-trace',
    meta: {
      shape: 'rectangular',
      roles: ['decorative', 'data-display'],
      moods: ['diagnostic', 'ambient'],
      bandAffinity: 'bass',
      sizes: ['needs-medium', 'needs-large'],
    },
  };

  private traceLine!: THREE.Line;
  private traceMat!: THREE.LineBasicMaterial;
  private circleLine!: THREE.Line;
  private circleMat!: THREE.LineBasicMaterial;
  private spokeLine!: THREE.LineSegments;
  private spokeMat!: THREE.LineBasicMaterial;
  private baseLine!: THREE.LineSegments;
  private baseMat!: THREE.LineBasicMaterial;

  private tracePositions!: Float32Array;
  private circlePositions!: Float32Array;
  private spokePositions!: Float32Array;

  private tracePoints = 0;
  private circleSegs = 48;
  private rollRadius = 0;
  private traceRadius = 0; // distance of tracing point from center
  private rollSpeed = 0;
  private baseY = 0;
  private startX = 0;
  private cycleLength = 0;

  build(): void {
    this.glitchAmount = 4;
    const variant = this.rng.int(0, 3);
    const { x, y, w, h } = this.px;

    // Presets: 0=regular, 1=curtate, 2=prolate, 3=epicycloid-like (larger trace arm)
    const presets = [
      { points: 400, rRatio: 1.0, speed: 0.6,  label: 'regular' },
      { points: 400, rRatio: 0.5, speed: 0.5,  label: 'curtate' },
      { points: 400, rRatio: 1.5, speed: 0.5,  label: 'prolate' },
      { points: 500, rRatio: 2.0, speed: 0.4,  label: 'extended' },
    ];
    const p = presets[variant];

    this.tracePoints = p.points;
    this.rollRadius = Math.min(w, h) * 0.12;
    this.traceRadius = this.rollRadius * p.rRatio;
    this.rollSpeed = p.speed;
    this.baseY = y + h * 0.65;
    this.startX = x;
    this.cycleLength = 2 * Math.PI * this.rollRadius;

    // Baseline
    const basePositions = new Float32Array([
      x, this.baseY, 0,
      x + w, this.baseY, 0,
    ]);
    const baseGeo = new THREE.BufferGeometry();
    baseGeo.setAttribute('position', new THREE.BufferAttribute(basePositions, 3));
    this.baseMat = new THREE.LineBasicMaterial({
      color: this.palette.dim, transparent: true, opacity: 0,
    });
    this.baseLine = new THREE.LineSegments(baseGeo, this.baseMat);
    this.group.add(this.baseLine);

    // Trace curve
    this.tracePositions = new Float32Array(this.tracePoints * 3);
    for (let i = 0; i < this.tracePoints * 3; i += 3) {
      this.tracePositions[i] = this.startX;
      this.tracePositions[i + 1] = this.baseY;
      this.tracePositions[i + 2] = 0;
    }
    const traceGeo = new THREE.BufferGeometry();
    traceGeo.setAttribute('position', new THREE.BufferAttribute(this.tracePositions, 3));
    this.traceMat = new THREE.LineBasicMaterial({
      color: this.palette.primary, transparent: true, opacity: 0,
    });
    this.traceLine = new THREE.Line(traceGeo, this.traceMat);
    this.group.add(this.traceLine);

    // Rolling circle
    this.circlePositions = new Float32Array((this.circleSegs + 1) * 3);
    for (let i = 0; i <= this.circleSegs; i++) {
      const a = (i / this.circleSegs) * Math.PI * 2;
      this.circlePositions[i * 3] = this.startX + Math.cos(a) * this.rollRadius;
      this.circlePositions[i * 3 + 1] = this.baseY - this.rollRadius + Math.sin(a) * this.rollRadius;
      this.circlePositions[i * 3 + 2] = 0;
    }
    const circleGeo = new THREE.BufferGeometry();
    circleGeo.setAttribute('position', new THREE.BufferAttribute(this.circlePositions, 3));
    this.circleMat = new THREE.LineBasicMaterial({
      color: this.palette.secondary, transparent: true, opacity: 0,
    });
    this.circleLine = new THREE.Line(circleGeo, this.circleMat);
    this.group.add(this.circleLine);

    // Spoke: center to tracing point, and center to contact point
    this.spokePositions = new Float32Array(12); // 2 lines * 2 points * 3
    for (let i = 0; i < 12; i++) this.spokePositions[i] = this.startX;
    const spokeGeo = new THREE.BufferGeometry();
    spokeGeo.setAttribute('position', new THREE.BufferAttribute(this.spokePositions, 3));
    this.spokeMat = new THREE.LineBasicMaterial({
      color: this.palette.secondary, transparent: true, opacity: 0,
    });
    this.spokeLine = new THREE.LineSegments(spokeGeo, this.spokeMat);
    this.group.add(this.spokeLine);
  }

  /** Cycloid position at parameter t (angle rolled) */
  private cycloidPoint(t: number): [number, number] {
    const cx = this.rollRadius * t;
    const px = cx - this.traceRadius * Math.sin(t);
    const py = this.rollRadius - this.traceRadius * Math.cos(t);
    return [px, py];
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    const { x, w } = this.px;

    // Current roll angle, wrapping across the width
    const totalAngle = time * this.rollSpeed * Math.PI * 2;
    const wrapAngle = totalAngle % (w / this.rollRadius);

    // Circle center position
    const ccx = x + this.rollRadius * wrapAngle;
    const ccy = this.baseY - this.rollRadius;

    // Update rolling circle
    for (let i = 0; i <= this.circleSegs; i++) {
      const a = (i / this.circleSegs) * Math.PI * 2;
      this.circlePositions[i * 3] = ccx + Math.cos(a) * this.rollRadius;
      this.circlePositions[i * 3 + 1] = ccy + Math.sin(a) * this.rollRadius;
      this.circlePositions[i * 3 + 2] = 0;
    }
    (this.circleLine.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    this.circleMat.opacity = opacity * 0.45;

    // Update trace curve: draw from t=0 to t=wrapAngle
    const maxAngle = Math.min(wrapAngle, w / this.rollRadius);
    for (let i = 0; i < this.tracePoints; i++) {
      const t = (i / (this.tracePoints - 1)) * maxAngle;
      const [px, py] = this.cycloidPoint(t);
      this.tracePositions[i * 3] = x + px;
      this.tracePositions[i * 3 + 1] = this.baseY - py;
      this.tracePositions[i * 3 + 2] = 0;
    }
    (this.traceLine.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    this.traceMat.opacity = opacity * 0.8;

    // Update spokes
    // Line 1: center to tracing point
    const traceAngle = -wrapAngle;
    const tpx = ccx + this.traceRadius * Math.sin(-traceAngle);
    const tpy = ccy - this.traceRadius * Math.cos(-traceAngle) + this.rollRadius;
    const [cpx, cpy] = this.cycloidPoint(wrapAngle);
    this.spokePositions[0] = ccx;
    this.spokePositions[1] = ccy;
    this.spokePositions[2] = 0;
    this.spokePositions[3] = x + cpx;
    this.spokePositions[4] = this.baseY - cpy;
    this.spokePositions[5] = 0;
    // Line 2: center to contact point on baseline
    this.spokePositions[6] = ccx;
    this.spokePositions[7] = ccy;
    this.spokePositions[8] = 0;
    this.spokePositions[9] = ccx;
    this.spokePositions[10] = this.baseY;
    this.spokePositions[11] = 0;
    (this.spokeLine.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    this.spokeMat.opacity = opacity * 0.35;

    this.baseMat.opacity = opacity * 0.25;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Temporarily change trace ratio
      const saved = this.traceRadius;
      this.traceRadius = this.rollRadius * (0.5 + this.rng.float(0, 2));
      setTimeout(() => { this.traceRadius = saved; }, 600);
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) {
      this.rollSpeed = 0.6;
      return;
    }
    this.rollSpeed = 0.6 + level * 0.15;
  }
}
