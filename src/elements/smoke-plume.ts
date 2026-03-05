import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Buoyant smoke particle simulation. Particles rise, spread, cool, and fade
 * with vortex shedding for realism. Multiple emitters create organic
 * plume dynamics.
 */
export class SmokePlumeElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'smoke-plume',
    meta: {
      shape: 'rectangular',
      roles: ['decorative'],
      moods: ['ambient', 'tactical'],
      bandAffinity: 'sub',
      sizes: ['needs-medium', 'needs-large'],
    },
  };

  private pointsMesh!: THREE.Points;
  private borderLines!: THREE.LineSegments;

  private maxParticles: number = 800;
  private particleCount: number = 0;
  private posX!: Float32Array;
  private posY!: Float32Array;
  private velX!: Float32Array;
  private velY!: Float32Array;
  private life!: Float32Array;
  private maxLife!: Float32Array;
  private temperature!: Float32Array;
  private size!: Float32Array;

  private emitterCount: number = 2;
  private emitters: { x: number; y: number; rate: number; accum: number }[] = [];
  private buoyancy: number = 60;
  private turbulence: number = 20;
  private cooling: number = 0.3;
  private spread: number = 15;
  private windX: number = 5;
  private vortexStrength: number = 0.5;
  private intensityLevel: number = 0;

  build(): void {
    const variant = this.rng.int(0, 3);
    const presets = [
      { maxP: 800, emitters: 2, buoy: 60, turb: 20, cool: 0.3, spread: 15, wind: 5, vortex: 0.5 },   // Standard
      { maxP: 1200, emitters: 3, buoy: 80, turb: 30, cool: 0.25, spread: 20, wind: 10, vortex: 0.7 }, // Heavy smoke
      { maxP: 400, emitters: 1, buoy: 100, turb: 10, cool: 0.4, spread: 8, wind: 2, vortex: 0.3 },    // Single plume
      { maxP: 1000, emitters: 4, buoy: 50, turb: 40, cool: 0.2, spread: 25, wind: 15, vortex: 1.0 },  // Chaotic
    ];
    const p = presets[variant];

    this.maxParticles = p.maxP;
    this.emitterCount = p.emitters;
    this.buoyancy = p.buoy;
    this.turbulence = p.turb;
    this.cooling = p.cool;
    this.spread = p.spread;
    this.windX = p.wind;
    this.vortexStrength = p.vortex;
    this.particleCount = 0;
    this.glitchAmount = 4;

    const { x, y, w, h } = this.px;

    // Scale physics to region
    const scale = Math.min(w, h) / 200;
    this.buoyancy *= scale;
    this.turbulence *= scale;
    this.spread *= scale;
    this.windX *= scale;

    // Initialize emitters along bottom
    this.emitters = [];
    for (let e = 0; e < this.emitterCount; e++) {
      this.emitters.push({
        x: x + (e + 0.5) / this.emitterCount * w + this.rng.float(-w * 0.05, w * 0.05),
        y: y + h - this.rng.float(5, 15),
        rate: 30 + this.rng.float(-10, 10), // particles per second
        accum: 0,
      });
    }

    // Allocate particle arrays
    this.posX = new Float32Array(this.maxParticles);
    this.posY = new Float32Array(this.maxParticles);
    this.velX = new Float32Array(this.maxParticles);
    this.velY = new Float32Array(this.maxParticles);
    this.life = new Float32Array(this.maxParticles);
    this.maxLife = new Float32Array(this.maxParticles);
    this.temperature = new Float32Array(this.maxParticles);
    this.size = new Float32Array(this.maxParticles);

    // Points mesh
    const positions = new Float32Array(this.maxParticles * 3);
    const colors = new Float32Array(this.maxParticles * 3);
    const sizes = new Float32Array(this.maxParticles);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    geo.setDrawRange(0, 0);

    this.pointsMesh = new THREE.Points(geo, new THREE.PointsMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0,
      size: 3,
      sizeAttenuation: false,
    }));
    this.group.add(this.pointsMesh);

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

  private emitParticle(ex: number, ey: number): void {
    if (this.particleCount >= this.maxParticles) {
      // Find oldest particle to recycle
      let oldest = 0;
      let maxAge = 0;
      for (let i = 0; i < this.particleCount; i++) {
        const age = this.maxLife[i] - this.life[i];
        if (age > maxAge) { maxAge = age; oldest = i; }
      }
      this.initParticle(oldest, ex, ey);
      return;
    }

    this.initParticle(this.particleCount, ex, ey);
    this.particleCount++;
  }

  private initParticle(idx: number, ex: number, ey: number): void {
    this.posX[idx] = ex + this.rng.float(-this.spread * 0.3, this.spread * 0.3);
    this.posY[idx] = ey;
    this.velX[idx] = this.rng.float(-this.spread, this.spread);
    this.velY[idx] = -this.rng.float(this.buoyancy * 0.5, this.buoyancy);
    this.temperature[idx] = 1.0;
    this.life[idx] = this.rng.float(2, 5);
    this.maxLife[idx] = this.life[idx];
    this.size[idx] = this.rng.float(2, 5);
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    const cdt = Math.min(dt, 0.033);

    // Emit new particles
    for (const em of this.emitters) {
      em.accum += cdt * em.rate * (1 + this.intensityLevel * 0.3);
      while (em.accum >= 1) {
        em.accum -= 1;
        this.emitParticle(em.x, em.y);
      }
    }

    // Wind oscillation
    const windNow = this.windX * Math.sin(time * 0.3) * (1 + this.intensityLevel * 0.2);

    // Update particles
    const pr = this.palette.primary;
    const sr = this.palette.secondary;
    const dm = this.palette.dim;
    const bg = this.palette.bg;

    const pos = this.pointsMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const col = this.pointsMesh.geometry.getAttribute('color') as THREE.BufferAttribute;

    let alive = 0;
    for (let i = 0; i < this.particleCount; i++) {
      this.life[i] -= cdt;
      if (this.life[i] <= 0) continue;

      // Cool down
      this.temperature[i] = Math.max(0, this.temperature[i] - this.cooling * cdt);

      // Buoyancy (increases with temperature)
      const buoy = -this.buoyancy * this.temperature[i];

      // Turbulence
      const turbX = (this.rng.next() - 0.5) * 2 * this.turbulence;
      const turbY = (this.rng.next() - 0.5) * 2 * this.turbulence * 0.5;

      // Vortex shedding (sinusoidal lateral oscillation based on height)
      const heightFrac = 1 - (this.posY[i] - this.px.y) / this.px.h;
      const vortex = Math.sin(heightFrac * 10 + time * 3) * this.vortexStrength * this.buoyancy;

      this.velX[i] += (windNow + turbX + vortex) * cdt;
      this.velY[i] += (buoy + turbY) * cdt;

      // Drag
      this.velX[i] *= 0.98;
      this.velY[i] *= 0.98;

      this.posX[i] += this.velX[i] * cdt;
      this.posY[i] += this.velY[i] * cdt;

      // Particle grows as it cools
      this.size[i] += cdt * 2;

      // Write to alive slot
      const lifeRatio = this.life[i] / this.maxLife[i];
      const alpha = lifeRatio * 0.6;

      // Color: hot=secondary, cool=dim, fading to bg
      const temp = this.temperature[i];
      const r = sr.r * temp + dm.r * (1 - temp);
      const g = sr.g * temp + dm.g * (1 - temp);
      const b = sr.b * temp + dm.b * (1 - temp);

      pos.setXYZ(alive, this.posX[i], this.posY[i], 0.2);
      col.setXYZ(alive, r * alpha, g * alpha, b * alpha);

      // Copy data if compacting
      if (alive !== i) {
        this.posX[alive] = this.posX[i];
        this.posY[alive] = this.posY[i];
        this.velX[alive] = this.velX[i];
        this.velY[alive] = this.velY[i];
        this.life[alive] = this.life[i];
        this.maxLife[alive] = this.maxLife[i];
        this.temperature[alive] = this.temperature[i];
        this.size[alive] = this.size[i];
      }
      alive++;
    }

    this.particleCount = alive;
    pos.needsUpdate = true;
    col.needsUpdate = true;
    this.pointsMesh.geometry.setDrawRange(0, alive);

    (this.pointsMesh.material as THREE.PointsMaterial).opacity = opacity;
    (this.borderLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.15;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Sudden wind gust
      for (let i = 0; i < this.particleCount; i++) {
        this.velX[i] += this.rng.float(-100, 100);
        this.velY[i] += this.rng.float(-50, 50);
      }
    }
    if (action === 'pulse') {
      // Burst of hot particles from all emitters
      for (const em of this.emitters) {
        for (let i = 0; i < 30; i++) {
          this.emitParticle(em.x, em.y);
        }
      }
    }
    if (action === 'alert') {
      // All particles suddenly hot
      for (let i = 0; i < this.particleCount; i++) {
        this.temperature[i] = 1.0;
        this.velY[i] -= this.buoyancy * 0.5;
      }
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    this.intensityLevel = level;
  }
}
