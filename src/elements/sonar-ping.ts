import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Expanding arcs from center with echo blips.
 * Arcs are partial circles (~120 degrees) that expand outward, fading as they go.
 */
export class SonarPingElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'sonar-ping',
    meta: { shape: 'radial', roles: ['scanner'], moods: ['tactical'], sizes: ['needs-medium', 'needs-large'] },
  };
  private arcs: THREE.Line[] = [];
  private arcPhases: number[] = [];
  private arcAngles: number[] = [];
  private blipPoints!: THREE.Points;
  private blipData: Array<{ angle: number; radius: number; brightness: number }> = [];
  private centerDot!: THREE.Mesh;
  private maxArcs: number = 0;
  private pingSpeed: number = 0;
  private segments: number = 32;
  private alertMode: boolean = false;

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const maxR = Math.min(w, h) / 2 * 0.9;

    this.maxArcs = this.rng.int(4, 8);
    this.pingSpeed = this.rng.float(0.3, 0.7);

    // Create arcs (~120 degree partial circles)
    for (let i = 0; i < this.maxArcs; i++) {
      const positions = new Float32Array((this.segments + 1) * 3);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const arc = new THREE.Line(geo, new THREE.LineBasicMaterial({
        color: this.palette.primary,
        transparent: true,
        opacity: 0,
      }));
      this.arcs.push(arc);
      this.arcPhases.push(i / this.maxArcs);
      this.arcAngles.push(this.rng.float(0, Math.PI * 2));
      this.group.add(arc);
    }

    // Blip echo points
    const blipCount = this.rng.int(6, 15);
    const blipPositions = new Float32Array(blipCount * 3);
    for (let i = 0; i < blipCount; i++) {
      const angle = this.rng.float(0, Math.PI * 2);
      const radius = this.rng.float(0.2, 0.85) * maxR;
      blipPositions[i * 3] = cx + Math.cos(angle) * radius;
      blipPositions[i * 3 + 1] = cy + Math.sin(angle) * radius;
      blipPositions[i * 3 + 2] = 2;
      this.blipData.push({ angle, radius, brightness: 0 });
    }
    const blipGeo = new THREE.BufferGeometry();
    blipGeo.setAttribute('position', new THREE.BufferAttribute(blipPositions, 3));
    this.blipPoints = new THREE.Points(blipGeo, new THREE.PointsMaterial({
      color: this.palette.primary,
      size: Math.max(4, Math.min(w, h) * 0.01),
      transparent: true,
      opacity: 0,
      sizeAttenuation: false,
    }));
    this.group.add(this.blipPoints);

    // Center dot
    const dotGeo = new THREE.CircleGeometry(Math.max(3, maxR * 0.03), 12);
    this.centerDot = new THREE.Mesh(dotGeo, new THREE.MeshBasicMaterial({
      color: this.palette.secondary,
      transparent: true,
      opacity: 0,
    }));
    this.centerDot.position.set(cx, cy, 2);
    this.group.add(this.centerDot);
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    const { x, y, w, h } = this.px;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const maxR = Math.min(w, h) / 2 * 0.9;
    const gx = this.group.position.x;
    const arcSpan = Math.PI * 2 / 3; // ~120 degrees

    for (let i = 0; i < this.maxArcs; i++) {
      this.arcPhases[i] = (this.arcPhases[i] + dt * this.pingSpeed) % 1;
      const phase = this.arcPhases[i];
      const radius = phase * maxR;
      const fadeOut = 1 - phase;
      const startAngle = this.arcAngles[i] + time * 0.2;

      const positions = this.arcs[i].geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let s = 0; s <= this.segments; s++) {
        const a = startAngle + (s / this.segments) * arcSpan;
        positions.setXYZ(s, cx + Math.cos(a) * radius + gx, cy + Math.sin(a) * radius, 1);
      }
      positions.needsUpdate = true;

      const arcColor = this.alertMode ? this.palette.alert : this.palette.primary;
      const mat = this.arcs[i].material as THREE.LineBasicMaterial;
      mat.color.copy(arcColor);
      mat.opacity = opacity * fadeOut * 0.8;

      // Light up blips when an arc passes their radius
      for (let b = 0; b < this.blipData.length; b++) {
        const blip = this.blipData[b];
        const radiusDiff = Math.abs(radius - blip.radius);
        if (radiusDiff < maxR * 0.05) {
          // Check if blip is within arc's angular span
          let angleDiff = ((blip.angle - startAngle) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
          if (angleDiff < arcSpan) {
            blip.brightness = 1;
          }
        }
      }
    }

    // Fade blips
    const blipPositions = this.blipPoints.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let b = 0; b < this.blipData.length; b++) {
      const blip = this.blipData[b];
      blip.brightness *= 0.96;
      blipPositions.setX(b, cx + Math.cos(blip.angle) * blip.radius + gx);
    }
    blipPositions.needsUpdate = true;

    const blipOpacity = this.blipData.reduce((max, b) => Math.max(max, b.brightness), 0);
    (this.blipPoints.material as THREE.PointsMaterial).opacity = opacity * Math.max(0.1, blipOpacity);

    // Center dot
    this.centerDot.position.x = cx + gx;
    (this.centerDot.material as THREE.MeshBasicMaterial).opacity = opacity * 0.7;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      this.pingSpeed *= 4;
      setTimeout(() => { this.pingSpeed /= 4; }, 500);
    }
    if (action === 'alert') {
      this.alertMode = true;
      this.pulseTimer = 2.0;
      // Reset all arcs to center for a burst
      for (let i = 0; i < this.maxArcs; i++) {
        this.arcPhases[i] = i * 0.05;
      }
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) { this.alertMode = false; return; }
    if (level >= 4) { this.alertMode = true; }
  }
}
