import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Spider web construction. Radial threads first, then spiral capture thread.
 * Animated building sequence with radial shape.
 */
export class SpiderWebElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'spider-web',
    meta: {
      shape: 'radial',
      roles: ['decorative'],
      moods: ['ambient'],
      bandAffinity: 'high',
      sizes: ['needs-medium', 'needs-large'],
    },
  };

  private radialMesh!: THREE.LineSegments;
  private spiralMesh!: THREE.Line;
  private cx: number = 0;
  private cy: number = 0;
  private maxRadius: number = 0;
  private radialCount: number = 0;
  private spiralTurns: number = 0;
  private spiralPoints: number = 0;
  private radialAngles: number[] = [];
  private buildTime: number = 0;
  private buildDuration: number = 0;
  private wobbleAmplitude: number = 0;

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;
    this.cx = x + w / 2;
    this.cy = y + h / 2;
    this.maxRadius = Math.min(w, h) * 0.42;

    const variant = this.rng.int(0, 3);
    const presets = [
      { radials: 12, turns: 15, duration: 6, wobble: 0.03 },
      { radials: 20, turns: 25, duration: 4, wobble: 0.02 },
      { radials: 8, turns: 10, duration: 8, wobble: 0.05 },
      { radials: 16, turns: 20, duration: 5, wobble: 0.04 },
    ];
    const p = presets[variant];
    this.radialCount = p.radials;
    this.spiralTurns = p.turns;
    this.buildDuration = p.duration;
    this.wobbleAmplitude = p.wobble;

    // Generate radial angles with slight irregularity
    this.radialAngles = [];
    for (let i = 0; i < this.radialCount; i++) {
      this.radialAngles.push(
        (i / this.radialCount) * Math.PI * 2 + this.rng.float(-0.1, 0.1),
      );
    }

    // Radial threads (LineSegments: pairs of vertices)
    const radPositions = new Float32Array(this.radialCount * 2 * 3);
    for (let i = 0; i < this.radialCount; i++) {
      // Center
      radPositions[i * 6] = this.cx;
      radPositions[i * 6 + 1] = this.cy;
      radPositions[i * 6 + 2] = 0;
      // Outer
      radPositions[i * 6 + 3] = this.cx + Math.cos(this.radialAngles[i]) * this.maxRadius;
      radPositions[i * 6 + 4] = this.cy + Math.sin(this.radialAngles[i]) * this.maxRadius;
      radPositions[i * 6 + 5] = 0;
    }
    const radGeo = new THREE.BufferGeometry();
    radGeo.setAttribute('position', new THREE.BufferAttribute(radPositions, 3));
    this.radialMesh = new THREE.LineSegments(radGeo, new THREE.LineBasicMaterial({
      color: this.palette.secondary,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.radialMesh);

    // Spiral thread
    this.spiralPoints = this.spiralTurns * this.radialCount;
    const spiralPositions = new Float32Array(this.spiralPoints * 3);
    // Fill with center initially
    for (let i = 0; i < this.spiralPoints; i++) {
      spiralPositions[i * 3] = this.cx;
      spiralPositions[i * 3 + 1] = this.cy;
      spiralPositions[i * 3 + 2] = 0;
    }
    const spiralGeo = new THREE.BufferGeometry();
    spiralGeo.setAttribute('position', new THREE.BufferAttribute(spiralPositions, 3));
    spiralGeo.setDrawRange(0, 0);
    this.spiralMesh = new THREE.Line(spiralGeo, new THREE.LineBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.spiralMesh);
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    this.buildTime += dt;

    const buildFrac = Math.min(this.buildTime / this.buildDuration, 1.0);

    // Phase 1: Radial threads appear (first 30%)
    const radialFrac = Math.min(buildFrac / 0.3, 1.0);

    // Animate radial thread growth
    const radPos = this.radialMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < this.radialCount; i++) {
      const r = this.maxRadius * radialFrac;
      const wobble = Math.sin(time * 2 + this.radialAngles[i] * 3) * this.wobbleAmplitude * this.maxRadius;
      radPos.setXYZ(i * 2, this.cx, this.cy, 0);
      radPos.setXYZ(i * 2 + 1,
        this.cx + Math.cos(this.radialAngles[i]) * (r + wobble),
        this.cy + Math.sin(this.radialAngles[i]) * (r + wobble),
        0,
      );
    }
    radPos.needsUpdate = true;
    (this.radialMesh.material as THREE.LineBasicMaterial).opacity = opacity * 0.6;

    // Phase 2: Spiral thread (after 20%)
    const spiralFrac = Math.max(0, (buildFrac - 0.2) / 0.8);
    const spiralPos = this.spiralMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const visibleSpiral = Math.floor(spiralFrac * this.spiralPoints);

    for (let i = 0; i < visibleSpiral; i++) {
      const turnFrac = i / this.spiralPoints;
      const radius = (0.1 + turnFrac * 0.9) * this.maxRadius;
      const angle = (i % this.radialCount) / this.radialCount * Math.PI * 2
        + this.radialAngles[i % this.radialCount] - (0 / this.radialCount) * Math.PI * 2;
      // Snap spiral to radial angles
      const radIdx = i % this.radialCount;
      const nextRadIdx = (radIdx + 1) % this.radialCount;
      const lerpFrac = 0.5; // midpoint between radials gives the sag
      const midAngle = this.radialAngles[radIdx];
      const wobble = Math.sin(time * 1.5 + i * 0.1) * this.wobbleAmplitude * radius;

      spiralPos.setXYZ(i,
        this.cx + Math.cos(midAngle) * (radius + wobble),
        this.cy + Math.sin(midAngle) * (radius + wobble),
        0,
      );
    }
    spiralPos.needsUpdate = true;
    this.spiralMesh.geometry.setDrawRange(0, visibleSpiral);
    (this.spiralMesh.material as THREE.LineBasicMaterial).opacity = opacity;

    // Loop: once fully built, slowly fade and rebuild
    if (this.buildTime > this.buildDuration + 3) {
      this.buildTime = 0;
    }
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Web "breaks" — reset build partway
      this.buildTime = this.rng.float(0, this.buildDuration * 0.3);
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level >= 2) {
      this.wobbleAmplitude = 0.03 + level * 0.015;
    }
  }
}
