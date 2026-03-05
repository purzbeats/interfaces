import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Euler's totient function phi(n) plotted as points (n, phi(n)).
 * Shows characteristic "ray" patterns radiating from the origin,
 * each ray corresponding to phi(n)/n = product(1 - 1/p) for primes p|n.
 * Progressive reveal with optional connecting lines.
 */
export class TotientPlotElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'totient-plot',
    meta: {
      shape: 'rectangular',
      roles: ['data-display', 'decorative'],
      moods: ['diagnostic', 'ambient'],
      bandAffinity: 'mid',
      sizes: ['needs-medium', 'needs-large'],
    },
  };

  private plotPoints!: THREE.Points;
  private rayLine!: THREE.Line;
  private nMax: number = 300;
  private pointSize: number = 2;
  private revealProgress: number = 0;
  private revealSpeed: number = 0.1;
  private showRayLine: boolean = false;
  private pulseSpeed: number = 0.5;
  private totientValues: number[] = [];

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;

    const variant = this.rng.int(0, 3);
    const presets = [
      { nMax: 300, pointSize: 2, revealSpeed: 0.1, showRay: false, pulseSpeed: 0.5 },
      { nMax: 500, pointSize: 2, revealSpeed: 0.07, showRay: true, pulseSpeed: 0.3 },
      { nMax: 200, pointSize: 3, revealSpeed: 0.15, showRay: false, pulseSpeed: 0.7 },
      { nMax: 800, pointSize: 1, revealSpeed: 0.05, showRay: true, pulseSpeed: 0.4 },
    ];
    const p = presets[variant];

    this.nMax = p.nMax;
    this.pointSize = p.pointSize;
    this.revealSpeed = p.revealSpeed;
    this.showRayLine = p.showRay;
    this.pulseSpeed = p.pulseSpeed;

    // Compute totient values using sieve
    this.totientValues = this.computeTotientSieve(this.nMax);

    // Scale to fit region
    const padding = 0.05;
    const plotX = x + w * padding;
    const plotY = y + h * padding;
    const plotW = w * (1 - 2 * padding);
    const plotH = h * (1 - 2 * padding);

    // Build point positions
    const positions = new Float32Array(this.nMax * 3);
    const colors = new Float32Array(this.nMax * 3);

    for (let n = 1; n <= this.nMax; n++) {
      const i = n - 1;
      const phi = this.totientValues[n];
      // Map n to x, phi(n) to y
      const px = plotX + (n / this.nMax) * plotW;
      const py = plotY + plotH - (phi / this.nMax) * plotH; // invert Y so origin at bottom-left

      positions[i * 3] = px;
      positions[i * 3 + 1] = py;
      positions[i * 3 + 2] = 0;

      // Color: primes (phi(n) = n-1) are primary, others fade based on ratio
      const ratio = phi / n;
      const isPrime = phi === n - 1 && n > 1;
      let col: THREE.Color;
      if (isPrime) {
        col = this.palette.primary.clone();
      } else {
        col = new THREE.Color().copy(this.palette.dim).lerp(this.palette.secondary, ratio);
      }
      colors[i * 3] = col.r;
      colors[i * 3 + 1] = col.g;
      colors[i * 3 + 2] = col.b;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    this.plotPoints = new THREE.Points(geo, new THREE.PointsMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0,
      size: this.pointSize,
      sizeAttenuation: false,
    }));
    this.group.add(this.plotPoints);

    // Optional: phi(n) = n-1 line (upper bound, the prime line)
    if (this.showRayLine) {
      const lineCount = 3; // phi(n)/n = 1, 1/2, 1/3 rays
      const segsPerRay = 2;
      const totalPts = lineCount * segsPerRay;
      const rayPos = new Float32Array(totalPts * 3);

      const rays = [1, 0.5, 1 / 3];
      for (let r = 0; r < lineCount; r++) {
        const slope = rays[r];
        const base = r * segsPerRay * 3;
        // From origin to max
        rayPos[base] = plotX;
        rayPos[base + 1] = plotY + plotH - 0;
        rayPos[base + 2] = -1;
        rayPos[base + 3] = plotX + plotW;
        rayPos[base + 4] = plotY + plotH - slope * plotH;
        rayPos[base + 5] = -1;
      }

      const rayGeo = new THREE.BufferGeometry();
      rayGeo.setAttribute('position', new THREE.BufferAttribute(rayPos, 3));
      this.rayLine = new THREE.Line(rayGeo, new THREE.LineBasicMaterial({
        color: this.palette.dim,
        transparent: true,
        opacity: 0,
      }));
      this.group.add(this.rayLine);
    }
  }

  private computeTotientSieve(max: number): number[] {
    const phi = new Array(max + 1);
    for (let i = 0; i <= max; i++) phi[i] = i;
    for (let p = 2; p <= max; p++) {
      if (phi[p] === p) {
        // p is prime
        for (let m = p; m <= max; m += p) {
          phi[m] = Math.floor(phi[m] / p * (p - 1));
        }
      }
    }
    phi[0] = 0;
    phi[1] = 1;
    return phi;
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);

    this.revealProgress = Math.min(this.revealProgress + dt * this.revealSpeed, 1);
    const visibleCount = Math.floor(this.revealProgress * this.nMax);
    this.plotPoints.geometry.setDrawRange(0, visibleCount);

    // Size pulse
    const sizePulse = 1 + 0.15 * Math.sin(time * this.pulseSpeed * Math.PI * 2);
    (this.plotPoints.material as THREE.PointsMaterial).size = this.pointSize * sizePulse;
    (this.plotPoints.material as THREE.PointsMaterial).opacity = opacity;

    if (this.rayLine) {
      (this.rayLine.material as THREE.LineBasicMaterial).opacity = opacity * 0.2;
    }
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
      this.revealSpeed = 0.1 + level * 0.08;
    }
    if (level >= 5) {
      this.revealProgress = 0;
      this.pointSize = 2 + level;
    }
  }
}
