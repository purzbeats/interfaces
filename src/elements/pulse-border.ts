import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';
import { hexCornersPixel, hexPerimeterPoint } from '../layout/hex-grid';

/**
 * Pulse border — border divided into segments that light up sequentially,
 * creating a running-light effect around the perimeter. Four variants:
 * clockwise sweep, ping-pong bounce, random sparkle, breathing wave.
 */
export class PulseBorderElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'pulse-border',
    meta: {
      shape: 'rectangular',
      roles: ['structural', 'decorative', 'border'],
      moods: ['tactical', 'ambient'],
      bandAffinity: 'bass',
      sizes: ['works-small', 'needs-medium', 'needs-large'],
    },
  };

  private variant: number = 0;
  private segmentPoints!: THREE.Points;
  private segmentCount: number = 0;
  private segmentOpacities!: Float32Array;
  private sweepPos: number = 0;
  private sweepDir: number = 1; // for ping-pong
  private sweepSpeed: number = 0.4;
  private sparkleTimers!: Float32Array; // for random sparkle
  private isHex: boolean = false;
  private hexCorners: THREE.Vector3[] | null = null;
  private perimeterLength: number = 0;
  private speedBoost: number = 1;

  build(): void {
    this.variant = this.rng.int(0, 3);
    const { x, y, w, h } = this.px;

    const hexCell = this.region.hexCell;
    if (hexCell) {
      this.isHex = true;
      this.hexCorners = hexCornersPixel(hexCell, this.screenWidth, this.screenHeight);
      let perim = 0;
      for (let i = 0; i < 6; i++) {
        const c1 = this.hexCorners[i], c2 = this.hexCorners[(i + 1) % 6];
        perim += Math.sqrt((c2.x - c1.x) ** 2 + (c2.y - c1.y) ** 2);
      }
      this.perimeterLength = perim;
    } else {
      this.perimeterLength = 2 * (w + h);
    }

    // Segment density proportional to perimeter
    const minDim = Math.min(w, h);
    const pointSpacing = Math.max(2, minDim * 0.02);
    this.segmentCount = Math.max(16, Math.floor(this.perimeterLength / pointSpacing));

    this.segmentOpacities = new Float32Array(this.segmentCount);
    this.sparkleTimers = new Float32Array(this.segmentCount);
    for (let i = 0; i < this.segmentCount; i++) {
      this.sparkleTimers[i] = this.rng.float(0, 3);
    }

    const positions = new Float32Array(this.segmentCount * 3);
    const cx = x + w * 0.5, cy = y + h * 0.5;

    for (let i = 0; i < this.segmentCount; i++) {
      const t = i / this.segmentCount;
      const pt = this.perimeterPoint(t);
      positions[i * 3] = pt.px;
      positions[i * 3 + 1] = pt.py;
      positions[i * 3 + 2] = 0;
    }

    const colors = new Float32Array(this.segmentCount * 3);
    for (let i = 0; i < this.segmentCount; i++) {
      colors[i * 3] = this.palette.primary.r;
      colors[i * 3 + 1] = this.palette.primary.g;
      colors[i * 3 + 2] = this.palette.primary.b;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const pointSize = Math.max(2, minDim * 0.015);
    this.segmentPoints = new THREE.Points(geo, new THREE.PointsMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 1,
      size: pointSize,
      sizeAttenuation: false,
    }));
    this.group.add(this.segmentPoints);

    this.sweepSpeed = 0.3 + this.rng.float(-0.1, 0.1);
  }

  private perimeterPoint(t: number): { px: number; py: number } {
    if (this.isHex && this.hexCorners) {
      return hexPerimeterPoint(this.hexCorners, t);
    }
    const { x, y, w, h } = this.px;
    const perim = this.perimeterLength;
    t = ((t % 1) + 1) % 1;
    const dist = t * perim;
    if (dist <= w) return { px: x + dist, py: y };
    if (dist <= w + h) return { px: x + w, py: y + (dist - w) };
    if (dist <= 2 * w + h) return { px: x + w - (dist - w - h), py: y + h };
    return { px: x, py: y + h - (dist - 2 * w - h) };
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);

    const speed = this.sweepSpeed * this.speedBoost;
    const tailLen = 0.15; // fraction of perimeter for the lit tail

    switch (this.variant) {
      case 0: { // clockwise sweep
        this.sweepPos = (this.sweepPos + dt * speed) % 1;
        for (let i = 0; i < this.segmentCount; i++) {
          const t = i / this.segmentCount;
          let dist = (this.sweepPos - t + 1) % 1;
          this.segmentOpacities[i] = dist < tailLen ? (1 - dist / tailLen) : 0.05;
        }
        break;
      }
      case 1: { // ping-pong bounce
        this.sweepPos += dt * speed * this.sweepDir;
        if (this.sweepPos >= 1) { this.sweepPos = 1; this.sweepDir = -1; }
        if (this.sweepPos <= 0) { this.sweepPos = 0; this.sweepDir = 1; }
        for (let i = 0; i < this.segmentCount; i++) {
          const t = i / this.segmentCount;
          const dist = Math.abs(this.sweepPos - t);
          this.segmentOpacities[i] = dist < tailLen ? (1 - dist / tailLen) : 0.05;
        }
        break;
      }
      case 2: { // random sparkle
        for (let i = 0; i < this.segmentCount; i++) {
          this.sparkleTimers[i] -= dt * speed * 2;
          if (this.sparkleTimers[i] <= 0) {
            this.sparkleTimers[i] = this.rng.float(0.5, 3);
            this.segmentOpacities[i] = 1;
          } else {
            this.segmentOpacities[i] = Math.max(0.05, this.segmentOpacities[i] - dt * 2);
          }
        }
        break;
      }
      case 3: { // breathing wave
        for (let i = 0; i < this.segmentCount; i++) {
          const t = i / this.segmentCount;
          const wave = Math.sin(t * Math.PI * 4 + time * speed * 6);
          this.segmentOpacities[i] = 0.1 + (wave * 0.5 + 0.5) * 0.9;
        }
        break;
      }
    }

    // Apply opacities via vertex colors (brightness modulation)
    const colors = this.segmentPoints.geometry.getAttribute('color') as THREE.BufferAttribute;
    const p = this.palette.primary;
    const s = this.palette.secondary;
    for (let i = 0; i < this.segmentCount; i++) {
      const a = this.segmentOpacities[i];
      // Blend from dim to primary based on opacity
      colors.setXYZ(i,
        p.r * a + s.r * (1 - a) * 0.2,
        p.g * a + s.g * (1 - a) * 0.2,
        p.b * a + s.b * (1 - a) * 0.2,
      );
    }
    colors.needsUpdate = true;

    (this.segmentPoints.material as THREE.PointsMaterial).opacity = opacity;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'activate') {
      this.sweepPos = 0;
      this.sweepDir = 1;
      this.speedBoost = 1;
    }
    if (action === 'alert') {
      this.pulseTimer = 2.0;
      // Flash all segments
      for (let i = 0; i < this.segmentCount; i++) {
        this.segmentOpacities[i] = 1;
      }
    }
    if (action === 'pulse') {
      this.speedBoost = 3.0;
      setTimeout(() => { this.speedBoost = 1; }, 500);
    }
    if (action === 'glitch') {
      this.sweepPos = this.rng.float(0, 1);
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) { this.speedBoost = 1; return; }
    this.speedBoost = 1 + level * 0.4;
  }
}
