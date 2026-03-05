import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Elastic collision simulation: circles with conserved momentum/energy.
 * Each ball rendered as a point with a velocity indicator line.
 */
export class ElasticCollisionElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'elastic-collision',
    meta: { shape: 'rectangular', roles: ['data-display', 'decorative'], moods: ['tactical', 'diagnostic'], bandAffinity: 'bass', sizes: ['needs-medium', 'needs-large'] },
  };

  private count = 0;
  private posX!: Float32Array;
  private posY!: Float32Array;
  private velX!: Float32Array;
  private velY!: Float32Array;
  private radius!: Float32Array;
  private mass!: Float32Array;
  private pointsMesh!: THREE.Points;
  private velLines!: THREE.LineSegments;
  private borderLines!: THREE.LineSegments;
  private velScale = 0;

  build(): void {
    this.glitchAmount = 4;
    const variant = this.rng.int(0, 4);
    const { x, y, w, h } = this.px;
    const minDim = Math.min(w, h);
    const presets = [
      { count: 12, rMin: 4, rMax: 10, speed: 60 },
      { count: 25, rMin: 3, rMax: 7, speed: 80 },
      { count: 6, rMin: 8, rMax: 18, speed: 40 },
      { count: 18, rMin: 3, rMax: 12, speed: 70 },
    ];
    const p = presets[variant];

    this.count = p.count;
    this.velScale = minDim * 0.003;
    const scale = minDim / 200;
    const rMin = p.rMin * scale;
    const rMax = p.rMax * scale;
    const speed = p.speed * scale;

    this.posX = new Float32Array(this.count);
    this.posY = new Float32Array(this.count);
    this.velX = new Float32Array(this.count);
    this.velY = new Float32Array(this.count);
    this.radius = new Float32Array(this.count);
    this.mass = new Float32Array(this.count);

    for (let i = 0; i < this.count; i++) {
      this.radius[i] = this.rng.float(rMin, rMax);
      this.mass[i] = this.radius[i] * this.radius[i]; // mass ~ area
      this.posX[i] = this.rng.float(this.radius[i], w - this.radius[i]);
      this.posY[i] = this.rng.float(this.radius[i], h - this.radius[i]);
      const angle = this.rng.float(0, Math.PI * 2);
      const spd = this.rng.float(speed * 0.5, speed);
      this.velX[i] = Math.cos(angle) * spd;
      this.velY[i] = Math.sin(angle) * spd;
    }

    // Points for balls
    const positions = new Float32Array(this.count * 3);
    const sizes = new Float32Array(this.count);
    for (let i = 0; i < this.count; i++) sizes[i] = this.radius[i] * 2;
    const pointGeo = new THREE.BufferGeometry();
    pointGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    pointGeo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    this.pointsMesh = new THREE.Points(pointGeo, new THREE.PointsMaterial({
      color: this.palette.primary, transparent: true, opacity: 0,
      size: 4, sizeAttenuation: false,
    }));
    this.group.add(this.pointsMesh);

    // Velocity lines: each ball = 1 segment = 2 verts
    const velPos = new Float32Array(this.count * 6);
    const velGeo = new THREE.BufferGeometry();
    velGeo.setAttribute('position', new THREE.BufferAttribute(velPos, 3));
    this.velLines = new THREE.LineSegments(velGeo, new THREE.LineBasicMaterial({
      color: this.palette.secondary, transparent: true, opacity: 0,
    }));
    this.group.add(this.velLines);

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
      color: this.palette.dim, transparent: true, opacity: 0,
    }));
    this.group.add(this.borderLines);
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);
    const { x, y, w, h } = this.px;
    const clampDt = Math.min(dt, 0.033);

    // Move
    for (let i = 0; i < this.count; i++) {
      this.posX[i] += this.velX[i] * clampDt;
      this.posY[i] += this.velY[i] * clampDt;
    }

    // Wall collisions
    for (let i = 0; i < this.count; i++) {
      const r = this.radius[i];
      if (this.posX[i] < r) { this.posX[i] = r; this.velX[i] = Math.abs(this.velX[i]); }
      if (this.posX[i] > w - r) { this.posX[i] = w - r; this.velX[i] = -Math.abs(this.velX[i]); }
      if (this.posY[i] < r) { this.posY[i] = r; this.velY[i] = Math.abs(this.velY[i]); }
      if (this.posY[i] > h - r) { this.posY[i] = h - r; this.velY[i] = -Math.abs(this.velY[i]); }
    }

    // Ball-ball elastic collisions
    for (let i = 0; i < this.count; i++) {
      for (let j = i + 1; j < this.count; j++) {
        const dx = this.posX[j] - this.posX[i];
        const dy = this.posY[j] - this.posY[i];
        const dist = Math.sqrt(dx * dx + dy * dy);
        const minDist = this.radius[i] + this.radius[j];
        if (dist < minDist && dist > 0.01) {
          // Normal vector
          const nx = dx / dist;
          const ny = dy / dist;
          // Relative velocity along normal
          const dvx = this.velX[i] - this.velX[j];
          const dvy = this.velY[i] - this.velY[j];
          const dvn = dvx * nx + dvy * ny;
          if (dvn > 0) {
            const mi = this.mass[i];
            const mj = this.mass[j];
            const imp = (2 * dvn) / (mi + mj);
            this.velX[i] -= imp * mj * nx;
            this.velY[i] -= imp * mj * ny;
            this.velX[j] += imp * mi * nx;
            this.velY[j] += imp * mi * ny;
          }
          // Separate
          const overlap = (minDist - dist) * 0.5;
          this.posX[i] -= nx * overlap;
          this.posY[i] -= ny * overlap;
          this.posX[j] += nx * overlap;
          this.posY[j] += ny * overlap;
        }
      }
    }

    // Update point positions
    const pos = this.pointsMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < this.count; i++) {
      pos.setXYZ(i, x + this.posX[i], y + this.posY[i], 0.5);
    }
    pos.needsUpdate = true;

    // Update velocity lines
    const vp = this.velLines.geometry.getAttribute('position') as THREE.BufferAttribute;
    const varr = vp.array as Float32Array;
    for (let i = 0; i < this.count; i++) {
      const bx = x + this.posX[i];
      const by = y + this.posY[i];
      const idx = i * 6;
      varr[idx] = bx; varr[idx + 1] = by; varr[idx + 2] = 0.3;
      varr[idx + 3] = bx + this.velX[i] * this.velScale;
      varr[idx + 4] = by + this.velY[i] * this.velScale;
      varr[idx + 5] = 0.3;
    }
    vp.needsUpdate = true;

    (this.pointsMesh.material as THREE.PointsMaterial).opacity = opacity;
    (this.velLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.5;
    (this.borderLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.25;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      for (let i = 0; i < this.count; i++) {
        this.velX[i] += this.rng.float(-50, 50);
        this.velY[i] += this.rng.float(-50, 50);
      }
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level > 0) {
      const boost = 1 + level * 0.08;
      for (let i = 0; i < this.count; i++) {
        this.velX[i] *= boost;
        this.velY[i] *= boost;
      }
    }
  }
}
