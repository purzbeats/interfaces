import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';
import type { AudioFrame } from '../audio/audio-reactive';

export class WaveformElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'waveform',
    meta: { shape: 'linear', roles: ['data-display'], moods: ['diagnostic'], bandAffinity: 'bass', audioSensitivity: 0.5, sizes: ['works-small'] },
  };
  private line!: THREE.Line;
  private numPoints: number = 0;
  private frequency: number = 0;
  private amplitude: number = 0;
  private phase: number = 0;
  private noiseFreq: number = 0;
  private waveType: number = 0;
  private liveWaveform: Float32Array | null = null;

  build(): void {
    const variant = this.rng.int(0, 3);
    const presets = [
      { numPoints: [64, 200] as const, frequency: [2, 8] as const, amplitude: [0.3, 0.45] as const, noiseFreq: [5, 20] as const, waveType: -1 },
      { numPoints: [200, 400] as const, frequency: [6, 15] as const, amplitude: [0.35, 0.5] as const, noiseFreq: [15, 40] as const, waveType: 2 },
      { numPoints: [32, 80] as const, frequency: [1, 3] as const, amplitude: [0.2, 0.35] as const, noiseFreq: [2, 8] as const, waveType: 0 },
      { numPoints: [100, 250] as const, frequency: [4, 12] as const, amplitude: [0.4, 0.5] as const, noiseFreq: [20, 50] as const, waveType: 1 },
    ];
    const p = presets[variant];

    this.glitchAmount = 5;
    this.numPoints = this.rng.int(p.numPoints[0], p.numPoints[1]);
    this.frequency = this.rng.float(p.frequency[0], p.frequency[1]);
    this.amplitude = this.rng.float(p.amplitude[0], p.amplitude[1]);
    this.phase = this.rng.float(0, Math.PI * 2);
    this.noiseFreq = this.rng.float(p.noiseFreq[0], p.noiseFreq[1]);
    this.waveType = p.waveType >= 0 ? p.waveType : this.rng.int(0, 3);

    const positions = new Float32Array(this.numPoints * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.line = new THREE.Line(geo, new THREE.LineBasicMaterial({
      color: this.palette.secondary,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.line);

    // Border
    const { x, y, w, h } = this.px;
    const bv = new Float32Array([
      x, y, 0, x + w, y, 0,
      x + w, y, 0, x + w, y + h, 0,
      x + w, y + h, 0, x, y + h, 0,
      x, y + h, 0, x, y, 0,
    ]);
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.BufferAttribute(bv, 3));
    this.group.add(new THREE.LineSegments(bg, new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    })));
  }

  tickAudio(frame: AudioFrame): void {
    this.liveWaveform = frame.waveform;
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    const { x, y, w, h } = this.px;
    const gx = this.group.position.x;

    const positions = this.line.geometry.getAttribute('position') as THREE.BufferAttribute;
    const cy = y + h / 2;
    const amp = h * Math.min(this.amplitude, 0.45);

    const live = this.liveWaveform;

    for (let i = 0; i < this.numPoints; i++) {
      const t = i / (this.numPoints - 1);
      const px = x + w * t + gx;

      let value: number;

      if (live) {
        // Real audio waveform — interpolate from 128-sample buffer
        const samplePos = t * (live.length - 1);
        const idx = Math.floor(samplePos);
        const frac = samplePos - idx;
        const a = live[idx];
        const b = live[Math.min(idx + 1, live.length - 1)];
        value = a + (b - a) * frac;
      } else {
        // Procedural fallback
        switch (this.waveType) {
          case 0:
            value = Math.sin(t * this.frequency * Math.PI * 2 + time * 3 + this.phase);
            break;
          case 1:
            value = ((t * this.frequency + time * 0.5) % 1) * 2 - 1;
            value += Math.sin(t * this.noiseFreq + time * 5) * 0.3;
            break;
          default:
            value = Math.sin(t * this.frequency * Math.PI * 2 + time * 2 + this.phase)
              + Math.sin(t * this.frequency * 1.5 * Math.PI * 2 + time * 3) * 0.5
              + Math.sin(t * this.noiseFreq + time * 7) * 0.15;
            value /= 1.65;
        }
      }

      // Glitch: inject spikes
      if (this.glitchTimer > 0 && Math.sin(i * 3.7 + this.glitchTimer * 50) > 0.8) {
        value += (Math.sin(i * 17.3) > 0 ? 1 : -1) * 0.5 * this.glitchTimer;
      }

      value = Math.max(-1, Math.min(1, value));
      positions.setXYZ(i, px, cy + value * amp, 1);
    }
    positions.needsUpdate = true;
    (this.line.material as THREE.LineBasicMaterial).opacity = opacity;

    this.group.children.forEach((child) => {
      if (child instanceof THREE.LineSegments) {
        (child.material as THREE.LineBasicMaterial).opacity = opacity * 0.3;
      }
    });
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) {
      this.amplitude = this.rng.float(0.3, 0.45);
      this.noiseFreq = this.rng.float(5, 20);
      return;
    }
    // Boost amplitude proportional to level
    this.amplitude = 0.35 + level * 0.04;
    // Inject noise/jaggedness proportional to level
    this.noiseFreq = 10 + level * 5;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      this.frequency = this.rng.float(2, 12);
    }
    if (action === 'alert') {
      (this.line.material as THREE.LineBasicMaterial).color.copy(this.palette.alert);
    }
  }
}
