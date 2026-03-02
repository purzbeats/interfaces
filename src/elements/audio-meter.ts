import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';
import type { AudioFrame } from '../audio/audio-reactive';

/**
 * Dual VU meter with peak hold indicators.
 * Two columns of PlaneGeometry segments with spring physics, peak Lines fall slowly.
 */
export class AudioMeterElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'audio-meter',
    meta: { shape: 'rectangular', roles: ['gauge', 'data-display'], moods: ['diagnostic'], sizes: ['works-small', 'needs-medium'] },
  };
  private bars: THREE.Mesh[][] = [[], []];
  private levels: number[] = [0, 0];
  private targets: number[] = [0, 0];
  private velocities: number[] = [0, 0];
  private peaks: number[] = [0, 0];
  private peakHold: number[] = [0, 0];
  private peakLines: THREE.Line[] = [];
  private borderLines!: THREE.LineSegments;
  private segmentCount: number = 0;
  private updateTimer: number = 0;
  private updateInterval: number = 0;
  private liveRms: number = -1;
  private liveBands: Float32Array | null = null;
  build(): void {
    this.glitchAmount = 3;
    const { x, y, w, h } = this.px;
    this.segmentCount = this.rng.int(12, 24);
    this.updateInterval = this.rng.float(0.1, 0.4);

    const colW = w * 0.35;
    const gap = w * 0.04;
    const segH = (h * 0.85) / this.segmentCount;
    const segGap = segH * 0.15;

    for (let ch = 0; ch < 2; ch++) {
      const colX = x + (ch === 0 ? w * 0.1 : w * 0.55);
      for (let i = 0; i < this.segmentCount; i++) {
        const sy = y + h * 0.05 + i * segH;
        const geo = new THREE.PlaneGeometry(colW, segH - segGap);
        const mat = new THREE.MeshBasicMaterial({
          color: this.palette.primary,
          transparent: true,
          opacity: 0,
        });
        const bar = new THREE.Mesh(geo, mat);
        bar.position.set(colX + colW / 2, sy + (segH - segGap) / 2, 1);
        this.bars[ch].push(bar);
        this.group.add(bar);
      }

      // Peak hold line
      const peakGeo = new THREE.BufferGeometry();
      peakGeo.setAttribute('position', new THREE.Float32BufferAttribute([
        colX, y + h * 0.05, 2, colX + colW, y + h * 0.05, 2,
      ], 3));
      const peakLine = new THREE.Line(peakGeo, new THREE.LineBasicMaterial({
        color: this.palette.secondary,
        transparent: true,
        opacity: 0,
      }));
      this.peakLines.push(peakLine);
      this.group.add(peakLine);
    }

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
    const { y, h } = this.px;

    // Update targets: real audio or procedural
    if (this.liveBands) {
      // Ch 0 = bass-weighted (sub+bass), Ch 1 = mid-weighted (mid+high)
      this.targets[0] = Math.min(1, (this.liveBands[0] + this.liveBands[1]) * 1.2);
      this.targets[1] = Math.min(1, (this.liveBands[2] + this.liveBands[3]) * 1.2);
    } else {
      this.updateTimer += dt;
      if (this.updateTimer >= this.updateInterval) {
        this.updateTimer = 0;
        for (let ch = 0; ch < 2; ch++) {
          this.targets[ch] = this.rng.float(0.05, 1.0);
        }
      }
    }

    // Spring physics per channel
    for (let ch = 0; ch < 2; ch++) {
      const force = (this.targets[ch] - this.levels[ch]) * 30;
      this.velocities[ch] += force * dt;
      this.velocities[ch] *= Math.exp(-5 * dt);
      this.levels[ch] += this.velocities[ch] * dt;
      this.levels[ch] = Math.max(0, Math.min(1.1, this.levels[ch]));

      // Update peak
      if (this.levels[ch] > this.peaks[ch]) {
        this.peaks[ch] = this.levels[ch];
        this.peakHold[ch] = 0.5; // hold for 0.5s
      }
      this.peakHold[ch] -= dt;
      if (this.peakHold[ch] <= 0) {
        this.peaks[ch] -= dt * 0.8; // slow fall
      }
      this.peaks[ch] = Math.max(0, this.peaks[ch]);

      // Update bar visibility
      const litCount = Math.floor(this.levels[ch] * this.segmentCount);
      for (let i = 0; i < this.segmentCount; i++) {
        const isLit = i < litCount;
        const isHot = i > this.segmentCount * 0.8;
        const mat = this.bars[ch][i].material as THREE.MeshBasicMaterial;
        mat.opacity = isLit ? opacity * 0.7 : opacity * 0.08;
        mat.color.copy(isHot && isLit ? this.palette.alert : this.palette.primary);
      }

      // Update peak line
      const peakY = y + h * 0.05 + this.peaks[ch] * h * 0.85;
      const peakPos = this.peakLines[ch].geometry.getAttribute('position') as THREE.BufferAttribute;
      peakPos.setY(0, peakY);
      peakPos.setY(1, peakY);
      peakPos.needsUpdate = true;
      (this.peakLines[ch].material as THREE.LineBasicMaterial).opacity = opacity * 0.8;
    }

    (this.borderLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.3;
  }

  tickAudio(frame: AudioFrame): void {
    this.liveRms = frame.rms;
    this.liveBands = frame.bands;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'pulse') {
      this.velocities[0] += 3;
      this.velocities[1] += 3;
    }
    if (action === 'glitch') {
      this.levels[0] = this.rng.float(0, 1);
      this.levels[1] = this.rng.float(0, 1);
    }
    if (action === 'alert') {
      this.targets[0] = 1;
      this.targets[1] = 1;
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) return;
    const boost = level * 0.15;
    for (let ch = 0; ch < 2; ch++) {
      this.targets[ch] = Math.min(1.0, this.targets[ch] + boost);
      this.velocities[ch] += level * 0.5;
    }
  }
}
