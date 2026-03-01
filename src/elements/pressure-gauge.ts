import * as THREE from 'three';
import { BaseElement } from './base-element';

/**
 * Analog Bourdon tube gauge with needle, tick marks, and danger zone arc.
 * 270° arc + tick marks + needle with spring physics.
 */
export class PressureGaugeElement extends BaseElement {
  private arcLines!: THREE.LineSegments;
  private dangerArc!: THREE.LineSegments;
  private needle!: THREE.Line;
  private tickLines!: THREE.LineSegments;
  private needleValue: number = 0;
  private needleTarget: number = 0;
  private needleVelocity: number = 0;
  private updateTimer: number = 0;
  private updateInterval: number = 0;
  build(): void {
    const { x, y, w, h } = this.px;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const radius = Math.min(w, h) / 2 * 0.85;
    this.needleValue = this.rng.float(0.2, 0.6);
    this.needleTarget = this.needleValue;
    this.updateInterval = this.rng.float(1.0, 3.0);

    // 270° arc (from 135° to 405° i.e. -45° to 225° in standard)
    const arcStart = Math.PI * 0.75; // 135°
    const arcEnd = Math.PI * 2.25; // 405°
    const segments = 64;
    const arcVerts: number[] = [];
    for (let i = 0; i < segments; i++) {
      const a1 = arcStart + (arcEnd - arcStart) * (i / segments);
      const a2 = arcStart + (arcEnd - arcStart) * ((i + 1) / segments);
      arcVerts.push(
        cx + Math.cos(a1) * radius, cy + Math.sin(a1) * radius, 0,
        cx + Math.cos(a2) * radius, cy + Math.sin(a2) * radius, 0,
      );
    }
    const arcGeo = new THREE.BufferGeometry();
    arcGeo.setAttribute('position', new THREE.Float32BufferAttribute(arcVerts, 3));
    this.arcLines = new THREE.LineSegments(arcGeo, new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.arcLines);

    // Danger zone (last 20% of arc)
    const dangerStart = arcStart + (arcEnd - arcStart) * 0.8;
    const dangerVerts: number[] = [];
    for (let i = 0; i < 16; i++) {
      const a1 = dangerStart + (arcEnd - dangerStart) * (i / 16);
      const a2 = dangerStart + (arcEnd - dangerStart) * ((i + 1) / 16);
      dangerVerts.push(
        cx + Math.cos(a1) * radius * 0.92, cy + Math.sin(a1) * radius * 0.92, 0,
        cx + Math.cos(a2) * radius * 0.92, cy + Math.sin(a2) * radius * 0.92, 0,
      );
    }
    const dangerGeo = new THREE.BufferGeometry();
    dangerGeo.setAttribute('position', new THREE.Float32BufferAttribute(dangerVerts, 3));
    this.dangerArc = new THREE.LineSegments(dangerGeo, new THREE.LineBasicMaterial({
      color: this.palette.alert,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.dangerArc);

    // Tick marks
    const tickVerts: number[] = [];
    const tickCount = 10;
    for (let i = 0; i <= tickCount; i++) {
      const t = i / tickCount;
      const a = arcStart + (arcEnd - arcStart) * t;
      const inner = (i % 5 === 0) ? 0.78 : 0.85;
      tickVerts.push(
        cx + Math.cos(a) * radius * inner, cy + Math.sin(a) * radius * inner, 0,
        cx + Math.cos(a) * radius * 0.95, cy + Math.sin(a) * radius * 0.95, 0,
      );
    }
    const tickGeo = new THREE.BufferGeometry();
    tickGeo.setAttribute('position', new THREE.Float32BufferAttribute(tickVerts, 3));
    this.tickLines = new THREE.LineSegments(tickGeo, new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.tickLines);

    // Needle
    const needleGeo = new THREE.BufferGeometry();
    needleGeo.setAttribute('position', new THREE.Float32BufferAttribute([
      cx, cy, 1, cx, cy + radius * 0.8, 1,
    ], 3));
    this.needle = new THREE.Line(needleGeo, new THREE.LineBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.needle);
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);
    const { x, y, w, h } = this.px;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const radius = Math.min(w, h) / 2 * 0.85;

    // Update target periodically
    this.updateTimer += dt;
    if (this.updateTimer >= this.updateInterval) {
      this.updateTimer = 0;
      this.needleTarget = this.rng.float(0.1, 0.95);
    }

    // Spring physics for needle
    const force = (this.needleTarget - this.needleValue) * 20;
    this.needleVelocity += force * dt;
    this.needleVelocity *= Math.exp(-5 * dt);
    this.needleValue += this.needleVelocity * dt;
    this.needleValue = Math.max(0, Math.min(1.05, this.needleValue));

    // Update needle position
    const arcStart = Math.PI * 0.75;
    const arcEnd = Math.PI * 2.25;
    const needleAngle = arcStart + (arcEnd - arcStart) * this.needleValue;
    const pos = this.needle.geometry.getAttribute('position') as THREE.BufferAttribute;
    pos.setXY(0, cx, cy);
    pos.setXY(1, cx + Math.cos(needleAngle) * radius * 0.8, cy + Math.sin(needleAngle) * radius * 0.8);
    pos.needsUpdate = true;

    // Color needle based on danger zone
    const inDanger = this.needleValue > 0.8;
    (this.needle.material as THREE.LineBasicMaterial).color.copy(
      inDanger ? this.palette.alert : this.palette.primary
    );
    (this.needle.material as THREE.LineBasicMaterial).opacity = opacity;
    (this.arcLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.4;
    (this.dangerArc.material as THREE.LineBasicMaterial).opacity = opacity * 0.6;
    (this.tickLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.5;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'pulse') {
      this.needleVelocity += this.rng.float(2, 5);
    }
    if (action === 'glitch') {
      this.needleValue = this.rng.float(0, 1);
    }
    if (action === 'alert') {
      this.needleTarget = 1.0;
    }
  }
}
