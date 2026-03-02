import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Multi-band spectrum analyzer bars with peak-hold markers.
 * Spring physics per bar with independently animated peak dots.
 */
export class FreqAnalyzerElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'freq-analyzer',
    meta: { shape: 'rectangular', roles: ['data-display', 'gauge'], moods: ['diagnostic'], sizes: ['works-small', 'needs-medium'] },
  };
  private bars: THREE.Mesh[] = [];
  private peakLines!: THREE.LineSegments;
  private borderLines!: THREE.LineSegments;
  private barValues: number[] = [];
  private barTargets: number[] = [];
  private barVelocities: number[] = [];
  private peakValues: number[] = [];
  private peakFallSpeeds: number[] = [];
  private barCount: number = 0;
  private updateTimer: number = 0;
  private updateInterval: number = 0;

  build(): void {
    this.glitchAmount = 3;
    const { x, y, w, h } = this.px;
    this.barCount = this.rng.int(12, 32);
    this.updateInterval = this.rng.float(0.08, 0.25);
    const gap = Math.max(1, w * 0.01);
    const barW = (w - gap * (this.barCount + 1)) / this.barCount;

    for (let i = 0; i < this.barCount; i++) {
      const bx = x + gap + (barW + gap) * i;
      const geo = new THREE.PlaneGeometry(barW, 1);
      const mat = new THREE.MeshBasicMaterial({
        color: this.palette.primary,
        transparent: true,
        opacity: 0,
      });
      const bar = new THREE.Mesh(geo, mat);
      bar.position.set(bx + barW / 2, y, 1);
      this.bars.push(bar);
      this.group.add(bar);

      const initial = this.rng.float(0.1, 0.8);
      this.barValues.push(initial);
      this.barTargets.push(initial);
      this.barVelocities.push(0);
      this.peakValues.push(initial);
      this.peakFallSpeeds.push(this.rng.float(0.1, 0.3));
    }

    // Peak hold markers (one horizontal dash per bar)
    const peakVerts = new Float32Array(this.barCount * 6);
    const peakGeo = new THREE.BufferGeometry();
    peakGeo.setAttribute('position', new THREE.BufferAttribute(peakVerts, 3));
    this.peakLines = new THREE.LineSegments(peakGeo, new THREE.LineBasicMaterial({
      color: this.palette.secondary,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.peakLines);

    // Border
    const bv = new Float32Array([
      x, y, 0, x + w, y, 0,
      x + w, y, 0, x + w, y + h, 0,
      x + w, y + h, 0, x, y + h, 0,
      x, y + h, 0, x, y, 0,
    ]);
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.BufferAttribute(bv, 3));
    this.borderLines = new THREE.LineSegments(bg, new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.borderLines);
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);
    const { x, y, w, h } = this.px;

    // Update targets periodically
    this.updateTimer += dt;
    if (this.updateTimer >= this.updateInterval) {
      this.updateTimer = 0;
      for (let i = 0; i < this.barCount; i++) {
        // Simulate spectrum shape - center frequencies tend higher
        const center = this.barCount / 2;
        const dist = Math.abs(i - center) / center;
        this.barTargets[i] = this.rng.float(0.05, 1.0 - dist * 0.4);
      }
    }

    const gap = Math.max(1, w * 0.01);
    const barW = (w - gap * (this.barCount + 1)) / this.barCount;
    const peakPos = this.peakLines.geometry.getAttribute('position') as THREE.BufferAttribute;

    for (let i = 0; i < this.barCount; i++) {
      // Spring physics
      const force = (this.barTargets[i] - this.barValues[i]) * 30;
      this.barVelocities[i] += force * dt;
      this.barVelocities[i] *= Math.exp(-5 * dt);
      this.barValues[i] += this.barVelocities[i] * dt;
      this.barValues[i] = Math.max(0.01, Math.min(1.2, this.barValues[i]));

      const bh = h * Math.min(this.barValues[i], 1);
      this.bars[i].scale.y = bh;
      this.bars[i].position.y = y + bh / 2;
      (this.bars[i].material as THREE.MeshBasicMaterial).opacity = opacity * 0.6;

      // Color by intensity
      const isHot = this.barValues[i] > 0.8;
      (this.bars[i].material as THREE.MeshBasicMaterial).color.copy(
        isHot ? this.palette.secondary : this.palette.primary
      );

      // Peak hold
      if (this.barValues[i] > this.peakValues[i]) {
        this.peakValues[i] = this.barValues[i];
      } else {
        this.peakValues[i] -= this.peakFallSpeeds[i] * dt;
        this.peakValues[i] = Math.max(this.barValues[i], this.peakValues[i]);
      }

      const bx = x + gap + (barW + gap) * i;
      const peakY = y + h * Math.min(this.peakValues[i], 1);
      peakPos.setXYZ(i * 2, bx, peakY, 2);
      peakPos.setXYZ(i * 2 + 1, bx + barW, peakY, 2);
    }
    peakPos.needsUpdate = true;

    (this.peakLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.8;
    (this.borderLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.3;
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) return;
    for (let i = 0; i < this.barCount; i++) {
      if (level >= 5) {
        this.barTargets[i] = 1.0;
      }
      this.barVelocities[i] += level * (level >= 3 ? 2 : 1);
    }
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'pulse') {
      for (let i = 0; i < this.barCount; i++) {
        this.barVelocities[i] += this.rng.float(2, 5);
      }
    }
    if (action === 'glitch') {
      for (let i = 0; i < this.barCount; i++) {
        this.barTargets[i] = this.rng.chance(0.5) ? 1 : 0;
      }
    }
    if (action === 'alert') {
      this.pulseTimer = 1.5;
      for (let i = 0; i < this.barCount; i++) {
        this.barTargets[i] = 1.0;
        this.barVelocities[i] = 5;
      }
    }
  }
}
