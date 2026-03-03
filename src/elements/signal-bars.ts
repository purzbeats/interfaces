import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Signal strength bars — staggered vertical bars that bounce with spring physics.
 * Like an audio spectrum analyzer or signal level indicator.
 */
export class SignalBarsElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'signal-bars',
    meta: { shape: 'rectangular', roles: ['data-display', 'gauge'], moods: ['diagnostic'], bandAffinity: 'bass', sizes: ['works-small', 'needs-medium'] },
  };
  private bars: THREE.Mesh[] = [];
  private barValues: number[] = [];
  private barTargets: number[] = [];
  private barVelocities: number[] = [];
  private barCount: number = 0;
  private borderLines!: THREE.LineSegments;
  private updateTimer: number = 0;
  private updateInterval: number = 0;
  private springK: number = 25;
  private springDamping: number = 4;

  build(): void {
    const variant = this.rng.int(0, 3);
    const presets = [
      { barCount: [8, 24] as const, spacing: 0.02, springK: 25, damping: 4, updateInterval: [0.15, 0.6] as const },
      { barCount: [24, 48] as const, spacing: 0.008, springK: 45, damping: 2, updateInterval: [0.05, 0.2] as const },
      { barCount: [4, 8] as const, spacing: 0.05, springK: 12, damping: 7, updateInterval: [0.4, 1.2] as const },
      { barCount: [12, 20] as const, spacing: 0.035, springK: 60, damping: 1.5, updateInterval: [0.1, 0.35] as const },
    ];
    const p = presets[variant];

    this.glitchAmount = 3;
    const { x, y, w, h } = this.px;
    this.barCount = this.rng.int(p.barCount[0], p.barCount[1]);
    this.updateInterval = this.rng.float(p.updateInterval[0], p.updateInterval[1]);
    this.springK = p.springK + this.rng.float(-3, 3);
    this.springDamping = p.damping + this.rng.float(-0.5, 0.5);
    const gap = w * (p.spacing + this.rng.float(-0.003, 0.003));
    const barW = (w - gap * (this.barCount + 1)) / this.barCount;

    for (let i = 0; i < this.barCount; i++) {
      const bx = x + gap + (barW + gap) * i;
      const geo = new THREE.PlaneGeometry(barW, 1);
      const mat = new THREE.MeshBasicMaterial({
        color: this.palette.primary,
        transparent: true,
        opacity: 0,
      });
      const bar = new THREE.Mesh(geo, mat);
      bar.position.set(bx + barW / 2, y, 1);
      this.bars.push(bar);
      this.group.add(bar);

      this.barValues.push(0);
      this.barTargets.push(this.rng.float(0.1, 0.9));
      this.barVelocities.push(0);
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

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    const { x, y, w, h } = this.px;

    // Update targets periodically
    this.updateTimer += dt;
    if (this.updateTimer >= this.updateInterval) {
      this.updateTimer = 0;
      for (let i = 0; i < this.barCount; i++) {
        this.barTargets[i] = this.rng.float(0.05, 1.0);
      }
    }

    // Spring physics per bar
    for (let i = 0; i < this.barCount; i++) {
      const force = (this.barTargets[i] - this.barValues[i]) * this.springK;
      this.barVelocities[i] += force * dt;
      this.barVelocities[i] *= Math.exp(-this.springDamping * dt); // damping
      this.barValues[i] += this.barVelocities[i] * dt;
      this.barValues[i] = Math.max(0.01, Math.min(1.2, this.barValues[i])); // allow overshoot

      const bh = h * Math.min(this.barValues[i], 1);
      this.bars[i].scale.y = bh;
      this.bars[i].position.y = y + bh / 2;

      // Color shifts toward alert at high values
      const isHot = this.barValues[i] > 0.85;
      (this.bars[i].material as THREE.MeshBasicMaterial).color.copy(
        isHot ? this.palette.secondary : this.palette.primary
      );
      (this.bars[i].material as THREE.MeshBasicMaterial).opacity = opacity * 0.65;
    }

    (this.borderLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.3;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'pulse') {
      // Impulse — kick all bars upward
      for (let i = 0; i < this.barCount; i++) {
        this.barVelocities[i] += this.rng.float(2, 5);
      }
    }
    if (action === 'glitch') {
      for (let i = 0; i < this.barCount; i++) {
        this.barTargets[i] = this.rng.chance(0.5) ? 1 : 0;
        this.barVelocities[i] = this.rng.float(-3, 3);
      }
    }
    if (action === 'alert') {
      for (let i = 0; i < this.barCount; i++) {
        this.barTargets[i] = 1.0;
        this.barVelocities[i] = 4;
      }
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) return;
    const boost = level * 0.15;
    for (let i = 0; i < this.barCount; i++) {
      this.barTargets[i] = Math.min(1.0, this.barTargets[i] + boost);
      this.barVelocities[i] += level * 0.5;
    }
  }
}
