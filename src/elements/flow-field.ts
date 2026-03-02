import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Perlin-like noise flow field with particle traces.
 * Particles follow the gradient of a smoothly varying vector field,
 * leaving fading trails — resembling a fluid dynamics simulation
 * or atmospheric current display on a research terminal.
 */

export class FlowFieldElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'flow-field',
    meta: { shape: 'rectangular', roles: ['data-display', 'decorative'], moods: ['ambient', 'diagnostic'], sizes: ['needs-medium', 'needs-large'] },
  };
  private pointsMesh!: THREE.Points;
  private trailMesh!: THREE.Points;
  private borderLines!: THREE.LineSegments;

  /** Flow field grid */
  private gridCols: number = 0;
  private gridRows: number = 0;
  private cellSize: number = 0;
  private fieldAngles!: Float32Array;

  /** Particles */
  private particleCount: number = 0;
  private particleX!: Float32Array;
  private particleY!: Float32Array;
  private particleSpeed: number = 0;

  /** Trails: ring buffer of past positions per particle */
  private trailLength: number = 6;
  private trailX!: Float32Array;
  private trailY!: Float32Array;
  private trailHead: number = 0;
  private trailAccum: number = 0;

  /** Glitch: reverse flow direction */
  private flowReversed: boolean = false;

  /** Alert: speed boost + extra particles */
  private alertTimer: number = 0;
  private baseParticleCount: number = 0;
  private alertSpeedBoost: number = 1;

  /** Pulse brightness boost */
  private brightnessBoost: number = 0;

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;

    // Flow field grid resolution
    this.cellSize = this.rng.float(15, 20);
    this.gridCols = Math.max(2, Math.ceil(w / this.cellSize));
    this.gridRows = Math.max(2, Math.ceil(h / this.cellSize));
    this.fieldAngles = new Float32Array(this.gridCols * this.gridRows);

    // Particles
    this.baseParticleCount = this.rng.int(80, 150);
    // Allocate extra capacity for alert-spawned particles
    const maxParticles = this.baseParticleCount + 60;
    this.particleCount = this.baseParticleCount;
    this.particleX = new Float32Array(maxParticles);
    this.particleY = new Float32Array(maxParticles);
    this.particleSpeed = Math.min(w, h) * this.rng.float(0.15, 0.25);

    // Initialize particle positions
    for (let i = 0; i < maxParticles; i++) {
      this.particleX[i] = x + this.rng.float(0, w);
      this.particleY[i] = y + this.rng.float(0, h);
    }

    // Trail storage
    this.trailLength = this.rng.int(5, 8);
    const totalTrail = maxParticles * this.trailLength;
    this.trailX = new Float32Array(totalTrail);
    this.trailY = new Float32Array(totalTrail);
    // Initialize trails to current positions
    for (let i = 0; i < maxParticles; i++) {
      for (let t = 0; t < this.trailLength; t++) {
        const idx = i * this.trailLength + t;
        this.trailX[idx] = this.particleX[i];
        this.trailY[idx] = this.particleY[i];
      }
    }

    // --- Main particle points ---
    const pointPositions = new Float32Array(maxParticles * 3);
    const pointGeo = new THREE.BufferGeometry();
    pointGeo.setAttribute('position', new THREE.BufferAttribute(pointPositions, 3));
    pointGeo.setDrawRange(0, this.particleCount);
    this.pointsMesh = new THREE.Points(pointGeo, new THREE.PointsMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
      size: this.rng.float(1.5, 2.0),
      sizeAttenuation: false,
    }));
    this.group.add(this.pointsMesh);

    // --- Trail points ---
    const trailPositions = new Float32Array(totalTrail * 3);
    const trailColors = new Float32Array(totalTrail * 3);
    const trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPositions, 3));
    trailGeo.setAttribute('color', new THREE.BufferAttribute(trailColors, 3));
    trailGeo.setDrawRange(0, this.particleCount * this.trailLength);
    this.trailMesh = new THREE.Points(trailGeo, new THREE.PointsMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0,
      size: 1.0,
      sizeAttenuation: false,
    }));
    this.group.add(this.trailMesh);

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
  }

  /**
   * Compute the flow field angle at grid position (gx, gy) for a given time.
   * Uses 3-4 octaves of layered sine/cosine for organic, Perlin-like flow.
   */
  private computeFieldAngle(gx: number, gy: number, time: number): number {
    // Octave 1: large-scale flow
    let angle = Math.sin(gx * 0.1 + time * 0.3) * Math.cos(gy * 0.15 + time * 0.2) * Math.PI * 2;

    // Octave 2: medium turbulence
    angle += Math.sin(gx * 0.25 + gy * 0.1 + time * 0.5) * Math.cos(gy * 0.3 - time * 0.15) * Math.PI * 0.8;

    // Octave 3: fine detail
    angle += Math.sin(gx * 0.5 - time * 0.4 + gy * 0.35) * Math.cos(gx * 0.2 + gy * 0.45 + time * 0.25) * Math.PI * 0.3;

    // Octave 4: high-frequency shimmer
    angle += Math.sin(gx * 0.8 + gy * 0.7 + time * 0.6) * 0.4;

    return angle;
  }

  /**
   * Update the entire flow field grid for current time.
   */
  private updateField(time: number): void {
    const reversed = this.flowReversed ? -1 : 1;
    for (let row = 0; row < this.gridRows; row++) {
      for (let col = 0; col < this.gridCols; col++) {
        this.fieldAngles[row * this.gridCols + col] =
          this.computeFieldAngle(col, row, time) * reversed;
      }
    }
  }

  /**
   * Look up the flow angle at a world position, with bilinear interpolation.
   */
  private sampleField(wx: number, wy: number): number {
    const { x, y } = this.px;
    // Convert world pos to grid coordinates
    const gxf = (wx - x) / this.cellSize;
    const gyf = (wy - y) / this.cellSize;

    const gx0 = Math.max(0, Math.min(this.gridCols - 1, Math.floor(gxf)));
    const gy0 = Math.max(0, Math.min(this.gridRows - 1, Math.floor(gyf)));
    const gx1 = Math.min(this.gridCols - 1, gx0 + 1);
    const gy1 = Math.min(this.gridRows - 1, gy0 + 1);

    const fx = gxf - gx0;
    const fy = gyf - gy0;

    // Bilinear interpolation of angles
    const a00 = this.fieldAngles[gy0 * this.gridCols + gx0];
    const a10 = this.fieldAngles[gy0 * this.gridCols + gx1];
    const a01 = this.fieldAngles[gy1 * this.gridCols + gx0];
    const a11 = this.fieldAngles[gy1 * this.gridCols + gx1];

    const top = a00 + (a10 - a00) * fx;
    const bottom = a01 + (a11 - a01) * fx;
    return top + (bottom - top) * fy;
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    const { x, y, w, h } = this.px;

    // Handle alert timer
    if (this.alertTimer > 0) {
      this.alertTimer -= dt;
      this.alertSpeedBoost = 3.0;
      // Extra particles during alert
      this.particleCount = Math.min(this.baseParticleCount + 60, this.particleX.length);
      if (this.alertTimer <= 0) {
        this.alertSpeedBoost = 1.0;
        this.particleCount = this.baseParticleCount;
      }
    }

    // Brightness boost from pulse
    if (this.brightnessBoost > 0) {
      this.brightnessBoost -= dt * 3;
      if (this.brightnessBoost < 0) this.brightnessBoost = 0;
    }

    // Handle glitch flow reversal
    this.flowReversed = this.glitchTimer > 0;

    // Update flow field
    this.updateField(time);

    // Move particles along field
    const speed = this.particleSpeed * this.alertSpeedBoost;

    for (let i = 0; i < this.particleCount; i++) {
      const angle = this.sampleField(this.particleX[i], this.particleY[i]);
      this.particleX[i] += Math.cos(angle) * speed * dt;
      this.particleY[i] += Math.sin(angle) * speed * dt;

      // Respawn if out of bounds
      if (
        this.particleX[i] < x || this.particleX[i] > x + w ||
        this.particleY[i] < y || this.particleY[i] > y + h
      ) {
        this.particleX[i] = x + Math.random() * w;
        this.particleY[i] = y + Math.random() * h;
        // Reset this particle's trail to new position
        for (let t = 0; t < this.trailLength; t++) {
          const tidx = i * this.trailLength + t;
          this.trailX[tidx] = this.particleX[i];
          this.trailY[tidx] = this.particleY[i];
        }
      }
    }

    // Record trail positions periodically
    this.trailAccum += dt;
    if (this.trailAccum >= 0.04) {
      this.trailAccum = 0;
      this.trailHead = (this.trailHead + 1) % this.trailLength;
      for (let i = 0; i < this.particleCount; i++) {
        const idx = i * this.trailLength + this.trailHead;
        this.trailX[idx] = this.particleX[i];
        this.trailY[idx] = this.particleY[i];
      }
    }

    // --- Update GPU buffers ---

    // Main particles
    const pointPos = this.pointsMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < this.particleCount; i++) {
      pointPos.setXYZ(i, this.particleX[i], this.particleY[i], 0.5);
    }
    pointPos.needsUpdate = true;
    this.pointsMesh.geometry.setDrawRange(0, this.particleCount);

    // Trail particles with depth-faded colors
    const trailPos = this.trailMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const trailCol = this.trailMesh.geometry.getAttribute('color') as THREE.BufferAttribute;
    const dimR = this.palette.dim.r;
    const dimG = this.palette.dim.g;
    const dimB = this.palette.dim.b;
    const primR = this.palette.primary.r;
    const primG = this.palette.primary.g;
    const primB = this.palette.primary.b;

    for (let i = 0; i < this.particleCount; i++) {
      for (let t = 0; t < this.trailLength; t++) {
        const idx = i * this.trailLength + t;

        trailPos.setXYZ(idx, this.trailX[idx], this.trailY[idx], 0.2);

        // Compute age: how many steps ago this trail point was recorded
        let age = (this.trailHead - t + this.trailLength) % this.trailLength;
        // Normalize: 0 = newest, 1 = oldest
        const ageFraction = age / (this.trailLength - 1);
        // Older = dimmer and more toward dim color
        const fade = (1 - ageFraction) * 0.7;
        trailCol.setXYZ(
          idx,
          primR * fade + dimR * (1 - fade),
          primG * fade + dimG * (1 - fade),
          primB * fade + dimB * (1 - fade),
        );
      }
    }

    trailPos.needsUpdate = true;
    trailCol.needsUpdate = true;
    this.trailMesh.geometry.setDrawRange(0, this.particleCount * this.trailLength);

    // Apply opacity
    const pointMat = this.pointsMesh.material as THREE.PointsMaterial;
    const brightBoost = 1 + this.brightnessBoost * 0.5;
    pointMat.opacity = Math.min(1, opacity * brightBoost);

    (this.trailMesh.material as THREE.PointsMaterial).opacity = opacity * 0.45;
    (this.borderLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.2;
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) return;
    if (level >= 5) {
      this.alertSpeedBoost = 3.0;
      this.alertTimer = 1.0;
    } else if (level >= 3) {
      this.brightnessBoost = 0.6;
    } else {
      this.brightnessBoost = 0.3;
    }
  }

  onAction(action: string): void {
    super.onAction(action);

    if (action === 'glitch') {
      // Flow reversal handled via glitchTimer in update
    }

    if (action === 'alert') {
      this.alertTimer = 2.0;
      this.pulseTimer = 2.0;
    }

    if (action === 'pulse') {
      // All particles brighten momentarily
      this.brightnessBoost = 1.0;
    }
  }
}
