import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Brownian motion simulation: many particles performing random walks with
 * trails, boundary collisions, and impulse-based movement.
 */
export class BrownianMotionElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'brownian-motion',
    meta: { shape: 'rectangular', roles: ['data-display', 'decorative'], moods: ['diagnostic', 'ambient'], bandAffinity: 'mid', sizes: ['needs-medium', 'needs-large'] },
  };

  private count = 0;
  private posX!: Float32Array;
  private posY!: Float32Array;
  private velX!: Float32Array;
  private velY!: Float32Array;
  private impulseStrength = 0;
  private damping = 0;
  private trailCanvas!: HTMLCanvasElement;
  private trailCtx!: CanvasRenderingContext2D;
  private trailTexture!: THREE.CanvasTexture;
  private trailMesh!: THREE.Mesh;
  private pointsMesh!: THREE.Points;
  private fadeRate = 0;

  build(): void {
    this.glitchAmount = 4;
    const variant = this.rng.int(0, 4);
    const presets = [
      { count: 80, impulse: 60, damping: 0.98, fade: 0.03, sizeFactor: 0.007 },
      { count: 200, impulse: 40, damping: 0.99, fade: 0.02, sizeFactor: 0.005 },
      { count: 30, impulse: 100, damping: 0.95, fade: 0.05, sizeFactor: 0.01 },
      { count: 120, impulse: 80, damping: 0.96, fade: 0.01, sizeFactor: 0.007 },
    ];
    const p = presets[variant];

    const { x, y, w, h } = this.px;
    this.count = p.count;
    this.impulseStrength = p.impulse * Math.min(w, h) / 200;
    this.damping = p.damping;
    this.fadeRate = p.fade;

    this.posX = new Float32Array(this.count);
    this.posY = new Float32Array(this.count);
    this.velX = new Float32Array(this.count);
    this.velY = new Float32Array(this.count);

    for (let i = 0; i < this.count; i++) {
      this.posX[i] = this.rng.float(0, w);
      this.posY[i] = this.rng.float(0, h);
      this.velX[i] = 0;
      this.velY[i] = 0;
    }

    // Trail canvas
    const res = Math.min(512, Math.max(w, h));
    const scale = res / Math.max(w, h);
    this.trailCanvas = document.createElement('canvas');
    this.trailCanvas.width = Math.ceil(w * scale);
    this.trailCanvas.height = Math.ceil(h * scale);
    this.trailCtx = this.get2DContext(this.trailCanvas);
    this.trailCtx.fillStyle = '#000';
    this.trailCtx.fillRect(0, 0, this.trailCanvas.width, this.trailCanvas.height);

    this.trailTexture = new THREE.CanvasTexture(this.trailCanvas);
    this.trailTexture.minFilter = THREE.NearestFilter;
    const geo = new THREE.PlaneGeometry(w, h);
    this.trailMesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      map: this.trailTexture, transparent: true, opacity: 0,
    }));
    this.trailMesh.position.set(x + w / 2, y + h / 2, 0);
    this.group.add(this.trailMesh);

    // Particle points
    const positions = new Float32Array(this.count * 3);
    const pointGeo = new THREE.BufferGeometry();
    pointGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.pointsMesh = new THREE.Points(pointGeo, new THREE.PointsMaterial({
      color: this.palette.primary, transparent: true, opacity: 0,
      size: Math.max(1, Math.min(w, h) * p.sizeFactor), sizeAttenuation: false,
    }));
    this.group.add(this.pointsMesh);
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);
    const { x, y, w, h } = this.px;
    const cw = this.trailCanvas.width;
    const ch = this.trailCanvas.height;
    const sx = cw / w;
    const sy = ch / h;

    // Fade trails
    this.trailCtx.fillStyle = `rgba(0,0,0,${this.fadeRate})`;
    this.trailCtx.fillRect(0, 0, cw, ch);

    const r = ((this.palette.secondary.r * 255) | 0).toString();
    const g = ((this.palette.secondary.g * 255) | 0).toString();
    const b = ((this.palette.secondary.b * 255) | 0).toString();
    this.trailCtx.fillStyle = `rgba(${r},${g},${b},0.8)`;

    // RNG-based impulses each frame
    // Use a simple hash per frame to generate impulses deterministically
    for (let i = 0; i < this.count; i++) {
      // Random impulse using seeded rng
      const angle = this.rng.float(0, Math.PI * 2);
      const strength = this.rng.float(0, this.impulseStrength) * dt;
      this.velX[i] += Math.cos(angle) * strength;
      this.velY[i] += Math.sin(angle) * strength;
      this.velX[i] *= this.damping;
      this.velY[i] *= this.damping;

      this.posX[i] += this.velX[i] * dt;
      this.posY[i] += this.velY[i] * dt;

      // Bounce off boundaries
      if (this.posX[i] < 0) { this.posX[i] = -this.posX[i]; this.velX[i] = Math.abs(this.velX[i]); }
      if (this.posX[i] > w) { this.posX[i] = 2 * w - this.posX[i]; this.velX[i] = -Math.abs(this.velX[i]); }
      if (this.posY[i] < 0) { this.posY[i] = -this.posY[i]; this.velY[i] = Math.abs(this.velY[i]); }
      if (this.posY[i] > h) { this.posY[i] = 2 * h - this.posY[i]; this.velY[i] = -Math.abs(this.velY[i]); }

      // Draw trail dot
      this.trailCtx.fillRect(this.posX[i] * sx - 0.5, this.posY[i] * sy - 0.5, 1.5, 1.5);
    }

    this.trailTexture.needsUpdate = true;

    // Update point positions
    const pos = this.pointsMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < this.count; i++) {
      pos.setXYZ(i, x + this.posX[i], y + this.posY[i], 0.5);
    }
    pos.needsUpdate = true;

    (this.trailMesh.material as THREE.MeshBasicMaterial).opacity = opacity * 0.6;
    (this.pointsMesh.material as THREE.PointsMaterial).opacity = opacity;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Massive random kick to all particles
      for (let i = 0; i < this.count; i++) {
        const angle = this.rng.float(0, Math.PI * 2);
        const kick = this.impulseStrength * 3;
        this.velX[i] += Math.cos(angle) * kick;
        this.velY[i] += Math.sin(angle) * kick;
      }
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    this.impulseStrength *= (1 + level * 0.1);
  }
}
