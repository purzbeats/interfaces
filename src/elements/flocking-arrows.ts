import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Directional arrow-head particles that flock in formation.
 * Unlike simple point boids, these render as oriented triangles
 * showing heading — a tactical formation display with military aesthetics.
 */
export class FlockingArrowsElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'flocking-arrows',
    meta: { shape: 'rectangular', roles: ['data-display', 'scanner'], moods: ['tactical', 'diagnostic'], bandAffinity: 'mid', sizes: ['needs-medium', 'needs-large'] },
  };

  private count = 0;
  private pX!: Float32Array;
  private pY!: Float32Array;
  private pVx!: Float32Array;
  private pVy!: Float32Array;
  private arrowSize = 4;
  private maxSpeed = 0;
  private sepRadius = 0;

  private mesh!: THREE.Mesh;
  private positions!: Float32Array;
  private gridLines!: THREE.LineSegments;

  build(): void {
    const variant = this.rng.int(0, 3);
    const presets = [
      { count: 60, arrowSize: 5, maxSpeedMul: 0.5, sep: 25 },
      { count: 120, arrowSize: 3.5, maxSpeedMul: 0.8, sep: 18 },
      { count: 25, arrowSize: 8, maxSpeedMul: 0.3, sep: 40 },
      { count: 80, arrowSize: 4, maxSpeedMul: 1.0, sep: 20 },
    ];
    const p = presets[variant];
    this.glitchAmount = 4;

    const { x, y, w, h } = this.px;
    this.count = p.count;
    this.arrowSize = p.arrowSize;
    this.maxSpeed = Math.min(w, h) * p.maxSpeedMul;
    this.sepRadius = p.sep * Math.min(w, h) / 200;

    this.pX = new Float32Array(this.count);
    this.pY = new Float32Array(this.count);
    this.pVx = new Float32Array(this.count);
    this.pVy = new Float32Array(this.count);

    for (let i = 0; i < this.count; i++) {
      this.pX[i] = x + this.rng.float(w * 0.1, w * 0.9);
      this.pY[i] = y + this.rng.float(h * 0.1, h * 0.9);
      const a = this.rng.float(0, Math.PI * 2);
      const s = this.rng.float(this.maxSpeed * 0.3, this.maxSpeed * 0.6);
      this.pVx[i] = Math.cos(a) * s;
      this.pVy[i] = Math.sin(a) * s;
    }

    // Each arrow = 1 triangle = 3 vertices
    this.positions = new Float32Array(this.count * 9);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    const mat = new THREE.MeshBasicMaterial({ color: this.palette.primary, transparent: true, opacity: 0, side: THREE.DoubleSide });
    this.mesh = new THREE.Mesh(geo, mat);
    this.group.add(this.mesh);

    // Background grid
    const spacing = Math.max(20, Math.min(w, h) * 0.1);
    const gv: number[] = [];
    for (let gx2 = x + spacing; gx2 < x + w; gx2 += spacing) gv.push(gx2, y, -0.5, gx2, y + h, -0.5);
    for (let gy2 = y + spacing; gy2 < y + h; gy2 += spacing) gv.push(x, gy2, -0.5, x + w, gy2, -0.5);
    if (gv.length > 0) {
      const gg = new THREE.BufferGeometry();
      gg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(gv), 3));
      this.gridLines = new THREE.LineSegments(gg, new THREE.LineBasicMaterial({ color: this.palette.dim, transparent: true, opacity: 0 }));
      this.group.add(this.gridLines);
    }
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);
    const { x, y, w, h } = this.px;
    const n = this.count;
    const sep2 = this.sepRadius * this.sepRadius;

    // Simple flocking
    for (let i = 0; i < n; i++) {
      let sepX = 0, sepY = 0, aliVx = 0, aliVy = 0, cohX = 0, cohY = 0;
      let nc = 0;
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const dx = this.pX[j] - this.pX[i];
        const dy = this.pY[j] - this.pY[i];
        const d2 = dx * dx + dy * dy;
        if (d2 < sep2 * 4) {
          if (d2 < sep2 && d2 > 0.01) {
            const d = Math.sqrt(d2);
            sepX -= (dx / d) * (this.sepRadius - d) / this.sepRadius;
            sepY -= (dy / d) * (this.sepRadius - d) / this.sepRadius;
          }
          aliVx += this.pVx[j]; aliVy += this.pVy[j];
          cohX += this.pX[j]; cohY += this.pY[j]; nc++;
        }
      }
      this.pVx[i] += sepX * this.maxSpeed * 2 * dt;
      this.pVy[i] += sepY * this.maxSpeed * 2 * dt;
      if (nc > 0) {
        aliVx /= nc; aliVy /= nc;
        this.pVx[i] += (aliVx - this.pVx[i]) * dt;
        this.pVy[i] += (aliVy - this.pVy[i]) * dt;
        cohX /= nc; cohY /= nc;
        this.pVx[i] += (cohX - this.pX[i]) * 0.5 * dt;
        this.pVy[i] += (cohY - this.pY[i]) * 0.5 * dt;
      }

      // Speed clamp
      const spd = Math.sqrt(this.pVx[i] * this.pVx[i] + this.pVy[i] * this.pVy[i]);
      if (spd > this.maxSpeed) { this.pVx[i] *= this.maxSpeed / spd; this.pVy[i] *= this.maxSpeed / spd; }

      this.pX[i] += this.pVx[i] * dt;
      this.pY[i] += this.pVy[i] * dt;

      // Soft bounds
      const m = Math.min(w, h) * 0.05;
      if (this.pX[i] < x + m) this.pVx[i] += this.maxSpeed * 0.1;
      if (this.pX[i] > x + w - m) this.pVx[i] -= this.maxSpeed * 0.1;
      if (this.pY[i] < y + m) this.pVy[i] += this.maxSpeed * 0.1;
      if (this.pY[i] > y + h - m) this.pVy[i] -= this.maxSpeed * 0.1;
    }

    // Update arrow triangles
    for (let i = 0; i < n; i++) {
      const angle = Math.atan2(this.pVy[i], this.pVx[i]);
      const s = this.arrowSize;
      const tip = 0;
      const wing = Math.PI * 0.75;

      this.positions[i * 9] = this.pX[i] + Math.cos(angle) * s * 1.5;
      this.positions[i * 9 + 1] = this.pY[i] + Math.sin(angle) * s * 1.5;
      this.positions[i * 9 + 2] = 0;
      this.positions[i * 9 + 3] = this.pX[i] + Math.cos(angle + wing) * s;
      this.positions[i * 9 + 4] = this.pY[i] + Math.sin(angle + wing) * s;
      this.positions[i * 9 + 5] = 0;
      this.positions[i * 9 + 6] = this.pX[i] + Math.cos(angle - wing) * s;
      this.positions[i * 9 + 7] = this.pY[i] + Math.sin(angle - wing) * s;
      this.positions[i * 9 + 8] = 0;
    }
    (this.mesh.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;

    (this.mesh.material as THREE.MeshBasicMaterial).opacity = opacity * 0.85;
    if (this.gridLines) (this.gridLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.06;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      for (let i = 0; i < this.count; i++) {
        this.pVx[i] = (this.rng.next() - 0.5) * this.maxSpeed * 2;
        this.pVy[i] = (this.rng.next() - 0.5) * this.maxSpeed * 2;
      }
    }
    if (action === 'alert') {
      const { x, y, w, h } = this.px;
      for (let i = 0; i < this.count; i++) {
        const dx = this.pX[i] - (x + w / 2);
        const dy = this.pY[i] - (y + h / 2);
        const d = Math.sqrt(dx * dx + dy * dy) + 1;
        this.pVx[i] = (dx / d) * this.maxSpeed;
        this.pVy[i] = (dy / d) * this.maxSpeed;
      }
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level >= 3) this.maxSpeed *= 1.5;
  }
}
