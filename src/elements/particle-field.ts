import * as THREE from 'three';
import { BaseElement } from './base-element';
import { stateOpacity, pulse, glitchOffset } from '../animation/fx';

/**
 * Field of drifting particles with connection lines between nearby ones.
 * Network-graph / constellation style display.
 */
export class ParticleFieldElement extends BaseElement {
  private pointsMesh!: THREE.Points;
  private linesMesh!: THREE.LineSegments;
  private borderLines!: THREE.LineSegments;
  private particles: { x: number; y: number; vx: number; vy: number }[] = [];
  private connectionThreshold: number = 0;
  private maxConnections: number = 0;
  private pulseTimer: number = 0;
  private glitchTimer: number = 0;

  build(): void {
    const { x, y, w, h } = this.px;
    const count = this.rng.int(50, 100);
    this.connectionThreshold = Math.min(w, h) * this.rng.float(0.12, 0.22);
    this.maxConnections = count * 4;

    // Initialize particles
    for (let i = 0; i < count; i++) {
      this.particles.push({
        x: x + this.rng.float(0, w),
        y: y + this.rng.float(0, h),
        vx: this.rng.float(-30, 30),
        vy: this.rng.float(-30, 30),
      });
    }

    // Points
    const positions = new Float32Array(count * 3);
    const pointGeo = new THREE.BufferGeometry();
    pointGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.pointsMesh = new THREE.Points(pointGeo, new THREE.PointsMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
      size: Math.max(3, Math.min(w, h) * 0.005),
      sizeAttenuation: false,
    }));
    this.group.add(this.pointsMesh);

    // Connection lines (preallocated)
    const linePositions = new Float32Array(this.maxConnections * 2 * 3);
    const lineColors = new Float32Array(this.maxConnections * 2 * 3);
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.BufferAttribute(linePositions, 3));
    lineGeo.setAttribute('color', new THREE.BufferAttribute(lineColors, 3));
    lineGeo.setDrawRange(0, 0);
    this.linesMesh = new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.linesMesh);

    // Border
    const bv = new Float32Array([
      x, y, 0, x + w, y, 0,
      x + w, y, 0, x + w, y + h, 0,
      x + w, y + h, 0, x, y + h, 0,
      x, y + h, 0, x, y, 0,
    ]);
    const borderGeo = new THREE.BufferGeometry();
    borderGeo.setAttribute('position', new THREE.BufferAttribute(bv, 3));
    this.borderLines = new THREE.LineSegments(borderGeo, new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.borderLines);
  }

  update(dt: number, _time: number): void {
    let opacity = stateOpacity(this.stateMachine.state, this.stateMachine.progress);
    if (this.pulseTimer > 0) { this.pulseTimer -= dt; opacity *= pulse(this.pulseTimer); }
    const gx = this.glitchTimer > 0 ? glitchOffset(this.glitchTimer, 4) : 0;
    if (this.glitchTimer > 0) this.glitchTimer -= dt;
    this.group.position.x = gx;

    const { x, y, w, h } = this.px;

    // Move particles
    for (const p of this.particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      // Bounce off bounds
      if (p.x < x) { p.x = x; p.vx = Math.abs(p.vx); }
      if (p.x > x + w) { p.x = x + w; p.vx = -Math.abs(p.vx); }
      if (p.y < y) { p.y = y; p.vy = Math.abs(p.vy); }
      if (p.y > y + h) { p.y = y + h; p.vy = -Math.abs(p.vy); }
    }

    // Update point positions
    const pointPos = this.pointsMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < this.particles.length; i++) {
      pointPos.setXYZ(i, this.particles[i].x, this.particles[i].y, 0);
    }
    pointPos.needsUpdate = true;
    (this.pointsMesh.material as THREE.PointsMaterial).opacity = opacity;

    // Update connections
    const linePos = this.linesMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const lineCol = this.linesMesh.geometry.getAttribute('color') as THREE.BufferAttribute;
    let lineIdx = 0;
    const thresh2 = this.connectionThreshold * this.connectionThreshold;
    const pr = this.palette.primary.r;
    const pg = this.palette.primary.g;
    const pb = this.palette.primary.b;

    for (let i = 0; i < this.particles.length && lineIdx < this.maxConnections; i++) {
      for (let j = i + 1; j < this.particles.length && lineIdx < this.maxConnections; j++) {
        const dx = this.particles[i].x - this.particles[j].x;
        const dy = this.particles[i].y - this.particles[j].y;
        const dist2 = dx * dx + dy * dy;
        if (dist2 < thresh2) {
          const alpha = 1 - Math.sqrt(dist2) / this.connectionThreshold;
          const vi = lineIdx * 2;
          linePos.setXYZ(vi, this.particles[i].x, this.particles[i].y, 0);
          linePos.setXYZ(vi + 1, this.particles[j].x, this.particles[j].y, 0);
          lineCol.setXYZ(vi, pr * alpha, pg * alpha, pb * alpha);
          lineCol.setXYZ(vi + 1, pr * alpha, pg * alpha, pb * alpha);
          lineIdx++;
        }
      }
    }
    linePos.needsUpdate = true;
    lineCol.needsUpdate = true;
    this.linesMesh.geometry.setDrawRange(0, lineIdx * 2);
    (this.linesMesh.material as THREE.LineBasicMaterial).opacity = opacity * 0.6;

    (this.borderLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.2;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'pulse') this.pulseTimer = 0.5;
    if (action === 'glitch') {
      this.glitchTimer = 0.4;
      for (const p of this.particles) {
        p.vx += (Math.random() - 0.5) * 60;
        p.vy += (Math.random() - 0.5) * 60;
      }
    }
    if (action === 'alert') {
      this.pulseTimer = 2.0;
      (this.pointsMesh.material as THREE.PointsMaterial).color.copy(this.palette.alert);
    }
  }
}
