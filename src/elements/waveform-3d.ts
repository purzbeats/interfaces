import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';
import type { AudioFrame } from '../audio/audio-reactive';

/**
 * Multiple offset waveform lines creating a pseudo-3D layered effect.
 * Joy Division / Unknown Pleasures aesthetic with depth-based dimming.
 */
export class Waveform3dElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'waveform-3d',
    meta: { shape: 'rectangular', roles: ['data-display', 'decorative'], moods: ['diagnostic', 'ambient'], sizes: ['needs-medium', 'needs-large'] },
  };
  private lines: THREE.Line[] = [];
  private borderLines!: THREE.LineSegments;
  private lineCount: number = 0;
  private pointsPerLine: number = 0;
  private frequencies: number[] = [];
  private phases: number[] = [];
  private liveWaveform: Float32Array | null = null;
  /** Ring buffer of past waveforms for the stacked layers. */
  private waveformHistory: Float32Array[] = [];

  build(): void {
    this.glitchAmount = 5;
    const { x, y, w, h } = this.px;

    this.lineCount = this.rng.int(8, 15);
    this.pointsPerLine = Math.max(40, Math.floor(w / 3));

    for (let i = 0; i < this.lineCount; i++) {
      this.frequencies.push(this.rng.float(2, 6));
      this.phases.push(this.rng.float(0, Math.PI * 2));

      const positions = new Float32Array(this.pointsPerLine * 3);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

      // Lines further back are dimmer
      const depth = i / (this.lineCount - 1); // 0 = back, 1 = front
      const color = new THREE.Color().copy(this.palette.dim).lerp(this.palette.primary, depth);

      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity: 0,
      }));
      this.lines.push(line);
      this.group.add(line);
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

  tickAudio(frame: AudioFrame): void {
    this.liveWaveform = frame.waveform;
    // Push a copy into the history ring buffer (front = newest)
    this.waveformHistory.unshift(new Float32Array(frame.waveform));
    while (this.waveformHistory.length > this.lineCount) {
      this.waveformHistory.pop();
    }
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    const { x, y, w, h } = this.px;

    const margin = h * 0.1;
    const usableH = h - margin * 2;
    const hasLive = this.waveformHistory.length > 0;

    for (let li = 0; li < this.lineCount; li++) {
      const line = this.lines[li];
      const depth = li / (this.lineCount - 1); // 0 = back, 1 = front
      const baseY = y + margin + (1 - depth) * usableH;
      const waveAmp = h * 0.06 * (0.3 + depth * 0.7);
      const freq = this.frequencies[li];
      const phase = this.phases[li];

      // Front line (li = lineCount-1) uses newest waveform, back uses oldest
      const histIdx = this.lineCount - 1 - li;
      const liveData = hasLive && histIdx < this.waveformHistory.length
        ? this.waveformHistory[histIdx]
        : null;

      const positions = line.geometry.getAttribute('position') as THREE.BufferAttribute;

      for (let p = 0; p < this.pointsPerLine; p++) {
        const t = p / (this.pointsPerLine - 1);
        const px = x + t * w;
        const envelope = Math.sin(t * Math.PI);

        let value: number;

        if (liveData) {
          // Real audio: interpolate from waveform buffer
          const samplePos = t * (liveData.length - 1);
          const idx = Math.floor(samplePos);
          const frac = samplePos - idx;
          const a = liveData[idx];
          const b = liveData[Math.min(idx + 1, liveData.length - 1)];
          value = (a + (b - a) * frac) * envelope;
        } else {
          // Procedural fallback
          value = Math.sin(t * freq * Math.PI * 2 + time * 2 + phase) * envelope;
          value += Math.sin(t * freq * 2.3 * Math.PI + time * 3.1 + phase * 1.7) * 0.3 * envelope;
        }

        // Glitch: inject noise
        if (this.glitchTimer > 0 && Math.sin(p * 5.3 + this.glitchTimer * 30) > 0.7) {
          value += (Math.sin(p * 13.7) > 0 ? 1 : -1) * 0.6 * this.glitchTimer;
        }

        positions.setXYZ(p, px, baseY + value * waveAmp, depth + 1);
      }
      positions.needsUpdate = true;

      const lineOpacity = opacity * (0.3 + depth * 0.7);
      (line.material as THREE.LineBasicMaterial).opacity = lineOpacity;
    }

    (this.borderLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.2;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      for (let i = 0; i < this.lineCount; i++) {
        this.frequencies[i] = this.rng.float(3, 10);
      }
    }
    if (action === 'alert') {
      this.pulseTimer = 1.5;
      for (const line of this.lines) {
        (line.material as THREE.LineBasicMaterial).color.copy(this.palette.alert);
      }
      setTimeout(() => {
        for (let i = 0; i < this.lineCount; i++) {
          const depth = i / (this.lineCount - 1);
          const color = new THREE.Color().copy(this.palette.dim).lerp(this.palette.primary, depth);
          (this.lines[i].material as THREE.LineBasicMaterial).color.copy(color);
        }
      }, 3000);
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) return;
    if (level >= 3) {
      for (let i = 0; i < this.lineCount; i++) {
        this.frequencies[i] *= 1.5;
      }
    }
  }
}
