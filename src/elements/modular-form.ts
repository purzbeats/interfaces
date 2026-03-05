import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Visualization of modular arithmetic patterns.
 * Plot (a*x mod m) for varying a, producing beautiful lattice patterns.
 * Points on a circle connected by modular multiplication.
 */
export class ModularFormElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'modular-form',
    meta: { shape: 'radial', roles: ['data-display', 'decorative'], moods: ['diagnostic', 'ambient'], bandAffinity: 'high', sizes: ['needs-medium', 'needs-large'] },
  };

  private linesMesh!: THREE.LineSegments;
  private circleLine!: THREE.Line;
  private cx = 0;
  private cy = 0;
  private radius = 0;
  private modulus = 0;
  private multiplier = 0;
  private targetMultiplier = 0;

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;
    this.cx = x + w / 2;
    this.cy = y + h / 2;
    this.radius = Math.min(w, h) * 0.42;

    const variant = this.rng.int(0, 3);
    const presets = [
      { mod: 200, mult: 2 },
      { mod: 150, mult: 3 },
      { mod: 100, mult: 51 },
      { mod: 250, mult: 7 },
    ];
    const p = presets[variant];
    this.modulus = p.mod;
    this.multiplier = p.mult;
    this.targetMultiplier = p.mult;

    // Circle outline
    const segs = 128;
    const circPos = new Float32Array((segs + 1) * 3);
    for (let i = 0; i <= segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      circPos[i * 3] = this.cx + Math.cos(a) * this.radius;
      circPos[i * 3 + 1] = this.cy + Math.sin(a) * this.radius;
    }
    const circGeo = new THREE.BufferGeometry();
    circGeo.setAttribute('position', new THREE.BufferAttribute(circPos, 3));
    this.circleLine = new THREE.Line(circGeo, new THREE.LineBasicMaterial({
      color: this.palette.dim, transparent: true, opacity: 0,
    }));
    this.group.add(this.circleLine);

    // Lines connecting points by modular multiplication
    const linePos = new Float32Array(this.modulus * 2 * 3);
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.BufferAttribute(linePos, 3));
    this.linesMesh = new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({
      color: this.palette.primary, transparent: true, opacity: 0,
    }));
    this.group.add(this.linesMesh);
  }

  private pointOnCircle(index: number, mod: number): [number, number] {
    const angle = (index / mod) * Math.PI * 2 - Math.PI / 2;
    return [this.cx + Math.cos(angle) * this.radius, this.cy + Math.sin(angle) * this.radius];
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);

    // Slowly morph the multiplier
    this.multiplier += (this.targetMultiplier - this.multiplier) * dt * 2;

    // Periodically pick new target multiplier
    if (Math.abs(this.multiplier - this.targetMultiplier) < 0.01) {
      const interesting = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 51, 53, 59, 61, 67, 71, 73, 79, 83, 89, 97];
      this.targetMultiplier = this.rng.pick(interesting);
    }

    // Update line positions
    const pos = this.linesMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const m = this.modulus;
    const mult = this.multiplier;
    for (let i = 0; i < m; i++) {
      const [x1, y1] = this.pointOnCircle(i, m);
      // For non-integer multiplier, interpolate between floor and ceil
      const destExact = (i * mult) % m;
      const destFloor = Math.floor(destExact);
      const destCeil = (destFloor + 1) % m;
      const frac = destExact - destFloor;
      const [xf, yf] = this.pointOnCircle(destFloor, m);
      const [xc, yc] = this.pointOnCircle(destCeil, m);
      const x2 = xf + (xc - xf) * frac;
      const y2 = yf + (yc - yf) * frac;
      pos.setXYZ(i * 2, x1, y1, 0);
      pos.setXYZ(i * 2 + 1, x2, y2, 0);
    }
    pos.needsUpdate = true;

    (this.linesMesh.material as THREE.LineBasicMaterial).opacity = opacity * 0.5;
    (this.circleLine.material as THREE.LineBasicMaterial).opacity = opacity * 0.2;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      this.targetMultiplier = 2 + this.rng.float(0, 95);
    }
    if (action === 'alert') {
      this.targetMultiplier = this.modulus / 2;
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level >= 3) {
      this.targetMultiplier = 2 + this.rng.float(0, level * 15);
    }
  }
}
