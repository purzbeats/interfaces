import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

interface NoiseDot {
  x: number;      // current x within band
  y: number;      // current y within band
  vx: number;     // drift velocity x
  vy: number;     // drift velocity y
  phase: number;  // shimmer phase offset
  speed: number;  // shimmer speed
  baseX: number;  // anchor x (resets drift)
  baseY: number;  // anchor y
}

/**
 * Horizontal band filled with animated noise particles.
 * Points shimmer and drift randomly within the band — like TV static confined to a stripe.
 * Variants: thin line, medium band, full region, color shifting.
 */
export class NoiseBandElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'noise-band',
    meta: {
      shape: 'rectangular',
      roles: ['decorative', 'scanner'],
      moods: ['diagnostic', 'ambient'],
      sizes: ['works-small', 'needs-medium'],
      bandAffinity: 'high',
      audioSensitivity: 1.8,
    },
  };

  private pointsMesh!: THREE.Points;
  private borderMesh!: THREE.LineSegments;
  private dots: NoiseDot[] = [];
  private variant: number = 0;
  private bandY: number = 0;
  private bandH: number = 0;
  private colorShiftTimer: number = 0;
  private alertMode: boolean = false;
  private baseIntensity: number = 1;

  build(): void {
    this.variant = this.rng.int(0, 3);
    const { x, y, w, h } = this.px;

    const presets = [
      { bandFrac: 0.08, count: 200, drift: 15, shimmerRate: 6 },   // thin line
      { bandFrac: 0.3,  count: 400, drift: 25, shimmerRate: 8 },   // medium band
      { bandFrac: 0.85, count: 600, drift: 40, shimmerRate: 5 },   // full region
      { bandFrac: 0.2,  count: 300, drift: 20, shimmerRate: 12 },  // color shifting
    ];
    const p = presets[this.variant];

    this.bandH = h * p.bandFrac;
    this.bandY = y + (h - this.bandH) / 2;

    // Create noise dots
    for (let i = 0; i < p.count; i++) {
      const bx = x + this.rng.float(0, w);
      const by = this.bandY + this.rng.float(0, this.bandH);
      this.dots.push({
        x: bx,
        y: by,
        vx: this.rng.float(-p.drift, p.drift),
        vy: this.rng.float(-p.drift * 0.5, p.drift * 0.5),
        phase: this.rng.float(0, Math.PI * 2),
        speed: this.rng.float(p.shimmerRate * 0.5, p.shimmerRate * 2),
        baseX: bx,
        baseY: by,
      });
    }

    const count = this.dots.length;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.pointsMesh = new THREE.Points(geo, new THREE.PointsMaterial({
      vertexColors: true,
      size: Math.max(1.5, Math.min(w, h) * 0.003),
      transparent: true,
      opacity: 0,
      sizeAttenuation: false,
    }));
    this.group.add(this.pointsMesh);

    // Border lines around band (thin subtle rect)
    const bv = new Float32Array([
      x, this.bandY, 0,           x + w, this.bandY, 0,
      x + w, this.bandY, 0,       x + w, this.bandY + this.bandH, 0,
      x + w, this.bandY + this.bandH, 0,  x, this.bandY + this.bandH, 0,
      x, this.bandY + this.bandH, 0,      x, this.bandY, 0,
    ]);
    const borderGeo = new THREE.BufferGeometry();
    borderGeo.setAttribute('position', new THREE.BufferAttribute(bv, 3));
    this.borderMesh = new THREE.LineSegments(borderGeo, new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.borderMesh);
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    const { x, w } = this.px;

    // Color shift timer for variant 3
    if (this.variant === 3) {
      this.colorShiftTimer += dt;
    }

    const positions = this.pointsMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const colors = this.pointsMesh.geometry.getAttribute('color') as THREE.BufferAttribute;

    const primary = this.alertMode ? this.palette.alert : this.palette.primary;
    const secondary = this.palette.secondary;
    const dim = this.palette.dim;

    for (let i = 0; i < this.dots.length; i++) {
      const d = this.dots[i];

      // Drift within band bounds with wraparound on x, bounce on y
      d.x += d.vx * dt;
      d.y += d.vy * dt;

      // Wrap x
      if (d.x < x) d.x += w;
      if (d.x > x + w) d.x -= w;

      // Bounce y within band
      if (d.y < this.bandY) { d.y = this.bandY; d.vy = Math.abs(d.vy); }
      if (d.y > this.bandY + this.bandH) { d.y = this.bandY + this.bandH; d.vy = -Math.abs(d.vy); }

      // Shimmer: randomize brightness with sine + noise kick
      const shimmer = 0.5 + 0.5 * Math.sin(time * d.speed + d.phase);
      // Randomly jitter position for static effect
      const jx = (this.rng.next() - 0.5) * 3;
      const jy = (this.rng.next() - 0.5) * (this.bandH * 0.1);

      positions.setXYZ(i, d.x + jx, d.y + jy, 1);

      // Color per variant
      let r: number, g: number, bl: number;
      if (this.variant === 3) {
        // Slowly shift hue between primary and secondary
        const colorT = (Math.sin(this.colorShiftTimer * 0.3 + d.phase) * 0.5 + 0.5) * shimmer;
        r = dim.r + (secondary.r - dim.r) * colorT + (primary.r - secondary.r) * shimmer * 0.3;
        g = dim.g + (secondary.g - dim.g) * colorT + (primary.g - secondary.g) * shimmer * 0.3;
        bl = dim.b + (secondary.b - dim.b) * colorT + (primary.b - secondary.b) * shimmer * 0.3;
      } else {
        // Brightness varies with shimmer
        r = dim.r + (primary.r - dim.r) * shimmer;
        g = dim.g + (primary.g - dim.g) * shimmer;
        bl = dim.b + (primary.b - dim.b) * shimmer;
      }
      colors.setXYZ(i, Math.max(0, r), Math.max(0, g), Math.max(0, bl));
    }

    positions.needsUpdate = true;
    colors.needsUpdate = true;

    (this.pointsMesh.material as THREE.PointsMaterial).opacity = opacity * this.baseIntensity;
    (this.borderMesh.material as THREE.LineBasicMaterial).opacity = opacity * 0.25;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Burst all dots outward randomly
      for (const d of this.dots) {
        d.vx += (this.rng.next() - 0.5) * 80;
        d.vy += (this.rng.next() - 0.5) * 40;
      }
    }
    if (action === 'alert') {
      this.alertMode = true;
      this.baseIntensity = 1.5;
      setTimeout(() => {
        this.alertMode = false;
        this.baseIntensity = 1;
      }, 2000);
    }
    if (action === 'pulse') {
      this.baseIntensity = 2.0;
      setTimeout(() => { this.baseIntensity = 1; }, 400);
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) {
      this.alertMode = false;
      this.baseIntensity = 1;
      return;
    }
    this.baseIntensity = 1 + level * 0.15;
    if (level >= 3) {
      // Increase drift speed of all dots
      const kick = level * 12;
      for (const d of this.dots) {
        d.vx += (this.rng.next() - 0.5) * kick;
        d.vy += (this.rng.next() - 0.5) * kick * 0.5;
      }
    }
    if (level >= 5) {
      this.alertMode = true;
      setTimeout(() => { this.alertMode = false; }, 1500);
    }
  }
}
