import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Cornu / Euler spiral (clothoid): curvature increases linearly with arc length.
 * Computed via numerical Fresnel integral approximation.
 * Used in road/railway design for smooth curvature transitions.
 */
export class EulerSpiralElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'euler-spiral',
    meta: {
      shape: 'radial',
      roles: ['decorative'],
      moods: ['ambient', 'diagnostic'],
      bandAffinity: 'high',
      sizes: ['needs-medium', 'needs-large'],
    },
  };

  private spiralLine!: THREE.Line;
  private mirrorLine!: THREE.Line;
  private sampleCount: number = 500;
  private maxParam: number = 5;
  private cx: number = 0;
  private cy: number = 0;
  private scale: number = 1;
  private rotSpeed: number = 0.1;
  private breathSpeed: number = 0.3;
  private breathAmp: number = 0.05;
  private revealProgress: number = 0;
  private revealSpeed: number = 0.15;
  private basePositions!: Float32Array;
  private mirrorPositions!: Float32Array;

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;
    this.cx = x + w / 2;
    this.cy = y + h / 2;

    const variant = this.rng.int(0, 3);
    const presets = [
      { samples: 500, maxT: 5, rotSpeed: 0.1, breathSpeed: 0.3, breathAmp: 0.05, revealSpeed: 0.15 },
      { samples: 800, maxT: 7, rotSpeed: 0.06, breathSpeed: 0.2, breathAmp: 0.04, revealSpeed: 0.1 },
      { samples: 300, maxT: 4, rotSpeed: 0.15, breathSpeed: 0.5, breathAmp: 0.08, revealSpeed: 0.25 },
      { samples: 600, maxT: 6, rotSpeed: 0.08, breathSpeed: 0.4, breathAmp: 0.06, revealSpeed: 0.12 },
    ];
    const p = presets[variant];

    this.sampleCount = p.samples;
    this.maxParam = p.maxT;
    this.rotSpeed = p.rotSpeed;
    this.breathSpeed = p.breathSpeed;
    this.breathAmp = p.breathAmp;
    this.revealSpeed = p.revealSpeed;

    // Compute Fresnel integrals to get spiral points
    // The Euler spiral: x(t) = integral(cos(pi*s^2/2), 0, t), y(t) = integral(sin(pi*s^2/2), 0, t)
    // Approximate with Riemann sum

    const halfPi = Math.PI / 2;
    // Find bounding box of spiral for scaling
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

    // First pass to compute raw positions and bounds
    const rawX = new Float32Array(this.sampleCount);
    const rawY = new Float32Array(this.sampleCount);
    let sumC = 0, sumS = 0;
    const stepSize = this.maxParam / this.sampleCount;

    for (let i = 0; i < this.sampleCount; i++) {
      const t = (i / (this.sampleCount - 1)) * this.maxParam;
      // Numerical integration using trapezoidal rule step
      sumC += Math.cos(halfPi * t * t) * stepSize;
      sumS += Math.sin(halfPi * t * t) * stepSize;
      rawX[i] = sumC;
      rawY[i] = sumS;
      minX = Math.min(minX, sumC);
      maxX = Math.max(maxX, sumC);
      minY = Math.min(minY, sumS);
      maxY = Math.max(maxY, sumS);
    }

    // Also compute negative side
    const rawNX = new Float32Array(this.sampleCount);
    const rawNY = new Float32Array(this.sampleCount);
    sumC = 0; sumS = 0;
    for (let i = 0; i < this.sampleCount; i++) {
      const t = -(i / (this.sampleCount - 1)) * this.maxParam;
      sumC += Math.cos(halfPi * t * t) * stepSize;
      sumS -= Math.sin(halfPi * t * t) * stepSize;
      rawNX[i] = sumC;
      rawNY[i] = sumS;
      minX = Math.min(minX, sumC);
      maxX = Math.max(maxX, sumC);
      minY = Math.min(minY, sumS);
      maxY = Math.max(maxY, sumS);
    }

    const rangeX = maxX - minX || 1;
    const rangeY = maxY - minY || 1;
    this.scale = Math.min(w * 0.85, h * 0.85) / Math.max(rangeX, rangeY);
    const offsetX = -(minX + maxX) / 2;
    const offsetY = -(minY + maxY) / 2;

    // Positive branch
    this.basePositions = new Float32Array(this.sampleCount * 3);
    for (let i = 0; i < this.sampleCount; i++) {
      this.basePositions[i * 3] = this.cx + (rawX[i] + offsetX) * this.scale;
      this.basePositions[i * 3 + 1] = this.cy + (rawY[i] + offsetY) * this.scale;
      this.basePositions[i * 3 + 2] = 0;
    }

    const posArr = new Float32Array(this.basePositions);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
    this.spiralLine = new THREE.Line(geo, new THREE.LineBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.spiralLine);

    // Negative branch (mirror)
    this.mirrorPositions = new Float32Array(this.sampleCount * 3);
    for (let i = 0; i < this.sampleCount; i++) {
      this.mirrorPositions[i * 3] = this.cx + (rawNX[i] + offsetX) * this.scale;
      this.mirrorPositions[i * 3 + 1] = this.cy + (rawNY[i] + offsetY) * this.scale;
      this.mirrorPositions[i * 3 + 2] = 0;
    }

    const mirArr = new Float32Array(this.mirrorPositions);
    const mirGeo = new THREE.BufferGeometry();
    mirGeo.setAttribute('position', new THREE.BufferAttribute(mirArr, 3));
    this.mirrorLine = new THREE.Line(mirGeo, new THREE.LineBasicMaterial({
      color: this.palette.secondary,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.mirrorLine);
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);

    this.revealProgress = Math.min(this.revealProgress + dt * this.revealSpeed, 1);
    const visibleCount = Math.floor(this.revealProgress * this.sampleCount);

    this.spiralLine.geometry.setDrawRange(0, visibleCount);
    this.mirrorLine.geometry.setDrawRange(0, visibleCount);

    const breath = 1 + this.breathAmp * Math.sin(time * this.breathSpeed * Math.PI * 2);
    const rot = time * this.rotSpeed;

    // Animate positions with rotation and breathing
    const pos = this.spiralLine.geometry.getAttribute('position') as THREE.BufferAttribute;
    const mir = this.mirrorLine.geometry.getAttribute('position') as THREE.BufferAttribute;

    for (let i = 0; i < visibleCount; i++) {
      // Main spiral
      const bx = this.basePositions[i * 3] - this.cx;
      const by = this.basePositions[i * 3 + 1] - this.cy;
      const cosR = Math.cos(rot);
      const sinR = Math.sin(rot);
      pos.setXYZ(i,
        this.cx + (bx * cosR - by * sinR) * breath,
        this.cy + (bx * sinR + by * cosR) * breath,
        0,
      );

      // Mirror spiral
      const mx = this.mirrorPositions[i * 3] - this.cx;
      const my = this.mirrorPositions[i * 3 + 1] - this.cy;
      mir.setXYZ(i,
        this.cx + (mx * cosR - my * sinR) * breath,
        this.cy + (mx * sinR + my * cosR) * breath,
        0,
      );
    }
    pos.needsUpdate = true;
    mir.needsUpdate = true;

    (this.spiralLine.material as THREE.LineBasicMaterial).opacity = opacity * 0.9;
    (this.mirrorLine.material as THREE.LineBasicMaterial).opacity = opacity * 0.6;
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
      this.rotSpeed = 0.1 + level * 0.1;
    }
    if (level >= 5) {
      this.revealProgress = 0;
    }
  }
}
