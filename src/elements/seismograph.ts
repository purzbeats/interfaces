import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';
import type { AudioFrame } from '../audio/audio-reactive';

/**
 * Seismograph trace with a scrolling pen line.
 * Jittery baseline with layered sine noise and occasional spikes.
 */
export class SeismographElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'seismograph',
    meta: { shape: 'linear', roles: ['data-display', 'gauge'], moods: ['diagnostic'], sizes: ['works-small', 'needs-medium'] },
  };
  private line!: THREE.Line;
  private numPoints: number = 0;
  private borderLines!: THREE.LineSegments;
  private spikeChance: number = 0;
  private noiseScale: number = 0;
  private alertMode: boolean = false;
  private liveWaveform: Float32Array | null = null;

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;

    // ~1 vertex per 2px
    this.numPoints = Math.max(32, Math.floor(w / 2));
    this.spikeChance = this.rng.float(0.01, 0.04);
    this.noiseScale = this.rng.float(0.15, 0.35);

    // Seismograph line
    const positions = new Float32Array(this.numPoints * 3);
    const cy = y + h / 2;
    for (let i = 0; i < this.numPoints; i++) {
      positions[i * 3] = x + (i / (this.numPoints - 1)) * w;
      positions[i * 3 + 1] = cy;
      positions[i * 3 + 2] = 1;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.line = new THREE.Line(geo, new THREE.LineBasicMaterial({
      color: this.palette.secondary,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.line);

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

  tickAudio(frame: AudioFrame): void {
    this.liveWaveform = frame.waveform;
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    const { x, y, w, h } = this.px;
    const cy = y + h / 2;
    const amp = h * this.noiseScale;

    const positions = this.line.geometry.getAttribute('position') as THREE.BufferAttribute;

    // Shift all vertices left by one slot
    for (let i = 0; i < this.numPoints - 1; i++) {
      positions.setY(i, positions.getY(i + 1));
    }

    let value: number;

    if (this.liveWaveform) {
      // Use the peak of the current waveform buffer as the pen value
      let maxAbs = 0;
      let maxVal = 0;
      for (let i = 0; i < this.liveWaveform.length; i++) {
        const abs = Math.abs(this.liveWaveform[i]);
        if (abs > maxAbs) {
          maxAbs = abs;
          maxVal = this.liveWaveform[i];
        }
      }
      value = maxVal * 2; // scale up for visual impact
    } else {
      // Procedural fallback
      value = Math.sin(time * 3.0) * 0.3
        + Math.sin(time * 7.3) * 0.2
        + Math.sin(time * 13.7) * 0.1;

      // Occasional spike
      if (this.rng.chance(this.spikeChance)) {
        value += this.rng.float(-1, 1) * 1.5;
      }
    }

    // Glitch makes spikes more frequent
    if (this.glitchTimer > 0) {
      value += Math.sin(time * 47) * 0.8 * this.glitchTimer;
    }

    positions.setY(this.numPoints - 1, cy + value * amp);

    // Re-position x coords (in case of resize)
    for (let i = 0; i < this.numPoints; i++) {
      positions.setX(i, x + (i / (this.numPoints - 1)) * w);
    }
    positions.needsUpdate = true;

    const lineColor = this.alertMode ? this.palette.alert : this.palette.secondary;
    (this.line.material as THREE.LineBasicMaterial).color.copy(lineColor);
    (this.line.material as THREE.LineBasicMaterial).opacity = opacity;
    (this.borderLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.3;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      this.noiseScale = this.rng.float(0.3, 0.5);
      setTimeout(() => { this.noiseScale = this.rng.float(0.15, 0.35); }, 500);
    }
    if (action === 'alert') {
      this.alertMode = true;
      this.pulseTimer = 1.5;
      setTimeout(() => { this.alertMode = false; }, 3000);
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) { this.alertMode = false; return; }
    if (level >= 4) { this.alertMode = true; }
  }
}
