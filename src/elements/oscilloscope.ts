import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';
import type { AudioFrame } from '../audio/audio-reactive';

/**
 * Lissajous figure with phosphor persistence trails.
 * Multiple Line traces at decreasing opacity, frequencies drift slowly.
 */
export class OscilloscopeElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'oscilloscope',
    meta: { shape: 'rectangular', roles: ['data-display', 'gauge'], moods: ['diagnostic'], bandAffinity: 'bass', audioSensitivity: 0.5, sizes: ['needs-medium'] },
  };
  private traces: THREE.Line[] = [];
  private borderLines!: THREE.LineSegments;
  private numPoints: number = 0;
  private traceCount: number = 0;
  private freqX: number = 0;
  private freqY: number = 0;
  private phaseShift: number = 0;
  private freqDrift: number = 0;
  private liveWaveform: Float32Array | null = null;
  build(): void {
    const variant = this.rng.int(0, 3);
    const presets = [
      { numPoints: 256, traceCount: [3, 6] as const, freqX: [1, 4] as const, freqY: [1, 4] as const, drift: [0.05, 0.2] as const },
      { numPoints: 512, traceCount: [5, 8] as const, freqX: [2, 7] as const, freqY: [2, 7] as const, drift: [0.15, 0.4] as const },
      { numPoints: 128, traceCount: [2, 3] as const, freqX: [1, 2] as const, freqY: [1, 2] as const, drift: [0.02, 0.08] as const },
      { numPoints: 384, traceCount: [4, 7] as const, freqX: [3, 8] as const, freqY: [1, 6] as const, drift: [0.2, 0.5] as const },
    ];
    const p = presets[variant];

    this.glitchAmount = 5;
    const { x, y, w, h } = this.px;
    this.numPoints = p.numPoints;
    this.traceCount = this.rng.int(p.traceCount[0], p.traceCount[1]);
    this.freqX = this.rng.float(p.freqX[0], p.freqX[1]);
    this.freqY = this.rng.float(p.freqY[0], p.freqY[1]);
    this.phaseShift = this.rng.float(0, Math.PI);
    this.freqDrift = this.rng.float(p.drift[0], p.drift[1]);

    for (let t = 0; t < this.traceCount; t++) {
      const positions = new Float32Array(this.numPoints * 3);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const trace = new THREE.Line(geo, new THREE.LineBasicMaterial({
        color: t === 0 ? this.palette.primary : this.palette.secondary,
        transparent: true,
        opacity: 0,
      }));
      this.traces.push(trace);
      this.group.add(trace);
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
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    const { x, y, w, h } = this.px;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const rx = w * 0.4;
    const ry = h * 0.4;

    const live = this.liveWaveform;

    // Update each trace with a time offset for persistence
    for (let t = 0; t < this.traceCount; t++) {
      const traceOpacity = 1 - t / this.traceCount;
      const pos = this.traces[t].geometry.getAttribute('position') as THREE.BufferAttribute;

      if (live && t === 0) {
        // Primary trace: real audio Lissajous (waveform vs delayed waveform)
        const delay = Math.floor(live.length / 4); // 90° phase shift
        for (let i = 0; i < this.numPoints; i++) {
          const si = Math.floor((i / this.numPoints) * (live.length - 1));
          const di = (si + delay) % live.length;
          const px = cx + live[si] * rx;
          const py = cy + live[di] * ry;
          pos.setXYZ(i, px, py, 1);
        }
      } else if (live && t > 0) {
        // Persistence traces: read from previous frame positions with slight decay
        // Use procedural with reduced amplitude as ghost trail
        const traceTime = time - t * 0.08;
        const driftX = this.freqX + Math.sin(time * this.freqDrift) * 0.3;
        const driftY = this.freqY + Math.cos(time * this.freqDrift * 0.7) * 0.3;
        const fade = 0.3 + 0.7 * (1 - t / this.traceCount);
        for (let i = 0; i < this.numPoints; i++) {
          const s = (i / this.numPoints) * Math.PI * 2;
          const si = Math.floor((i / this.numPoints) * (live.length - 1));
          const di = (si + Math.floor(live.length / 4)) % live.length;
          // Blend live audio with procedural for ghosting
          const lx = live[si] * rx;
          const ly = live[di] * ry;
          const px_proc = Math.sin(s * driftX + traceTime * 1.5) * rx;
          const py_proc = Math.sin(s * driftY + traceTime * 1.5 + this.phaseShift) * ry;
          pos.setXYZ(i, cx + lx * fade + px_proc * (1 - fade), cy + ly * fade + py_proc * (1 - fade), 1);
        }
      } else {
        // Procedural fallback (no audio)
        const traceTime = time - t * 0.05;
        const driftX = this.freqX + Math.sin(time * this.freqDrift) * 0.3;
        const driftY = this.freqY + Math.cos(time * this.freqDrift * 0.7) * 0.3;
        for (let i = 0; i < this.numPoints; i++) {
          const s = (i / this.numPoints) * Math.PI * 2;
          const px = cx + Math.sin(s * driftX + traceTime * 1.5) * rx;
          const py = cy + Math.sin(s * driftY + traceTime * 1.5 + this.phaseShift) * ry;
          pos.setXYZ(i, px, py, 1);
        }
      }

      pos.needsUpdate = true;
      (this.traces[t].material as THREE.LineBasicMaterial).opacity = opacity * traceOpacity * 0.7;
    }

    (this.borderLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.3;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      this.freqX = this.rng.float(1, 6);
      this.freqY = this.rng.float(1, 6);
    }
    if (action === 'alert') {
      (this.traces[0].material as THREE.LineBasicMaterial).color.copy(this.palette.alert);
    }
  }
}
