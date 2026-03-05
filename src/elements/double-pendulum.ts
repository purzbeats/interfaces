import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Double pendulum with chaotic trajectory trace.
 * Two linked pendulum arms exhibit sensitive dependence on initial conditions,
 * tracing unpredictable paths that fill the display with luminous chaos.
 */
export class DoublePendulumElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'double-pendulum',
    meta: { shape: 'rectangular', roles: ['data-display', 'decorative'], moods: ['diagnostic', 'ambient'], bandAffinity: 'mid', sizes: ['needs-medium', 'needs-large'] },
  };

  private pendulumCount = 2;
  private theta1!: Float32Array;
  private theta2!: Float32Array;
  private omega1!: Float32Array;
  private omega2!: Float32Array;
  private L1 = 0; private L2 = 0;
  private g = 200;

  private armMeshes: THREE.Line[] = [];
  private armMats: THREE.LineBasicMaterial[] = [];
  private trailMeshes: THREE.Line[] = [];
  private trailMats: THREE.LineBasicMaterial[] = [];
  private bobMeshes: THREE.Points[] = [];

  private trailLen = 600;
  private trailX: Float32Array[] = [];
  private trailY: Float32Array[] = [];
  private trailHead = 0;
  private trailFilled = false;

  private cx = 0;
  private cy = 0;
  private pivotLines!: THREE.LineSegments;
  private pivotMat!: THREE.LineBasicMaterial;

  build(): void {
    const variant = this.rng.int(0, 3);
    const presets = [
      { count: 2, trail: 600, lenFrac: 0.18 },
      { count: 4, trail: 400, lenFrac: 0.14 },
      { count: 1, trail: 1000, lenFrac: 0.25 },
      { count: 3, trail: 500, lenFrac: 0.16 },
    ];
    const p = presets[variant];
    this.glitchAmount = 5;

    const { x, y, w, h } = this.px;
    this.cx = x + w / 2;
    this.cy = y + h * 0.3;
    this.L1 = Math.min(w, h) * p.lenFrac;
    this.L2 = this.L1 * this.rng.float(0.8, 1.2);
    this.pendulumCount = p.count;
    this.trailLen = p.trail;

    this.theta1 = new Float32Array(this.pendulumCount);
    this.theta2 = new Float32Array(this.pendulumCount);
    this.omega1 = new Float32Array(this.pendulumCount);
    this.omega2 = new Float32Array(this.pendulumCount);

    const colors = [this.palette.primary, this.palette.secondary, this.palette.dim,
      this.palette.primary.clone().lerp(this.palette.secondary, 0.5)];

    for (let i = 0; i < this.pendulumCount; i++) {
      // Slightly different initial angles for chaos divergence
      this.theta1[i] = Math.PI * this.rng.float(0.5, 0.95);
      this.theta2[i] = Math.PI * this.rng.float(0.5, 0.95) + i * 0.001;
      this.omega1[i] = 0;
      this.omega2[i] = 0;

      // Arm
      const armPos = new Float32Array(9); // 3 points
      const armGeo = new THREE.BufferGeometry();
      armGeo.setAttribute('position', new THREE.BufferAttribute(armPos, 3));
      const armMat = new THREE.LineBasicMaterial({ color: colors[i % colors.length], transparent: true, opacity: 0 });
      const arm = new THREE.Line(armGeo, armMat);
      this.armMeshes.push(arm);
      this.armMats.push(armMat);
      this.group.add(arm);

      // Trail
      const trailPos = new Float32Array(this.trailLen * 3);
      const trailGeo = new THREE.BufferGeometry();
      trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPos, 3));
      trailGeo.setDrawRange(0, 0);
      const trailMat = new THREE.LineBasicMaterial({ color: colors[i % colors.length], transparent: true, opacity: 0 });
      const trail = new THREE.Line(trailGeo, trailMat);
      this.trailMeshes.push(trail);
      this.trailMats.push(trailMat);
      this.group.add(trail);

      this.trailX.push(new Float32Array(this.trailLen));
      this.trailY.push(new Float32Array(this.trailLen));

      // Bob points
      const bobPos = new Float32Array(6); // 2 bobs
      const bobGeo = new THREE.BufferGeometry();
      bobGeo.setAttribute('position', new THREE.BufferAttribute(bobPos, 3));
      const bob = new THREE.Points(bobGeo, new THREE.PointsMaterial({
        color: colors[i % colors.length], transparent: true, opacity: 0, size: Math.max(1, Math.min(w, h) * 0.013), sizeAttenuation: false,
      }));
      this.bobMeshes.push(bob);
      this.group.add(bob);
    }

    // Pivot crosshair
    const pv = new Float32Array([
      this.cx - 6, this.cy, -0.5, this.cx + 6, this.cy, -0.5,
      this.cx, this.cy - 6, -0.5, this.cx, this.cy + 6, -0.5,
    ]);
    const pg2 = new THREE.BufferGeometry();
    pg2.setAttribute('position', new THREE.BufferAttribute(pv, 3));
    this.pivotMat = new THREE.LineBasicMaterial({ color: this.palette.dim, transparent: true, opacity: 0 });
    this.pivotLines = new THREE.LineSegments(pg2, this.pivotMat);
    this.group.add(this.pivotLines);
  }

  private integrate(idx: number, dt: number): void {
    const t1 = this.theta1[idx], t2 = this.theta2[idx];
    const w1 = this.omega1[idx], w2 = this.omega2[idx];
    const g = this.g;
    const l1 = this.L1, l2 = this.L2;
    const m1 = 1, m2 = 1;

    const dt2 = t1 - t2;
    const sinDt = Math.sin(dt2);
    const cosDt = Math.cos(dt2);
    const denom1 = (2 * m1 + m2 - m2 * Math.cos(2 * dt2));

    const alpha1 = (-g * (2 * m1 + m2) * Math.sin(t1) - m2 * g * Math.sin(t1 - 2 * t2) -
      2 * sinDt * m2 * (w2 * w2 * l2 + w1 * w1 * l1 * cosDt)) / (l1 * denom1);

    const alpha2 = (2 * sinDt * (w1 * w1 * l1 * (m1 + m2) + g * (m1 + m2) * Math.cos(t1) +
      w2 * w2 * l2 * m2 * cosDt)) / (l2 * denom1);

    this.omega1[idx] += alpha1 * dt;
    this.omega2[idx] += alpha2 * dt;
    this.theta1[idx] += this.omega1[idx] * dt;
    this.theta2[idx] += this.omega2[idx] * dt;

    // Damping
    this.omega1[idx] *= 0.9999;
    this.omega2[idx] *= 0.9999;
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);
    const substeps = Math.max(1, Math.min(8, Math.round(dt / 0.002)));
    const subDt = dt / substeps;

    for (let i = 0; i < this.pendulumCount; i++) {
      for (let s = 0; s < substeps; s++) this.integrate(i, subDt);

      const x1 = this.cx + this.L1 * Math.sin(this.theta1[i]);
      const y1 = this.cy + this.L1 * Math.cos(this.theta1[i]);
      const x2 = x1 + this.L2 * Math.sin(this.theta2[i]);
      const y2 = y1 + this.L2 * Math.cos(this.theta2[i]);

      // Arm
      const apos = this.armMeshes[i].geometry.getAttribute('position') as THREE.BufferAttribute;
      apos.setXYZ(0, this.cx, this.cy, 0.5);
      apos.setXYZ(1, x1, y1, 0.5);
      apos.setXYZ(2, x2, y2, 0.5);
      apos.needsUpdate = true;

      // Bobs
      const bpos = this.bobMeshes[i].geometry.getAttribute('position') as THREE.BufferAttribute;
      bpos.setXYZ(0, x1, y1, 1);
      bpos.setXYZ(1, x2, y2, 1);
      bpos.needsUpdate = true;

      // Trail (tip of second bob)
      this.trailX[i][this.trailHead] = x2;
      this.trailY[i][this.trailHead] = y2;
    }

    this.trailHead = (this.trailHead + 1) % this.trailLen;
    if (this.trailHead === 0) this.trailFilled = true;

    // Update trails
    const count = this.trailFilled ? this.trailLen : this.trailHead;
    for (let i = 0; i < this.pendulumCount; i++) {
      const tpos = this.trailMeshes[i].geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let t = 0; t < count; t++) {
        const ri = (this.trailHead - count + t + this.trailLen) % this.trailLen;
        tpos.setXYZ(t, this.trailX[i][ri], this.trailY[i][ri], 0);
      }
      tpos.needsUpdate = true;
      this.trailMeshes[i].geometry.setDrawRange(0, count);
      this.trailMats[i].opacity = opacity * 0.5;
      this.armMats[i].opacity = opacity * 0.7;
      (this.bobMeshes[i].material as THREE.PointsMaterial).opacity = opacity;
    }

    this.pivotMat.opacity = opacity * 0.3;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      for (let i = 0; i < this.pendulumCount; i++) {
        this.omega1[i] += (this.rng.next() - 0.5) * 10;
        this.omega2[i] += (this.rng.next() - 0.5) * 10;
      }
    }
    if (action === 'alert') {
      for (let i = 0; i < this.pendulumCount; i++) {
        this.theta1[i] = Math.PI * this.rng.float(0.5, 0.95);
        this.theta2[i] = Math.PI * this.rng.float(0.5, 0.95);
        this.omega1[i] = 0;
        this.omega2[i] = 0;
      }
      this.trailFilled = false;
      this.trailHead = 0;
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level >= 3) this.g = 400;
    if (level >= 5) {
      for (let i = 0; i < this.pendulumCount; i++) {
        this.omega1[i] += 15;
        this.omega2[i] -= 15;
      }
    }
  }
}
