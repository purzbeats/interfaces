import * as THREE from 'three';
import { BaseElement } from './base-element';
import { stateOpacity, pulse, glitchOffset } from '../animation/fx';

/**
 * Arc reactor / circular gauge — segmented arcs that fill up like power levels,
 * with rotating indicator needles. Think power charging interfaces.
 */
export class ArcReactorElement extends BaseElement {
  private arcSegments: THREE.Line[] = [];
  private needle!: THREE.LineSegments;
  private centerRing!: THREE.Line;
  private segmentCount: number = 0;
  private segmentValues: number[] = [];
  private segmentTargets: number[] = [];
  private needleAngle: number = 0;
  private needleTargetAngle: number = 0;
  private cycleTimer: number = 0;
  private pulseTimer: number = 0;
  private glitchTimer: number = 0;

  build(): void {
    const { x, y, w, h } = this.px;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const outerR = Math.min(w, h) / 2 * 0.85;
    const innerR = outerR * 0.5;
    this.segmentCount = this.rng.int(6, 14);
    const gapAngle = 0.04; // gap between segments
    const segments = 32;

    for (let s = 0; s < this.segmentCount; s++) {
      const startAngle = (s / this.segmentCount) * Math.PI * 2 + gapAngle;
      const endAngle = ((s + 1) / this.segmentCount) * Math.PI * 2 - gapAngle;
      const arcR = innerR + (outerR - innerR) * 0.5;

      const positions: number[] = [];
      for (let i = 0; i <= segments; i++) {
        const a = startAngle + (endAngle - startAngle) * (i / segments);
        positions.push(cx + Math.cos(a) * arcR, cy + Math.sin(a) * arcR, 1);
      }

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      const arc = new THREE.Line(geo, new THREE.LineBasicMaterial({
        color: this.palette.primary,
        transparent: true,
        opacity: 0,
      }));
      this.arcSegments.push(arc);
      this.group.add(arc);

      this.segmentValues.push(0);
      this.segmentTargets.push(this.rng.float(0.2, 1.0));
    }

    // Center ring
    const centerPositions: number[] = [];
    const centerR = innerR * 0.4;
    for (let i = 0; i <= 32; i++) {
      const a = (i / 32) * Math.PI * 2;
      centerPositions.push(cx + Math.cos(a) * centerR, cy + Math.sin(a) * centerR, 2);
    }
    const centerGeo = new THREE.BufferGeometry();
    centerGeo.setAttribute('position', new THREE.Float32BufferAttribute(centerPositions, 3));
    this.centerRing = new THREE.Line(centerGeo, new THREE.LineBasicMaterial({
      color: this.palette.secondary,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.centerRing);

    // Needle
    const needleVerts = new Float32Array([
      cx, cy, 3, cx + outerR * 0.95, cy, 3,
    ]);
    const needleGeo = new THREE.BufferGeometry();
    needleGeo.setAttribute('position', new THREE.BufferAttribute(needleVerts, 3));
    this.needle = new THREE.LineSegments(needleGeo, new THREE.LineBasicMaterial({
      color: this.palette.alert,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.needle);

    this.needleTargetAngle = this.rng.float(0, Math.PI * 2);
  }

  update(dt: number, time: number): void {
    let opacity = stateOpacity(this.stateMachine.state, this.stateMachine.progress);
    const { x, y, w, h } = this.px;
    const cx = x + w / 2;
    const cy = y + h / 2;

    if (this.pulseTimer > 0) {
      this.pulseTimer -= dt;
      opacity *= pulse(this.pulseTimer);
    }

    const gx = this.glitchTimer > 0 ? glitchOffset(this.glitchTimer, 4) : 0;
    if (this.glitchTimer > 0) this.glitchTimer -= dt;
    this.group.position.x = gx;

    // Cycle segment targets
    this.cycleTimer += dt;
    if (this.cycleTimer > 2.5) {
      this.cycleTimer = 0;
      for (let s = 0; s < this.segmentCount; s++) {
        this.segmentTargets[s] = this.rng.float(0.1, 1.0);
      }
      this.needleTargetAngle = this.rng.float(0, Math.PI * 2);
    }

    // Update segments — each fills independently with overshoot easing
    for (let s = 0; s < this.segmentCount; s++) {
      const diff = this.segmentTargets[s] - this.segmentValues[s];
      this.segmentValues[s] += diff * dt * 3;
      // Slight overshoot
      if (Math.abs(diff) > 0.05) {
        this.segmentValues[s] += Math.sin(time * 15 + s) * 0.003;
      }

      const v = this.segmentValues[s];
      const segOpacity = opacity * (0.2 + v * 0.6);
      (this.arcSegments[s].material as THREE.LineBasicMaterial).opacity = segOpacity;

      // High-value segments glow brighter
      if (v > 0.8) {
        (this.arcSegments[s].material as THREE.LineBasicMaterial).color.copy(this.palette.secondary);
      } else {
        (this.arcSegments[s].material as THREE.LineBasicMaterial).color.copy(this.palette.primary);
      }
    }

    // Needle sweeps to target with springy motion
    const angleDiff = this.needleTargetAngle - this.needleAngle;
    this.needleAngle += angleDiff * dt * 2;
    this.needle.rotation.z = this.needleAngle;
    (this.needle.material as THREE.LineBasicMaterial).opacity = opacity * 0.7;

    // Center ring breathes
    const breathe = 1 + Math.sin(time * 1.5) * 0.08;
    this.centerRing.scale.set(breathe, breathe, 1);
    (this.centerRing.material as THREE.LineBasicMaterial).opacity = opacity * 0.5;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'pulse') {
      this.pulseTimer = 0.5;
      this.needleTargetAngle += Math.PI;
    }
    if (action === 'glitch') {
      this.glitchTimer = 0.4;
      for (let s = 0; s < this.segmentCount; s++) {
        this.segmentTargets[s] = this.rng.chance(0.5) ? 1 : 0;
      }
    }
    if (action === 'alert') {
      this.pulseTimer = 2.0;
      for (let s = 0; s < this.segmentCount; s++) {
        this.segmentTargets[s] = 1.0;
      }
    }
  }
}
