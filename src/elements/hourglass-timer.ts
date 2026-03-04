import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Hourglass sand timer with two triangular chambers connected by a narrow neck.
 * Particles transfer from top to bottom, then the hourglass flips.
 */
export class HourglassTimerElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'hourglass-timer',
    meta: {
      shape: 'rectangular',
      roles: ['gauge'],
      moods: ['diagnostic'],
      sizes: ['needs-medium'],
    },
  };

  private outline!: THREE.LineSegments;
  private particles!: THREE.Mesh[];

  private readonly PARTICLE_COUNT = 24;
  private particlePositions!: Float32Array; // x, y pairs
  private particlePhase!: Float32Array;
  private cycleTime: number = 0;
  private cycleDuration: number = 0;
  private flipped: boolean = false;

  // Hourglass geometry bounds
  private cx: number = 0;
  private cy: number = 0;
  private halfW: number = 0;
  private halfH: number = 0;
  private neckW: number = 0;

  build(): void {
    const { x, y, w, h } = this.px;

    this.cx = x + w * 0.5;
    this.cy = y + h * 0.5;
    this.halfW = w * 0.35;
    this.halfH = h * 0.42;
    this.neckW = w * 0.03;
    this.cycleDuration = this.rng.float(6.0, 10.0);

    // Hourglass outline: two triangles meeting at neck
    const topY = this.cy - this.halfH;
    const botY = this.cy + this.halfH;
    const verts: number[] = [
      // Top triangle: wide at top, narrow at center
      this.cx - this.halfW, topY, 0,   this.cx + this.halfW, topY, 0,        // top edge
      this.cx + this.halfW, topY, 0,   this.cx + this.neckW, this.cy, 0,     // right slope down
      this.cx - this.halfW, topY, 0,   this.cx - this.neckW, this.cy, 0,     // left slope down
      // Bottom triangle: narrow at center, wide at bottom
      this.cx - this.neckW, this.cy, 0, this.cx - this.halfW, botY, 0,       // left slope down
      this.cx + this.neckW, this.cy, 0, this.cx + this.halfW, botY, 0,       // right slope down
      this.cx - this.halfW, botY, 0,   this.cx + this.halfW, botY, 0,        // bottom edge
      // Neck connectors
      this.cx - this.neckW, this.cy, 0, this.cx + this.neckW, this.cy, 0,    // neck horizontal
    ];

    const outlineGeo = new THREE.BufferGeometry();
    outlineGeo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    this.outline = new THREE.LineSegments(outlineGeo, new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.outline);

    // Particles (small square meshes)
    this.particles = [];
    this.particlePositions = new Float32Array(this.PARTICLE_COUNT * 2);
    this.particlePhase = new Float32Array(this.PARTICLE_COUNT);
    const dotSize = Math.min(w, h) * 0.025;

    for (let i = 0; i < this.PARTICLE_COUNT; i++) {
      const geo = new THREE.PlaneGeometry(dotSize, dotSize);
      const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        color: this.palette.primary,
        transparent: true,
        opacity: 0,
      }));
      this.particles.push(mesh);
      this.group.add(mesh);
      this.particlePhase[i] = this.rng.float(0, 1);
      // Initialize all in top chamber
      this.particlePositions[i * 2] = this.rng.float(-0.7, 0.7);
      this.particlePositions[i * 2 + 1] = this.rng.float(-0.8, -0.1);
    }
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);

    this.cycleTime += dt;
    if (this.cycleTime >= this.cycleDuration) {
      this.cycleTime = 0;
      this.flipped = !this.flipped;
    }

    const progress = this.cycleTime / this.cycleDuration; // 0..1

    const topY = this.cy - this.halfH;
    const botY = this.cy + this.halfH;

    for (let i = 0; i < this.PARTICLE_COUNT; i++) {
      const phase = this.particlePhase[i];
      // Each particle has its own transfer timing based on phase
      const transferTime = phase * 0.8; // stagger: particles transfer at different times (0..0.8)
      let normalizedY: number; // -1 = top, +1 = bottom
      let normalizedX = this.particlePositions[i * 2];

      if (progress < transferTime) {
        // Still in source chamber (top if not flipped, bottom if flipped)
        // Settle toward bottom of source chamber
        const settling = progress / Math.max(transferTime, 0.01);
        normalizedY = this.flipped ? (0.1 + phase * 0.7) : (-0.1 - phase * 0.7);
        // Slight jitter
        normalizedX += Math.sin(time * 3 + i * 1.7) * 0.05;
      } else if (progress < transferTime + 0.1) {
        // Funneling through neck
        const funnelT = (progress - transferTime) / 0.1;
        normalizedY = this.flipped ? (0.1 * (1 - funnelT) + (-0.1) * funnelT) : (-0.1 * (1 - funnelT) + 0.1 * funnelT);
        normalizedX = normalizedX * (1 - funnelT) * 0.3;
      } else {
        // Arrived in destination chamber
        const arriveT = Math.min(1, (progress - transferTime - 0.1) / 0.3);
        normalizedY = this.flipped ? (-0.1 - phase * 0.7 * arriveT) : (0.1 + phase * 0.7 * arriveT);
        normalizedX += Math.sin(time * 2 + i * 2.3) * 0.04;
      }

      // Convert normalized coords to pixel coords within the hourglass
      // Determine chamber width at the given Y position
      const absY = normalizedY;
      let chamberWidth: number;
      if (Math.abs(absY) < 0.05) {
        chamberWidth = this.neckW / this.halfW;
      } else {
        chamberWidth = Math.abs(absY);
      }

      const clampedX = Math.max(-chamberWidth * 0.8, Math.min(chamberWidth * 0.8, normalizedX));
      const px = this.cx + clampedX * this.halfW;
      const py = this.cy + normalizedY * this.halfH;

      this.particles[i].position.set(px, py, 1);
      (this.particles[i].material as THREE.MeshBasicMaterial).opacity = opacity * 0.85;
    }

    (this.outline.material as THREE.LineBasicMaterial).opacity = opacity * 0.45;
  }
}
