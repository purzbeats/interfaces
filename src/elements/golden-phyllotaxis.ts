import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Sunflower seed phyllotaxis: points placed at golden angle increments
 * with increasing radius, showing Fibonacci spiral patterns.
 * Points geometry with size and color variation.
 */
export class GoldenPhyllotaxisElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'golden-phyllotaxis',
    meta: {
      shape: 'radial',
      roles: ['decorative'],
      moods: ['ambient'],
      bandAffinity: 'bass',
      sizes: ['needs-medium', 'needs-large'],
    },
  };

  private points!: THREE.Points;
  private seedCount: number = 300;
  private cx: number = 0;
  private cy: number = 0;
  private maxRadius: number = 0;
  private spacing: number = 1;
  private rotSpeed: number = 0.1;
  private breathSpeed: number = 0.3;
  private breathAmp: number = 0.1;
  private divergenceAngle: number = 137.508; // golden angle in degrees
  private revealProgress: number = 0;
  private revealSpeed: number = 0.15;
  private basePositions!: Float32Array;

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;
    this.cx = x + w / 2;
    this.cy = y + h / 2;
    this.maxRadius = Math.min(w, h) * 0.44;

    const variant = this.rng.int(0, 3);
    const presets = [
      { seeds: 300, spacing: 1.0, rotSpeed: 0.1, breathSpeed: 0.3, breathAmp: 0.1, divergence: 137.508, revealSpeed: 0.15 },
      { seeds: 500, spacing: 0.7, rotSpeed: 0.05, breathSpeed: 0.2, breathAmp: 0.08, divergence: 137.508, revealSpeed: 0.1 },
      { seeds: 200, spacing: 1.3, rotSpeed: 0.15, breathSpeed: 0.5, breathAmp: 0.15, divergence: 137.508, revealSpeed: 0.25 },
      { seeds: 400, spacing: 0.85, rotSpeed: 0.08, breathSpeed: 0.4, breathAmp: 0.12, divergence: 137.3, revealSpeed: 0.12 }, // Slightly off golden angle
    ];
    const p = presets[variant];

    this.seedCount = p.seeds;
    this.spacing = p.spacing;
    this.rotSpeed = p.rotSpeed;
    this.breathSpeed = p.breathSpeed;
    this.breathAmp = p.breathAmp;
    this.divergenceAngle = p.divergence;
    this.revealSpeed = p.revealSpeed;

    const positions = new Float32Array(this.seedCount * 3);
    this.basePositions = new Float32Array(this.seedCount * 3);
    const colors = new Float32Array(this.seedCount * 3);
    const sizes = new Float32Array(this.seedCount);

    const goldenAngle = this.divergenceAngle * (Math.PI / 180);
    const radiusScale = this.maxRadius / Math.sqrt(this.seedCount);

    for (let i = 0; i < this.seedCount; i++) {
      const angle = i * goldenAngle;
      const r = radiusScale * Math.sqrt(i) * this.spacing;
      const px = this.cx + Math.cos(angle) * r;
      const py = this.cy + Math.sin(angle) * r;

      positions[i * 3] = px;
      positions[i * 3 + 1] = py;
      positions[i * 3 + 2] = 0;
      this.basePositions[i * 3] = px;
      this.basePositions[i * 3 + 1] = py;
      this.basePositions[i * 3 + 2] = 0;

      // Color: gradient from center (primary) to edge (secondary)
      const t = Math.sqrt(i / this.seedCount);
      const col = new THREE.Color().copy(this.palette.primary).lerp(this.palette.secondary, t);
      colors[i * 3] = col.r;
      colors[i * 3 + 1] = col.g;
      colors[i * 3 + 2] = col.b;

      // Size: larger at center, smaller at edge
      sizes[i] = Math.max(2, (1 - t) * 6 + 2);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

    this.points = new THREE.Points(geo, new THREE.PointsMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0,
      size: 4,
      sizeAttenuation: false,
    }));
    this.group.add(this.points);
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);

    this.revealProgress = Math.min(this.revealProgress + dt * this.revealSpeed, 1);
    const visibleCount = Math.floor(this.revealProgress * this.seedCount);
    this.points.geometry.setDrawRange(0, visibleCount);

    const breath = 1 + this.breathAmp * Math.sin(time * this.breathSpeed * Math.PI * 2);
    const rot = time * this.rotSpeed;

    const pos = this.points.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < visibleCount; i++) {
      const bx = this.basePositions[i * 3];
      const by = this.basePositions[i * 3 + 1];
      // Rotate around center
      const dx = bx - this.cx;
      const dy = by - this.cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const angle = Math.atan2(dy, dx) + rot;
      pos.setXYZ(i,
        this.cx + Math.cos(angle) * dist * breath,
        this.cy + Math.sin(angle) * dist * breath,
        0,
      );
    }
    pos.needsUpdate = true;

    (this.points.material as THREE.PointsMaterial).opacity = opacity;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Scramble divergence angle slightly
      this.divergenceAngle += this.rng.float(-2, 2);
      this.rebuildPositions();
      this.revealProgress = 0;
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) return;
    if (level >= 3) {
      this.breathAmp = 0.1 + level * 0.05;
    }
    if (level >= 5) {
      this.divergenceAngle = 137.508 + this.rng.float(-3, 3);
      this.rebuildPositions();
    }
  }

  private rebuildPositions(): void {
    const goldenAngle = this.divergenceAngle * (Math.PI / 180);
    const radiusScale = this.maxRadius / Math.sqrt(this.seedCount);
    for (let i = 0; i < this.seedCount; i++) {
      const angle = i * goldenAngle;
      const r = radiusScale * Math.sqrt(i) * this.spacing;
      this.basePositions[i * 3] = this.cx + Math.cos(angle) * r;
      this.basePositions[i * 3 + 1] = this.cy + Math.sin(angle) * r;
      this.basePositions[i * 3 + 2] = 0;
    }
  }
}
