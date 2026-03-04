import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

interface SmokeParticle {
  x: number;
  y: number;
  baseX: number;     // original x for sine drift
  speed: number;     // rise speed px/s
  sineFreq: number;  // horizontal drift frequency
  sineAmp: number;   // horizontal drift amplitude
  phase: number;     // sine phase offset
  size: number;      // particle size
  age: number;       // seconds alive
  lifetime: number;  // total lifetime in seconds
  isSecondary: boolean;
}

/**
 * Rising smoke particles that drift upward with sine-wave motion.
 * Particles fade as they rise toward the top.
 */
export class SmokeRiseElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'smoke-rise',
    meta: {
      shape: 'rectangular',
      roles: ['decorative'],
      moods: ['ambient'],
      sizes: ['works-small', 'needs-medium'],
    },
  };

  private particles: SmokeParticle[] = [];
  private meshPoints!: THREE.Points;
  private maxParticles: number = 0;
  private spawnRate: number = 0;
  private spawnAccum: number = 0;

  build(): void {
    const { x, y, w, h } = this.px;

    this.maxParticles = 30 + this.rng.int(0, 20);
    this.spawnRate = this.maxParticles / 3; // fill up over ~3 seconds

    // Preallocate points geometry
    const positions = new Float32Array(this.maxParticles * 3);
    const colors = new Float32Array(this.maxParticles * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setDrawRange(0, 0);

    this.meshPoints = new THREE.Points(geo, new THREE.PointsMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0,
      size: Math.max(2, Math.min(w, h) * 0.015),
      sizeAttenuation: false,
    }));
    this.group.add(this.meshPoints);

    // Pre-spawn some particles at staggered ages
    const preSpawn = Math.floor(this.maxParticles * 0.6);
    for (let i = 0; i < preSpawn; i++) {
      const p = this.createParticle();
      p.age = this.rng.float(0, p.lifetime * 0.8);
      p.y = p.y + p.speed * p.age;
      this.particles.push(p);
    }
  }

  private createParticle(): SmokeParticle {
    const { x, y, w, h } = this.px;

    const baseX = x + w * 0.2 + this.rng.float(0, w * 0.6);
    const lifetime = h / (15 + this.rng.float(0, 25)) ; // based on rise speed

    return {
      x: baseX,
      y: y + h * this.rng.float(-0.02, 0.05), // start near bottom
      baseX,
      speed: 15 + this.rng.float(0, 25),
      sineFreq: this.rng.float(0.5, 2.0),
      sineAmp: this.rng.float(3, w * 0.06),
      phase: this.rng.float(0, Math.PI * 2),
      size: this.rng.float(0.7, 1.3),
      age: 0,
      lifetime,
      isSecondary: this.rng.chance(0.15),
    };
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    const { x, y, w, h } = this.px;

    // Spawn new particles
    this.spawnAccum += dt * this.spawnRate;
    while (this.spawnAccum >= 1 && this.particles.length < this.maxParticles) {
      this.spawnAccum -= 1;
      this.particles.push(this.createParticle());
    }
    if (this.particles.length >= this.maxParticles) {
      this.spawnAccum = 0;
    }

    // Update particles
    const dimR = this.palette.dim.r;
    const dimG = this.palette.dim.g;
    const dimB = this.palette.dim.b;
    const secR = this.palette.secondary.r;
    const secG = this.palette.secondary.g;
    const secB = this.palette.secondary.b;

    const posAttr = this.meshPoints.geometry.getAttribute('position') as THREE.BufferAttribute;
    const colAttr = this.meshPoints.geometry.getAttribute('color') as THREE.BufferAttribute;

    let aliveCount = 0;

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.age += dt;

      // Rise upward
      p.y += p.speed * dt;

      // Horizontal sine drift
      p.x = p.baseX + Math.sin(p.age * p.sineFreq + p.phase) * p.sineAmp;

      // Remove if past top or lifetime exceeded
      if (p.y > y + h || p.age > p.lifetime) {
        this.particles.splice(i, 1);
        continue;
      }
    }

    // Write to GPU buffers
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];

      // Fade based on vertical progress (fade near top)
      const verticalFrac = (p.y - y) / h;
      const fadeAlpha = 1.0 - verticalFrac;
      // Also fade in briefly at start
      const fadeIn = Math.min(p.age / 0.5, 1.0);
      const alpha = fadeAlpha * fadeIn;

      posAttr.setXYZ(i, p.x, p.y, 0);

      if (p.isSecondary) {
        colAttr.setXYZ(i, secR * alpha, secG * alpha, secB * alpha);
      } else {
        colAttr.setXYZ(i, dimR * alpha, dimG * alpha, dimB * alpha);
      }
    }

    // Hide unused slots
    for (let i = this.particles.length; i < this.maxParticles; i++) {
      posAttr.setXYZ(i, -99999, -99999, 0);
      colAttr.setXYZ(i, 0, 0, 0);
    }

    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
    this.meshPoints.geometry.setDrawRange(0, this.particles.length);
    (this.meshPoints.material as THREE.PointsMaterial).opacity = opacity;
  }
}
