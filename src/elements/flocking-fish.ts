import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Schooling fish with elongated bodies (3-segment chains) that follow boid
 * rules. More organic than point boids - each fish is a chain of segments
 * that bend and flex as they swim.
 */
export class FlockingFishElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'flocking-fish',
    meta: {
      shape: 'rectangular',
      roles: ['decorative', 'data-display'],
      moods: ['ambient', 'tactical'],
      bandAffinity: 'bass',
      sizes: ['needs-medium', 'needs-large'],
    },
  };

  private lineMesh!: THREE.LineSegments;
  private borderLines!: THREE.LineSegments;

  private fishCount: number = 0;
  private segCount: number = 3;
  private segLength: number = 6;

  // Head position and velocity for each fish
  private headX!: Float32Array;
  private headY!: Float32Array;
  private velX!: Float32Array;
  private velY!: Float32Array;

  // Chain segment positions: fishCount * segCount * 2 (x,y)
  private segX!: Float32Array;
  private segY!: Float32Array;

  private maxSpeed: number = 80;
  private separationR: number = 25;
  private alignR: number = 50;
  private cohesionR: number = 70;
  private intensityLevel: number = 0;

  // Current flow direction (slow drift)
  private flowAngle: number = 0;
  private flowStrength: number = 10;

  build(): void {
    const variant = this.rng.int(0, 3);
    const presets = [
      { fish: 25, segs: 3, segLen: 6, maxSpd: 80, sepR: 25, aliR: 50, cohR: 70, flow: 10 },   // Standard school
      { fish: 40, segs: 3, segLen: 4, maxSpd: 100, sepR: 20, aliR: 40, cohR: 60, flow: 15 },  // Dense fast
      { fish: 15, segs: 4, segLen: 8, maxSpd: 50, sepR: 35, aliR: 60, cohR: 80, flow: 5 },    // Large slow
      { fish: 30, segs: 5, segLen: 5, maxSpd: 90, sepR: 22, aliR: 45, cohR: 65, flow: 12 },   // Long body
    ];
    const p = presets[variant];

    this.fishCount = p.fish;
    this.segCount = p.segs;
    this.segLength = p.segLen;
    this.maxSpeed = p.maxSpd;
    this.separationR = p.sepR;
    this.alignR = p.aliR;
    this.cohesionR = p.cohR;
    this.flowStrength = p.flow;
    this.glitchAmount = 4;

    const { x, y, w, h } = this.px;
    const n = this.fishCount;
    const s = this.segCount;

    // Scale radii to region
    const scale = Math.min(w, h) / 200;
    this.separationR *= scale;
    this.alignR *= scale;
    this.cohesionR *= scale;
    this.maxSpeed *= scale;
    this.flowStrength *= scale;

    // Initialize fish
    this.headX = new Float32Array(n);
    this.headY = new Float32Array(n);
    this.velX = new Float32Array(n);
    this.velY = new Float32Array(n);
    this.segX = new Float32Array(n * s);
    this.segY = new Float32Array(n * s);

    for (let i = 0; i < n; i++) {
      this.headX[i] = x + this.rng.float(w * 0.1, w * 0.9);
      this.headY[i] = y + this.rng.float(h * 0.1, h * 0.9);
      const angle = this.rng.float(0, Math.PI * 2);
      const speed = this.rng.float(this.maxSpeed * 0.3, this.maxSpeed * 0.7);
      this.velX[i] = Math.cos(angle) * speed;
      this.velY[i] = Math.sin(angle) * speed;

      // Initialize segments behind head
      for (let j = 0; j < s; j++) {
        this.segX[i * s + j] = this.headX[i] - Math.cos(angle) * this.segLength * (j + 1);
        this.segY[i * s + j] = this.headY[i] - Math.sin(angle) * this.segLength * (j + 1);
      }
    }

    // Line segments for fish bodies: each fish has (segCount) line segments
    const totalLines = n * s;
    const positions = new Float32Array(totalLines * 6);
    const colors = new Float32Array(totalLines * 6);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    this.lineMesh = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.lineMesh);

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

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    const { x, y, w, h } = this.px;
    const n = this.fishCount;
    const s = this.segCount;

    // Slow flow drift
    this.flowAngle = time * 0.1;

    // Boid simulation for heads
    for (let i = 0; i < n; i++) {
      let sepX = 0, sepY = 0;
      let aliVx = 0, aliVy = 0, aliCount = 0;
      let cohX = 0, cohY = 0, cohCount = 0;

      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const dx = this.headX[j] - this.headX[i];
        const dy = this.headY[j] - this.headY[i];
        const dist2 = dx * dx + dy * dy;

        if (dist2 < this.separationR * this.separationR && dist2 > 0.01) {
          const dist = Math.sqrt(dist2);
          const wt = (this.separationR - dist) / this.separationR;
          sepX -= (dx / dist) * wt;
          sepY -= (dy / dist) * wt;
        }
        if (dist2 < this.alignR * this.alignR) {
          aliVx += this.velX[j];
          aliVy += this.velY[j];
          aliCount++;
        }
        if (dist2 < this.cohesionR * this.cohesionR) {
          cohX += this.headX[j];
          cohY += this.headY[j];
          cohCount++;
        }
      }

      // Apply forces
      this.velX[i] += sepX * 2.5 * this.maxSpeed * dt;
      this.velY[i] += sepY * 2.5 * this.maxSpeed * dt;

      if (aliCount > 0) {
        aliVx /= aliCount;
        aliVy /= aliCount;
        this.velX[i] += (aliVx - this.velX[i]) * 1.0 * dt;
        this.velY[i] += (aliVy - this.velY[i]) * 1.0 * dt;
      }
      if (cohCount > 0) {
        cohX /= cohCount;
        cohY /= cohCount;
        this.velX[i] += (cohX - this.headX[i]) * 0.8 * dt;
        this.velY[i] += (cohY - this.headY[i]) * 0.8 * dt;
      }

      // Flow force
      this.velX[i] += Math.cos(this.flowAngle) * this.flowStrength * dt;
      this.velY[i] += Math.sin(this.flowAngle) * this.flowStrength * dt;

      // Speed clamp
      const speed = Math.sqrt(this.velX[i] * this.velX[i] + this.velY[i] * this.velY[i]);
      if (speed > this.maxSpeed) {
        this.velX[i] = (this.velX[i] / speed) * this.maxSpeed;
        this.velY[i] = (this.velY[i] / speed) * this.maxSpeed;
      } else if (speed < this.maxSpeed * 0.2 && speed > 0.01) {
        this.velX[i] = (this.velX[i] / speed) * this.maxSpeed * 0.2;
        this.velY[i] = (this.velY[i] / speed) * this.maxSpeed * 0.2;
      }

      // Move head
      this.headX[i] += this.velX[i] * dt;
      this.headY[i] += this.velY[i] * dt;

      // Soft bounce
      const margin = Math.min(w, h) * 0.05;
      if (this.headX[i] < x + margin) this.velX[i] += this.maxSpeed * 0.1;
      if (this.headX[i] > x + w - margin) this.velX[i] -= this.maxSpeed * 0.1;
      if (this.headY[i] < y + margin) this.velY[i] += this.maxSpeed * 0.1;
      if (this.headY[i] > y + h - margin) this.velY[i] -= this.maxSpeed * 0.1;

      // Update chain segments (follow-the-leader)
      let prevX = this.headX[i];
      let prevY = this.headY[i];
      for (let j = 0; j < s; j++) {
        const idx = i * s + j;
        const sdx = this.segX[idx] - prevX;
        const sdy = this.segY[idx] - prevY;
        const dist = Math.sqrt(sdx * sdx + sdy * sdy);
        if (dist > this.segLength) {
          this.segX[idx] = prevX + (sdx / dist) * this.segLength;
          this.segY[idx] = prevY + (sdy / dist) * this.segLength;
        }
        prevX = this.segX[idx];
        prevY = this.segY[idx];
      }
    }

    // Update GPU buffers
    const pos = this.lineMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const col = this.lineMesh.geometry.getAttribute('color') as THREE.BufferAttribute;
    const pr = this.palette.primary;
    const dm = this.palette.dim;

    for (let i = 0; i < n; i++) {
      let prevPx = this.headX[i];
      let prevPy = this.headY[i];
      for (let j = 0; j < s; j++) {
        const lineIdx = (i * s + j) * 2;
        const segIdx = i * s + j;
        pos.setXYZ(lineIdx, prevPx, prevPy, 0.3);
        pos.setXYZ(lineIdx + 1, this.segX[segIdx], this.segY[segIdx], 0.3);

        // Color fades along body
        const t = j / s;
        const r = pr.r * (1 - t) + dm.r * t;
        const g = pr.g * (1 - t) + dm.g * t;
        const b = pr.b * (1 - t) + dm.b * t;
        col.setXYZ(lineIdx, pr.r, pr.g, pr.b);
        col.setXYZ(lineIdx + 1, r, g, b);

        prevPx = this.segX[segIdx];
        prevPy = this.segY[segIdx];
      }
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;

    (this.lineMesh.material as THREE.LineBasicMaterial).opacity = opacity;
    (this.borderLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.2;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      for (let i = 0; i < this.fishCount; i++) {
        this.velX[i] += this.rng.float(-this.maxSpeed, this.maxSpeed);
        this.velY[i] += this.rng.float(-this.maxSpeed, this.maxSpeed);
      }
    }
    if (action === 'pulse') {
      const cx = this.px.x + this.px.w / 2;
      const cy = this.px.y + this.px.h / 2;
      for (let i = 0; i < this.fishCount; i++) {
        const dx = cx - this.headX[i];
        const dy = cy - this.headY[i];
        const dist = Math.sqrt(dx * dx + dy * dy) + 0.1;
        this.velX[i] = (dx / dist) * this.maxSpeed;
        this.velY[i] = (dy / dist) * this.maxSpeed;
      }
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    this.intensityLevel = level;
    this.maxSpeed = 80 * (Math.min(this.px.w, this.px.h) / 200) * (1 + level * 0.2);
  }
}
