import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Standard map (Chirikov-Taylor map). Area-preserving map showing
 * KAM tori and chaotic seas in phase space.
 */
export class SymplecticMapElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'symplectic-map',
    meta: { shape: 'rectangular', roles: ['data-display'], moods: ['diagnostic', 'ambient'], bandAffinity: 'mid', sizes: ['needs-medium', 'needs-large'] },
  };

  private pointsMesh!: THREE.Points;
  private maxPoints = 0;
  private head = 0;
  private orbitCount = 0;
  private K = 0;          // stochasticity parameter
  private targetK = 0;
  private orbitsX!: Float32Array;
  private orbitsP!: Float32Array;
  private cx = 0;
  private cy = 0;
  private scaleW = 0;
  private scaleH = 0;

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;
    this.cx = x + w / 2;
    this.cy = y + h / 2;
    this.scaleW = w * 0.9;
    this.scaleH = h * 0.9;

    const variant = this.rng.int(0, 3);
    const presets = [
      { orbits: 30, K: 0.9, maxPts: 8000 },   // near integrable, KAM tori visible
      { orbits: 40, K: 1.5, maxPts: 10000 },   // mixed phase space
      { orbits: 20, K: 2.5, maxPts: 6000 },    // mostly chaotic
      { orbits: 50, K: 0.5, maxPts: 12000 },   // very integrable
    ];
    const p = presets[variant];
    this.orbitCount = p.orbits;
    this.K = p.K;
    this.targetK = p.K;
    this.maxPoints = p.maxPts;

    // Initialize orbits with different initial conditions
    this.orbitsX = new Float32Array(p.orbits);
    this.orbitsP = new Float32Array(p.orbits);
    for (let i = 0; i < p.orbits; i++) {
      this.orbitsX[i] = this.rng.float(0, 1);
      this.orbitsP[i] = this.rng.float(0, 1);
    }

    const positions = new Float32Array(this.maxPoints * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setDrawRange(0, 0);
    this.pointsMesh = new THREE.Points(geo, new THREE.PointsMaterial({
      color: this.palette.primary, transparent: true, opacity: 0, size: 1.2, sizeAttenuation: false,
    }));
    this.group.add(this.pointsMesh);
    this.head = 0;
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);

    // Morph K
    this.K += (this.targetK - this.K) * dt * 0.5;

    // Iterate the standard map: p' = p + K/(2pi) sin(2pi x), x' = x + p' (mod 1)
    const pos = this.pointsMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const itersPerFrame = 4;
    const TWO_PI = Math.PI * 2;
    for (let iter = 0; iter < itersPerFrame; iter++) {
      for (let i = 0; i < this.orbitCount; i++) {
        let px = this.orbitsX[i];
        let pp = this.orbitsP[i];
        pp = pp + (this.K / TWO_PI) * Math.sin(TWO_PI * px);
        pp = ((pp % 1) + 1) % 1;
        px = ((px + pp) % 1 + 1) % 1;
        this.orbitsX[i] = px;
        this.orbitsP[i] = pp;

        if (this.head < this.maxPoints) {
          const sx = this.cx - this.scaleW / 2 + px * this.scaleW;
          const sy = this.cy - this.scaleH / 2 + pp * this.scaleH;
          pos.setXYZ(this.head, sx, sy, 0);
          this.head++;
        }
      }
    }

    // Reset when full
    if (this.head >= this.maxPoints) {
      this.head = 0;
      // Reinit orbits
      for (let i = 0; i < this.orbitCount; i++) {
        this.orbitsX[i] = this.rng.float(0, 1);
        this.orbitsP[i] = this.rng.float(0, 1);
      }
    }

    pos.needsUpdate = true;
    this.pointsMesh.geometry.setDrawRange(0, this.head);
    (this.pointsMesh.material as THREE.PointsMaterial).opacity = opacity * 0.7;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      this.head = 0;
      this.targetK = this.rng.float(0.2, 4.0);
    }
    if (action === 'alert') {
      this.targetK = 6.0; // fully chaotic
      setTimeout(() => { this.targetK = this.rng.float(0.5, 2.0); }, 2000);
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level >= 2) {
      this.targetK = 0.5 + level * 0.5;
    }
  }
}
