import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Particle Life: emergent self-organizing particle clusters.
 * 3-4 species with random attraction/repulsion rules produce
 * lifelike clustering, orbiting, and chasing behaviors.
 */
export class ParticleLifeElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'particle-life',
    meta: { shape: 'rectangular', roles: ['data-display', 'decorative'], moods: ['diagnostic', 'ambient'], bandAffinity: 'mid', sizes: ['needs-medium', 'needs-large'] },
  };

  private speciesCount = 3;
  private particleCount = 0;
  private pX!: Float32Array;
  private pY!: Float32Array;
  private pVx!: Float32Array;
  private pVy!: Float32Array;
  private pSpecies!: Uint8Array;
  private rules!: Float32Array; // speciesCount x speciesCount interaction matrix
  private ruleRadius = 60;

  private pointsMesh!: THREE.Points;
  private pointColors!: Float32Array;
  private borderLines!: THREE.LineSegments;

  private speciesColors: THREE.Color[] = [];
  private friction = 0.9;

  build(): void {
    const variant = this.rng.int(0, 3);
    const presets = [
      { species: 3, particles: 180, radius: 60, friction: 0.9, size: 2.0 },
      { species: 4, particles: 300, radius: 50, friction: 0.85, size: 1.5 },
      { species: 3, particles: 80, radius: 80, friction: 0.93, size: 3.0 },
      { species: 5, particles: 250, radius: 40, friction: 0.82, size: 1.8 },
    ];
    const p = presets[variant];
    this.glitchAmount = 4;

    const { x, y, w, h } = this.px;
    this.speciesCount = p.species;
    this.particleCount = p.particles;
    this.ruleRadius = p.radius * Math.min(w, h) / 300;
    this.friction = p.friction;

    // Random interaction rules: positive = attract, negative = repel
    this.rules = new Float32Array(this.speciesCount * this.speciesCount);
    for (let i = 0; i < this.rules.length; i++) {
      this.rules[i] = this.rng.float(-1, 1);
    }

    // Species colors from palette
    this.speciesColors = [
      this.palette.primary.clone(),
      this.palette.secondary.clone(),
      this.palette.dim.clone(),
    ];
    // Generate more if needed
    while (this.speciesColors.length < this.speciesCount) {
      const c = this.palette.primary.clone().lerp(this.palette.secondary, this.rng.float(0.3, 0.7));
      this.speciesColors.push(c);
    }

    // Particles
    this.pX = new Float32Array(this.particleCount);
    this.pY = new Float32Array(this.particleCount);
    this.pVx = new Float32Array(this.particleCount);
    this.pVy = new Float32Array(this.particleCount);
    this.pSpecies = new Uint8Array(this.particleCount);

    for (let i = 0; i < this.particleCount; i++) {
      this.pX[i] = x + this.rng.float(w * 0.05, w * 0.95);
      this.pY[i] = y + this.rng.float(h * 0.05, h * 0.95);
      this.pVx[i] = 0;
      this.pVy[i] = 0;
      this.pSpecies[i] = this.rng.int(0, this.speciesCount - 1);
    }

    // Points mesh with vertex colors
    const positions = new Float32Array(this.particleCount * 3);
    this.pointColors = new Float32Array(this.particleCount * 3);
    for (let i = 0; i < this.particleCount; i++) {
      const c = this.speciesColors[this.pSpecies[i]];
      this.pointColors[i * 3] = c.r;
      this.pointColors[i * 3 + 1] = c.g;
      this.pointColors[i * 3 + 2] = c.b;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.pointColors, 3));
    this.pointsMesh = new THREE.Points(geo, new THREE.PointsMaterial({
      vertexColors: true, transparent: true, opacity: 0, size: p.size, sizeAttenuation: false,
    }));
    this.group.add(this.pointsMesh);

    // Border
    const bv = new Float32Array([x, y, 0, x + w, y, 0, x + w, y, 0, x + w, y + h, 0, x + w, y + h, 0, x, y + h, 0, x, y + h, 0, x, y, 0]);
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.BufferAttribute(bv, 3));
    this.borderLines = new THREE.LineSegments(bg, new THREE.LineBasicMaterial({ color: this.palette.dim, transparent: true, opacity: 0 }));
    this.group.add(this.borderLines);
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);
    const { x, y, w, h } = this.px;
    const cdt = Math.min(dt, 0.033);
    const n = this.particleCount;
    const rr2 = this.ruleRadius * this.ruleRadius;

    // Apply interaction forces
    for (let i = 0; i < n; i++) {
      let fx = 0, fy = 0;
      const si = this.pSpecies[i];

      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const dx = this.pX[j] - this.pX[i];
        const dy = this.pY[j] - this.pY[i];
        const d2 = dx * dx + dy * dy;
        if (d2 > rr2 || d2 < 1) continue;

        const d = Math.sqrt(d2);
        const sj = this.pSpecies[j];
        const rule = this.rules[si * this.speciesCount + sj];

        // Force: attractive at medium range, repulsive at close range
        const normD = d / this.ruleRadius;
        let force: number;
        if (normD < 0.3) {
          // Strong repulsion at close range
          force = normD / 0.3 - 1;
        } else {
          // Rule-based attraction/repulsion at medium range
          force = rule * (1 - Math.abs(2 * normD - 1 - 0.3) / 0.7);
        }

        fx += (dx / d) * force;
        fy += (dy / d) * force;
      }

      const strength = this.ruleRadius * 0.4;
      this.pVx[i] += fx * strength * cdt;
      this.pVy[i] += fy * strength * cdt;
    }

    // Move and apply friction
    for (let i = 0; i < n; i++) {
      this.pVx[i] *= this.friction;
      this.pVy[i] *= this.friction;
      this.pX[i] += this.pVx[i] * cdt;
      this.pY[i] += this.pVy[i] * cdt;

      // Wrap edges
      if (this.pX[i] < x) this.pX[i] += w;
      if (this.pX[i] > x + w) this.pX[i] -= w;
      if (this.pY[i] < y) this.pY[i] += h;
      if (this.pY[i] > y + h) this.pY[i] -= h;
    }

    // GPU update
    const pos = this.pointsMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < n; i++) pos.setXYZ(i, this.pX[i], this.pY[i], 0);
    pos.needsUpdate = true;

    (this.pointsMesh.material as THREE.PointsMaterial).opacity = opacity;
    (this.borderLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.2;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Randomize rules
      for (let i = 0; i < this.rules.length; i++) this.rules[i] = this.rng.float(-1, 1);
    }
    if (action === 'alert') {
      // Explosion from center
      const { x, y, w, h } = this.px;
      const cx = x + w / 2, cy = y + h / 2;
      for (let i = 0; i < this.particleCount; i++) {
        const dx = this.pX[i] - cx;
        const dy = this.pY[i] - cy;
        const d = Math.sqrt(dx * dx + dy * dy) + 1;
        this.pVx[i] = (dx / d) * 200;
        this.pVy[i] = (dy / d) * 200;
      }
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level >= 4) {
      for (let i = 0; i < this.rules.length; i++) this.rules[i] = this.rng.float(-1, 1);
    }
  }
}
