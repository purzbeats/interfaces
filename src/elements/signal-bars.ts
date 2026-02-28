import * as THREE from 'three';
import { BaseElement } from './base-element';
import { stateOpacity, pulse, glitchOffset } from '../animation/fx';

/**
 * Signal strength bars — staggered vertical bars that bounce with spring physics.
 * Like an audio spectrum analyzer or signal level indicator.
 */
export class SignalBarsElement extends BaseElement {
  private bars: THREE.Mesh[] = [];
  private barValues: number[] = [];
  private barTargets: number[] = [];
  private barVelocities: number[] = [];
  private barCount: number = 0;
  private borderLines!: THREE.LineSegments;
  private updateTimer: number = 0;
  private updateInterval: number = 0;
  private pulseTimer: number = 0;
  private glitchTimer: number = 0;

  build(): void {
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
    let opacity = stateOpacity(this.stateMachine.state, this.stateMachine.progress);
    const { x, y, w, h } = this.px;

    if (this.pulseTimer > 0) {
      this.pulseTimer -= dt;
      opacity *= pulse(this.pulseTimer);
    }

    const gx = this.glitchTimer > 0 ? glitchOffset(this.glitchTimer, 3) : 0;
    if (this.glitchTimer > 0) this.glitchTimer -= dt;
    this.group.position.x = gx;

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
      this.pulseTimer = 0.5;
      // Impulse — kick all bars upward
      for (let i = 0; i < this.barCount; i++) {
        this.barVelocities[i] += this.rng.float(2, 5);
      }
    }
    if (action === 'glitch') {
      this.glitchTimer = 0.4;
      for (let i = 0; i < this.barCount; i++) {
        this.barTargets[i] = this.rng.chance(0.5) ? 1 : 0;
        this.barVelocities[i] = this.rng.float(-3, 3);
      }
    }
    if (action === 'alert') {
      this.pulseTimer = 1.5;
      for (let i = 0; i < this.barCount; i++) {
        this.barTargets[i] = 1.0;
        this.barVelocities[i] = 4;
      }
    }
  }
}
