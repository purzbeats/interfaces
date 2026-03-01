import * as THREE from 'three';
import { BaseElement } from './base-element';
import { glitchOffset } from '../animation/fx';

export class RadarSweepElement extends BaseElement {
  private sweepLine!: THREE.Line;
  private ringLines!: THREE.LineSegments;
  private blips: THREE.Points | null = null;
  private angle: number = 0;
  private speed: number = 0;
  private blipData: Array<{ angle: number; radius: number; brightness: number }> = [];
  private alertMode: boolean = false;

  build(): void {
    this.glitchAmount = 5;
    const { x, y, w, h } = this.px;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const radius = Math.min(w, h) / 2 * 0.9;
    this.speed = this.rng.float(1.5, 3.5);

    // Concentric rings + crosshairs
    const ringVerts: number[] = [];
    const ringCount = this.rng.int(4, 8);
    const segments = 64;
    for (let r = 1; r <= ringCount; r++) {
      const rr = (radius / ringCount) * r;
      for (let i = 0; i < segments; i++) {
        const a1 = (i / segments) * Math.PI * 2;
        const a2 = ((i + 1) / segments) * Math.PI * 2;
        ringVerts.push(
          cx + Math.cos(a1) * rr, cy + Math.sin(a1) * rr, 0,
          cx + Math.cos(a2) * rr, cy + Math.sin(a2) * rr, 0,
        );
      }
    }
    ringVerts.push(cx - radius, cy, 0, cx + radius, cy, 0);
    ringVerts.push(cx, cy - radius, 0, cx, cy + radius, 0);

    const ringGeo = new THREE.BufferGeometry();
    ringGeo.setAttribute('position', new THREE.Float32BufferAttribute(ringVerts, 3));
    this.ringLines = new THREE.LineSegments(ringGeo, new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.ringLines);

    // Sweep line
    const sweepGeo = new THREE.BufferGeometry();
    sweepGeo.setAttribute('position', new THREE.Float32BufferAttribute([
      cx, cy, 1, cx + radius, cy, 1,
    ], 3));
    this.sweepLine = new THREE.Line(sweepGeo, new THREE.LineBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.sweepLine);

    // Blips
    const blipCount = this.rng.int(8, 20);
    for (let i = 0; i < blipCount; i++) {
      this.blipData.push({
        angle: this.rng.float(0, Math.PI * 2),
        radius: this.rng.float(0.2, 0.9) * radius,
        brightness: 0,
      });
    }
    const blipPos = new Float32Array(blipCount * 3);
    for (let i = 0; i < blipCount; i++) {
      const b = this.blipData[i];
      blipPos[i * 3] = cx + Math.cos(b.angle) * b.radius;
      blipPos[i * 3 + 1] = cy + Math.sin(b.angle) * b.radius;
      blipPos[i * 3 + 2] = 2;
    }
    const blipGeo = new THREE.BufferGeometry();
    blipGeo.setAttribute('position', new THREE.BufferAttribute(blipPos, 3));
    this.blips = new THREE.Points(blipGeo, new THREE.PointsMaterial({
      color: this.palette.primary,
      size: Math.max(4, Math.min(w, h) * 0.008),
      transparent: true,
      opacity: 0,
      sizeAttenuation: false,
    }));
    this.group.add(this.blips);
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    const { x, y, w, h } = this.px;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const radius = Math.min(w, h) / 2 * 0.9;

    this.angle += dt * this.speed;

    // Update sweep line endpoint
    const positions = this.sweepLine.geometry.getAttribute('position') as THREE.BufferAttribute;
    positions.setXY(0, cx, cy);
    positions.setXY(1, cx + Math.cos(this.angle) * radius, cy + Math.sin(this.angle) * radius);
    positions.needsUpdate = true;

    const sweepColor = this.alertMode ? this.palette.alert : this.palette.primary;
    (this.sweepLine.material as THREE.LineBasicMaterial).color.copy(sweepColor);
    (this.sweepLine.material as THREE.LineBasicMaterial).opacity = opacity;
    (this.ringLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.4;

    // Update blip brightness based on sweep proximity
    if (this.blips) {
      const blipPositions = this.blips.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < this.blipData.length; i++) {
        const b = this.blipData[i];
        let angleDiff = ((this.angle - b.angle) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
        if (angleDiff < 0.3) {
          b.brightness = 1;
        } else {
          b.brightness *= 0.97;
        }
        // Jitter blips during glitch
        const jx = this.glitchTimer > 0 ? glitchOffset(this.glitchTimer + i, 3) : 0;
        blipPositions.setX(i, cx + Math.cos(b.angle) * b.radius + jx);
      }
      blipPositions.needsUpdate = true;
      (this.blips.material as THREE.PointsMaterial).opacity = opacity * 0.8;
      (this.blips.material as THREE.PointsMaterial).color.copy(sweepColor);
    }
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      this.speed = this.rng.float(4, 12); // spin fast briefly
    }
    if (action === 'alert') {
      this.alertMode = true;
      this.pulseTimer = 2.0;
      this.speed *= 2;
    }
  }
}
