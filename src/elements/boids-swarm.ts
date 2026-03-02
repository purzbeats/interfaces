import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Flocking simulation (boids algorithm) rendered as a tactical swarm display.
 * 30-60 data-point boids with separation, alignment, cohesion behaviors,
 * faint trails, and a background tactical grid.
 */
export class BoidsSwarmElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'boids-swarm',
    meta: { shape: 'rectangular', roles: ['data-display', 'decorative'], moods: ['tactical', 'ambient'], sizes: ['needs-medium', 'needs-large'] },
  };
  private boidCount: number = 0;
  private posX!: Float32Array;
  private posY!: Float32Array;
  private velX!: Float32Array;
  private velY!: Float32Array;

  // Trail storage: last 4 positions per boid
  private trailLength: number = 4;
  private trailX!: Float32Array;
  private trailY!: Float32Array;
  private trailHead: number = 0; // ring buffer index

  private pointsMesh!: THREE.Points;
  private trailMesh!: THREE.Points;
  private gridLines!: THREE.LineSegments;
  private borderLines!: THREE.LineSegments;

  // Boids parameters
  private minSpeed: number = 0;
  private maxSpeed: number = 0;
  private separationRadius: number = 20;
  private alignmentRadius: number = 40;
  private cohesionRadius: number = 60;

  // Predator (glitch effect)
  private predatorActive: boolean = false;
  private predatorTimer: number = 0;
  private predatorX: number = 0;
  private predatorY: number = 0;

  // Alert rush-to-center effect
  private alertPhase: 'none' | 'converge' | 'explode' = 'none';
  private alertTimer: number = 0;

  // Trail update accumulator (don't record every frame)
  private trailAccum: number = 0;

  glitchAmount = 4;

  build(): void {
    const { x, y, w, h } = this.px;
    this.boidCount = this.rng.int(30, 60);
    this.minSpeed = Math.min(w, h) * 0.15;
    this.maxSpeed = Math.min(w, h) * 0.6;

    // Scale radii relative to region size
    const scale = Math.min(w, h) / 200;
    this.separationRadius = 20 * scale;
    this.alignmentRadius = 40 * scale;
    this.cohesionRadius = 60 * scale;

    const n = this.boidCount;

    // Initialize boid arrays
    this.posX = new Float32Array(n);
    this.posY = new Float32Array(n);
    this.velX = new Float32Array(n);
    this.velY = new Float32Array(n);

    for (let i = 0; i < n; i++) {
      this.posX[i] = x + this.rng.float(w * 0.1, w * 0.9);
      this.posY[i] = y + this.rng.float(h * 0.1, h * 0.9);
      const angle = this.rng.float(0, Math.PI * 2);
      const speed = this.rng.float(this.minSpeed, this.maxSpeed * 0.5);
      this.velX[i] = Math.cos(angle) * speed;
      this.velY[i] = Math.sin(angle) * speed;
    }

    // Trail arrays (ring buffer: trailLength slots per boid)
    const totalTrail = n * this.trailLength;
    this.trailX = new Float32Array(totalTrail);
    this.trailY = new Float32Array(totalTrail);
    // Initialize all trail positions to current boid positions
    for (let i = 0; i < n; i++) {
      for (let t = 0; t < this.trailLength; t++) {
        this.trailX[i * this.trailLength + t] = this.posX[i];
        this.trailY[i * this.trailLength + t] = this.posY[i];
      }
    }

    // --- Background tactical grid ---
    const gridSpacing = Math.max(20, Math.min(w, h) * 0.08);
    const gridVerts: number[] = [];
    // Vertical lines
    for (let gx = x + gridSpacing; gx < x + w; gx += gridSpacing) {
      gridVerts.push(gx, y, 0, gx, y + h, 0);
    }
    // Horizontal lines
    for (let gy = y + gridSpacing; gy < y + h; gy += gridSpacing) {
      gridVerts.push(x, gy, 0, x + w, gy, 0);
    }
    if (gridVerts.length > 0) {
      const gridGeo = new THREE.BufferGeometry();
      gridGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(gridVerts), 3));
      this.gridLines = new THREE.LineSegments(gridGeo, new THREE.LineBasicMaterial({
        color: this.palette.dim,
        transparent: true,
        opacity: 0,
      }));
      this.group.add(this.gridLines);
    }

    // --- Border ---
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

    // --- Trail points ---
    const trailPositions = new Float32Array(totalTrail * 3);
    const trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPositions, 3));
    this.trailMesh = new THREE.Points(trailGeo, new THREE.PointsMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
      size: 1.5,
      sizeAttenuation: false,
    }));
    this.group.add(this.trailMesh);

    // --- Boid points ---
    const boidPositions = new Float32Array(n * 3);
    const boidGeo = new THREE.BufferGeometry();
    boidGeo.setAttribute('position', new THREE.BufferAttribute(boidPositions, 3));
    this.pointsMesh = new THREE.Points(boidGeo, new THREE.PointsMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
      size: 2.5,
      sizeAttenuation: false,
    }));
    this.group.add(this.pointsMesh);
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);
    const { x, y, w, h } = this.px;
    const n = this.boidCount;
    const cx = x + w / 2;
    const cy = y + h / 2;

    // --- Handle alert phases ---
    if (this.alertPhase !== 'none') {
      this.alertTimer -= dt;
      if (this.alertPhase === 'converge') {
        // All boids rush toward center
        for (let i = 0; i < n; i++) {
          const dx = cx - this.posX[i];
          const dy = cy - this.posY[i];
          const dist = Math.sqrt(dx * dx + dy * dy) + 0.01;
          const force = this.maxSpeed * 3;
          this.velX[i] = (dx / dist) * force;
          this.velY[i] = (dy / dist) * force;
          this.posX[i] += this.velX[i] * dt;
          this.posY[i] += this.velY[i] * dt;
        }
        if (this.alertTimer <= 0) {
          this.alertPhase = 'explode';
          this.alertTimer = 0.6;
          // Assign explosion velocities
          for (let i = 0; i < n; i++) {
            const angle = (i / n) * Math.PI * 2 + this.rng.float(-0.3, 0.3);
            const speed = this.maxSpeed * this.rng.float(1.5, 3);
            this.velX[i] = Math.cos(angle) * speed;
            this.velY[i] = Math.sin(angle) * speed;
          }
        }
      } else if (this.alertPhase === 'explode') {
        for (let i = 0; i < n; i++) {
          this.posX[i] += this.velX[i] * dt;
          this.posY[i] += this.velY[i] * dt;
          // Decelerate
          this.velX[i] *= 0.97;
          this.velY[i] *= 0.97;
          // Soft bounce
          this.softBounce(i, x, y, w, h);
        }
        if (this.alertTimer <= 0) {
          this.alertPhase = 'none';
        }
      }
    } else {
      // --- Normal boids simulation ---
      this.stepBoids(dt, x, y, w, h);
    }

    // --- Predator effect ---
    if (this.predatorActive) {
      this.predatorTimer -= dt;
      if (this.predatorTimer <= 0) {
        this.predatorActive = false;
      } else {
        const predatorRadius = this.cohesionRadius * 2;
        for (let i = 0; i < n; i++) {
          const dx = this.posX[i] - this.predatorX;
          const dy = this.posY[i] - this.predatorY;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < predatorRadius && dist > 0.1) {
            const flee = (predatorRadius - dist) / predatorRadius;
            const force = this.maxSpeed * 4 * flee;
            this.velX[i] += (dx / dist) * force * dt;
            this.velY[i] += (dy / dist) * force * dt;
          }
        }
      }
    }

    // --- Record trail positions periodically ---
    this.trailAccum += dt;
    if (this.trailAccum >= 0.06) {
      this.trailAccum = 0;
      this.trailHead = (this.trailHead + 1) % this.trailLength;
      for (let i = 0; i < n; i++) {
        const idx = i * this.trailLength + this.trailHead;
        this.trailX[idx] = this.posX[i];
        this.trailY[idx] = this.posY[i];
      }
    }

    // --- Update GPU buffers ---
    const boidPos = this.pointsMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < n; i++) {
      boidPos.setXYZ(i, this.posX[i], this.posY[i], 0.5);
    }
    boidPos.needsUpdate = true;

    const trailPos = this.trailMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < n; i++) {
      for (let t = 0; t < this.trailLength; t++) {
        const idx = i * this.trailLength + t;
        trailPos.setXYZ(idx, this.trailX[idx], this.trailY[idx], 0.2);
      }
    }
    trailPos.needsUpdate = true;

    // --- Apply opacity ---
    (this.pointsMesh.material as THREE.PointsMaterial).opacity = opacity;
    (this.trailMesh.material as THREE.PointsMaterial).opacity = opacity * 0.35;
    if (this.gridLines) {
      (this.gridLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.08;
    }
    (this.borderLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.25;
  }

  private stepBoids(dt: number, rx: number, ry: number, rw: number, rh: number): void {
    const n = this.boidCount;
    const sepR2 = this.separationRadius * this.separationRadius;
    const aliR2 = this.alignmentRadius * this.alignmentRadius;
    const cohR2 = this.cohesionRadius * this.cohesionRadius;

    for (let i = 0; i < n; i++) {
      let sepX = 0, sepY = 0;
      let aliVx = 0, aliVy = 0, aliCount = 0;
      let cohX = 0, cohY = 0, cohCount = 0;

      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const dx = this.posX[j] - this.posX[i];
        const dy = this.posY[j] - this.posY[i];
        const dist2 = dx * dx + dy * dy;

        // Separation
        if (dist2 < sepR2 && dist2 > 0.01) {
          const dist = Math.sqrt(dist2);
          const weight = (this.separationRadius - dist) / this.separationRadius;
          sepX -= (dx / dist) * weight;
          sepY -= (dy / dist) * weight;
        }
        // Alignment
        if (dist2 < aliR2) {
          aliVx += this.velX[j];
          aliVy += this.velY[j];
          aliCount++;
        }
        // Cohesion
        if (dist2 < cohR2) {
          cohX += this.posX[j];
          cohY += this.posY[j];
          cohCount++;
        }
      }

      // Apply forces
      const sepWeight = 2.5;
      const aliWeight = 1.0;
      const cohWeight = 0.8;

      this.velX[i] += sepX * sepWeight * this.maxSpeed * dt;
      this.velY[i] += sepY * sepWeight * this.maxSpeed * dt;

      if (aliCount > 0) {
        aliVx /= aliCount;
        aliVy /= aliCount;
        this.velX[i] += (aliVx - this.velX[i]) * aliWeight * dt;
        this.velY[i] += (aliVy - this.velY[i]) * aliWeight * dt;
      }

      if (cohCount > 0) {
        cohX /= cohCount;
        cohY /= cohCount;
        const toCohX = cohX - this.posX[i];
        const toCohY = cohY - this.posY[i];
        this.velX[i] += toCohX * cohWeight * dt;
        this.velY[i] += toCohY * cohWeight * dt;
      }

      // Clamp speed
      const speed = Math.sqrt(this.velX[i] * this.velX[i] + this.velY[i] * this.velY[i]);
      if (speed > this.maxSpeed) {
        this.velX[i] = (this.velX[i] / speed) * this.maxSpeed;
        this.velY[i] = (this.velY[i] / speed) * this.maxSpeed;
      } else if (speed < this.minSpeed && speed > 0.01) {
        this.velX[i] = (this.velX[i] / speed) * this.minSpeed;
        this.velY[i] = (this.velY[i] / speed) * this.minSpeed;
      }

      // Move
      this.posX[i] += this.velX[i] * dt;
      this.posY[i] += this.velY[i] * dt;

      // Soft bounce off edges
      this.softBounce(i, rx, ry, rw, rh);
    }
  }

  private softBounce(i: number, rx: number, ry: number, rw: number, rh: number): void {
    const margin = Math.min(rw, rh) * 0.05;
    const turnForce = this.maxSpeed * 0.1;

    if (this.posX[i] < rx + margin) this.velX[i] += turnForce;
    if (this.posX[i] > rx + rw - margin) this.velX[i] -= turnForce;
    if (this.posY[i] < ry + margin) this.velY[i] += turnForce;
    if (this.posY[i] > ry + rh - margin) this.velY[i] -= turnForce;

    // Hard clamp as safety
    if (this.posX[i] < rx) { this.posX[i] = rx; this.velX[i] = Math.abs(this.velX[i]); }
    if (this.posX[i] > rx + rw) { this.posX[i] = rx + rw; this.velX[i] = -Math.abs(this.velX[i]); }
    if (this.posY[i] < ry) { this.posY[i] = ry; this.velY[i] = Math.abs(this.velY[i]); }
    if (this.posY[i] > ry + rh) { this.posY[i] = ry + rh; this.velY[i] = -Math.abs(this.velY[i]); }
  }

  onAction(action: string): void {
    super.onAction(action);
    const { x, y, w, h } = this.px;

    if (action === 'glitch') {
      // Spawn a predator at a random position
      this.predatorActive = true;
      this.predatorTimer = 0.5;
      this.predatorX = x + this.rng.float(w * 0.2, w * 0.8);
      this.predatorY = y + this.rng.float(h * 0.2, h * 0.8);
    }

    if (action === 'alert') {
      this.alertPhase = 'converge';
      this.alertTimer = 0.4;
      // Flash boid color to alert
      (this.pointsMesh.material as THREE.PointsMaterial).color.copy(this.palette.alert);
      setTimeout(() => {
        (this.pointsMesh.material as THREE.PointsMaterial).color.copy(this.palette.primary);
      }, 800);
    }

    if (action === 'pulse') {
      // Boost all boids outward from center briefly
      const cx = x + w / 2;
      const cy = y + h / 2;
      for (let i = 0; i < this.boidCount; i++) {
        const dx = this.posX[i] - cx;
        const dy = this.posY[i] - cy;
        const dist = Math.sqrt(dx * dx + dy * dy) + 0.1;
        this.velX[i] += (dx / dist) * this.maxSpeed * 0.5;
        this.velY[i] += (dy / dist) * this.maxSpeed * 0.5;
      }
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) return;
    const { x, y, w, h } = this.px;
    // Scatter boids proportional to level
    const cx = x + w / 2;
    const cy = y + h / 2;
    const force = level * 0.2;
    for (let i = 0; i < this.boidCount; i++) {
      const dx = this.posX[i] - cx;
      const dy = this.posY[i] - cy;
      const dist = Math.sqrt(dx * dx + dy * dy) + 0.1;
      this.velX[i] += (dx / dist) * this.maxSpeed * force;
      this.velY[i] += (dy / dist) * this.maxSpeed * force;
    }
    if (level >= 5) {
      // Spawn predator
      this.predatorActive = true;
      this.predatorTimer = 0.8;
      this.predatorX = x + this.rng.float(w * 0.2, w * 0.8);
      this.predatorY = y + this.rng.float(h * 0.2, h * 0.8);
    }
  }
}
