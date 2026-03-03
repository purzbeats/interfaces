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

  build(): void {
    this.glitchAmount = 3;
    const { x, y, w, h } = this.px;
    this.barCount = this.rng.int(8, 24);
    this.updateInterval = this.rng.float(0.15, 0.6);
    const gap = w * 0.02;
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
    const springK = 25;
    const damping = 4;
    for (let i = 0; i < this.barCount; i++) {
      const force = (this.barTargets[i] - this.barValues[i]) * springK;
      this.barVelocities[i] += force * dt;
      this.barVelocities[i] *= Math.exp(-damping * dt); // damping
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
