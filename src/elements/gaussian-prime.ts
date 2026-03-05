import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Gaussian primes plotted on the complex plane.
 * a+bi is a Gaussian prime if its norm a^2+b^2 is an ordinary prime,
 * or if one of a,b is 0 and the other is a prime p with p mod 4 = 3.
 * Produces a distinctive cross/diamond pattern.
 */
export class GaussianPrimeElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'gaussian-prime',
    meta: {
      shape: 'rectangular',
      roles: ['data-display', 'decorative'],
      moods: ['diagnostic', 'ambient'],
      bandAffinity: 'high',
      sizes: ['needs-medium', 'needs-large'],
    },
  };

  private primePoints!: THREE.Points;
  private axisLines!: THREE.LineSegments;
  private primeCount: number = 0;
  private maxRange: number = 20;
  private pointSize: number = 3;
  private rotSpeed: number = 0;
  private pulseSpeed: number = 1;
  private revealProgress: number = 0;
  private revealSpeed: number = 0.2;
  private cx: number = 0;
  private cy: number = 0;

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;
    this.cx = x + w / 2;
    this.cy = y + h / 2;

    const variant = this.rng.int(0, 3);
    const presets = [
      { range: 20, pointSize: 3, rotSpeed: 0.02, pulseSpeed: 1, revealSpeed: 0.2 },
      { range: 30, pointSize: 2, rotSpeed: 0.01, pulseSpeed: 0.7, revealSpeed: 0.15 },
      { range: 15, pointSize: 4, rotSpeed: 0.04, pulseSpeed: 1.5, revealSpeed: 0.3 },
      { range: 40, pointSize: 2, rotSpeed: 0.005, pulseSpeed: 0.5, revealSpeed: 0.1 },
    ];
    const p = presets[variant];

    this.maxRange = p.range;
    this.pointSize = p.pointSize;
    this.rotSpeed = p.rotSpeed;
    this.pulseSpeed = p.pulseSpeed;
    this.revealSpeed = p.revealSpeed;

    // Find all Gaussian primes in range [-maxRange, maxRange]^2
    const primes: Array<{ a: number; b: number }> = [];

    for (let a = -this.maxRange; a <= this.maxRange; a++) {
      for (let b = -this.maxRange; b <= this.maxRange; b++) {
        if (this.isGaussianPrime(a, b)) {
          primes.push({ a, b });
        }
      }
    }

    this.primeCount = primes.length;
    const scale = Math.min(w, h) * 0.42 / this.maxRange;

    // Build point positions
    const positions = new Float32Array(this.primeCount * 3);
    const colors = new Float32Array(this.primeCount * 3);

    for (let i = 0; i < this.primeCount; i++) {
      const { a, b } = primes[i];
      positions[i * 3] = this.cx + a * scale;
      positions[i * 3 + 1] = this.cy + b * scale;
      positions[i * 3 + 2] = 0;

      // Color by norm distance
      const norm = Math.sqrt(a * a + b * b);
      const t = Math.min(norm / this.maxRange, 1);
      const col = new THREE.Color().copy(this.palette.primary).lerp(this.palette.secondary, t);
      // On axes: use dim color
      if (a === 0 || b === 0) {
        col.copy(this.palette.dim).lerp(this.palette.primary, 0.5);
      }
      colors[i * 3] = col.r;
      colors[i * 3 + 1] = col.g;
      colors[i * 3 + 2] = col.b;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    this.primePoints = new THREE.Points(geo, new THREE.PointsMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0,
      size: this.pointSize,
      sizeAttenuation: false,
    }));
    this.group.add(this.primePoints);

    // Axis lines
    const axisPos = new Float32Array(12);
    // Horizontal axis
    axisPos[0] = x + w * 0.02;
    axisPos[1] = this.cy;
    axisPos[2] = -1;
    axisPos[3] = x + w * 0.98;
    axisPos[4] = this.cy;
    axisPos[5] = -1;
    // Vertical axis
    axisPos[6] = this.cx;
    axisPos[7] = y + h * 0.02;
    axisPos[8] = -1;
    axisPos[9] = this.cx;
    axisPos[10] = y + h * 0.98;
    axisPos[11] = -1;

    const axisGeo = new THREE.BufferGeometry();
    axisGeo.setAttribute('position', new THREE.BufferAttribute(axisPos, 3));
    this.axisLines = new THREE.LineSegments(axisGeo, new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.axisLines);
  }

  private isPrime(n: number): boolean {
    if (n < 2) return false;
    if (n < 4) return true;
    if (n % 2 === 0 || n % 3 === 0) return false;
    for (let i = 5; i * i <= n; i += 6) {
      if (n % i === 0 || n % (i + 2) === 0) return false;
    }
    return true;
  }

  private isGaussianPrime(a: number, b: number): boolean {
    if (a === 0 && b === 0) return false;
    // If one component is 0, the other must be prime and +-3 mod 4
    if (a === 0) {
      const absB = Math.abs(b);
      return this.isPrime(absB) && absB % 4 === 3;
    }
    if (b === 0) {
      const absA = Math.abs(a);
      return this.isPrime(absA) && absA % 4 === 3;
    }
    // Otherwise check if norm is prime
    const norm = a * a + b * b;
    return this.isPrime(norm);
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);

    this.revealProgress = Math.min(this.revealProgress + dt * this.revealSpeed, 1);
    const visibleCount = Math.floor(this.revealProgress * this.primeCount);
    this.primePoints.geometry.setDrawRange(0, visibleCount);

    // Gentle pulsing of point size
    const sizePulse = 1 + 0.2 * Math.sin(time * this.pulseSpeed * Math.PI * 2);
    (this.primePoints.material as THREE.PointsMaterial).size = this.pointSize * sizePulse;

    // Very slow rotation
    if (this.rotSpeed > 0) {
      const pos = this.primePoints.geometry.getAttribute('position') as THREE.BufferAttribute;
      const rot = time * this.rotSpeed * 0.1;
      const cosR = Math.cos(rot);
      const sinR = Math.sin(rot);
      const arr = pos.array as Float32Array;
      // Only apply tiny rotation to avoid distorting the pattern
      // We rotate the group instead for clarity
    }

    (this.primePoints.material as THREE.PointsMaterial).opacity = opacity;
    (this.axisLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.25;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      this.revealProgress = 0;
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) return;
    if (level >= 3) {
      this.pointSize = 3 + level;
    }
    if (level >= 5) {
      this.revealProgress = 0;
    }
  }
}
