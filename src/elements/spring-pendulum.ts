import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Elastic pendulum: a mass on a spring that also swings. Produces
 * chaotic Lissajous-like patterns. Trail rendering of the mass
 * traces out complex two-frequency motion.
 */
export class SpringPendulumElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'spring-pendulum',
    meta: {
      shape: 'radial',
      roles: ['data-display', 'decorative'],
      moods: ['ambient', 'diagnostic'],
      bandAffinity: 'mid',
      sizes: ['needs-medium', 'needs-large'],
    },
  };

  private springLine!: THREE.Line;
  private bob!: THREE.Points;
  private trailLine!: THREE.Line;
  private frameLine!: THREE.LineSegments;

  // Physics state: polar-ish coords
  private r: number = 0;       // current spring length
  private theta: number = 0;   // angle from vertical
  private rDot: number = 0;    // radial velocity
  private thetaDot: number = 0;// angular velocity
  private r0: number = 1;      // natural spring length
  private k: number = 20;      // spring constant
  private m: number = 1;       // mass
  private g: number = 9.8;     // gravity

  private pivotX: number = 0;
  private pivotY: number = 0;
  private pixelScale: number = 1;
  private springSegs: number = 24;
  private trailLen: number = 200;
  private trail: { x: number; y: number }[] = [];
  private speedMult: number = 1;

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;
    this.pivotX = x + w / 2;
    this.pivotY = y + h * 0.08;
    this.pixelScale = Math.min(w, h) * 0.25;

    const variant = this.rng.int(0, 3);
    const presets = [
      { k: 15, r0: 1.0, initTheta: 0.8, initR: 1.3 },
      { k: 30, r0: 0.8, initTheta: 0.5, initR: 1.1 },
      { k: 10, r0: 1.2, initTheta: 1.0, initR: 1.6 },
      { k: 25, r0: 0.9, initTheta: 0.3, initR: 1.5 },
    ];
    const p = presets[variant];
    this.k = p.k;
    this.r0 = p.r0;
    this.r = p.initR;
    this.theta = p.initTheta;
    this.rDot = 0;
    this.thetaDot = 0;

    // Spring coil line
    const spPos = new Float32Array(this.springSegs * 3);
    const spGeo = new THREE.BufferGeometry();
    spGeo.setAttribute('position', new THREE.BufferAttribute(spPos, 3));
    this.springLine = new THREE.Line(spGeo, new THREE.LineBasicMaterial({
      color: this.palette.dim, transparent: true, opacity: 0,
    }));
    this.group.add(this.springLine);

    // Bob point
    const bobPos = new Float32Array(3);
    const bobGeo = new THREE.BufferGeometry();
    bobGeo.setAttribute('position', new THREE.BufferAttribute(bobPos, 3));
    this.bob = new THREE.Points(bobGeo, new THREE.PointsMaterial({
      color: this.palette.primary, transparent: true, opacity: 0,
      size: 8, sizeAttenuation: false,
    }));
    this.group.add(this.bob);

    // Trail
    const tPos = new Float32Array(this.trailLen * 3);
    const tColors = new Float32Array(this.trailLen * 3);
    const tGeo = new THREE.BufferGeometry();
    tGeo.setAttribute('position', new THREE.BufferAttribute(tPos, 3));
    tGeo.setAttribute('color', new THREE.BufferAttribute(tColors, 3));
    this.trailLine = new THREE.Line(tGeo, new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0,
    }));
    this.group.add(this.trailLine);

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
    const effDt = Math.min(dt, 0.03) * this.speedMult;

    // Elastic pendulum equations of motion (Lagrangian mechanics):
    // r'' = r * thetaDot^2 - g*cos(theta) + (k/m)*(r0 - r)
    // theta'' = (-2*rDot*thetaDot - g*sin(theta)) / r
    const steps = 8;
    const subDt = effDt / steps;
    for (let s = 0; s < steps; s++) {
      const rAcc = this.r * this.thetaDot * this.thetaDot
        - this.g * Math.cos(this.theta)
        + (this.k / this.m) * (this.r0 - this.r);
      const thAcc = (-2 * this.rDot * this.thetaDot
        - this.g * Math.sin(this.theta)) / Math.max(this.r, 0.01);

      this.rDot += rAcc * subDt;
      this.thetaDot += thAcc * subDt;
      // Tiny damping to prevent divergence
      this.rDot *= (1 - 0.001 * subDt);
      this.thetaDot *= (1 - 0.001 * subDt);
      this.r += this.rDot * subDt;
      this.theta += this.thetaDot * subDt;
      // Keep r positive
      if (this.r < 0.05) { this.r = 0.05; this.rDot = Math.abs(this.rDot); }
    }

    // Convert to pixel coords (theta=0 is straight down)
    const bobPxX = this.pivotX + Math.sin(this.theta) * this.r * this.pixelScale;
    const bobPxY = this.pivotY + Math.cos(this.theta) * this.r * this.pixelScale;

    // Update spring coil (zigzag from pivot to bob)
    const spPos = this.springLine.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < this.springSegs; i++) {
      const frac = i / (this.springSegs - 1);
      const sx = this.pivotX + (bobPxX - this.pivotX) * frac;
      const sy = this.pivotY + (bobPxY - this.pivotY) * frac;
      // Perpendicular zigzag
      const perpX = -(bobPxY - this.pivotY);
      const perpY = (bobPxX - this.pivotX);
      const len = Math.sqrt(perpX * perpX + perpY * perpY) || 1;
      const zigzag = (i > 0 && i < this.springSegs - 1)
        ? ((i % 2) * 2 - 1) * 5 : 0;
      spPos.setXYZ(i,
        sx + (perpX / len) * zigzag,
        sy + (perpY / len) * zigzag, 0.5);
    }
    spPos.needsUpdate = true;

    // Update bob
    const bPos = this.bob.geometry.getAttribute('position') as THREE.BufferAttribute;
    bPos.setXYZ(0, bobPxX, bobPxY, 2);
    bPos.needsUpdate = true;

    // Update trail
    this.trail.push({ x: bobPxX, y: bobPxY });
    if (this.trail.length > this.trailLen) this.trail.shift();

    const tPos = this.trailLine.geometry.getAttribute('position') as THREE.BufferAttribute;
    const tCol = this.trailLine.geometry.getAttribute('color') as THREE.BufferAttribute;
    const pc = this.palette.primary;
    const dc = this.palette.dim;
    for (let i = 0; i < this.trailLen; i++) {
      const pt = this.trail[i] ?? this.trail[this.trail.length - 1] ?? { x: bobPxX, y: bobPxY };
      tPos.setXYZ(i, pt.x, pt.y, 0.3);
      const fade = i / Math.max(this.trail.length - 1, 1);
      tCol.setXYZ(i,
        dc.r + (pc.r - dc.r) * fade,
        dc.g + (pc.g - dc.g) * fade,
        dc.b + (pc.b - dc.b) * fade);
    }
    tPos.needsUpdate = true;
    tCol.needsUpdate = true;

    // Opacities
    (this.springLine.material as THREE.LineBasicMaterial).opacity = opacity * 0.5;
    (this.bob.material as THREE.PointsMaterial).opacity = opacity;
    (this.trailLine.material as THREE.LineBasicMaterial).opacity = opacity * 0.4;
    (this.frameLine.material as THREE.LineBasicMaterial).opacity = opacity * 0.15;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      this.thetaDot += this.rng.float(-4, 4);
      this.rDot += this.rng.float(-2, 2);
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level >= 3) this.speedMult = 1 + level * 0.2;
    else this.speedMult = 1;
  }
}
