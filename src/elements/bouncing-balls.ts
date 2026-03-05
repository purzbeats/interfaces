import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Multiple balls bouncing under gravity in a box with wall collisions.
 * A phase-space plot (position vs velocity) is drawn alongside using line segments.
 */
export class BouncingBallsElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'bouncing-balls',
    meta: { shape: 'rectangular', roles: ['data-display', 'decorative'], moods: ['diagnostic', 'ambient'], bandAffinity: 'bass', sizes: ['needs-medium', 'needs-large'] },
  };

  private ballCount = 0;
  private px2!: Float32Array; // x positions
  private py2!: Float32Array; // y positions
  private vx!: Float32Array;
  private vy!: Float32Array;
  private radii!: Float32Array;
  private gravity = 0;
  private restitution = 0.9;
  private ballPoints!: THREE.Points;
  private phaseLines!: THREE.LineSegments;
  private borderLines!: THREE.LineSegments;
  private simW = 0;
  private simH = 0;
  private phaseW = 0;

  build(): void {
    this.glitchAmount = 4;
    const variant = this.rng.int(0, 3);
    const presets = [
      { balls: 12, gravity: 200, restitution: 0.9, radius: 4 },
      { balls: 30, gravity: 300, restitution: 0.85, radius: 3 },
      { balls: 6, gravity: 150, restitution: 0.95, radius: 6 },
      { balls: 20, gravity: 400, restitution: 0.8, radius: 3.5 },
    ];
    const p = presets[variant];

    const { x, y, w, h } = this.px;
    this.ballCount = p.balls;
    this.gravity = p.gravity * (h / 200);
    this.restitution = p.restitution;
    this.simW = w * 0.6;
    this.simH = h;
    this.phaseW = w * 0.35;

    this.px2 = new Float32Array(this.ballCount);
    this.py2 = new Float32Array(this.ballCount);
    this.vx = new Float32Array(this.ballCount);
    this.vy = new Float32Array(this.ballCount);
    this.radii = new Float32Array(this.ballCount);

    for (let i = 0; i < this.ballCount; i++) {
      this.px2[i] = this.rng.float(p.radius, this.simW - p.radius);
      this.py2[i] = this.rng.float(p.radius, this.simH * 0.7);
      this.vx[i] = this.rng.float(-80, 80);
      this.vy[i] = this.rng.float(-50, 50);
      this.radii[i] = p.radius + this.rng.float(-1, 1);
    }

    // Ball points
    const positions = new Float32Array(this.ballCount * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.ballPoints = new THREE.Points(geo, new THREE.PointsMaterial({
      color: this.palette.primary, transparent: true, opacity: 0,
      size: p.radius * 2, sizeAttenuation: false,
    }));
    this.group.add(this.ballPoints);

    // Phase space plot: each ball gets 2 vertices (a short line segment showing its state)
    const phasePositions = new Float32Array(this.ballCount * 2 * 3);
    const phaseGeo = new THREE.BufferGeometry();
    phaseGeo.setAttribute('position', new THREE.BufferAttribute(phasePositions, 3));
    this.phaseLines = new THREE.LineSegments(phaseGeo, new THREE.LineBasicMaterial({
      color: this.palette.secondary, transparent: true, opacity: 0,
    }));
    this.group.add(this.phaseLines);

    // Border for sim area and phase area
    const bx = x, by = y;
    const bv = [
      bx, by, 0, bx + this.simW, by, 0,
      bx + this.simW, by, 0, bx + this.simW, by + h, 0,
      bx + this.simW, by + h, 0, bx, by + h, 0,
      bx, by + h, 0, bx, by, 0,
      // Phase area border
      bx + this.simW + w * 0.05, by, 0, bx + w, by, 0,
      bx + w, by, 0, bx + w, by + h, 0,
      bx + w, by + h, 0, bx + this.simW + w * 0.05, by + h, 0,
      bx + this.simW + w * 0.05, by + h, 0, bx + this.simW + w * 0.05, by, 0,
    ];
    const borderGeo = new THREE.BufferGeometry();
    borderGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(bv), 3));
    this.borderLines = new THREE.LineSegments(borderGeo, new THREE.LineBasicMaterial({
      color: this.palette.dim, transparent: true, opacity: 0,
    }));
    this.group.add(this.borderLines);
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);
    const { x, y, w, h } = this.px;
    const cdt = Math.min(dt, 0.033);

    // Physics step
    for (let i = 0; i < this.ballCount; i++) {
      this.vy[i] += this.gravity * cdt;
      this.px2[i] += this.vx[i] * cdt;
      this.py2[i] += this.vy[i] * cdt;
      const r = this.radii[i];

      // Wall collisions
      if (this.px2[i] < r) { this.px2[i] = r; this.vx[i] = Math.abs(this.vx[i]) * this.restitution; }
      if (this.px2[i] > this.simW - r) { this.px2[i] = this.simW - r; this.vx[i] = -Math.abs(this.vx[i]) * this.restitution; }
      if (this.py2[i] < r) { this.py2[i] = r; this.vy[i] = Math.abs(this.vy[i]) * this.restitution; }
      if (this.py2[i] > this.simH - r) { this.py2[i] = this.simH - r; this.vy[i] = -Math.abs(this.vy[i]) * this.restitution; }

      // Ball-ball collisions (simple elastic)
      for (let j = i + 1; j < this.ballCount; j++) {
        const dx = this.px2[j] - this.px2[i];
        const dy = this.py2[j] - this.py2[i];
        const dist = Math.sqrt(dx * dx + dy * dy);
        const minDist = this.radii[i] + this.radii[j];
        if (dist < minDist && dist > 0.01) {
          const nx = dx / dist, ny = dy / dist;
          const relVx = this.vx[i] - this.vx[j];
          const relVy = this.vy[i] - this.vy[j];
          const dot = relVx * nx + relVy * ny;
          if (dot > 0) {
            this.vx[i] -= dot * nx; this.vy[i] -= dot * ny;
            this.vx[j] += dot * nx; this.vy[j] += dot * ny;
          }
          const overlap = (minDist - dist) * 0.5;
          this.px2[i] -= nx * overlap; this.py2[i] -= ny * overlap;
          this.px2[j] += nx * overlap; this.py2[j] += ny * overlap;
        }
      }
    }

    // Update ball positions
    const pos = this.ballPoints.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < this.ballCount; i++) {
      pos.setXYZ(i, x + this.px2[i], y + this.py2[i], 0.5);
    }
    pos.needsUpdate = true;

    // Update phase-space plot (y-position vs vy)
    const phasePos = this.phaseLines.geometry.getAttribute('position') as THREE.BufferAttribute;
    const phaseX0 = x + this.simW + w * 0.05;
    const maxVel = this.gravity * 2;
    for (let i = 0; i < this.ballCount; i++) {
      const normY = this.py2[i] / this.simH;
      const normVy = (this.vy[i] / maxVel) * 0.5 + 0.5;
      const plotX = phaseX0 + Math.max(0, Math.min(1, normY)) * this.phaseW;
      const plotY = y + Math.max(0, Math.min(1, normVy)) * h;
      // Draw a small cross: horizontal segment
      phasePos.setXYZ(i * 2, plotX - 2, plotY, 0.5);
      phasePos.setXYZ(i * 2 + 1, plotX + 2, plotY, 0.5);
    }
    phasePos.needsUpdate = true;

    (this.ballPoints.material as THREE.PointsMaterial).opacity = opacity;
    (this.phaseLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.7;
    (this.borderLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.3;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      for (let i = 0; i < this.ballCount; i++) {
        this.vx[i] += this.rng.float(-200, 200);
        this.vy[i] += this.rng.float(-200, 200);
      }
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) { this.restitution = 0.9; return; }
    this.restitution = 0.9 + level * 0.02;
    for (let i = 0; i < this.ballCount; i++) {
      this.vy[i] -= this.gravity * 0.1 * level;
    }
  }
}
