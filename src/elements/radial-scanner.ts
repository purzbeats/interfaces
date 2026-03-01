import * as THREE from 'three';
import { BaseElement } from './base-element';
import { stateOpacity, pulse, glitchOffset } from '../animation/fx';

/**
 * Expanding ping rings from center that illuminate static blips.
 * No rotation — rings expand via vertex position updates.
 */
export class RadialScannerElement extends BaseElement {
  private crosshairs!: THREE.LineSegments;
  private blipPoints!: THREE.Points;
  private blipBrightness: number[] = [];
  private blipCount: number = 0;
  private borderRing!: THREE.Line;
  private pingRings: { ring: THREE.Line; radius: number; maxRadius: number }[] = [];
  private centerDot!: THREE.Points;
  private pingTimer: number = 0;
  private pingInterval: number = 0;
  private segments: number = 48;
  private pulseTimer: number = 0;
  private glitchTimer: number = 0;

  build(): void {
    const { x, y, w, h } = this.px;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const maxR = Math.min(w, h) / 2 * 0.9;
    this.pingInterval = this.rng.float(1.2, 2.5);

    // Border ring
    const borderVerts: number[] = [];
    for (let i = 0; i <= this.segments; i++) {
      const a = (i / this.segments) * Math.PI * 2;
      borderVerts.push(cx + Math.cos(a) * maxR, cy + Math.sin(a) * maxR, 0);
    }
    const borderGeo = new THREE.BufferGeometry();
    borderGeo.setAttribute('position', new THREE.Float32BufferAttribute(borderVerts, 3));
    this.borderRing = new THREE.Line(borderGeo, new THREE.LineBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.borderRing);

    // Crosshairs — full diameter
    const crossVerts = new Float32Array([
      cx - maxR, cy, 0, cx + maxR, cy, 0,
      cx, cy - maxR, 0, cx, cy + maxR, 0,
    ]);
    const crossGeo = new THREE.BufferGeometry();
    crossGeo.setAttribute('position', new THREE.BufferAttribute(crossVerts, 3));
    this.crosshairs = new THREE.LineSegments(crossGeo, new THREE.LineBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.crosshairs);

    // Center dot
    const centerDotGeo = new THREE.BufferGeometry();
    centerDotGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([cx, cy, 2]), 3));
    this.centerDot = new THREE.Points(centerDotGeo, new THREE.PointsMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
      size: 6,
      sizeAttenuation: false,
    }));
    this.group.add(this.centerDot);

    // Static blips at random positions within the circle
    this.blipCount = this.rng.int(8, 20);
    const blipPositions = new Float32Array(this.blipCount * 3);
    const blipColors = new Float32Array(this.blipCount * 3);
    for (let i = 0; i < this.blipCount; i++) {
      const angle = this.rng.float(0, Math.PI * 2);
      const dist = this.rng.float(0.15, 0.85) * maxR;
      blipPositions[i * 3] = cx + Math.cos(angle) * dist;
      blipPositions[i * 3 + 1] = cy + Math.sin(angle) * dist;
      blipPositions[i * 3 + 2] = 2;
      const c = this.palette.dim;
      blipColors[i * 3] = c.r;
      blipColors[i * 3 + 1] = c.g;
      blipColors[i * 3 + 2] = c.b;
      this.blipBrightness.push(0);
    }
    const blipGeo = new THREE.BufferGeometry();
    blipGeo.setAttribute('position', new THREE.BufferAttribute(blipPositions, 3));
    blipGeo.setAttribute('color', new THREE.BufferAttribute(blipColors, 3));
    this.blipPoints = new THREE.Points(blipGeo, new THREE.PointsMaterial({
      size: Math.max(4, Math.min(w, h) * 0.01),
      vertexColors: true,
      transparent: true,
      opacity: 0,
      sizeAttenuation: false,
    }));
    this.group.add(this.blipPoints);

    // Pre-create ping ring pool (reuse) — first one starts immediately
    for (let p = 0; p < 4; p++) {
      const pingPos = new Float32Array((this.segments + 1) * 3);
      const pingGeo = new THREE.BufferGeometry();
      pingGeo.setAttribute('position', new THREE.BufferAttribute(pingPos, 3));
      const ring = new THREE.Line(pingGeo, new THREE.LineBasicMaterial({
        color: this.palette.primary,
        transparent: true,
        opacity: 0,
      }));
      this.pingRings.push({ ring, radius: p === 0 ? 0 : -1, maxRadius: maxR });
      this.group.add(ring);
    }
  }

  update(dt: number, _time: number): void {
    let opacity = stateOpacity(this.stateMachine.state, this.stateMachine.progress);
    const { x, y, w, h } = this.px;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const maxR = Math.min(w, h) / 2 * 0.9;

    if (this.pulseTimer > 0) {
      this.pulseTimer -= dt;
      opacity *= pulse(this.pulseTimer);
    }

    const gx = this.glitchTimer > 0 ? glitchOffset(this.glitchTimer, 4) : 0;
    if (this.glitchTimer > 0) this.glitchTimer -= dt;
    this.group.position.x = gx;

    // Spawn new ping rings
    this.pingTimer += dt;
    if (this.pingTimer >= this.pingInterval) {
      this.pingTimer = 0;
      // Find inactive ring slot
      for (const pr of this.pingRings) {
        if (pr.radius < 0 || pr.radius > pr.maxRadius) {
          pr.radius = 0;
          break;
        }
      }
    }

    // Update ping rings
    const expandSpeed = maxR * 0.6; // traverse full radius in ~1.7s
    const blipPositions = this.blipPoints.geometry.getAttribute('position') as THREE.BufferAttribute;

    for (const pr of this.pingRings) {
      if (pr.radius < 0) {
        (pr.ring.material as THREE.LineBasicMaterial).opacity = 0;
        continue;
      }

      pr.radius += expandSpeed * dt;
      const progress = pr.radius / pr.maxRadius;
      const ringOpacity = opacity * Math.max(0, 1 - progress) * 0.8;

      // Update ring vertices
      const pos = pr.ring.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i <= this.segments; i++) {
        const a = (i / this.segments) * Math.PI * 2;
        pos.setXYZ(i, cx + Math.cos(a) * pr.radius, cy + Math.sin(a) * pr.radius, 1);
      }
      pos.needsUpdate = true;
      (pr.ring.material as THREE.LineBasicMaterial).opacity = ringOpacity;

      // Illuminate blips near ring edge
      for (let i = 0; i < this.blipCount; i++) {
        const bx = blipPositions.getX(i) - cx;
        const by = blipPositions.getY(i) - cy;
        const blipDist = Math.sqrt(bx * bx + by * by);
        const ringDist = Math.abs(blipDist - pr.radius);
        if (ringDist < maxR * 0.06) {
          this.blipBrightness[i] = 1;
        }
      }
    }

    // Decay blip brightness
    const colors = this.blipPoints.geometry.getAttribute('color') as THREE.BufferAttribute;
    const primary = this.palette.primary;
    const dim = this.palette.dim;
    for (let i = 0; i < this.blipCount; i++) {
      this.blipBrightness[i] *= Math.exp(-1.5 * dt);
      const b = this.blipBrightness[i];
      colors.setXYZ(i,
        dim.r + (primary.r - dim.r) * b,
        dim.g + (primary.g - dim.g) * b,
        dim.b + (primary.b - dim.b) * b,
      );
    }
    colors.needsUpdate = true;

    (this.blipPoints.material as THREE.PointsMaterial).opacity = opacity;
    (this.borderRing.material as THREE.LineBasicMaterial).opacity = opacity * 0.5;
    (this.crosshairs.material as THREE.LineBasicMaterial).opacity = opacity * 0.25;
    (this.centerDot.material as THREE.PointsMaterial).opacity = opacity;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'pulse') {
      this.pulseTimer = 0.5;
      // Fire a ping immediately
      for (const pr of this.pingRings) {
        if (pr.radius < 0 || pr.radius > pr.maxRadius) {
          pr.radius = 0;
          break;
        }
      }
    }
    if (action === 'glitch') {
      this.glitchTimer = 0.5;
      // Brighten all blips
      for (let i = 0; i < this.blipCount; i++) {
        this.blipBrightness[i] = 1;
      }
    }
    if (action === 'alert') {
      this.pulseTimer = 2.0;
      // Rapid pings
      for (const pr of this.pingRings) {
        pr.radius = 0;
      }
    }
  }
}
