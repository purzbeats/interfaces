import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Mathematical knot visualization. Trefoil, figure-eight, cinquefoil, and
 * torus knots rendered as 3D parametric curves projected to 2D.
 * Slowly rotating wireframe with fading trail.
 */
export class KnotTheoryElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'knot-theory',
    meta: { shape: 'radial', roles: ['decorative'], moods: ['ambient', 'diagnostic'], bandAffinity: 'mid', sizes: ['needs-medium', 'needs-large'] },
  };

  private line!: THREE.Line;
  private lineMat!: THREE.LineBasicMaterial;
  private positions!: Float32Array;
  private numPoints: number = 0;
  private cx: number = 0;
  private cy: number = 0;
  private radius: number = 0;
  private rotSpeed: number = 0;
  private knotP: number = 0;
  private knotQ: number = 0;
  private knotR: number = 0;
  private knotTubeRatio: number = 0;

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;
    this.cx = x + w / 2;
    this.cy = y + h / 2;
    this.radius = Math.min(w, h) * 0.38;

    const variant = this.rng.int(0, 3);
    // Knot types: (p, q) torus knot parameters + tube thickness ratio
    const presets = [
      { p: 2, q: 3, r: 0.4, points: 300, speed: 0.3 },   // trefoil
      { p: 2, q: 5, r: 0.35, points: 400, speed: 0.25 },  // cinquefoil
      { p: 3, q: 5, r: 0.3, points: 500, speed: 0.2 },    // (3,5) torus knot
      { p: 2, q: 7, r: 0.3, points: 500, speed: 0.15 },   // (2,7) torus knot
    ];
    const pr = presets[variant];
    this.knotP = pr.p;
    this.knotQ = pr.q;
    this.knotR = pr.r;
    this.numPoints = pr.points;
    this.rotSpeed = pr.speed;
    this.knotTubeRatio = pr.r;

    this.positions = new Float32Array((this.numPoints + 1) * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));

    this.lineMat = new THREE.LineBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
    });
    this.line = new THREE.Line(geo, this.lineMat);
    this.group.add(this.line);
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    const angle = time * this.rotSpeed;
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);
    const p = this.knotP;
    const q = this.knotQ;
    const R = this.radius;
    const r = R * this.knotTubeRatio;

    for (let i = 0; i <= this.numPoints; i++) {
      const t = (i / this.numPoints) * Math.PI * 2;
      // Torus knot parametric equations in 3D
      const cr = R * 0.5 + r * Math.cos(q * t);
      const x3d = cr * Math.cos(p * t);
      const y3d = cr * Math.sin(p * t);
      const z3d = r * Math.sin(q * t);

      // Rotate around Y axis then project
      const rx = x3d * cosA + z3d * sinA;
      const rz = -x3d * sinA + z3d * cosA;
      // Simple perspective projection
      const scale = 1.0 / (1.0 - rz / (R * 4));

      const idx = i * 3;
      this.positions[idx] = this.cx + rx * scale;
      this.positions[idx + 1] = this.cy + y3d * scale;
      this.positions[idx + 2] = 0;
    }

    const attr = this.line.geometry.getAttribute('position') as THREE.BufferAttribute;
    attr.needsUpdate = true;
    this.lineMat.opacity = opacity * 0.8;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      this.glitchTimer = 0.5;
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level >= 3) {
      this.rotSpeed *= 1.5;
    }
  }
}
