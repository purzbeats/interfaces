import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Two pendulums connected by a spring. Energy transfers back and forth
 * between them via the coupling, producing beat-frequency oscillation.
 * Real physics: coupled harmonic oscillator differential equations.
 */
export class CoupledPendulumElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'coupled-pendulum',
    meta: {
      shape: 'rectangular',
      roles: ['data-display', 'decorative'],
      moods: ['diagnostic', 'ambient'],
      bandAffinity: 'bass',
      sizes: ['needs-medium', 'needs-large'],
    },
  };

  private beamLine!: THREE.LineSegments;
  private stringLines!: THREE.LineSegments;
  private springLine!: THREE.Line;
  private bobs!: THREE.Points;
  private trailLine1!: THREE.Line;
  private trailLine2!: THREE.Line;
  private frameLine!: THREE.LineSegments;

  // Physics state
  private theta1: number = 0;
  private theta2: number = 0;
  private omega1: number = 0;
  private omega2: number = 0;
  private gravity: number = 9.8;
  private length: number = 1;
  private coupling: number = 0.5;
  private damping: number = 0.002;

  private pivotX1: number = 0;
  private pivotX2: number = 0;
  private pivotY: number = 0;
  private pendulumLen: number = 0;
  private amplitude: number = 0.5;
  private speedMult: number = 1;
  private springSegments: number = 20;
  private trailLen: number = 60;
  private trail1: { x: number; y: number }[] = [];
  private trail2: { x: number; y: number }[] = [];

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;

    const variant = this.rng.int(0, 3);
    const presets = [
      { coupling: 0.3, amp: 0.4, damp: 0.001, initMode: 'asymmetric' },
      { coupling: 0.8, amp: 0.5, damp: 0.003, initMode: 'symmetric' },
      { coupling: 0.15, amp: 0.6, damp: 0.0005, initMode: 'asymmetric' },
      { coupling: 1.2, amp: 0.35, damp: 0.002, initMode: 'antisymmetric' },
    ];
    const p = presets[variant];
    this.coupling = p.coupling;
    this.damping = p.damp;
    this.amplitude = p.amp;

    // Initial conditions based on mode
    if (p.initMode === 'symmetric') {
      this.theta1 = this.amplitude; this.theta2 = this.amplitude;
    } else if (p.initMode === 'antisymmetric') {
      this.theta1 = this.amplitude; this.theta2 = -this.amplitude;
    } else {
      this.theta1 = this.amplitude; this.theta2 = 0;
    }

    this.pivotY = y + h * 0.1;
    this.pivotX1 = x + w * 0.3;
    this.pivotX2 = x + w * 0.7;
    this.pendulumLen = h * 0.55;

    // Support beam
    const bv = new Float32Array([
      x + w * 0.1, this.pivotY, 0, x + w * 0.9, this.pivotY, 0,
    ]);
    const bGeo = new THREE.BufferGeometry();
    bGeo.setAttribute('position', new THREE.BufferAttribute(bv, 3));
    this.beamLine = new THREE.LineSegments(bGeo, new THREE.LineBasicMaterial({
      color: this.palette.dim, transparent: true, opacity: 0,
    }));
    this.group.add(this.beamLine);

    // Strings (2 segments: pivot to bob for each)
    const sPos = new Float32Array(12);
    const sGeo = new THREE.BufferGeometry();
    sGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
    this.stringLines = new THREE.LineSegments(sGeo, new THREE.LineBasicMaterial({
      color: this.palette.dim, transparent: true, opacity: 0,
    }));
    this.group.add(this.stringLines);

    // Spring connecting the two bobs
    const spPos = new Float32Array(this.springSegments * 3);
    const spGeo = new THREE.BufferGeometry();
    spGeo.setAttribute('position', new THREE.BufferAttribute(spPos, 3));
    this.springLine = new THREE.Line(spGeo, new THREE.LineBasicMaterial({
      color: this.palette.secondary, transparent: true, opacity: 0,
    }));
    this.group.add(this.springLine);

    // Bobs
    const bobPos = new Float32Array(6);
    const bobGeo = new THREE.BufferGeometry();
    bobGeo.setAttribute('position', new THREE.BufferAttribute(bobPos, 3));
    this.bobs = new THREE.Points(bobGeo, new THREE.PointsMaterial({
      color: this.palette.primary, transparent: true, opacity: 0,
      size: Math.max(1, Math.min(w, h) * 0.025), sizeAttenuation: false,
    }));
    this.group.add(this.bobs);

    // Trails
    const t1Pos = new Float32Array(this.trailLen * 3);
    const t1Geo = new THREE.BufferGeometry();
    t1Geo.setAttribute('position', new THREE.BufferAttribute(t1Pos, 3));
    this.trailLine1 = new THREE.Line(t1Geo, new THREE.LineBasicMaterial({
      color: this.palette.primary, transparent: true, opacity: 0,
    }));
    this.group.add(this.trailLine1);

    const t2Pos = new Float32Array(this.trailLen * 3);
    const t2Geo = new THREE.BufferGeometry();
    t2Geo.setAttribute('position', new THREE.BufferAttribute(t2Pos, 3));
    this.trailLine2 = new THREE.Line(t2Geo, new THREE.LineBasicMaterial({
      color: this.palette.secondary, transparent: true, opacity: 0,
    }));
    this.group.add(this.trailLine2);

    // Frame
    const pad = 2;
    const fv = new Float32Array([
      x + pad, y + pad, 0, x + w - pad, y + pad, 0,
      x + w - pad, y + pad, 0, x + w - pad, y + h - pad, 0,
      x + w - pad, y + h - pad, 0, x + pad, y + h - pad, 0,
      x + pad, y + h - pad, 0, x + pad, y + pad, 0,
    ]);
    const fGeo = new THREE.BufferGeometry();
    fGeo.setAttribute('position', new THREE.BufferAttribute(fv, 3));
    this.frameLine = new THREE.LineSegments(fGeo, new THREE.LineBasicMaterial({
      color: this.palette.dim, transparent: true, opacity: 0,
    }));
    this.group.add(this.frameLine);
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    const effDt = Math.min(dt, 0.05) * this.speedMult;

    // Coupled pendulum physics (small angle approx)
    // theta1'' = -(g/L)*theta1 - k*(theta1-theta2) - d*omega1
    // theta2'' = -(g/L)*theta2 - k*(theta2-theta1) - d*omega2
    const steps = 4;
    const subDt = effDt / steps;
    for (let s = 0; s < steps; s++) {
      const a1 = -(this.gravity / this.length) * this.theta1
        - this.coupling * (this.theta1 - this.theta2)
        - this.damping * this.omega1;
      const a2 = -(this.gravity / this.length) * this.theta2
        - this.coupling * (this.theta2 - this.theta1)
        - this.damping * this.omega2;
      this.omega1 += a1 * subDt;
      this.omega2 += a2 * subDt;
      this.theta1 += this.omega1 * subDt;
      this.theta2 += this.omega2 * subDt;
    }

    // Compute bob positions
    const bob1X = this.pivotX1 + Math.sin(this.theta1) * this.pendulumLen;
    const bob1Y = this.pivotY + Math.cos(this.theta1) * this.pendulumLen;
    const bob2X = this.pivotX2 + Math.sin(this.theta2) * this.pendulumLen;
    const bob2Y = this.pivotY + Math.cos(this.theta2) * this.pendulumLen;

    // Update strings
    const sPos = this.stringLines.geometry.getAttribute('position') as THREE.BufferAttribute;
    sPos.setXYZ(0, this.pivotX1, this.pivotY, 1);
    sPos.setXYZ(1, bob1X, bob1Y, 1);
    sPos.setXYZ(2, this.pivotX2, this.pivotY, 1);
    sPos.setXYZ(3, bob2X, bob2Y, 1);
    sPos.needsUpdate = true;

    // Update bobs
    const bPos = this.bobs.geometry.getAttribute('position') as THREE.BufferAttribute;
    bPos.setXYZ(0, bob1X, bob1Y, 2);
    bPos.setXYZ(1, bob2X, bob2Y, 2);
    bPos.needsUpdate = true;

    // Update spring (zigzag between bob attachment points)
    const attachY = this.pivotY + this.pendulumLen * 0.4;
    const att1X = this.pivotX1 + Math.sin(this.theta1) * this.pendulumLen * 0.4;
    const att2X = this.pivotX2 + Math.sin(this.theta2) * this.pendulumLen * 0.4;
    const spPos = this.springLine.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < this.springSegments; i++) {
      const frac = i / (this.springSegments - 1);
      const sx = att1X + (att2X - att1X) * frac;
      const zigzag = (i > 0 && i < this.springSegments - 1)
        ? Math.sin(i * Math.PI) * 4 * ((i % 2) * 2 - 1) : 0;
      spPos.setXYZ(i, sx, attachY + zigzag, 0.8);
    }
    spPos.needsUpdate = true;

    // Update trails
    this.trail1.push({ x: bob1X, y: bob1Y });
    this.trail2.push({ x: bob2X, y: bob2Y });
    if (this.trail1.length > this.trailLen) this.trail1.shift();
    if (this.trail2.length > this.trailLen) this.trail2.shift();

    const t1Pos = this.trailLine1.geometry.getAttribute('position') as THREE.BufferAttribute;
    const t2Pos = this.trailLine2.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < this.trailLen; i++) {
      const p1 = this.trail1[i] ?? this.trail1[this.trail1.length - 1] ?? { x: bob1X, y: bob1Y };
      const p2 = this.trail2[i] ?? this.trail2[this.trail2.length - 1] ?? { x: bob2X, y: bob2Y };
      t1Pos.setXYZ(i, p1.x, p1.y, 0.3);
      t2Pos.setXYZ(i, p2.x, p2.y, 0.3);
    }
    t1Pos.needsUpdate = true;
    t2Pos.needsUpdate = true;

    // Opacities
    (this.beamLine.material as THREE.LineBasicMaterial).opacity = opacity * 0.5;
    (this.stringLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.4;
    (this.springLine.material as THREE.LineBasicMaterial).opacity = opacity * 0.6;
    (this.bobs.material as THREE.PointsMaterial).opacity = opacity;
    (this.trailLine1.material as THREE.LineBasicMaterial).opacity = opacity * 0.2;
    (this.trailLine2.material as THREE.LineBasicMaterial).opacity = opacity * 0.2;
    (this.frameLine.material as THREE.LineBasicMaterial).opacity = opacity * 0.15;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      this.omega1 += this.rng.float(-3, 3);
      this.omega2 += this.rng.float(-3, 3);
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level >= 3) this.speedMult = 1 + level * 0.3;
    else this.speedMult = 1;
  }
}
