import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * 1D standing wave: superposition of two counter-propagating sinusoidal waves.
 * Shows nodes, antinodes, and envelope. Different harmonic modes as presets.
 */
export class StandingWaveElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'standing-wave',
    meta: { shape: 'linear', roles: ['data-display', 'decorative'], moods: ['diagnostic', 'ambient'], bandAffinity: 'mid', sizes: ['works-small', 'needs-medium'] },
  };

  private segments = 0;
  private harmonic = 1;
  private frequency = 0;
  private amplitude = 0;
  private waveLine!: THREE.Line;
  private envTopLine!: THREE.Line;
  private envBotLine!: THREE.Line;
  private nodeDots!: THREE.Points;
  private baseY = 0;
  private startX = 0;
  private endX = 0;

  build(): void {
    this.glitchAmount = 4;
    const variant = this.rng.int(0, 4);
    const { x, y, w, h } = this.px;
    const presets = [
      { harmonic: 2, freq: 2.0, segments: 120 },
      { harmonic: 3, freq: 2.5, segments: 150 },
      { harmonic: 5, freq: 3.0, segments: 200 },
      { harmonic: 1, freq: 1.5, segments: 100 },
    ];
    const p = presets[variant];

    this.harmonic = p.harmonic;
    this.frequency = p.freq;
    this.segments = p.segments;
    this.amplitude = h * 0.35;
    this.baseY = y + h / 2;
    this.startX = x + w * 0.02;
    this.endX = x + w * 0.98;

    // Main wave line
    const wavePos = new Float32Array((this.segments + 1) * 3);
    const waveGeo = new THREE.BufferGeometry();
    waveGeo.setAttribute('position', new THREE.BufferAttribute(wavePos, 3));
    this.waveLine = new THREE.Line(waveGeo, new THREE.LineBasicMaterial({
      color: this.palette.primary, transparent: true, opacity: 0,
    }));
    this.group.add(this.waveLine);

    // Envelope lines (top and bottom)
    const envPos1 = new Float32Array((this.segments + 1) * 3);
    const envGeo1 = new THREE.BufferGeometry();
    envGeo1.setAttribute('position', new THREE.BufferAttribute(envPos1, 3));
    this.envTopLine = new THREE.Line(envGeo1, new THREE.LineBasicMaterial({
      color: this.palette.dim, transparent: true, opacity: 0,
    }));
    this.group.add(this.envTopLine);

    const envPos2 = new Float32Array((this.segments + 1) * 3);
    const envGeo2 = new THREE.BufferGeometry();
    envGeo2.setAttribute('position', new THREE.BufferAttribute(envPos2, 3));
    this.envBotLine = new THREE.Line(envGeo2, new THREE.LineBasicMaterial({
      color: this.palette.dim, transparent: true, opacity: 0,
    }));
    this.group.add(this.envBotLine);

    // Node dots: nodes at positions where sin(n*pi*x/L) = 0
    const nodeCount = this.harmonic + 1; // includes endpoints
    const nodePos = new Float32Array(nodeCount * 3);
    const nodeGeo = new THREE.BufferGeometry();
    nodeGeo.setAttribute('position', new THREE.BufferAttribute(nodePos, 3));
    this.nodeDots = new THREE.Points(nodeGeo, new THREE.PointsMaterial({
      color: this.palette.secondary, transparent: true, opacity: 0,
      size: 5, sizeAttenuation: false,
    }));
    this.group.add(this.nodeDots);

    // Set static node positions
    const np = this.nodeDots.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < nodeCount; i++) {
      const t = i / this.harmonic;
      const px = this.startX + t * (this.endX - this.startX);
      np.setXYZ(i, px, this.baseY, 0.5);
    }
    np.needsUpdate = true;
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    const L = this.endX - this.startX;
    const n = this.harmonic;
    const omega = this.frequency * Math.PI * 2;
    const cosT = Math.cos(omega * time);

    const waveArr = (this.waveLine.geometry.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
    const envTopArr = (this.envTopLine.geometry.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
    const envBotArr = (this.envBotLine.geometry.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;

    for (let i = 0; i <= this.segments; i++) {
      const t = i / this.segments;
      const px = this.startX + t * L;
      // Standing wave: 2A * sin(n*pi*x/L) * cos(omega*t)
      const spatial = Math.sin(n * Math.PI * t);
      const yVal = this.amplitude * spatial * cosT;
      const envVal = this.amplitude * Math.abs(spatial);

      const idx = i * 3;
      waveArr[idx] = px;
      waveArr[idx + 1] = this.baseY + yVal;
      waveArr[idx + 2] = 0;

      envTopArr[idx] = px;
      envTopArr[idx + 1] = this.baseY + envVal;
      envTopArr[idx + 2] = 0;

      envBotArr[idx] = px;
      envBotArr[idx + 1] = this.baseY - envVal;
      envBotArr[idx + 2] = 0;
    }

    (this.waveLine.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.envTopLine.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.envBotLine.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;

    (this.waveLine.material as THREE.LineBasicMaterial).opacity = opacity;
    (this.envTopLine.material as THREE.LineBasicMaterial).opacity = opacity * 0.25;
    (this.envBotLine.material as THREE.LineBasicMaterial).opacity = opacity * 0.25;
    (this.nodeDots.material as THREE.PointsMaterial).opacity = opacity * 0.8;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Briefly shift harmonic
      const old = this.harmonic;
      this.harmonic = old + this.rng.int(1, 4);
      setTimeout(() => { this.harmonic = old; }, 500);
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    this.frequency = (1.5 + level * 0.3);
  }
}
