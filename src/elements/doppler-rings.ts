import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Doppler effect visualization: a source moves in a circle emitting
 * circular wavefronts. Wavefronts compress ahead and expand behind.
 */
export class DopplerRingsElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'doppler-rings',
    meta: { shape: 'radial', roles: ['data-display', 'decorative'], moods: ['diagnostic', 'ambient'], bandAffinity: 'mid', sizes: ['needs-medium', 'needs-large'] },
  };

  private cx = 0;
  private cy = 0;
  private orbitRadius = 0;
  private sourceSpeed = 0;
  private emitInterval = 0;
  private waveSpeed = 0;
  private maxWaves = 0;
  private segments = 48;

  // Wave state: origin x/y and birth time
  private waveOX!: Float32Array;
  private waveOY!: Float32Array;
  private waveBirth!: Float32Array;
  private waveCount = 0;
  private emitAccum = 0;
  private waveLines!: THREE.LineSegments;
  private sourcePoint!: THREE.Points;
  private maxRadius = 0;

  build(): void {
    this.glitchAmount = 4;
    const variant = this.rng.int(0, 4);
    const presets = [
      { speed: 0.8, interval: 0.3, waveSpeed: 120, maxWaves: 20 },
      { speed: 1.2, interval: 0.2, waveSpeed: 90, maxWaves: 30 },
      { speed: 0.5, interval: 0.5, waveSpeed: 150, maxWaves: 15 },
      { speed: 1.5, interval: 0.15, waveSpeed: 70, maxWaves: 35 },
    ];
    const p = presets[variant];

    const { x, y, w, h } = this.px;
    this.cx = x + w / 2;
    this.cy = y + h / 2;
    this.maxRadius = Math.min(w, h) * 0.48;
    this.orbitRadius = this.maxRadius * 0.25;
    this.sourceSpeed = p.speed;
    this.emitInterval = p.interval;
    this.waveSpeed = p.waveSpeed * (this.maxRadius / 150);
    this.maxWaves = p.maxWaves;

    this.waveOX = new Float32Array(this.maxWaves);
    this.waveOY = new Float32Array(this.maxWaves);
    this.waveBirth = new Float32Array(this.maxWaves);
    this.waveBirth.fill(-999);
    this.waveCount = 0;
    this.emitAccum = 0;

    // Each wave is a ring of segments; each segment = 2 vertices = 6 floats
    const totalVerts = this.maxWaves * this.segments * 2;
    const positions = new Float32Array(totalVerts * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.waveLines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
      color: this.palette.secondary, transparent: true, opacity: 0,
    }));
    this.group.add(this.waveLines);

    // Source point
    const srcPos = new Float32Array(3);
    const srcGeo = new THREE.BufferGeometry();
    srcGeo.setAttribute('position', new THREE.BufferAttribute(srcPos, 3));
    this.sourcePoint = new THREE.Points(srcGeo, new THREE.PointsMaterial({
      color: this.palette.primary, transparent: true, opacity: 0,
      size: 5, sizeAttenuation: false,
    }));
    this.group.add(this.sourcePoint);
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);

    // Source position on circular orbit
    const angle = time * this.sourceSpeed;
    const srcX = this.cx + Math.cos(angle) * this.orbitRadius;
    const srcY = this.cy + Math.sin(angle) * this.orbitRadius;

    // Emit new wave
    this.emitAccum += dt;
    if (this.emitAccum >= this.emitInterval) {
      this.emitAccum -= this.emitInterval;
      const idx = this.waveCount % this.maxWaves;
      this.waveOX[idx] = srcX;
      this.waveOY[idx] = srcY;
      this.waveBirth[idx] = time;
      this.waveCount++;
    }

    // Update source point
    const sp = this.sourcePoint.geometry.getAttribute('position') as THREE.BufferAttribute;
    sp.setXYZ(0, srcX, srcY, 0.5);
    sp.needsUpdate = true;
    (this.sourcePoint.material as THREE.PointsMaterial).opacity = opacity;

    // Update wave rings
    const pos = this.waveLines.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;

    for (let w = 0; w < this.maxWaves; w++) {
      const baseIdx = w * this.segments * 6;
      const age = time - this.waveBirth[w];
      const radius = age * this.waveSpeed;
      const alive = age >= 0 && age < 10 && radius < this.maxRadius;

      for (let s = 0; s < this.segments; s++) {
        const i = baseIdx + s * 6;
        if (alive) {
          const a0 = (s / this.segments) * Math.PI * 2;
          const a1 = ((s + 1) / this.segments) * Math.PI * 2;
          arr[i] = this.waveOX[w] + Math.cos(a0) * radius;
          arr[i + 1] = this.waveOY[w] + Math.sin(a0) * radius;
          arr[i + 2] = 0;
          arr[i + 3] = this.waveOX[w] + Math.cos(a1) * radius;
          arr[i + 4] = this.waveOY[w] + Math.sin(a1) * radius;
          arr[i + 5] = 0;
        } else {
          // Park dead segments at a degenerate point (not origin)
          arr[i] = this.cx; arr[i + 1] = this.cy; arr[i + 2] = -1;
          arr[i + 3] = this.cx; arr[i + 4] = this.cy; arr[i + 5] = -1;
        }
      }
    }
    pos.needsUpdate = true;

    const mat = this.waveLines.material as THREE.LineBasicMaterial;
    mat.opacity = opacity * 0.6;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      this.sourceSpeed *= -1;
      this.emitAccum = this.emitInterval;
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level > 0) {
      this.emitInterval = Math.max(0.05, this.emitInterval * (1 - level * 0.05));
    }
  }
}
