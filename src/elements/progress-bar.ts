import * as THREE from 'three';
import { BaseElement } from './base-element';
import { pulse, stateOpacity, glitchOffset } from '../animation/fx';

export class ProgressBarElement extends BaseElement {
  private fillMesh!: THREE.Mesh;
  private borderLines!: THREE.LineSegments;
  private isVertical: boolean = false;
  private targetValue: number = 0;
  private currentValue: number = 0;
  private speed: number = 0;
  private cycleTimer: number = 0;
  private pulseTimer: number = 0;
  private glitchTimer: number = 0;

  build(): void {
    const { x, y, w, h } = this.px;
    this.isVertical = h > w * 1.5;
    this.targetValue = this.rng.float(0.3, 0.9);
    this.speed = this.rng.float(0.5, 2.0);

    // Unit-sized fill — we animate with scale, not geometry recreation
    const fillGeo = new THREE.PlaneGeometry(1, 1);
    const fillMat = new THREE.MeshBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
    });
    this.fillMesh = new THREE.Mesh(fillGeo, fillMat);
    this.group.add(this.fillMesh);

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
    const opacity = this.computeOpacity(dt);
    const { x, y, w, h } = this.px;
    const gx = this.glitchTimer > 0 ? glitchOffset(this.glitchTimer, 3) : 0;
    if (this.glitchTimer > 0) this.glitchTimer -= dt;

    // Cycle target value
    this.cycleTimer += dt;
    if (this.cycleTimer > 2) {
      this.cycleTimer = 0;
      this.targetValue = this.rng.float(0.2, 1.0);
    }
    this.currentValue += (this.targetValue - this.currentValue) * dt * this.speed;

    // Animate fill via scale instead of geometry recreation
    if (this.isVertical) {
      const fh = Math.max(1, h * this.currentValue);
      this.fillMesh.scale.set(w - 2, fh, 1);
      this.fillMesh.position.set(x + w / 2 + gx, y + fh / 2, 1);
    } else {
      const fw = Math.max(1, w * this.currentValue);
      this.fillMesh.scale.set(fw, h - 2, 1);
      this.fillMesh.position.set(x + fw / 2 + gx, y + h / 2, 1);
    }

    (this.fillMesh.material as THREE.MeshBasicMaterial).opacity = opacity * 0.6;
    (this.borderLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.5;
  }

  private computeOpacity(dt: number): number {
    let opacity = stateOpacity(this.stateMachine.state, this.stateMachine.progress);
    if (this.pulseTimer > 0) {
      this.pulseTimer -= dt;
      opacity *= pulse(this.pulseTimer);
    }
    return opacity;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'pulse') this.pulseTimer = 0.5;
    if (action === 'glitch') this.glitchTimer = 0.4;
    if (action === 'alert') {
      this.targetValue = 1.0;
      (this.fillMesh.material as THREE.MeshBasicMaterial).color.copy(this.palette.alert);
      this.pulseTimer = 1.5;
    }
  }
}
