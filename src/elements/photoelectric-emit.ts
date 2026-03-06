import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Photoelectric effect: photons hit a metal surface, and if above the
 * threshold frequency, electrons are ejected with kinetic energy
 * proportional to (frequency - threshold). Shows photon stream,
 * surface, and ejected electrons.
 */
export class PhotoelectricEmitElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'photoelectric-emit',
    meta: { shape: 'rectangular', roles: ['data-display', 'scanner'], moods: ['tactical', 'diagnostic'], bandAffinity: 'high', sizes: ['needs-medium', 'needs-large'] },
  };

  private photonCount = 0;
  private electronCount = 0;
  private maxPhotons = 0;
  private maxElectrons = 0;
  private frequency = 0;       // current photon frequency (normalized 0-1)
  private threshold = 0.4;     // threshold frequency
  private freqSweep = true;

  // Photon arrays (moving left to right toward surface)
  private phX!: Float32Array;
  private phY!: Float32Array;
  private phSpeed!: Float32Array;
  private phActive!: Uint8Array;

  // Electron arrays (ejected rightward from surface)
  private elX!: Float32Array;
  private elY!: Float32Array;
  private elVx!: Float32Array;
  private elVy!: Float32Array;
  private elActive!: Uint8Array;

  private photonPoints!: THREE.Points;
  private electronPoints!: THREE.Points;
  private surfaceLine!: THREE.LineSegments;
  private borderLines!: THREE.LineSegments;
  private freqBar!: THREE.LineSegments;
  private emitAccum = 0;

  build(): void {
    this.glitchAmount = 4;
    const variant = this.rng.int(0, 3);
    const presets = [
      { photons: 60, electrons: 40, threshold: 0.4, sweep: true },
      { photons: 80, electrons: 55, threshold: 0.3, sweep: true },
      { photons: 45, electrons: 30, threshold: 0.5, sweep: false },
      { photons: 70, electrons: 45, threshold: 0.35, sweep: true },
    ];
    const p = presets[variant];

    const { x, y, w, h } = this.px;
    this.maxPhotons = p.photons;
    this.maxElectrons = p.electrons;
    this.threshold = p.threshold;
    this.freqSweep = p.sweep;
    this.frequency = 0.5;

    this.phX = new Float32Array(this.maxPhotons);
    this.phY = new Float32Array(this.maxPhotons);
    this.phSpeed = new Float32Array(this.maxPhotons);
    this.phActive = new Uint8Array(this.maxPhotons);

    this.elX = new Float32Array(this.maxElectrons);
    this.elY = new Float32Array(this.maxElectrons);
    this.elVx = new Float32Array(this.maxElectrons);
    this.elVy = new Float32Array(this.maxElectrons);
    this.elActive = new Uint8Array(this.maxElectrons);

    // Photon points
    const phPositions = new Float32Array(this.maxPhotons * 3);
    const phGeo = new THREE.BufferGeometry();
    phGeo.setAttribute('position', new THREE.BufferAttribute(phPositions, 3));
    this.photonPoints = new THREE.Points(phGeo, new THREE.PointsMaterial({
      color: this.palette.primary, transparent: true, opacity: 0,
      size: Math.max(1, Math.min(w, h) * 0.016), sizeAttenuation: false,
    }));
    this.group.add(this.photonPoints);

    // Electron points
    const elPositions = new Float32Array(this.maxElectrons * 3);
    const elGeo = new THREE.BufferGeometry();
    elGeo.setAttribute('position', new THREE.BufferAttribute(elPositions, 3));
    this.electronPoints = new THREE.Points(elGeo, new THREE.PointsMaterial({
      color: this.palette.secondary, transparent: true, opacity: 0,
      size: Math.max(1, Math.min(w, h) * 0.02), sizeAttenuation: false,
    }));
    this.group.add(this.electronPoints);

    // Metal surface (vertical line at 40% from left)
    const surfX = x + w * 0.4;
    const sv = [surfX, y + h * 0.05, 0, surfX, y + h * 0.95, 0,
      surfX - 3, y + h * 0.05, 0, surfX - 3, y + h * 0.95, 0];
    const surfGeo = new THREE.BufferGeometry();
    surfGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(sv), 3));
    this.surfaceLine = new THREE.LineSegments(surfGeo, new THREE.LineBasicMaterial({
      color: this.palette.dim, transparent: true, opacity: 0,
    }));
    this.group.add(this.surfaceLine);

    // Frequency indicator bar at bottom
    const fbv = new Float32Array(4 * 3);
    const fbGeo = new THREE.BufferGeometry();
    fbGeo.setAttribute('position', new THREE.BufferAttribute(fbv, 3));
    this.freqBar = new THREE.LineSegments(fbGeo, new THREE.LineBasicMaterial({
      color: this.palette.primary, transparent: true, opacity: 0,
    }));
    this.group.add(this.freqBar);

    // Border
    const bv = [x, y, 0, x + w, y, 0, x + w, y, 0, x + w, y + h, 0,
      x + w, y + h, 0, x, y + h, 0, x, y + h, 0, x, y, 0];
    const borderGeo = new THREE.BufferGeometry();
    borderGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(bv), 3));
    this.borderLines = new THREE.LineSegments(borderGeo, new THREE.LineBasicMaterial({
      color: this.palette.dim, transparent: true, opacity: 0,
    }));
    this.group.add(this.borderLines);
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    const { x, y, w, h } = this.px;
    const surfX = x + w * 0.4;
    const cdt = Math.min(dt, 0.033);

    // Sweep frequency
    if (this.freqSweep) {
      this.frequency = 0.5 + 0.45 * Math.sin(time * 0.4);
    }

    const aboveThreshold = this.frequency > this.threshold;
    const excessEnergy = Math.max(0, this.frequency - this.threshold);

    // Emit photons from left
    this.emitAccum += cdt;
    if (this.emitAccum > 0.02) {
      this.emitAccum = 0;
      let emitted = 0;
      for (let i = 0; i < this.maxPhotons && emitted < 3; i++) {
        if (!this.phActive[i]) {
          this.phActive[i] = 1;
          this.phX[i] = x + this.rng.float(0, w * 0.05);
          this.phY[i] = y + h * 0.05 + this.rng.float(0, h * 0.9);
          this.phSpeed[i] = w * this.rng.float(0.6, 1.2);
          emitted++;
        }
      }
    }

    // Move photons
    const phPos = this.photonPoints.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < this.maxPhotons; i++) {
      if (this.phActive[i]) {
        this.phX[i] += this.phSpeed[i] * cdt;

        // Hit surface
        if (this.phX[i] >= surfX) {
          this.phActive[i] = 0;
          // Eject electron if above threshold
          if (aboveThreshold) {
            for (let e = 0; e < this.maxElectrons; e++) {
              if (!this.elActive[e]) {
                this.elActive[e] = 1;
                this.elX[e] = surfX + 3;
                this.elY[e] = this.phY[i] + this.rng.float(-5, 5);
                const speed = w * 0.3 * (0.3 + excessEnergy * 1.5);
                const angle = this.rng.float(-0.4, 0.4);
                this.elVx[e] = Math.cos(angle) * speed;
                this.elVy[e] = Math.sin(angle) * speed;
                break;
              }
            }
          }
          this.phX[i] = surfX; // clamp for display this frame
        }

        phPos.setXYZ(i, this.phX[i], this.phY[i], 0.5);
      } else {
        phPos.setXYZ(i, x - w * 0.05, y - h * 0.05, 0); // hide offscreen
      }
    }
    phPos.needsUpdate = true;

    // Move electrons
    const elPos = this.electronPoints.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let e = 0; e < this.maxElectrons; e++) {
      if (this.elActive[e]) {
        this.elX[e] += this.elVx[e] * cdt;
        this.elY[e] += this.elVy[e] * cdt;

        const oobPad = Math.min(w, h) * 0.04;
        if (this.elX[e] > x + w + oobPad || this.elY[e] < y - oobPad || this.elY[e] > y + h + oobPad) {
          this.elActive[e] = 0;
        }
        elPos.setXYZ(e, this.elX[e], this.elY[e], 0.5);
      } else {
        elPos.setXYZ(e, x - w * 0.05, y - h * 0.05, 0);
      }
    }
    elPos.needsUpdate = true;

    // Update frequency bar
    const fbPos = this.freqBar.geometry.getAttribute('position') as THREE.BufferAttribute;
    const barY = y + h * 0.97;
    const barLeft = x + w * 0.05;
    const barRight = x + w * 0.35;
    const freqX = barLeft + this.frequency * (barRight - barLeft);
    const threshX = barLeft + this.threshold * (barRight - barLeft);
    // Threshold marker
    fbPos.setXYZ(0, threshX, barY - 4, 0.5);
    fbPos.setXYZ(1, threshX, barY + 4, 0.5);
    // Current frequency marker
    fbPos.setXYZ(2, freqX, barY - 3, 0.5);
    fbPos.setXYZ(3, freqX, barY + 3, 0.5);
    fbPos.needsUpdate = true;

    // Color photons based on frequency
    const phMat = this.photonPoints.material as THREE.PointsMaterial;
    if (aboveThreshold) {
      phMat.color.copy(this.palette.primary);
    } else {
      phMat.color.copy(this.palette.dim);
    }

    phMat.opacity = opacity;
    (this.electronPoints.material as THREE.PointsMaterial).opacity = opacity;
    (this.surfaceLine.material as THREE.LineBasicMaterial).opacity = opacity * 0.8;
    (this.freqBar.material as THREE.LineBasicMaterial).opacity = opacity * 0.8;
    (this.borderLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.4;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Burst of high-energy photons
      this.frequency = 0.95;
      this.freqSweep = false;
      setTimeout(() => { this.freqSweep = true; }, 1000);
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) return;
    this.frequency = Math.min(1, this.frequency + level * 0.05);
  }
}
