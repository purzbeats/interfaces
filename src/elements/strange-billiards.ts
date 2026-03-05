import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Billiard ball simulation in non-standard table shapes (stadium, Sinai,
 * Bunimovich). Ball traces chaotic trajectories leaving a fading trail.
 */
export class StrangeBilliardsElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'strange-billiards',
    meta: { shape: 'rectangular', roles: ['data-display'], moods: ['diagnostic', 'tactical'], bandAffinity: 'high', sizes: ['needs-medium', 'needs-large'] },
  };

  private trailLine!: THREE.Line;
  private trailMat!: THREE.LineBasicMaterial;
  private ballMesh!: THREE.Mesh;
  private positions!: Float32Array;
  private maxPoints: number = 2000;
  private head: number = 0;
  private bx: number = 0;
  private by: number = 0;
  private vx: number = 0;
  private vy: number = 0;
  private speed: number = 0;
  private tableType: number = 0;
  private cx: number = 0;
  private cy: number = 0;
  private hw: number = 0;
  private hh: number = 0;
  private obstacleR: number = 0;

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;
    this.cx = x + w / 2;
    this.cy = y + h / 2;
    this.hw = w * 0.45;
    this.hh = h * 0.45;

    const variant = this.rng.int(0, 3);
    const presets = [
      { points: 2000, speed: 120, table: 0 }, // stadium
      { points: 3000, speed: 100, table: 1 }, // Sinai (circle obstacle)
      { points: 2500, speed: 140, table: 2 }, // Bunimovich (concave walls)
      { points: 1500, speed: 160, table: 0 }, // fast stadium
    ];
    const pr = presets[variant];
    this.maxPoints = pr.points;
    this.speed = pr.speed;
    this.tableType = pr.table;
    this.obstacleR = Math.min(this.hw, this.hh) * 0.25;

    // Initial ball position and velocity
    this.bx = this.cx + this.rng.float(-this.hw * 0.3, this.hw * 0.3);
    this.by = this.cy + this.rng.float(-this.hh * 0.3, this.hh * 0.3);
    const angle = this.rng.float(0, Math.PI * 2);
    this.vx = Math.cos(angle);
    this.vy = Math.sin(angle);

    this.positions = new Float32Array(this.maxPoints * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geo.setDrawRange(0, 0);

    this.trailMat = new THREE.LineBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
    });
    this.trailLine = new THREE.Line(geo, this.trailMat);
    this.group.add(this.trailLine);

    // Ball dot
    const ballGeo = new THREE.PlaneGeometry(4, 4);
    const ballMat = new THREE.MeshBasicMaterial({
      color: this.palette.secondary,
      transparent: true,
      opacity: 0,
    });
    this.ballMesh = new THREE.Mesh(ballGeo, ballMat);
    this.group.add(this.ballMesh);
  }

  private reflect(): void {
    const dx = this.bx - this.cx;
    const dy = this.by - this.cy;

    if (this.tableType === 1) {
      // Sinai: circular obstacle in center
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < this.obstacleR) {
        const nx = dx / dist;
        const ny = dy / dist;
        const dot = this.vx * nx + this.vy * ny;
        this.vx -= 2 * dot * nx;
        this.vy -= 2 * dot * ny;
        this.bx = this.cx + nx * (this.obstacleR + 1);
        this.by = this.cy + ny * (this.obstacleR + 1);
      }
    }

    // Rectangular boundary reflection
    if (this.bx < this.cx - this.hw) { this.vx = Math.abs(this.vx); this.bx = this.cx - this.hw; }
    if (this.bx > this.cx + this.hw) { this.vx = -Math.abs(this.vx); this.bx = this.cx + this.hw; }
    if (this.by < this.cy - this.hh) { this.vy = Math.abs(this.vy); this.by = this.cy - this.hh; }
    if (this.by > this.cy + this.hh) { this.vy = -Math.abs(this.vy); this.by = this.cy + this.hh; }

    if (this.tableType === 2) {
      // Bunimovich: curved top/bottom walls push inward
      const edgeDist = Math.abs(dy) / this.hh;
      if (edgeDist > 0.85) {
        const curvature = (edgeDist - 0.85) * 3.0;
        this.vy -= curvature * Math.sign(dy) * 0.02;
        const len = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
        this.vx /= len;
        this.vy /= len;
      }
    }
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);
    const steps = Math.ceil(this.speed * dt);
    const stepDt = dt / steps;

    for (let s = 0; s < steps; s++) {
      this.bx += this.vx * this.speed * stepDt;
      this.by += this.vy * this.speed * stepDt;
      this.reflect();
    }

    // Record trail
    if (this.head < this.maxPoints) {
      const idx = this.head * 3;
      this.positions[idx] = this.bx;
      this.positions[idx + 1] = this.by;
      this.positions[idx + 2] = 0;
      this.head++;
    } else {
      // Shift trail
      this.positions.copyWithin(0, 3, this.maxPoints * 3);
      const idx = (this.maxPoints - 1) * 3;
      this.positions[idx] = this.bx;
      this.positions[idx + 1] = this.by;
      this.positions[idx + 2] = 0;
    }

    const geo = this.trailLine.geometry;
    geo.setDrawRange(0, Math.min(this.head, this.maxPoints));
    (geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    this.trailMat.opacity = opacity * 0.5;

    this.ballMesh.position.set(this.bx, this.by, 1);
    (this.ballMesh.material as THREE.MeshBasicMaterial).opacity = opacity;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      this.glitchTimer = 0.5;
    } else if (action === 'alert') {
      const angle = this.rng.float(0, Math.PI * 2);
      this.vx = Math.cos(angle);
      this.vy = Math.sin(angle);
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level >= 2) {
      this.speed *= 1 + level * 0.1;
    }
  }
}
