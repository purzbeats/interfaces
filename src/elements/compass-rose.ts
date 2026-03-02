import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Compass rose with cardinal/intercardinal direction lines and a rotating needle.
 * Needle oscillates with a damped sine for a natural compass feel.
 */
export class CompassRoseElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'compass-rose',
    meta: { shape: 'radial', roles: ['gauge', 'decorative'], moods: ['tactical'], sizes: ['needs-medium'] },
  };
  private cardinalLines!: THREE.LineSegments;
  private borderCircle!: THREE.LineSegments;
  private needleLine!: THREE.Line;
  private needleAngle: number = 0;
  private needleTarget: number = 0;
  private needleVelocity: number = 0;
  private wobbleSpeed: number = 0;
  private alertMode: boolean = false;

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const radius = Math.min(w, h) / 2 * 0.85;

    this.wobbleSpeed = this.rng.float(0.3, 0.8);
    this.needleAngle = this.rng.float(0, Math.PI * 2);
    this.needleTarget = this.needleAngle;

    // Cardinal lines (N/S/E/W) + intercardinal (NE/SE/SW/NW)
    const lineVerts: number[] = [];
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      const isCardinal = i % 2 === 0;
      const innerR = isCardinal ? radius * 0.15 : radius * 0.35;
      const outerR = isCardinal ? radius * 0.95 : radius * 0.7;
      lineVerts.push(
        cx + Math.cos(angle) * innerR, cy + Math.sin(angle) * innerR, 0,
        cx + Math.cos(angle) * outerR, cy + Math.sin(angle) * outerR, 0,
      );
    }

    // Small tick marks at 15-degree intervals
    for (let i = 0; i < 24; i++) {
      if (i % 3 === 0) continue; // skip cardinal/intercardinal positions
      const angle = (i / 24) * Math.PI * 2;
      lineVerts.push(
        cx + Math.cos(angle) * radius * 0.85, cy + Math.sin(angle) * radius * 0.85, 0,
        cx + Math.cos(angle) * radius * 0.95, cy + Math.sin(angle) * radius * 0.95, 0,
      );
    }

    const cardGeo = new THREE.BufferGeometry();
    cardGeo.setAttribute('position', new THREE.Float32BufferAttribute(lineVerts, 3));
    this.cardinalLines = new THREE.LineSegments(cardGeo, new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.cardinalLines);

    // Border circle
    const segments = 64;
    const circleVerts = new Float32Array(segments * 2 * 3);
    for (let i = 0; i < segments; i++) {
      const a1 = (i / segments) * Math.PI * 2;
      const a2 = ((i + 1) / segments) * Math.PI * 2;
      circleVerts[i * 6] = cx + Math.cos(a1) * radius;
      circleVerts[i * 6 + 1] = cy + Math.sin(a1) * radius;
      circleVerts[i * 6 + 2] = 0;
      circleVerts[i * 6 + 3] = cx + Math.cos(a2) * radius;
      circleVerts[i * 6 + 4] = cy + Math.sin(a2) * radius;
      circleVerts[i * 6 + 5] = 0;
    }
    const circleGeo = new THREE.BufferGeometry();
    circleGeo.setAttribute('position', new THREE.BufferAttribute(circleVerts, 3));
    this.borderCircle = new THREE.LineSegments(circleGeo, new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.borderCircle);

    // Needle line (from center outward)
    const needleGeo = new THREE.BufferGeometry();
    needleGeo.setAttribute('position', new THREE.Float32BufferAttribute([
      cx, cy, 2, cx + radius * 0.8, cy, 2,
    ], 3));
    this.needleLine = new THREE.Line(needleGeo, new THREE.LineBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.needleLine);
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    const { x, y, w, h } = this.px;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const radius = Math.min(w, h) / 2 * 0.85;

    // Slowly shift needle target with damped oscillation
    this.needleTarget += Math.sin(time * this.wobbleSpeed) * dt * 0.5;

    // Spring-damper toward target
    const diff = this.needleTarget - this.needleAngle;
    this.needleVelocity += diff * 4 * dt;
    this.needleVelocity *= Math.exp(-3 * dt); // damping
    this.needleAngle += this.needleVelocity * dt;

    // Update needle endpoint
    const positions = this.needleLine.geometry.getAttribute('position') as THREE.BufferAttribute;
    positions.setXYZ(0, cx, cy, 2);
    positions.setXYZ(1, cx + Math.cos(this.needleAngle) * radius * 0.8, cy + Math.sin(this.needleAngle) * radius * 0.8, 2);
    positions.needsUpdate = true;

    const needleColor = this.alertMode ? this.palette.alert : this.palette.primary;
    (this.needleLine.material as THREE.LineBasicMaterial).color.copy(needleColor);
    (this.needleLine.material as THREE.LineBasicMaterial).opacity = opacity;
    (this.cardinalLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.5;
    (this.borderCircle.material as THREE.LineBasicMaterial).opacity = opacity * 0.4;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      this.needleVelocity += this.rng.float(-10, 10);
    }
    if (action === 'alert') {
      this.alertMode = true;
      this.pulseTimer = 2.0;
      this.needleTarget += Math.PI; // spin the needle
      setTimeout(() => { this.alertMode = false; }, 3000);
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) { this.alertMode = false; return; }
    if (level >= 3) {
      this.needleVelocity += this.rng.float(-5, 5) * level;
    }
    if (level >= 5) { this.alertMode = true; }
  }
}
