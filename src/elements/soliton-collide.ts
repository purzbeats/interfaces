import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * KdV solitons propagating and passing through each other.
 * Two solitary waves of different amplitudes collide and emerge unchanged.
 * Rendered as a 1D curve using THREE.Line.
 */
export class SolitonCollideElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'soliton-collide',
    meta: { shape: 'linear', roles: ['data-display', 'decorative'], moods: ['diagnostic', 'ambient'], bandAffinity: 'bass', sizes: ['works-small', 'needs-medium'] },
  };

  private line!: THREE.Line;
  private baseLine!: THREE.Line;
  private segments = 200;
  private solitons: Array<{ amp: number; pos: number; speed: number }> = [];
  private domainLen = 6.0;

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;

    const variant = this.rng.int(0, 3);
    const presets = [
      { segs: 200, amps: [2.0, 0.8], speeds: [2.0, 0.8], positions: [-2.0, 1.5], domain: 6.0 },
      { segs: 300, amps: [3.0, 1.2], speeds: [3.0, 1.2], positions: [-2.5, 2.0], domain: 8.0 },
      { segs: 150, amps: [1.5, 0.5], speeds: [1.5, 0.5], positions: [-1.5, 1.0], domain: 5.0 },
      { segs: 250, amps: [2.5, 1.0, 0.4], speeds: [2.5, 1.0, 0.4], positions: [-2.0, 0.5, 2.0], domain: 7.0 },
    ];
    const p = presets[variant];
    this.segments = p.segs;
    this.domainLen = p.domain;

    for (let i = 0; i < p.amps.length; i++) {
      this.solitons.push({
        amp: p.amps[i] + this.rng.float(-0.1, 0.1),
        pos: p.positions[i],
        speed: p.speeds[i],
      });
    }

    // Main soliton curve
    const verts = new Float32Array((this.segments + 1) * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    this.line = new THREE.Line(geo, new THREE.LineBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
      linewidth: 1,
    }));
    this.group.add(this.line);

    // Baseline
    const baseVerts = new Float32Array(2 * 3);
    const baseGeo = new THREE.BufferGeometry();
    baseGeo.setAttribute('position', new THREE.BufferAttribute(baseVerts, 3));
    const baseY = y + h * 0.7;
    baseVerts[0] = x; baseVerts[1] = baseY; baseVerts[2] = 0;
    baseVerts[3] = x + w; baseVerts[4] = baseY; baseVerts[5] = 0;
    this.baseLine = new THREE.Line(baseGeo, new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.baseLine);
  }

  /**
   * KdV soliton: u(x,t) = A * sech^2(sqrt(A/12) * (x - c*t - x0))
   * where c = A/3 (speed proportional to amplitude).
   */
  private solitonProfile(xVal: number, time: number): number {
    let u = 0;
    for (const sol of this.solitons) {
      const c = sol.speed;
      const A = sol.amp;
      const kappa = Math.sqrt(A / 12);
      const xi = xVal - c * time - sol.pos;
      // Wrap for periodic domain
      const xiWrap = xi - this.domainLen * Math.round(xi / this.domainLen);
      const sech = 1 / Math.cosh(kappa * xiWrap);
      u += A * sech * sech;
    }
    return u;
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    const { x, y, w, h } = this.px;

    const baseY = y + h * 0.7;
    const ampScale = h * 0.5;
    const halfDomain = this.domainLen / 2;

    const pos = this.line.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i <= this.segments; i++) {
      const frac = i / this.segments;
      const xDomain = -halfDomain + frac * this.domainLen;
      const u = this.solitonProfile(xDomain, time);
      const screenX = x + frac * w;
      const screenY = baseY - u * ampScale / 3;
      pos.setXYZ(i, screenX, screenY, 0);
    }
    pos.needsUpdate = true;

    (this.line.material as THREE.LineBasicMaterial).opacity = opacity * 0.9;
    (this.baseLine.material as THREE.LineBasicMaterial).opacity = opacity * 0.2;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Add a new small soliton
      this.solitons.push({
        amp: this.rng.float(0.3, 1.0),
        pos: this.rng.float(-this.domainLen / 2, this.domainLen / 2),
        speed: this.rng.float(0.3, 1.5),
      });
      // Keep at most 5
      if (this.solitons.length > 5) this.solitons.shift();
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level >= 3) {
      for (const s of this.solitons) {
        s.amp = Math.min(4, s.amp + 0.2 * level);
        s.speed = s.amp / 3;
      }
    }
  }
}
