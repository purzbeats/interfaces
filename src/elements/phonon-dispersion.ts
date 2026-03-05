import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * 1D chain of atoms connected by springs showing phonon wave propagation.
 * Atoms as points, bonds as lines, with dispersion relation visualization.
 */
export class PhononDispersionElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'phonon-dispersion',
    meta: { shape: 'linear', roles: ['data-display', 'decorative'], moods: ['diagnostic', 'ambient'], bandAffinity: 'mid', sizes: ['works-small', 'needs-medium'] },
  };

  private atomLine!: THREE.Line;
  private bondLine!: THREE.LineSegments;
  private dispersionLine!: THREE.Line;
  private atomCount = 30;
  private atomDisp: Float32Array = new Float32Array(0);
  private atomVel: Float32Array = new Float32Array(0);
  private springK = 40;
  private atomMass = 1.0;
  private dispSegments = 80;
  private showDispersion = true;
  private dampingFactor = 0.998;

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;

    const variant = this.rng.int(0, 3);
    const presets = [
      { atoms: 30, k: 40, mass: 1.0, damp: 0.998, disp: true },
      { atoms: 50, k: 80, mass: 1.0, damp: 0.999, disp: true },
      { atoms: 20, k: 25, mass: 1.5, damp: 0.997, disp: false },
      { atoms: 40, k: 60, mass: 0.8, damp: 0.998, disp: true },
    ];
    const p = presets[variant];
    this.atomCount = p.atoms;
    this.springK = p.k;
    this.atomMass = p.mass;
    this.dampingFactor = p.damp;
    this.showDispersion = p.disp;

    this.atomDisp = new Float32Array(this.atomCount);
    this.atomVel = new Float32Array(this.atomCount);

    // Initial perturbation: Gaussian pulse in center
    const center = Math.floor(this.atomCount / 2);
    const sigma = 2.5;
    for (let i = 0; i < this.atomCount; i++) {
      const d = i - center;
      this.atomDisp[i] = Math.exp(-d * d / (2 * sigma * sigma));
    }

    // Atom dots rendered as a line through atom positions
    const atomVerts = new Float32Array(this.atomCount * 3);
    const atomGeo = new THREE.BufferGeometry();
    atomGeo.setAttribute('position', new THREE.BufferAttribute(atomVerts, 3));
    this.atomLine = new THREE.Line(atomGeo, new THREE.LineBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.atomLine);

    // Bond segments connecting atoms
    const bondVerts = new Float32Array((this.atomCount - 1) * 2 * 3);
    const bondGeo = new THREE.BufferGeometry();
    bondGeo.setAttribute('position', new THREE.BufferAttribute(bondVerts, 3));
    this.bondLine = new THREE.LineSegments(bondGeo, new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.bondLine);

    // Dispersion relation curve (bottom portion)
    if (this.showDispersion) {
      const dispVerts = new Float32Array((this.dispSegments + 1) * 3);
      const dispGeo = new THREE.BufferGeometry();
      dispGeo.setAttribute('position', new THREE.BufferAttribute(dispVerts, 3));
      this.dispersionLine = new THREE.Line(dispGeo, new THREE.LineBasicMaterial({
        color: this.palette.secondary,
        transparent: true,
        opacity: 0,
      }));
      this.group.add(this.dispersionLine);
    }
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);
    const { x, y, w, h } = this.px;
    const clampDt = Math.min(dt, 0.02);

    // Verlet-like integration: compute forces then update
    const substeps = 4;
    const subDt = clampDt / substeps;
    for (let step = 0; step < substeps; step++) {
      const forces = new Float32Array(this.atomCount);
      for (let i = 0; i < this.atomCount; i++) {
        const left = i > 0 ? this.atomDisp[i - 1] : 0;
        const right = i < this.atomCount - 1 ? this.atomDisp[i + 1] : 0;
        forces[i] = this.springK * (left + right - 2 * this.atomDisp[i]) / this.atomMass;
      }
      for (let i = 0; i < this.atomCount; i++) {
        this.atomVel[i] = (this.atomVel[i] + forces[i] * subDt) * this.dampingFactor;
        this.atomDisp[i] += this.atomVel[i] * subDt;
      }
      // Fixed endpoints
      this.atomDisp[0] = 0;
      this.atomDisp[this.atomCount - 1] = 0;
      this.atomVel[0] = 0;
      this.atomVel[this.atomCount - 1] = 0;
    }

    // Draw atoms on a horizontal line with vertical displacement
    const chainY = y + h * (this.showDispersion ? 0.35 : 0.5);
    const ampScale = h * 0.25;
    const spacing = w / (this.atomCount - 1);

    const atomPos = this.atomLine.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < this.atomCount; i++) {
      const ax = x + i * spacing;
      const ay = chainY - this.atomDisp[i] * ampScale;
      atomPos.setXYZ(i, ax, ay, 1);
    }
    atomPos.needsUpdate = true;
    (this.atomLine.material as THREE.LineBasicMaterial).opacity = opacity * 0.9;

    // Draw bonds
    const bondPos = this.bondLine.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < this.atomCount - 1; i++) {
      const ax1 = x + i * spacing;
      const ay1 = chainY - this.atomDisp[i] * ampScale;
      const ax2 = x + (i + 1) * spacing;
      const ay2 = chainY - this.atomDisp[i + 1] * ampScale;
      bondPos.setXYZ(i * 2, ax1, ay1, 0.5);
      bondPos.setXYZ(i * 2 + 1, ax2, ay2, 0.5);
    }
    bondPos.needsUpdate = true;
    (this.bondLine.material as THREE.LineBasicMaterial).opacity = opacity * 0.3;

    // Dispersion relation: omega(k) = 2*sqrt(K/m)*|sin(ka/2)|
    if (this.showDispersion && this.dispersionLine) {
      const dispY = y + h * 0.75;
      const dispH = h * 0.2;
      const omegaMax = 2 * Math.sqrt(this.springK / this.atomMass);

      const dispPos = this.dispersionLine.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i <= this.dispSegments; i++) {
        const frac = i / this.dispSegments;
        const ka = frac * Math.PI; // k from 0 to pi/a
        const omega = omegaMax * Math.abs(Math.sin(ka / 2));
        const dx = x + frac * w;
        const dy = dispY - (omega / omegaMax) * dispH;
        dispPos.setXYZ(i, dx, dy, 0);
      }
      dispPos.needsUpdate = true;
      (this.dispersionLine.material as THREE.LineBasicMaterial).opacity = opacity * 0.5;
    }
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Random impulse on a few atoms
      const count = this.rng.int(1, 4);
      for (let i = 0; i < count; i++) {
        const idx = this.rng.int(1, this.atomCount - 2);
        this.atomVel[idx] += this.rng.float(-5, 5);
      }
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level >= 2) {
      const idx = Math.floor(this.atomCount / 2);
      this.atomVel[idx] += level * 1.5;
    }
  }
}
