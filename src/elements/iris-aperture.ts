import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Camera iris/aperture that opens and closes.
 * Blades rotate around the outer circle to simulate aperture mechanics.
 */
export class IrisApertureElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'iris-aperture',
    meta: { shape: 'radial', roles: ['decorative', 'gauge'], moods: ['tactical'], sizes: ['needs-medium'] },
  };
  private bladeLines!: THREE.LineSegments;
  private borderCircle!: THREE.LineSegments;
  private bladeCount: number = 0;
  private openSpeed: number = 0;
  private alertMode: boolean = false;

  build(): void {
    this.glitchAmount = 5;
    const { x, y, w, h } = this.px;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const radius = Math.min(w, h) / 2 * 0.85;

    this.bladeCount = this.rng.int(6, 8);
    this.openSpeed = this.rng.float(0.4, 1.2);

    // Blade lines: each blade is 2 line segments (V shape) = 4 vertices
    const bladeVerts = new Float32Array(this.bladeCount * 4 * 3);
    const bladeGeo = new THREE.BufferGeometry();
    bladeGeo.setAttribute('position', new THREE.BufferAttribute(bladeVerts, 3));
    this.bladeLines = new THREE.LineSegments(bladeGeo, new THREE.LineBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.bladeLines);

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
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    const { x, y, w, h } = this.px;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const radius = Math.min(w, h) / 2 * 0.85;

    // Aperture open/close oscillation (0 = closed, 1 = open)
    const aperture = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(time * this.openSpeed));
    const innerR = radius * 0.15 + radius * 0.6 * aperture;
    const bladeSpread = 0.15 + 0.35 * (1 - aperture);

    const positions = this.bladeLines.geometry.getAttribute('position') as THREE.BufferAttribute;

    for (let i = 0; i < this.bladeCount; i++) {
      const baseAngle = (i / this.bladeCount) * Math.PI * 2;

      // Outer point on the circle
      const ox = cx + Math.cos(baseAngle) * radius;
      const oy = cy + Math.sin(baseAngle) * radius;

      // Inner point (closer to center when closed)
      const ix = cx + Math.cos(baseAngle) * innerR;
      const iy = cy + Math.sin(baseAngle) * innerR;

      // Two arms of V from outer point toward inner
      const vi = i * 4;
      positions.setXYZ(vi, ox, oy, 1);
      positions.setXYZ(vi + 1, ix + Math.cos(baseAngle + bladeSpread) * radius * 0.15, iy + Math.sin(baseAngle + bladeSpread) * radius * 0.15, 1);
      positions.setXYZ(vi + 2, ox, oy, 1);
      positions.setXYZ(vi + 3, ix + Math.cos(baseAngle - bladeSpread) * radius * 0.15, iy + Math.sin(baseAngle - bladeSpread) * radius * 0.15, 1);
    }
    positions.needsUpdate = true;

    const bladeColor = this.alertMode ? this.palette.alert : this.palette.primary;
    (this.bladeLines.material as THREE.LineBasicMaterial).color.copy(bladeColor);
    (this.bladeLines.material as THREE.LineBasicMaterial).opacity = opacity;
    (this.borderCircle.material as THREE.LineBasicMaterial).opacity = opacity * 0.4;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      this.openSpeed = this.rng.float(3, 8);
      setTimeout(() => { this.openSpeed = this.rng.float(0.4, 1.2); }, 600);
    }
    if (action === 'alert') {
      this.alertMode = true;
      this.pulseTimer = 2.0;
      setTimeout(() => { this.alertMode = false; }, 3000);
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) { this.alertMode = false; return; }
    if (level >= 4) { this.alertMode = true; }
  }
}
