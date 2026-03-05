import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * 3D harmonograph: 3 damped pendulums combine to trace decaying 3D
 * Lissajous patterns projected to 2D. The curve draws progressively
 * and resets with new parameters, producing unique rosette patterns.
 * A fading trail and dot marker show the current drawing point.
 */
export class Harmonograph3dElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'harmonograph-3d',
    meta: {
      shape: 'radial',
      roles: ['decorative'],
      moods: ['ambient'],
      bandAffinity: 'mid',
      sizes: ['needs-medium', 'needs-large'],
    } satisfies ElementMeta,
  };

  private lineMesh!: THREE.Line;
  private lineMat!: THREE.LineBasicMaterial;
  private dotMesh!: THREE.Points;
  private dotMat!: THREE.PointsMaterial;
  private borderLines!: THREE.LineSegments;
  private borderMat!: THREE.LineBasicMaterial;

  private maxPoints = 3000;
  private drawHead = 0;
  private cx = 0;
  private cy = 0;
  private scaleR = 0;
  // 6 pendulum components: x1,y1 (pendulum A), x2,y2 (pendulum B), z1,z2 (pendulum C for 3D)
  private params!: { f: number; p: number; a: number; d: number }[];
  private simTime = 0;
  private speed = 0;
  private tiltAngle = 0;
  private rotAngle = 0;
  private rotSpeed = 0;
  private intensityLevel = 0;

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;
    this.cx = x + w / 2;
    this.cy = y + h / 2;
    this.scaleR = Math.min(w, h) * 0.40;

    const variant = this.rng.int(0, 3);
    const presetParams = [
      [
        { f: 2.01, p: 0, a: 1, d: 0.003 },
        { f: 3.00, p: 1.5, a: 1, d: 0.002 },
        { f: 3.01, p: 0.7, a: 0.5, d: 0.004 },
        { f: 2.00, p: 2.1, a: 0.5, d: 0.003 },
        { f: 1.50, p: 0.3, a: 0.4, d: 0.005 },
        { f: 2.50, p: 1.8, a: 0.4, d: 0.004 },
      ],
      [
        { f: 2.00, p: 0, a: 1, d: 0.001 },
        { f: 3.01, p: 0.5, a: 1, d: 0.001 },
        { f: 4.02, p: 1.0, a: 0.3, d: 0.005 },
        { f: 1.00, p: 0, a: 0.3, d: 0.002 },
        { f: 5.01, p: 0.4, a: 0.2, d: 0.003 },
        { f: 3.99, p: 2.0, a: 0.2, d: 0.006 },
      ],
      [
        { f: 1.00, p: 0, a: 1, d: 0.002 },
        { f: 1.01, p: Math.PI / 2, a: 1, d: 0.002 },
        { f: 2.99, p: 0.3, a: 0.4, d: 0.006 },
        { f: 3.01, p: 1.8, a: 0.4, d: 0.006 },
        { f: 2.00, p: 0.7, a: 0.3, d: 0.004 },
        { f: 1.99, p: 1.2, a: 0.3, d: 0.005 },
      ],
      [
        { f: 3.00, p: 0, a: 1, d: 0.004 },
        { f: 2.01, p: 1.0, a: 1, d: 0.003 },
        { f: 5.02, p: 0.5, a: 0.25, d: 0.008 },
        { f: 4.99, p: 2.0, a: 0.25, d: 0.007 },
        { f: 7.01, p: 0.9, a: 0.15, d: 0.010 },
        { f: 6.98, p: 1.5, a: 0.15, d: 0.009 },
      ],
    ];

    this.params = presetParams[variant].map(pp => ({
      f: pp.f + this.rng.float(-0.005, 0.005),
      p: pp.p + this.rng.float(-0.1, 0.1),
      a: pp.a,
      d: pp.d,
    }));
    this.speed = 1.5 + this.rng.float(-0.3, 0.3);
    this.tiltAngle = this.rng.float(0.3, 0.8);
    this.rotSpeed = this.rng.float(0.02, 0.08);

    // Main curve line
    const positions = new Float32Array(this.maxPoints * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setDrawRange(0, 0);
    this.lineMat = new THREE.LineBasicMaterial({
      color: this.palette.primary, transparent: true, opacity: 0,
    });
    this.lineMesh = new THREE.Line(geo, this.lineMat);
    this.group.add(this.lineMesh);

    // Drawing point indicator
    const dotPos = new Float32Array(3);
    const dotGeo = new THREE.BufferGeometry();
    dotGeo.setAttribute('position', new THREE.BufferAttribute(dotPos, 3));
    this.dotMat = new THREE.PointsMaterial({
      color: this.palette.secondary, transparent: true, opacity: 0,
      size: Math.max(1, Math.min(w, h) * 0.016), sizeAttenuation: false,
    });
    this.dotMesh = new THREE.Points(dotGeo, this.dotMat);
    this.group.add(this.dotMesh);

    // Border
    const bv = new Float32Array([
      x, y, 0, x + w, y, 0, x + w, y, 0, x + w, y + h, 0,
      x + w, y + h, 0, x, y + h, 0, x, y + h, 0, x, y, 0,
    ]);
    const bGeo = new THREE.BufferGeometry();
    bGeo.setAttribute('position', new THREE.BufferAttribute(bv, 3));
    this.borderMat = new THREE.LineBasicMaterial({
      color: this.palette.dim, transparent: true, opacity: 0,
    });
    this.borderLines = new THREE.LineSegments(bGeo, this.borderMat);
    this.group.add(this.borderLines);

    this.simTime = 0;
    this.drawHead = 0;
  }

  private sample(t: number): { x: number; y: number; z: number } {
    const pp = this.params;
    const xVal = pp[0].a * Math.sin(pp[0].f * t + pp[0].p) * Math.exp(-pp[0].d * t)
               + pp[2].a * Math.sin(pp[2].f * t + pp[2].p) * Math.exp(-pp[2].d * t);
    const yVal = pp[1].a * Math.sin(pp[1].f * t + pp[1].p) * Math.exp(-pp[1].d * t)
               + pp[3].a * Math.sin(pp[3].f * t + pp[3].p) * Math.exp(-pp[3].d * t);
    const zVal = pp[4].a * Math.sin(pp[4].f * t + pp[4].p) * Math.exp(-pp[4].d * t)
               + pp[5].a * Math.sin(pp[5].f * t + pp[5].p) * Math.exp(-pp[5].d * t);
    return { x: xVal, y: yVal, z: zVal };
  }

  private project(p: { x: number; y: number; z: number }, rot: number): { x: number; y: number } {
    // Rotate around Y axis
    const cosR = Math.cos(rot);
    const sinR = Math.sin(rot);
    const rx = p.x * cosR - p.z * sinR;
    const rz = p.x * sinR + p.z * cosR;
    // Tilt around X
    const cosT = Math.cos(this.tiltAngle);
    const sinT = Math.sin(this.tiltAngle);
    const ry = p.y * cosT - rz * sinT;
    return { x: this.cx + rx * this.scaleR, y: this.cy + ry * this.scaleR };
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    const clampDt = Math.min(dt, 0.05);
    this.simTime += clampDt * this.speed;
    this.rotAngle = time * this.rotSpeed;

    const pos = this.lineMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const pointsPerFrame = 8;
    let lastPt = { x: this.cx, y: this.cy };

    for (let i = 0; i < pointsPerFrame; i++) {
      if (this.drawHead >= this.maxPoints) {
        this.drawHead = 0;
        this.simTime = 0;
        // Drift parameters for next curve
        for (const p of this.params) {
          p.p += this.rng.float(-0.2, 0.2);
          p.f += this.rng.float(-0.01, 0.01);
        }
      }
      const t = this.simTime + (i / pointsPerFrame) * clampDt * this.speed;
      const s = this.sample(t);
      const pt = this.project(s, this.rotAngle);
      pos.setXYZ(this.drawHead, pt.x, pt.y, 0);
      lastPt = pt;
      this.drawHead++;
    }
    pos.needsUpdate = true;
    this.lineMesh.geometry.setDrawRange(0, this.drawHead);

    // Update dot position
    const dotPos = this.dotMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    dotPos.setXYZ(0, lastPt.x, lastPt.y, 0.1);
    dotPos.needsUpdate = true;

    this.lineMat.opacity = opacity * 0.7;
    this.dotMat.opacity = opacity;
    this.borderMat.opacity = opacity * 0.2;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      this.drawHead = 0;
      this.simTime = 0;
      for (const p of this.params) {
        p.p = this.rng.float(0, Math.PI * 2);
      }
    }
    if (action === 'pulse') {
      for (const p of this.params) {
        p.d *= 0.1;
      }
      setTimeout(() => { for (const p of this.params) p.d *= 10; }, 600);
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    this.intensityLevel = level;
    if (level === 0) { this.speed = 1.5; return; }
    this.speed = 1.5 + level * 0.4;
    this.rotSpeed = 0.05 + level * 0.02;
  }
}
