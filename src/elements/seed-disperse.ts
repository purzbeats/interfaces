import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

interface SeedPreset {
  seedCount: number;
  launchInterval: number;
  windStrength: number;
  seedType: 'dandelion' | 'maple' | 'thistle' | 'milkweed';
}

interface Seed {
  x: number;
  y: number;
  vx: number;
  vy: number;
  spin: number;
  spinAngle: number;
  life: number;
  maxLife: number;
  active: boolean;
  trailX: Float32Array;
  trailY: Float32Array;
  trailHead: number;
  trailCount: number;
}

/**
 * Seed dispersal from a central plant. Seeds carried by wind — some float
 * (dandelion), some spin (maple samara). Parabolic/helical trajectories.
 * Points with trail lines.
 */
export class SeedDisperseElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'seed-disperse',
    meta: {
      shape: 'rectangular',
      roles: ['decorative'],
      moods: ['ambient'],
      sizes: ['works-small', 'needs-medium'],
      bandAffinity: 'high',
    } satisfies ElementMeta,
  };

  private stemLine!: THREE.Line;
  private stemMat!: THREE.LineBasicMaterial;
  private seedPoints!: THREE.Points;
  private seedMat!: THREE.PointsMaterial;
  private trailLines!: THREE.LineSegments;
  private trailMat!: THREE.LineBasicMaterial;

  private seeds: Seed[] = [];
  private seedCount = 30;
  private launchInterval = 0.5;
  private launchTimer = 0;
  private windStrength = 30;
  private seedType: SeedPreset['seedType'] = 'dandelion';
  private trailLength = 15;

  private plantX = 0;
  private plantY = 0;
  private intensityLevel = 0;

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;

    const variant = this.rng.int(0, 4);
    const presets: SeedPreset[] = [
      { seedCount: 30, launchInterval: 0.5, windStrength: 30, seedType: 'dandelion' },
      { seedCount: 20, launchInterval: 0.8, windStrength: 15, seedType: 'maple' },
      { seedCount: 40, launchInterval: 0.3, windStrength: 40, seedType: 'thistle' },
      { seedCount: 25, launchInterval: 0.6, windStrength: 25, seedType: 'milkweed' },
    ];
    const p = presets[variant];
    this.seedCount = p.seedCount;
    this.launchInterval = p.launchInterval;
    this.windStrength = p.windStrength * (w / 300);
    this.seedType = p.seedType;

    this.plantX = x + w * 0.3;
    this.plantY = y + h * 0.8;

    // ── Plant stem ──
    const stemVerts = new Float32Array([
      this.plantX, this.plantY + h * 0.1, 0,
      this.plantX, this.plantY, 0,
      this.plantX - w * 0.02, this.plantY - h * 0.05, 0,
      this.plantX, this.plantY - h * 0.02, 0,
      this.plantX + w * 0.02, this.plantY - h * 0.05, 0,
    ]);
    const stemGeo = new THREE.BufferGeometry();
    stemGeo.setAttribute('position', new THREE.BufferAttribute(stemVerts, 3));
    this.stemMat = new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    });
    this.stemLine = new THREE.Line(stemGeo, this.stemMat);
    this.group.add(this.stemLine);

    // Initialize seed pool
    for (let i = 0; i < this.seedCount; i++) {
      const trailX = new Float32Array(this.trailLength);
      const trailY = new Float32Array(this.trailLength);
      for (let t = 0; t < this.trailLength; t++) {
        trailX[t] = this.plantX;
        trailY[t] = this.plantY;
      }
      this.seeds.push({
        x: this.plantX,
        y: this.plantY,
        vx: 0,
        vy: 0,
        spin: 0,
        spinAngle: 0,
        life: 0,
        maxLife: 0,
        active: false,
        trailX,
        trailY,
        trailHead: 0,
        trailCount: 0,
      });
    }

    // ── Seed points ──
    const seedPos = new Float32Array(this.seedCount * 3);
    for (let i = 0; i < seedPos.length; i++) seedPos[i] = 0;
    const seedGeo = new THREE.BufferGeometry();
    seedGeo.setAttribute('position', new THREE.BufferAttribute(seedPos, 3));
    seedGeo.setDrawRange(0, 0);
    this.seedMat = new THREE.PointsMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
      size: Math.max(3, Math.min(w, h) * 0.012),
      sizeAttenuation: false,
    });
    this.seedPoints = new THREE.Points(seedGeo, this.seedMat);
    this.group.add(this.seedPoints);

    // ── Trail lines ──
    const totalTrailSegs = this.seedCount * (this.trailLength - 1);
    const trailPos = new Float32Array(totalTrailSegs * 2 * 3);
    for (let i = 0; i < trailPos.length; i++) trailPos[i] = 0;
    const trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPos, 3));
    this.trailMat = new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    });
    this.trailLines = new THREE.LineSegments(trailGeo, this.trailMat);
    this.group.add(this.trailLines);

    this.launchTimer = this.rng.float(0, this.launchInterval);
  }

  private launchSeed(): void {
    for (const seed of this.seeds) {
      if (seed.active) continue;

      seed.x = this.plantX + this.rng.float(-3, 3);
      seed.y = this.plantY;
      seed.active = true;
      seed.trailHead = 0;
      seed.trailCount = 0;

      switch (this.seedType) {
        case 'dandelion':
          // Floaty — mostly horizontal with gentle rise then slow fall
          seed.vx = this.windStrength * this.rng.float(0.5, 1.5);
          seed.vy = this.rng.float(-20, -5);
          seed.spin = 0;
          seed.life = this.rng.float(3, 6);
          break;
        case 'maple':
          // Spinning — helical descent
          seed.vx = this.windStrength * this.rng.float(0.3, 0.8);
          seed.vy = this.rng.float(-10, 5);
          seed.spin = this.rng.float(5, 12) * (this.rng.chance(0.5) ? 1 : -1);
          seed.life = this.rng.float(2, 4);
          break;
        case 'thistle':
          // Light, erratic — lots of wind influence
          seed.vx = this.windStrength * this.rng.float(0.8, 2.0);
          seed.vy = this.rng.float(-30, -10);
          seed.spin = 0;
          seed.life = this.rng.float(4, 8);
          break;
        case 'milkweed':
          // Slow float with gentle oscillation
          seed.vx = this.windStrength * this.rng.float(0.4, 1.0);
          seed.vy = this.rng.float(-15, -5);
          seed.spin = this.rng.float(1, 3);
          seed.life = this.rng.float(3, 7);
          break;
      }

      seed.maxLife = seed.life;
      seed.spinAngle = this.rng.float(0, Math.PI * 2);

      // Init trail at launch position
      for (let t = 0; t < this.trailLength; t++) {
        seed.trailX[t] = seed.x;
        seed.trailY[t] = seed.y;
      }
      break;
    }
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    const speedMul = 1 + this.intensityLevel * 0.3;
    const { x, y, w, h } = this.px;

    // Launch timer
    const interval = this.launchInterval / speedMul;
    this.launchTimer += dt;
    if (this.launchTimer >= interval) {
      this.launchTimer = 0;
      this.launchSeed();
    }

    const seedPos = this.seedPoints.geometry.getAttribute('position') as THREE.BufferAttribute;
    const trailPos = this.trailLines.geometry.getAttribute('position') as THREE.BufferAttribute;

    let activeCount = 0;
    let trailSegCount = 0;

    // Wind oscillation
    const windOsc = Math.sin(time * 0.5) * this.windStrength * 0.3;

    for (let i = 0; i < this.seedCount; i++) {
      const seed = this.seeds[i];
      if (!seed.active) continue;

      // Physics
      const gravity = 15; // gentle gravity
      seed.vy += gravity * dt;
      seed.vx += windOsc * dt * 0.5;

      // Seed-type-specific dynamics
      if (this.seedType === 'dandelion' || this.seedType === 'milkweed') {
        // Air resistance / buoyancy slows fall
        seed.vy *= 0.995;
        seed.vx += Math.sin(time * 3 + i * 1.5) * 5 * dt;
      } else if (this.seedType === 'maple') {
        // Helical spin adds oscillation
        seed.spinAngle += seed.spin * dt;
        seed.vx += Math.cos(seed.spinAngle) * 20 * dt;
        seed.vy += Math.sin(seed.spinAngle) * 10 * dt;
        seed.vy *= 0.99;
      } else if (this.seedType === 'thistle') {
        // Erratic
        seed.vx += Math.sin(time * 5 + i * 2) * 15 * dt;
        seed.vy += Math.cos(time * 4 + i * 3) * 8 * dt;
        seed.vy *= 0.99;
      }

      seed.x += seed.vx * dt * speedMul;
      seed.y += seed.vy * dt * speedMul;
      seed.life -= dt;

      // Record trail
      seed.trailHead = (seed.trailHead + 1) % this.trailLength;
      seed.trailX[seed.trailHead] = seed.x;
      seed.trailY[seed.trailHead] = seed.y;
      if (seed.trailCount < this.trailLength) seed.trailCount++;

      // Deactivate if expired or off-screen
      if (seed.life <= 0 || seed.x > x + w + 20 || seed.x < x - 20 || seed.y > y + h + 20) {
        seed.active = false;
        continue;
      }

      seedPos.setXYZ(activeCount, seed.x, seed.y, 1);
      activeCount++;

      // Trail segments
      const maxT = Math.min(seed.trailCount - 1, this.trailLength - 1);
      for (let t = 0; t < maxT; t++) {
        const idx0 = (seed.trailHead - t + this.trailLength) % this.trailLength;
        const idx1 = (seed.trailHead - t - 1 + this.trailLength) % this.trailLength;
        if (trailSegCount < this.seedCount * (this.trailLength - 1)) {
          trailPos.setXYZ(trailSegCount * 2, seed.trailX[idx0], seed.trailY[idx0], 0.5);
          trailPos.setXYZ(trailSegCount * 2 + 1, seed.trailX[idx1], seed.trailY[idx1], 0.5);
          trailSegCount++;
        }
      }
    }

    seedPos.needsUpdate = true;
    trailPos.needsUpdate = true;
    this.seedPoints.geometry.setDrawRange(0, activeCount);
    this.trailLines.geometry.setDrawRange(0, trailSegCount * 2);

    // Sway plant stem in wind
    const stemPos = this.stemLine.geometry.getAttribute('position') as THREE.BufferAttribute;
    const sway = Math.sin(time * 1.5) * w * 0.01;
    stemPos.setX(0, this.plantX + sway * 0.5);
    stemPos.setX(2, this.plantX - w * 0.02 + sway * 0.3);
    stemPos.setX(4, this.plantX + w * 0.02 + sway * 0.3);
    stemPos.needsUpdate = true;

    this.stemMat.opacity = opacity * 0.5;
    this.seedMat.opacity = opacity;
    this.trailMat.opacity = opacity * 0.25;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Gust — launch many seeds at once
      for (let i = 0; i < 8; i++) {
        this.launchSeed();
      }
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    this.intensityLevel = level;
    if (level >= 3) {
      // Wind gust — launch burst
      for (let i = 0; i < level * 2; i++) {
        this.launchSeed();
      }
    }
  }
}
