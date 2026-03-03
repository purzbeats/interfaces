import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

export class ProgressBarElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'progress-bar',
    meta: { shape: 'linear', roles: ['gauge'], moods: ['diagnostic'], bandAffinity: 'bass', sizes: ['works-small'] },
  };
  private fillMesh!: THREE.Mesh;
  private borderLines!: THREE.LineSegments;
  private isVertical: boolean = false;
  private targetValue: number = 0;
  private currentValue: number = 0;
  private speed: number = 0;
  private cycleTimer: number = 0;
  private barH: number = 0;
  private barY: number = 0;

  build(): void {
    this.glitchAmount = 3;
    const { x, y, w, h } = this.px;
    this.isVertical = h > w * 1.5;
    this.targetValue = this.rng.float(0.3, 0.9);
    this.speed = this.rng.float(0.5, 2.0);
    this.barH = Math.min(h * 0.15, 40);
    this.barY = y + (h - this.barH) / 2;

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
      x, this.barY, 0, x + w, this.barY, 0,
      x + w, this.barY, 0, x + w, this.barY + this.barH, 0,
      x + w, this.barY + this.barH, 0, x, this.barY + this.barH, 0,
      x, this.barY + this.barH, 0, x, this.barY, 0,
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
    const gx = this.group.position.x;

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
      this.fillMesh.scale.set(fw, this.barH - 2, 1);
      this.fillMesh.position.set(x + fw / 2 + gx, this.barY + this.barH / 2, 1);
    }

    (this.fillMesh.material as THREE.MeshBasicMaterial).opacity = opacity * 0.6;
    (this.borderLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.5;
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) return;
    if (level >= 5) {
      this.targetValue = 1.0;
    } else {
      this.targetValue = Math.min(1.0, this.targetValue + level * (level >= 3 ? 0.3 : 0.15));
    }
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'alert') {
      this.targetValue = 1.0;
      (this.fillMesh.material as THREE.MeshBasicMaterial).color.copy(this.palette.alert);
    }
  }
}
