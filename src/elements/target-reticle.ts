import * as THREE from 'three';
import { BaseElement } from './base-element';
import { pulse, stateOpacity, glitchOffset } from '../animation/fx';

/**
 * Concentric targeting reticle — expanding/contracting rings with rotating segments.
 * Classic EVA targeting computer aesthetic.
 */
export class TargetReticleElement extends BaseElement {
  private rings: THREE.Line[] = [];
  private tickMarks!: THREE.LineSegments;
  private innerDiamond!: THREE.LineSegments;
  private ringCount: number = 0;
  private ringRadii: number[] = [];
  private ringRotSpeeds: number[] = [];
  private ringScaleTarget: number[] = [];
  private ringScaleCurrent: number[] = [];
  private breathePhase: number = 0;
  private breatheSpeed: number = 0;
  private pulseTimer: number = 0;
  private glitchTimer: number = 0;
  private lockOn: boolean = false;

  build(): void {
    const { x, y, w, h } = this.px;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const maxR = Math.min(w, h) / 2 * 0.85;
    this.ringCount = this.rng.int(3, 7);
    this.breatheSpeed = this.rng.float(0.8, 2.0);
    this.breathePhase = this.rng.float(0, Math.PI * 2);

    for (let r = 0; r < this.ringCount; r++) {
      const radius = maxR * ((r + 1) / this.ringCount);
      this.ringRadii.push(radius);
      this.ringRotSpeeds.push(this.rng.float(-1.5, 1.5));
      this.ringScaleTarget.push(1);
      this.ringScaleCurrent.push(0);

      // Partial ring — not full circle, broken into segments
      const segments = this.rng.int(24, 48);
      const gapStart = this.rng.float(0, Math.PI * 2);
      const gapSize = this.rng.float(0.3, 1.2);
      const positions: number[] = [];

      for (let i = 0; i < segments; i++) {
        const a1 = (i / segments) * Math.PI * 2;
        const a2 = ((i + 1) / segments) * Math.PI * 2;
        // Skip gap region
        const midA = (a1 + a2) / 2;
        const distFromGap = Math.abs(((midA - gapStart + Math.PI) % (Math.PI * 2)) - Math.PI);
        if (distFromGap < gapSize / 2) continue;

        positions.push(
          cx + Math.cos(a1) * radius, cy + Math.sin(a1) * radius, 1,
          cx + Math.cos(a2) * radius, cy + Math.sin(a2) * radius, 1,
        );
      }

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      const ring = new THREE.Line(geo, new THREE.LineBasicMaterial({
        color: r === this.ringCount - 1 ? this.palette.secondary : this.palette.primary,
        transparent: true,
        opacity: 0,
      }));
      this.rings.push(ring);
      this.group.add(ring);
    }

    // Tick marks at cardinal directions
    const tickVerts: number[] = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const inner = maxR * 0.15;
      const outer = maxR * 0.25;
      tickVerts.push(
        cx + Math.cos(a) * inner, cy + Math.sin(a) * inner, 2,
        cx + Math.cos(a) * outer, cy + Math.sin(a) * outer, 2,
      );
    }
    const tickGeo = new THREE.BufferGeometry();
    tickGeo.setAttribute('position', new THREE.Float32BufferAttribute(tickVerts, 3));
    this.tickMarks = new THREE.LineSegments(tickGeo, new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.tickMarks);

    // Inner diamond
    const ds = maxR * 0.1;
    const dVerts = new Float32Array([
      cx, cy - ds, 2, cx + ds, cy, 2,
      cx + ds, cy, 2, cx, cy + ds, 2,
      cx, cy + ds, 2, cx - ds, cy, 2,
      cx - ds, cy, 2, cx, cy - ds, 2,
    ]);
    const dGeo = new THREE.BufferGeometry();
    dGeo.setAttribute('position', new THREE.BufferAttribute(dVerts, 3));
    this.innerDiamond = new THREE.LineSegments(dGeo, new THREE.LineBasicMaterial({
      color: this.palette.alert,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.innerDiamond);
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

    const gx = this.glitchTimer > 0 ? glitchOffset(this.glitchTimer, 5) : 0;
    if (this.glitchTimer > 0) this.glitchTimer -= dt;

    // Breathing scale
    const breathe = 1 + Math.sin(time * this.breatheSpeed + this.breathePhase) * 0.06;

    for (let r = 0; r < this.rings.length; r++) {
      // Smooth scale interpolation
      this.ringScaleCurrent[r] += (this.ringScaleTarget[r] - this.ringScaleCurrent[r]) * dt * 4;
      const scale = this.ringScaleCurrent[r] * breathe;

      const ring = this.rings[r];
      ring.position.set(cx + gx, cy, 0);
      ring.position.x -= cx;
      ring.position.y -= cy;
      ring.scale.set(scale, scale, 1);
      ring.position.x += cx + gx;
      ring.position.y += cy;

      // Each ring rotates
      ring.rotation.z += this.ringRotSpeeds[r] * dt;

      const ringOpacity = opacity * (this.lockOn ? 0.9 : 0.5 + r * 0.08);
      (ring.material as THREE.LineBasicMaterial).opacity = ringOpacity;
    }

    (this.tickMarks.material as THREE.LineBasicMaterial).opacity = opacity * 0.4;

    // Diamond pulses when locked on
    const diamondOpacity = this.lockOn
      ? opacity * (0.6 + Math.sin(time * 8) * 0.4)
      : opacity * 0.3;
    (this.innerDiamond.material as THREE.LineBasicMaterial).opacity = diamondOpacity;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'activate') {
      // Rings expand from center on activation
      for (let r = 0; r < this.ringCount; r++) {
        this.ringScaleCurrent[r] = 0;
        this.ringScaleTarget[r] = 1;
      }
    }
    if (action === 'pulse') {
      this.pulseTimer = 0.5;
      // Rings contract then expand
      for (let r = 0; r < this.ringCount; r++) {
        this.ringScaleTarget[r] = 0.7;
        setTimeout(() => { this.ringScaleTarget[r] = 1; }, 200 + r * 50);
      }
    }
    if (action === 'glitch') this.glitchTimer = 0.5;
    if (action === 'alert') {
      this.lockOn = true;
      this.pulseTimer = 2.0;
      this.emitAudio('seekSound', 200);
    }
  }
}
