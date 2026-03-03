import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Two electrode shapes with electric sparks jumping between them.
 * Jagged spark lines regenerate frequently for a crackling discharge effect.
 * Variants: horizontal gap, vertical gap, multiple gaps, with glow particles.
 */
export class SparkGapElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'spark-gap',
    meta: { shape: 'rectangular', roles: ['decorative', 'data-display'], moods: ['tactical', 'diagnostic'], bandAffinity: 'high', sizes: ['works-small', 'needs-medium'] },
  };

  private electrodes!: THREE.LineSegments;
  private sparks!: THREE.LineSegments[];
  private particles!: THREE.Points | null;

  private variant: number = 0;
  private gapCount: number = 1;
  private segmentsPerSpark: number = 12;
  private regenRate: number = 15;
  private regenAccums: number[] = [];
  private sparkSeeds: number[] = [];
  private vertical: boolean = false;
  private alertMode: boolean = false;
  private intensity: number = 1;

  build(): void {
    this.variant = this.rng.int(0, 3);
    this.glitchAmount = 6;

    const { x, y, w, h } = this.px;

    const presets = [
      // 0: horizontal gap, single spark
      { gapCount: 1, segMin: 10, segMax: 16, regenMin: 10, regenMax: 18, vertical: false, particles: false },
      // 1: vertical gap, single spark
      { gapCount: 1, segMin: 10, segMax: 16, regenMin: 12, regenMax: 20, vertical: true, particles: false },
      // 2: multiple gaps (horizontal)
      { gapCount: 3, segMin: 6, segMax: 10, regenMin: 15, regenMax: 30, vertical: false, particles: false },
      // 3: with glow particles
      { gapCount: 2, segMin: 8, segMax: 14, regenMin: 20, regenMax: 35, vertical: false, particles: true },
    ];
    const p = presets[this.variant];
    this.gapCount = p.gapCount;
    this.segmentsPerSpark = this.rng.int(p.segMin, p.segMax);
    this.regenRate = this.rng.float(p.regenMin, p.regenMax);
    this.vertical = p.vertical;

    for (let i = 0; i < this.gapCount; i++) {
      this.regenAccums.push(0);
      this.sparkSeeds.push(this.rng.float(0, 1000));
    }

    // --- Build electrodes ---
    // Each gap has a left electrode and a right electrode (or top/bottom if vertical)
    const eVerts: number[] = [];

    for (let g = 0; g < this.gapCount; g++) {
      const frac = this.gapCount > 1 ? (g + 0.5) / this.gapCount : 0.5;

      if (!this.vertical) {
        // Horizontal: electrodes on left and right sides
        const cy = y + h * frac;
        const elecH = h * (this.gapCount > 1 ? 0.22 : 0.38);
        const elecW = w * 0.12;

        // Left electrode (rect outline as 4 line segments)
        const lx = x + w * 0.06;
        eVerts.push(lx, cy - elecH, 0, lx + elecW, cy - elecH, 0);
        eVerts.push(lx + elecW, cy - elecH, 0, lx + elecW, cy + elecH, 0);
        eVerts.push(lx + elecW, cy + elecH, 0, lx, cy + elecH, 0);
        eVerts.push(lx, cy + elecH, 0, lx, cy - elecH, 0);
        // Tip indicator
        eVerts.push(lx + elecW, cy, 0, lx + elecW + w * 0.04, cy, 0);

        // Right electrode
        const rx = x + w * 0.82;
        eVerts.push(rx, cy - elecH, 0, rx + elecW, cy - elecH, 0);
        eVerts.push(rx + elecW, cy - elecH, 0, rx + elecW, cy + elecH, 0);
        eVerts.push(rx + elecW, cy + elecH, 0, rx, cy + elecH, 0);
        eVerts.push(rx, cy + elecH, 0, rx, cy - elecH, 0);
        eVerts.push(rx - w * 0.04, cy, 0, rx, cy, 0);
      } else {
        // Vertical: electrodes on top and bottom
        const cx = x + w * frac;
        const elecW = w * 0.38;
        const elecH = h * 0.1;

        // Top electrode
        const ty = y + h * 0.06;
        eVerts.push(cx - elecW, ty, 0, cx + elecW, ty, 0);
        eVerts.push(cx + elecW, ty, 0, cx + elecW, ty + elecH, 0);
        eVerts.push(cx + elecW, ty + elecH, 0, cx - elecW, ty + elecH, 0);
        eVerts.push(cx - elecW, ty + elecH, 0, cx - elecW, ty, 0);
        eVerts.push(cx, ty + elecH, 0, cx, ty + elecH + h * 0.04, 0);

        // Bottom electrode
        const by = y + h * 0.84;
        eVerts.push(cx - elecW, by, 0, cx + elecW, by, 0);
        eVerts.push(cx + elecW, by, 0, cx + elecW, by + elecH, 0);
        eVerts.push(cx + elecW, by + elecH, 0, cx - elecW, by + elecH, 0);
        eVerts.push(cx - elecW, by + elecH, 0, cx - elecW, by, 0);
        eVerts.push(cx, by - h * 0.04, 0, cx, by, 0);
      }
    }

    const eGeo = new THREE.BufferGeometry();
    eGeo.setAttribute('position', new THREE.Float32BufferAttribute(eVerts, 3));
    this.electrodes = new THREE.LineSegments(eGeo, new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.electrodes);

    // --- Build spark line slots (one per gap, pre-allocated) ---
    this.sparks = [];
    const maxVerts = this.segmentsPerSpark * 2 * 3;
    for (let g = 0; g < this.gapCount; g++) {
      const sGeo = new THREE.BufferGeometry();
      sGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(maxVerts), 3));
      sGeo.setDrawRange(0, 0);
      const spark = new THREE.LineSegments(sGeo, new THREE.LineBasicMaterial({
        color: this.palette.primary,
        transparent: true,
        opacity: 0,
      }));
      this.group.add(spark);
      this.sparks.push(spark);
    }

    // --- Optional glow particles ---
    this.particles = null;
    if (p.particles) {
      const particleCount = 40;
      const pPos = new Float32Array(particleCount * 3);
      // Scatter particles around the gap center(s)
      for (let i = 0; i < particleCount; i++) {
        const g = i % this.gapCount;
        const frac = this.gapCount > 1 ? (g + 0.5) / this.gapCount : 0.5;
        pPos[i * 3] = x + w * 0.5 + this.rng.float(-w * 0.15, w * 0.15);
        pPos[i * 3 + 1] = y + h * frac + this.rng.float(-h * 0.1, h * 0.1);
        pPos[i * 3 + 2] = 1.5;
      }
      const pGeo = new THREE.BufferGeometry();
      pGeo.setAttribute('position', new THREE.Float32BufferAttribute(pPos, 3));
      this.particles = new THREE.Points(pGeo, new THREE.PointsMaterial({
        color: this.palette.secondary,
        transparent: true,
        opacity: 0,
        size: 2.5,
        sizeAttenuation: false,
      }));
      this.group.add(this.particles);
    }
  }

  /** Generate a jagged spark path between two points into the geometry buffer. */
  private buildSpark(
    geo: THREE.BufferGeometry,
    x1: number, y1: number,
    x2: number, y2: number,
    segments: number,
    spread: number,
    seed: number
  ): number {
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    let vi = 0;
    let prevX = x1;
    let prevY = y1;

    for (let i = 1; i <= segments; i++) {
      const t = i / segments;
      const nx = x1 + (x2 - x1) * t;
      const envelope = Math.sin(t * Math.PI);
      const n1 = Math.sin(t * 41 + seed) * Math.cos(t * 23 + seed * 1.3);
      const n2 = Math.sin(t * 73 + seed * 0.7) * 0.5;
      const ny = y1 + (y2 - y1) * t + (n1 + n2) * spread * envelope;

      pos.setXYZ(vi++, prevX, prevY, 2);
      pos.setXYZ(vi++, nx, ny, 2);
      prevX = nx;
      prevY = ny;
    }
    pos.needsUpdate = true;
    return vi;
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    const { x, y, w, h } = this.px;
    const speedMul = this.alertMode ? 3.0 : 1.0 + (this.intensity - 1) * 0.5;

    (this.electrodes.material as THREE.LineBasicMaterial).opacity = opacity * 0.55;

    for (let g = 0; g < this.gapCount; g++) {
      this.regenAccums[g] += dt * speedMul;
      const interval = 1 / this.regenRate;

      if (this.regenAccums[g] >= interval) {
        this.regenAccums[g] = 0;
        this.sparkSeeds[g] = time * 137 + g * 53;

        const frac = this.gapCount > 1 ? (g + 0.5) / this.gapCount : 0.5;
        let x1: number, y1: number, x2: number, y2: number, spread: number;

        if (!this.vertical) {
          const cy = y + h * frac;
          x1 = x + w * 0.18;
          y1 = cy + this.rng.float(-h * 0.03, h * 0.03);
          x2 = x + w * 0.82;
          y2 = cy + this.rng.float(-h * 0.03, h * 0.03);
          spread = h * (this.gapCount > 1 ? 0.10 : 0.18);
        } else {
          const cx = x + w * frac;
          x1 = cx + this.rng.float(-w * 0.03, w * 0.03);
          y1 = y + h * 0.16;
          x2 = cx + this.rng.float(-w * 0.03, w * 0.03);
          y2 = y + h * 0.84;
          spread = w * 0.18;
        }

        const vi = this.buildSpark(
          this.sparks[g].geometry,
          x1, y1, x2, y2,
          this.segmentsPerSpark,
          spread,
          this.sparkSeeds[g]
        );
        this.sparks[g].geometry.setDrawRange(0, vi);
      }

      // Flicker the spark brightness
      const flicker = 0.6 + Math.sin(time * 29 + g * 7.3) * 0.25 + Math.sin(time * 53 + g * 3.1) * 0.15;
      const sparkMat = this.sparks[g].material as THREE.LineBasicMaterial;
      sparkMat.color.copy(this.alertMode ? this.palette.alert : this.palette.primary);
      sparkMat.opacity = opacity * flicker * (this.alertMode ? 1.0 : 0.85);
    }

    if (this.particles) {
      // Flicker particles around gaps
      const pFlicker = 0.3 + Math.sin(time * 17) * 0.2 + Math.sin(time * 41) * 0.1;
      (this.particles.material as THREE.PointsMaterial).opacity = opacity * pFlicker * 0.6;

      // Animate particle positions slightly
      const pos = this.particles.geometry.getAttribute('position') as THREE.BufferAttribute;
      const count = pos.count;
      for (let i = 0; i < count; i++) {
        const frac = this.gapCount > 1 ? ((i % this.gapCount) + 0.5) / this.gapCount : 0.5;
        const jitter = Math.sin(time * 7 + i * 1.7) * 2;
        pos.setX(i, x + w * 0.5 + Math.sin(time * 3.1 + i * 0.8) * w * 0.12 + jitter);
        pos.setY(i, y + h * frac + Math.cos(time * 4.7 + i * 1.1) * h * 0.08 + jitter);
      }
      pos.needsUpdate = true;
    }
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'alert') {
      this.alertMode = true;
      this.pulseTimer = 2.0;
      setTimeout(() => { this.alertMode = false; }, 3000);
    }
    if (action === 'glitch') {
      // Crackle faster during glitch
      this.regenRate *= 4;
      setTimeout(() => { this.regenRate /= 4; }, 400);
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    this.intensity = level;
    if (level === 0) {
      this.alertMode = false;
      return;
    }
    if (level >= 5) {
      this.alertMode = true;
      for (const s of this.sparks) {
        (s.material as THREE.LineBasicMaterial).color.copy(this.palette.alert);
      }
    } else if (level >= 3) {
      for (const s of this.sparks) {
        (s.material as THREE.LineBasicMaterial).color.copy(this.palette.secondary);
      }
    }
  }
}
