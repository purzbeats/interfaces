import * as THREE from 'three';
import { BaseElement } from './base-element';

/**
 * ECG trace with leading dot and QRS complex waveform.
 * Single Line geometry, write-head draws repeating ECG pattern left-to-right, wraps with erasure.
 */
export class HeartMonitorElement extends BaseElement {
  private line!: THREE.Line;
  private dot!: THREE.Points;
  private borderLines!: THREE.LineSegments;
  private numPoints: number = 0;
  private writeHead: number = 0;
  private speed: number = 0;
  private bpm: number = 0;
  private ecgPhase: number = 0;
  private flatline: boolean = false;

  build(): void {
    const { x, y, w, h } = this.px;
    this.numPoints = Math.max(64, Math.floor(w * 0.5));
    this.speed = this.rng.float(80, 160); // points per second
    this.bpm = this.rng.float(60, 120);

    // ECG line
    const positions = new Float32Array(this.numPoints * 3);
    for (let i = 0; i < this.numPoints; i++) {
      positions[i * 3] = x + (w * i) / (this.numPoints - 1);
      positions[i * 3 + 1] = y + h / 2;
      positions[i * 3 + 2] = 1;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.line = new THREE.Line(geo, new THREE.LineBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.line);

    // Leading dot
    const dotGeo = new THREE.BufferGeometry();
    dotGeo.setAttribute('position', new THREE.Float32BufferAttribute([x, y + h / 2, 2], 3));
    this.dot = new THREE.Points(dotGeo, new THREE.PointsMaterial({
      color: this.palette.secondary,
      size: Math.max(4, Math.min(w, h) * 0.02),
      transparent: true,
      opacity: 0,
      sizeAttenuation: false,
    }));
    this.group.add(this.dot);

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

    // Advance write head
    const advance = dt * this.speed;
    const pos = this.line.geometry.getAttribute('position') as THREE.BufferAttribute;
    const cy = y + h / 2;
    const amp = h * 0.4;
    const beatsPerSec = this.bpm / 60;

    for (let a = 0; a < advance; a++) {
      const idx = Math.floor(this.writeHead) % this.numPoints;
      this.ecgPhase += beatsPerSec / this.speed;

      const value = this.flatline ? 0 : this.ecgWave(this.ecgPhase % 1);
      pos.setY(idx, cy + value * amp);

      // Erase ahead (gap)
      const eraseIdx = (idx + 3) % this.numPoints;
      pos.setY(eraseIdx, cy);

      this.writeHead++;
    }
    pos.needsUpdate = true;

    // Update dot position
    const dotIdx = Math.floor(this.writeHead) % this.numPoints;
    const dotPos = this.dot.geometry.getAttribute('position') as THREE.BufferAttribute;
    dotPos.setXY(0, x + (w * dotIdx) / (this.numPoints - 1), pos.getY(dotIdx));
    dotPos.needsUpdate = true;

    (this.line.material as THREE.LineBasicMaterial).opacity = opacity;
    (this.dot.material as THREE.PointsMaterial).opacity = opacity;
    (this.borderLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.3;
  }

  /** Generate ECG-like waveform for one beat cycle (t in 0..1) */
  private ecgWave(t: number): number {
    // P wave
    if (t < 0.1) return Math.sin(t / 0.1 * Math.PI) * 0.1;
    // PR segment
    if (t < 0.15) return 0;
    // Q dip
    if (t < 0.18) return -((t - 0.15) / 0.03) * 0.15;
    // R spike
    if (t < 0.22) return -0.15 + ((t - 0.18) / 0.04) * 1.15;
    // S dip
    if (t < 0.26) return 1.0 - ((t - 0.22) / 0.04) * 1.3;
    // ST segment
    if (t < 0.35) return -0.3 + ((t - 0.26) / 0.09) * 0.3;
    // T wave
    if (t < 0.5) return Math.sin((t - 0.35) / 0.15 * Math.PI) * 0.2;
    // Baseline
    return 0;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      this.bpm = this.rng.float(140, 200);
    }
    if (action === 'alert') {
      this.flatline = true;
      (this.line.material as THREE.LineBasicMaterial).color.copy(this.palette.alert);
      setTimeout(() => { this.flatline = false; }, 3000);
    }
  }
}
