import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Field of drifting particles with connection lines between nearby ones.
 * Network-graph / constellation style display.
 */
export class ParticleFieldElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'particle-field',
    meta: { shape: 'rectangular', roles: ['decorative', 'data-display'], moods: ['ambient'], bandAffinity: 'high', audioSensitivity: 1.5, sizes: ['needs-medium', 'needs-large'] },
  };
  private pointsMesh!: THREE.Points;
  private linesMesh!: THREE.LineSegments;
  private borderLines!: THREE.LineSegments;
  private particles: { x: number; y: number; vx: number; vy: number }[] = [];
  private connectionThreshold: number = 0;
  private maxConnections: number = 0;

  build(): void {
    const variant = this.rng.int(0, 3);
    const presets = [
      { count: 70, speedRange: 30, sizeMul: 0.005, connMul: 0.17, maxConnMul: 4 },      // Standard
      { count: 150, speedRange: 50, sizeMul: 0.008, connMul: 0.25, maxConnMul: 5 },     // Dense/Intense
      { count: 25, speedRange: 15, sizeMul: 0.004, connMul: 0.10, maxConnMul: 3 },      // Minimal/Sparse
      { count: 100, speedRange: 60, sizeMul: 0.012, connMul: 0.30, maxConnMul: 6 },     // Exotic/Alt
    ];
    const p = presets[variant];

    const { x, y, w, h } = this.px;
    const count = p.count + this.rng.int(-5, 5);
    this.connectionThreshold = Math.min(w, h) * (p.connMul + this.rng.float(-0.02, 0.02));
    this.maxConnections = count * p.maxConnMul;

    // Initialize particles
    for (let i = 0; i < count; i++) {
      this.particles.push({
        x: x + this.rng.float(0, w),
        y: y + this.rng.float(0, h),
        vx: this.rng.float(-p.speedRange, p.speedRange),
        vy: this.rng.float(-p.speedRange, p.speedRange),
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
      size: Math.max(3, Math.min(w, h) * p.sizeMul),
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
    const opacity = this.applyEffects(dt);

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

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) {
      this.connectionThreshold = Math.min(this.px.w, this.px.h) * 0.17;
      return;
    }
    // Increase connection distance with level
    this.connectionThreshold = Math.min(this.px.w, this.px.h) * (0.17 + level * 0.02);
    // Increase particle speed with level
    const kick = level * (level >= 3 ? 30 : 10);
    for (const p of this.particles) {
      p.vx += this.rng.float(-1, 1) * kick;
      p.vy += this.rng.float(-1, 1) * kick;
    }
    if (level >= 5) {
      (this.pointsMesh.material as THREE.PointsMaterial).color.copy(this.palette.alert);
      setTimeout(() => {
        (this.pointsMesh.material as THREE.PointsMaterial).color.copy(this.palette.primary);
      }, 2000);
    }
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      for (const p of this.particles) {
        p.vx += (this.rng.next() - 0.5) * 60;
        p.vy += (this.rng.next() - 0.5) * 60;
      }
    }
    if (action === 'alert') {
      (this.pointsMesh.material as THREE.PointsMaterial).color.copy(this.palette.alert);
    }
  }
}
