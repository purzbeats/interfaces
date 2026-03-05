import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Poincare section of the Lorenz attractor. Integrates the Lorenz system
 * and plots intersections with a chosen plane, revealing fractal structure.
 * Points accumulate over time like a long-exposure photograph.
 */
export class LorenzSectionElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'lorenz-section',
    meta: { shape: 'rectangular', roles: ['data-display', 'decorative'], moods: ['diagnostic', 'ambient'], bandAffinity: 'mid', sizes: ['needs-medium', 'needs-large'] },
  };

  private pointsMesh!: THREE.Points;
  private pointsMat!: THREE.PointsMaterial;
  private positions!: Float32Array;
  private maxPoints: number = 4000;
  private head: number = 0;
  // Lorenz state
  private lx: number = 0;
  private ly: number = 0;
  private lz: number = 0;
  private prevZ: number = 0;
  // Lorenz parameters
  private sigma: number = 10;
  private rho: number = 28;
  private beta: number = 8 / 3;
  private integDt: number = 0.005;
  private stepsPerFrame: number = 200;
  // Display mapping
  private cx: number = 0;
  private cy: number = 0;
  private scaleX: number = 1;
  private scaleY: number = 1;
  private sectionPlane: number = 27; // z-plane for section

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;
    this.cx = x + w / 2;
    this.cy = y + h / 2;

    const variant = this.rng.int(0, 3);
    const presets = [
      { max: 4000, steps: 200, section: 27, rho: 28 },
      { max: 6000, steps: 300, section: 25, rho: 28 },
      { max: 3000, steps: 150, section: 27, rho: 45 },  // higher rho
      { max: 5000, steps: 250, section: 30, rho: 35 },
    ];
    const pr = presets[variant];
    this.maxPoints = pr.max;
    this.stepsPerFrame = pr.steps;
    this.sectionPlane = pr.section;
    this.rho = pr.rho;

    this.scaleX = w / 50;
    this.scaleY = h / 50;

    // Initial conditions
    this.lx = 1 + this.rng.float(-0.1, 0.1);
    this.ly = 1;
    this.lz = 1;
    this.prevZ = this.lz;

    this.positions = new Float32Array(this.maxPoints * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geo.setDrawRange(0, 0);

    this.pointsMat = new THREE.PointsMaterial({
      color: this.palette.primary,
      size: 2,
      transparent: true,
      opacity: 0,
    });
    this.pointsMesh = new THREE.Points(geo, this.pointsMat);
    this.group.add(this.pointsMesh);
  }

  private lorenzStep(): void {
    const dt = this.integDt;
    const { sigma, rho, beta } = this;
    // RK4 integration
    const dx1 = sigma * (this.ly - this.lx);
    const dy1 = this.lx * (rho - this.lz) - this.ly;
    const dz1 = this.lx * this.ly - beta * this.lz;

    const x2 = this.lx + dx1 * dt / 2;
    const y2 = this.ly + dy1 * dt / 2;
    const z2 = this.lz + dz1 * dt / 2;
    const dx2 = sigma * (y2 - x2);
    const dy2 = x2 * (rho - z2) - y2;
    const dz2 = x2 * y2 - beta * z2;

    const x3 = this.lx + dx2 * dt / 2;
    const y3 = this.ly + dy2 * dt / 2;
    const z3 = this.lz + dz2 * dt / 2;
    const dx3 = sigma * (y3 - x3);
    const dy3 = x3 * (rho - z3) - y3;
    const dz3 = x3 * y3 - beta * z3;

    const x4 = this.lx + dx3 * dt;
    const y4 = this.ly + dy3 * dt;
    const z4 = this.lz + dz3 * dt;
    const dx4 = sigma * (y4 - x4);
    const dy4 = x4 * (rho - z4) - y4;
    const dz4 = x4 * y4 - beta * z4;

    this.lx += (dx1 + 2 * dx2 + 2 * dx3 + dx4) * dt / 6;
    this.ly += (dy1 + 2 * dy2 + 2 * dy3 + dy4) * dt / 6;
    this.lz += (dz1 + 2 * dz2 + 2 * dz3 + dz4) * dt / 6;
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);

    for (let i = 0; i < this.stepsPerFrame; i++) {
      this.prevZ = this.lz;
      this.lorenzStep();

      // Detect upward crossing of section plane
      if (this.prevZ < this.sectionPlane && this.lz >= this.sectionPlane && this.head < this.maxPoints) {
        const idx = this.head * 3;
        this.positions[idx] = this.cx + this.lx * this.scaleX;
        this.positions[idx + 1] = this.cy + (this.ly - 25) * this.scaleY;
        this.positions[idx + 2] = 0;
        this.head++;
      }
    }

    const geo = this.pointsMesh.geometry;
    geo.setDrawRange(0, this.head);
    (geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    this.pointsMat.opacity = opacity * 0.9;

    // Reset if full
    if (this.head >= this.maxPoints) {
      this.head = 0;
      this.lx = 1 + this.rng.float(-0.5, 0.5);
      this.ly = 1;
      this.lz = 1;
    }
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') this.glitchTimer = 0.5;
    if (action === 'alert') {
      this.head = 0;
      this.lx = this.rng.float(-5, 5);
      this.ly = this.rng.float(-5, 5);
      this.lz = this.rng.float(10, 30);
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level >= 3) this.stepsPerFrame = 200 + level * 100;
  }
}
