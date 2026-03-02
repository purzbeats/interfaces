import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * ECG/heartbeat-style sharp pulse waveform with scrolling trace.
 * Clean flatline punctuated by sharp QRS-complex-like spikes.
 */
export class PulseWaveElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'pulse-wave',
    meta: { shape: 'linear', roles: ['data-display', 'gauge'], moods: ['diagnostic'], sizes: ['works-small', 'needs-medium'] },
  };
  private traceLine!: THREE.Line;
  private gridLines!: THREE.LineSegments;
  private numPoints: number = 0;
  private scrollSpeed: number = 0;
  private heartRate: number = 0;
  private phaseOffset: number = 0;
  private noiseAmp: number = 0;
  private flatline: boolean = false;

  build(): void {
    this.glitchAmount = 6;
    const { x, y, w, h } = this.px;
    this.numPoints = Math.max(80, Math.floor(w / 2));
    this.scrollSpeed = this.rng.float(60, 120);
    this.heartRate = this.rng.float(0.8, 1.6); // beats per second
    this.phaseOffset = this.rng.float(0, 100);
    this.noiseAmp = h * 0.01;

    // Background grid
    const gridVerts: number[] = [];
    const gridSpacingX = w / 10;
    const gridSpacingY = h / 6;
    for (let gx = 0; gx <= 10; gx++) {
      const px = x + gx * gridSpacingX;
      gridVerts.push(px, y, 0, px, y + h, 0);
    }
    for (let gy = 0; gy <= 6; gy++) {
      const py = y + gy * gridSpacingY;
      gridVerts.push(x, py, 0, x + w, py, 0);
    }
    const gridGeo = new THREE.BufferGeometry();
    gridGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(gridVerts), 3));
    this.gridLines = new THREE.LineSegments(gridGeo, new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.gridLines);

    // Trace line
    const positions = new Float32Array(this.numPoints * 3);
    const cy = y + h / 2;
    for (let i = 0; i < this.numPoints; i++) {
      positions[i * 3] = x + (i / (this.numPoints - 1)) * w;
      positions[i * 3 + 1] = cy;
      positions[i * 3 + 2] = 1;
    }
    const traceGeo = new THREE.BufferGeometry();
    traceGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.traceLine = new THREE.Line(traceGeo, new THREE.LineBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.traceLine);
  }

  private ecgWave(t: number): number {
    // Normalized t within one beat cycle [0,1]
    const cycle = t % 1;

    // P-wave (small bump)
    if (cycle > 0.05 && cycle < 0.15) {
      const p = (cycle - 0.05) / 0.10;
      return Math.sin(p * Math.PI) * 0.12;
    }
    // QRS complex (sharp spike)
    if (cycle > 0.18 && cycle < 0.22) {
      const q = (cycle - 0.18) / 0.04;
      if (q < 0.25) return -0.15 * (q / 0.25); // Q dip
      if (q < 0.5) return -0.15 + (0.15 + 1.0) * ((q - 0.25) / 0.25); // R spike up
      if (q < 0.75) return 1.0 - 1.25 * ((q - 0.5) / 0.25); // R down past baseline
      return -0.25 + 0.25 * ((q - 0.75) / 0.25); // S return
    }
    // T-wave (gentle bump)
    if (cycle > 0.30 && cycle < 0.45) {
      const tw = (cycle - 0.30) / 0.15;
      return Math.sin(tw * Math.PI) * 0.2;
    }
    return 0; // flatline
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);

    (this.gridLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.15;
    (this.traceLine.material as THREE.LineBasicMaterial).opacity = opacity * 0.9;

    const { y, h } = this.px;
    const cy = y + h / 2;
    const amp = h * 0.35;
    const pos = this.traceLine.geometry.getAttribute('position') as THREE.BufferAttribute;

    const scrollPhase = time * this.heartRate + this.phaseOffset;

    for (let i = 0; i < this.numPoints; i++) {
      const t = i / this.numPoints;
      // Each point represents a different moment in time
      const pointPhase = scrollPhase - t * 2.5;
      let val: number;
      if (this.flatline) {
        val = (Math.random() - 0.5) * 0.02;
      } else {
        val = this.ecgWave(pointPhase);
        // Add subtle noise
        val += (Math.sin(i * 3.7 + time * 11) * 0.5 + Math.sin(i * 7.3 + time * 17) * 0.3) * this.noiseAmp / amp;
      }
      pos.setY(i, cy + val * amp);
    }
    pos.needsUpdate = true;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'pulse') { this.emitAudio('seekSound', 300); }
    if (action === 'glitch') {
      this.flatline = !this.flatline;
      if (this.flatline) {
        (this.traceLine.material as THREE.LineBasicMaterial).color.copy(this.palette.alert);
      } else {
        (this.traceLine.material as THREE.LineBasicMaterial).color.copy(this.palette.primary);
      }
    }
    if (action === 'alert') {
      this.heartRate *= 1.8;
      (this.traceLine.material as THREE.LineBasicMaterial).color.copy(this.palette.alert);
    }
  }
}
