import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * N-body gravitational simulation with bodies arranged in a ring.
 * Perturbations cause complex orbital dynamics with trail rendering.
 */
export class NBodyRingElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'n-body-ring',
    meta: { shape: 'radial', roles: ['data-display', 'decorative'], moods: ['tactical', 'ambient'], bandAffinity: 'sub', sizes: ['needs-medium', 'needs-large'] },
  };

  private bodyCount = 0;
  private posX!: Float32Array;
  private posY!: Float32Array;
  private velX!: Float32Array;
  private velY!: Float32Array;
  private mass!: Float32Array;
  private trailLen = 60;
  private trailBuf!: Float32Array; // interleaved x,y per body per step
  private trailHead = 0;
  private pointsMesh!: THREE.Points;
  private trailMesh!: THREE.Points;
  private cx = 0;
  private cy = 0;
  private G = 0;
  private softening = 0;

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;
    this.cx = x + w / 2;
    this.cy = y + h / 2;
    const radius = Math.min(w, h) * 0.35;

    const variant = this.rng.int(0, 3);
    const presets = [
      { n: 8, G: 800, soft: 8, massVar: 0.3 },
      { n: 12, G: 500, soft: 6, massVar: 0.1 },
      { n: 5, G: 1500, soft: 10, massVar: 0.5 },
      { n: 16, G: 300, soft: 5, massVar: 0.2 },
    ];
    const p = presets[variant];
    this.bodyCount = p.n;
    this.G = p.G;
    this.softening = p.soft;

    this.posX = new Float32Array(p.n);
    this.posY = new Float32Array(p.n);
    this.velX = new Float32Array(p.n);
    this.velY = new Float32Array(p.n);
    this.mass = new Float32Array(p.n);

    // Arrange in a ring with tangential velocities for quasi-stable orbits
    for (let i = 0; i < p.n; i++) {
      const angle = (i / p.n) * Math.PI * 2;
      this.posX[i] = this.cx + Math.cos(angle) * radius;
      this.posY[i] = this.cy + Math.sin(angle) * radius;
      this.mass[i] = 1 + this.rng.float(-p.massVar, p.massVar);
      // Tangential velocity for circular orbit approximation
      const speed = Math.sqrt(this.G * p.n / (radius * 4));
      this.velX[i] = -Math.sin(angle) * speed + this.rng.float(-2, 2);
      this.velY[i] = Math.cos(angle) * speed + this.rng.float(-2, 2);
    }

    // Trail buffer
    this.trailBuf = new Float32Array(p.n * this.trailLen * 2);
    for (let i = 0; i < p.n; i++) {
      for (let t = 0; t < this.trailLen; t++) {
        this.trailBuf[(i * this.trailLen + t) * 2] = this.posX[i];
        this.trailBuf[(i * this.trailLen + t) * 2 + 1] = this.posY[i];
      }
    }

    // Body points
    const bodyPos = new Float32Array(p.n * 3);
    const bodyGeo = new THREE.BufferGeometry();
    bodyGeo.setAttribute('position', new THREE.BufferAttribute(bodyPos, 3));
    this.pointsMesh = new THREE.Points(bodyGeo, new THREE.PointsMaterial({
      color: this.palette.primary, transparent: true, opacity: 0, size: Math.max(1, Math.min(w, h) * 0.013), sizeAttenuation: false,
    }));
    this.group.add(this.pointsMesh);

    // Trail points
    const trailPos = new Float32Array(p.n * this.trailLen * 3);
    const trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPos, 3));
    this.trailMesh = new THREE.Points(trailGeo, new THREE.PointsMaterial({
      color: this.palette.dim, transparent: true, opacity: 0, size: Math.max(1, Math.min(w, h) * 0.005), sizeAttenuation: false,
    }));
    this.group.add(this.trailMesh);
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);
    const n = this.bodyCount;
    const clampDt = Math.min(dt, 0.03);
    const soft2 = this.softening * this.softening;

    // Leapfrog integration
    for (let i = 0; i < n; i++) {
      let ax = 0, ay = 0;
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const dx = this.posX[j] - this.posX[i];
        const dy = this.posY[j] - this.posY[i];
        const dist2 = dx * dx + dy * dy + soft2;
        const invDist3 = this.mass[j] / (dist2 * Math.sqrt(dist2));
        ax += dx * invDist3;
        ay += dy * invDist3;
      }
      this.velX[i] += ax * this.G * clampDt;
      this.velY[i] += ay * this.G * clampDt;
    }
    for (let i = 0; i < n; i++) {
      this.posX[i] += this.velX[i] * clampDt;
      this.posY[i] += this.velY[i] * clampDt;
      // Soft boundary
      const dx = this.posX[i] - this.cx;
      const dy = this.posY[i] - this.cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const maxR = Math.min(this.px.w, this.px.h) * 0.48;
      if (dist > maxR) {
        const pull = (dist - maxR) * 0.5;
        this.velX[i] -= (dx / dist) * pull;
        this.velY[i] -= (dy / dist) * pull;
      }
    }

    // Record trail
    this.trailHead = (this.trailHead + 1) % this.trailLen;
    for (let i = 0; i < n; i++) {
      const idx = (i * this.trailLen + this.trailHead) * 2;
      this.trailBuf[idx] = this.posX[i];
      this.trailBuf[idx + 1] = this.posY[i];
    }

    // Update GPU buffers
    const bp = this.pointsMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < n; i++) bp.setXYZ(i, this.posX[i], this.posY[i], 0);
    bp.needsUpdate = true;

    const tp = this.trailMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < n; i++) {
      for (let t = 0; t < this.trailLen; t++) {
        const idx = (i * this.trailLen + t) * 2;
        tp.setXYZ(i * this.trailLen + t, this.trailBuf[idx], this.trailBuf[idx + 1], 0);
      }
    }
    tp.needsUpdate = true;

    (this.pointsMesh.material as THREE.PointsMaterial).opacity = opacity;
    (this.trailMesh.material as THREE.PointsMaterial).opacity = opacity * 0.3;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      for (let i = 0; i < this.bodyCount; i++) {
        this.velX[i] += this.rng.float(-30, 30);
        this.velY[i] += this.rng.float(-30, 30);
      }
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level >= 3) {
      for (let i = 0; i < this.bodyCount; i++) {
        this.velX[i] *= 1 + level * 0.1;
        this.velY[i] *= 1 + level * 0.1;
      }
    }
  }
}
