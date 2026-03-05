import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Fireflies synchronizing flashes using the Peskin pulse-coupled oscillator model.
 * Each firefly has a phase; when one flashes, nearby ones advance their phase.
 * Progressive synchronization emerges over time.
 */
export class FireflySyncElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'firefly-sync',
    meta: {
      shape: 'rectangular',
      roles: ['decorative', 'data-display'],
      moods: ['ambient'],
      bandAffinity: 'high',
      sizes: ['works-small', 'needs-medium', 'needs-large'],
    } satisfies ElementMeta,
  };

  private pointsMesh!: THREE.Points;
  private count: number = 0;

  // Per-firefly state (SoA)
  private posX!: Float32Array;
  private posY!: Float32Array;
  private phase!: Float32Array;    // 0..1, flashes at 1.0
  private freq!: Float32Array;     // natural frequency
  private brightness!: Float32Array;
  private velX!: Float32Array;
  private velY!: Float32Array;

  // Model params
  private couplingStrength: number = 0;
  private couplingRadius: number = 0;
  private flashDecay: number = 0;
  private period: number = 0;

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;
    const variant = this.rng.int(0, 3);

    const presets = [
      { count: 40, coupling: 0.05, radius: 0.3, period: 2.0,  decay: 4, drift: 3 },
      { count: 80, coupling: 0.08, radius: 0.25, period: 1.5, decay: 5, drift: 2 },
      { count: 20, coupling: 0.03, radius: 0.5, period: 3.0,  decay: 3, drift: 5 },
      { count: 60, coupling: 0.12, radius: 0.2, period: 1.0,  decay: 6, drift: 1 },
    ];
    const p = presets[variant];

    this.count = p.count + this.rng.int(-3, 3);
    this.couplingStrength = p.coupling;
    this.couplingRadius = Math.min(w, h) * p.radius;
    this.flashDecay = p.decay;
    this.period = p.period;

    const n = this.count;
    this.posX = new Float32Array(n);
    this.posY = new Float32Array(n);
    this.phase = new Float32Array(n);
    this.freq = new Float32Array(n);
    this.brightness = new Float32Array(n);
    this.velX = new Float32Array(n);
    this.velY = new Float32Array(n);

    for (let i = 0; i < n; i++) {
      this.posX[i] = x + this.rng.float(w * 0.05, w * 0.95);
      this.posY[i] = y + this.rng.float(h * 0.05, h * 0.95);
      this.phase[i] = this.rng.float(0, 1);
      this.freq[i] = (1 / this.period) * this.rng.float(0.9, 1.1);
      this.brightness[i] = 0;
      const angle = this.rng.float(0, Math.PI * 2);
      const spd = p.drift * this.rng.float(0.5, 1.5);
      this.velX[i] = Math.cos(angle) * spd;
      this.velY[i] = Math.sin(angle) * spd;
    }

    const positions = new Float32Array(n * 3);
    const colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      positions[i * 3] = this.posX[i];
      positions[i * 3 + 1] = this.posY[i];
      positions[i * 3 + 2] = 0;
      colors[i * 3] = 0;
      colors[i * 3 + 1] = 0;
      colors[i * 3 + 2] = 0;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    this.pointsMesh = new THREE.Points(geo, new THREE.PointsMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0,
      size: 4,
      sizeAttenuation: false,
    }));
    this.group.add(this.pointsMesh);
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);
    const { x, y, w, h } = this.px;
    const n = this.count;
    const r2 = this.couplingRadius * this.couplingRadius;

    // Advance phases and detect flashes
    const flashed: boolean[] = [];
    for (let i = 0; i < n; i++) flashed[i] = false;

    for (let i = 0; i < n; i++) {
      this.phase[i] += this.freq[i] * dt;
      if (this.phase[i] >= 1.0) {
        this.phase[i] -= 1.0;
        this.brightness[i] = 1.0;
        flashed[i] = true;
      }
    }

    // Peskin coupling: flashing fireflies advance nearby phases
    for (let i = 0; i < n; i++) {
      if (!flashed[i]) continue;
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const dx = this.posX[j] - this.posX[i];
        const dy = this.posY[j] - this.posY[i];
        if (dx * dx + dy * dy < r2) {
          this.phase[j] = Math.min(this.phase[j] + this.couplingStrength, 0.99);
        }
      }
    }

    // Decay brightness
    for (let i = 0; i < n; i++) {
      this.brightness[i] = Math.max(0, this.brightness[i] - this.flashDecay * dt);
    }

    // Drift movement
    for (let i = 0; i < n; i++) {
      this.posX[i] += this.velX[i] * dt;
      this.posY[i] += this.velY[i] * dt;

      // Soft wrap
      if (this.posX[i] < x) { this.posX[i] = x; this.velX[i] = Math.abs(this.velX[i]); }
      if (this.posX[i] > x + w) { this.posX[i] = x + w; this.velX[i] = -Math.abs(this.velX[i]); }
      if (this.posY[i] < y) { this.posY[i] = y; this.velY[i] = Math.abs(this.velY[i]); }
      if (this.posY[i] > y + h) { this.posY[i] = y + h; this.velY[i] = -Math.abs(this.velY[i]); }
    }

    // Update GPU buffers
    const posAttr = this.pointsMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const colAttr = this.pointsMesh.geometry.getAttribute('color') as THREE.BufferAttribute;

    const pr = this.palette.primary;
    const sc = this.palette.secondary;
    const dm = this.palette.dim;

    for (let i = 0; i < n; i++) {
      posAttr.setXYZ(i, this.posX[i], this.posY[i], 0);

      const b = this.brightness[i];
      const baseDim = 0.15;
      const t = Math.max(b, baseDim);

      colAttr.setXYZ(i,
        dm.r * (1 - t) + pr.r * b + sc.r * (t - b),
        dm.g * (1 - t) + pr.g * b + sc.g * (t - b),
        dm.b * (1 - t) + pr.b * b + sc.b * (t - b),
      );
    }

    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
    (this.pointsMesh.material as THREE.PointsMaterial).opacity = opacity;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Desynchronize: scramble all phases
      for (let i = 0; i < this.count; i++) {
        this.phase[i] = this.rng.float(0, 1);
        this.brightness[i] = this.rng.float(0, 0.5);
      }
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) {
      this.couplingStrength = 0.05;
      return;
    }
    // Stronger coupling = faster sync
    this.couplingStrength = 0.05 + level * 0.03;
    if (level >= 4) {
      // Force-flash some fireflies
      const flashCount = Math.min(this.count, level * 3);
      for (let i = 0; i < flashCount; i++) {
        const idx = this.rng.int(0, this.count - 1);
        this.phase[idx] = 0.99;
      }
    }
  }
}
