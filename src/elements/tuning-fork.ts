import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Vibrating tuning fork — Y-shaped line with oscillating prongs
 * and emanating sound wave arcs. Amplitude decays then re-strikes.
 */
export class TuningForkElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'tuning-fork',
    meta: {
      shape: 'linear',
      roles: ['decorative'],
      moods: ['ambient'],
      sizes: ['works-small', 'needs-medium'],
    },
  };

  private forkLines!: THREE.LineSegments;
  private waveLines!: THREE.LineSegments;

  private readonly WAVE_COUNT = 3;
  private readonly WAVE_SEGMENTS = 12;

  // Fork geometry
  private handleBottom: number = 0;
  private forkJunction: number = 0;
  private prongTop: number = 0;
  private forkCx: number = 0;
  private prongSpread: number = 0;

  // Vibration state
  private vibrateAmplitude: number = 0;
  private vibrateFreq: number = 0;
  private strikeTimer: number = 0;
  private strikeInterval: number = 0;
  private decayRate: number = 0;

  build(): void {
    const { x, y, w, h } = this.px;

    this.forkCx = x + w * 0.5;
    this.handleBottom = y + h * 0.9;
    this.forkJunction = y + h * 0.45;
    this.prongTop = y + h * 0.08;
    this.prongSpread = w * 0.2;
    this.vibrateFreq = this.rng.float(18, 28);
    this.decayRate = this.rng.float(1.2, 2.5);
    this.strikeInterval = this.rng.float(3.0, 6.0);
    this.strikeTimer = 0; // strike immediately
    this.vibrateAmplitude = 1.0;

    // Fork: handle + two prongs. Pre-allocate for dynamic prong tips.
    // Handle: 1 segment. Left prong: 1 segment. Right prong: 1 segment. = 3 segments = 6 verts
    const forkGeo = new THREE.BufferGeometry();
    forkGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(6 * 3), 3));
    this.forkLines = new THREE.LineSegments(forkGeo, new THREE.LineBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.forkLines);

    // Sound wave arcs emanating from prong tips
    // Each wave: arc of WAVE_SEGMENTS line segments = WAVE_SEGMENTS * 2 verts
    // Total: WAVE_COUNT * 2 (left + right) * WAVE_SEGMENTS * 2 verts
    const waveVertCount = this.WAVE_COUNT * 2 * this.WAVE_SEGMENTS * 2 * 3;
    const waveGeo = new THREE.BufferGeometry();
    waveGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(waveVertCount), 3));
    this.waveLines = new THREE.LineSegments(waveGeo, new THREE.LineBasicMaterial({
      color: this.palette.secondary,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.waveLines);
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);

    // Re-strike timer
    this.strikeTimer += dt;
    if (this.strikeTimer >= this.strikeInterval) {
      this.strikeTimer = 0;
      this.vibrateAmplitude = 1.0;
      this.strikeInterval = this.rng.float(3.0, 6.0);
    }

    // Decay amplitude
    this.vibrateAmplitude = Math.max(0, this.vibrateAmplitude - this.decayRate * dt);

    const vibOffset = Math.sin(time * this.vibrateFreq) * this.vibrateAmplitude * this.prongSpread * 0.3;

    // Update fork geometry
    const fPos = this.forkLines.geometry.getAttribute('position') as THREE.BufferAttribute;

    // Handle: bottom to junction
    fPos.setXYZ(0, this.forkCx, this.handleBottom, 0);
    fPos.setXYZ(1, this.forkCx, this.forkJunction, 0);

    // Left prong: junction to top-left (with vibration at tip)
    const leftTipX = this.forkCx - this.prongSpread - vibOffset;
    fPos.setXYZ(2, this.forkCx, this.forkJunction, 0);
    fPos.setXYZ(3, leftTipX, this.prongTop, 0);

    // Right prong: junction to top-right (with vibration at tip)
    const rightTipX = this.forkCx + this.prongSpread + vibOffset;
    fPos.setXYZ(4, this.forkCx, this.forkJunction, 0);
    fPos.setXYZ(5, rightTipX, this.prongTop, 0);

    fPos.needsUpdate = true;

    // Sound waves emanating from prong tips
    const wPos = this.waveLines.geometry.getAttribute('position') as THREE.BufferAttribute;
    let vi = 0;
    const waveOpacity = opacity * this.vibrateAmplitude * 0.6;

    for (let w = 0; w < this.WAVE_COUNT; w++) {
      const waveAge = (this.strikeTimer + w * 0.4) * 1.5;
      const waveRadius = waveAge * 15;
      const waveFade = Math.max(0, 1 - waveAge * 0.3);
      if (waveFade <= 0) {
        // Still need to write zeros to keep buffer valid
        for (let s = 0; s < this.WAVE_SEGMENTS * 2; s++) {
          wPos.setXYZ(vi++, 0, 0, -10);
        }
        for (let s = 0; s < this.WAVE_SEGMENTS * 2; s++) {
          wPos.setXYZ(vi++, 0, 0, -10);
        }
        continue;
      }

      // Left prong wave arc (quarter circle, pointing left-up)
      for (let s = 0; s < this.WAVE_SEGMENTS; s++) {
        const a1 = (Math.PI * 0.5) + (Math.PI * 0.5) * (s / this.WAVE_SEGMENTS);
        const a2 = (Math.PI * 0.5) + (Math.PI * 0.5) * ((s + 1) / this.WAVE_SEGMENTS);
        wPos.setXYZ(vi++, leftTipX + Math.cos(a1) * waveRadius, this.prongTop + Math.sin(a1) * waveRadius, 0);
        wPos.setXYZ(vi++, leftTipX + Math.cos(a2) * waveRadius, this.prongTop + Math.sin(a2) * waveRadius, 0);
      }

      // Right prong wave arc (quarter circle, pointing right-up)
      for (let s = 0; s < this.WAVE_SEGMENTS; s++) {
        const a1 = (Math.PI * 0.5) * (s / this.WAVE_SEGMENTS);
        const a2 = (Math.PI * 0.5) * ((s + 1) / this.WAVE_SEGMENTS);
        wPos.setXYZ(vi++, rightTipX + Math.cos(a1) * waveRadius, this.prongTop + Math.sin(a1) * waveRadius, 0);
        wPos.setXYZ(vi++, rightTipX + Math.cos(a2) * waveRadius, this.prongTop + Math.sin(a2) * waveRadius, 0);
      }
    }

    wPos.needsUpdate = true;
    this.waveLines.geometry.setDrawRange(0, vi);

    (this.forkLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.8;
    (this.waveLines.material as THREE.LineBasicMaterial).opacity = waveOpacity;
  }
}
