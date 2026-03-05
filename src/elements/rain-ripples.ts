import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

interface Ripple {
  cx: number;
  cy: number;
  birthTime: number;
  maxRadius: number;
  speed: number;
  lifetime: number;
}

/**
 * Raindrops hitting a surface creating expanding circular ripples.
 * Multiple drops at random times/positions. Ripples expand and fade.
 */
export class RainRipplesElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'rain-ripples',
    meta: {
      shape: 'rectangular',
      roles: ['decorative'],
      moods: ['ambient'],
      bandAffinity: 'high',
      sizes: ['works-small', 'needs-medium', 'needs-large'],
    },
  };

  private lineMesh!: THREE.LineSegments;
  private ripples: Ripple[] = [];
  private maxRipples: number = 0;
  private segments: number = 0;
  private maxSegmentsTotal: number = 0;
  private dropInterval: number = 0;
  private dropTimer: number = 0;
  private rippleLifetime: number = 0;
  private rippleSpeed: number = 0;
  private elapsed: number = 0;

  build(): void {
    this.glitchAmount = 4;

    const variant = this.rng.int(0, 3);
    const presets = [
      { maxRipples: 24, segments: 24, interval: 0.25, lifetime: 2.0, speed: 60 },
      { maxRipples: 40, segments: 32, interval: 0.1, lifetime: 1.5, speed: 80 },
      { maxRipples: 14, segments: 20, interval: 0.5, lifetime: 3.0, speed: 40 },
      { maxRipples: 30, segments: 28, interval: 0.15, lifetime: 1.8, speed: 70 },
    ];
    const p = presets[variant];
    this.maxRipples = p.maxRipples;
    this.segments = p.segments;
    this.dropInterval = p.interval;
    this.rippleLifetime = p.lifetime;
    this.rippleSpeed = p.speed;
    this.dropTimer = 0;

    // Each ripple is drawn as segments line pairs forming a circle
    // Each circle has `segments` line segments -> segments * 2 vertices
    this.maxSegmentsTotal = this.maxRipples * this.segments;
    const positions = new Float32Array(this.maxSegmentsTotal * 2 * 3);
    const colors = new Float32Array(this.maxSegmentsTotal * 2 * 3);

    // Fill with off-screen positions initially
    for (let i = 0; i < this.maxSegmentsTotal * 2; i++) {
      positions[i * 3] = -9999;
      positions[i * 3 + 1] = -9999;
      positions[i * 3 + 2] = 0;
      colors[i * 3] = this.palette.primary.r;
      colors[i * 3 + 1] = this.palette.primary.g;
      colors[i * 3 + 2] = this.palette.primary.b;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setDrawRange(0, 0);

    this.lineMesh = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.lineMesh);
  }

  private spawnRipple(): void {
    const { x, y, w, h } = this.px;
    const ripple: Ripple = {
      cx: x + this.rng.float(0.1, 0.9) * w,
      cy: y + this.rng.float(0.1, 0.9) * h,
      birthTime: this.elapsed,
      maxRadius: this.rng.float(0.6, 1.2) * Math.min(w, h) * 0.35,
      speed: this.rippleSpeed * this.rng.float(0.8, 1.2),
      lifetime: this.rippleLifetime * this.rng.float(0.8, 1.2),
    };
    this.ripples.push(ripple);

    // Remove old ripples if over limit
    while (this.ripples.length > this.maxRipples) {
      this.ripples.shift();
    }
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);
    this.elapsed += dt;

    // Spawn new drops
    this.dropTimer += dt;
    while (this.dropTimer >= this.dropInterval) {
      this.dropTimer -= this.dropInterval;
      this.spawnRipple();
    }

    // Remove expired ripples
    this.ripples = this.ripples.filter(r => (this.elapsed - r.birthTime) < r.lifetime);

    const posAttr = this.lineMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const colAttr = this.lineMesh.geometry.getAttribute('color') as THREE.BufferAttribute;

    let segIdx = 0;

    for (let ri = 0; ri < this.ripples.length && segIdx + this.segments <= this.maxSegmentsTotal; ri++) {
      const r = this.ripples[ri];
      const age = this.elapsed - r.birthTime;
      const lifeFrac = age / r.lifetime;
      const radius = age * r.speed;
      const alpha = Math.max(0, (1 - lifeFrac) * 1.4);

      // Choose color based on age
      const col = lifeFrac < 0.4 ? this.palette.primary : this.palette.secondary;
      const cr = col.r * alpha;
      const cg = col.g * alpha;
      const cb = col.b * alpha;

      for (let s = 0; s < this.segments; s++) {
        const a0 = (s / this.segments) * Math.PI * 2;
        const a1 = ((s + 1) / this.segments) * Math.PI * 2;

        const vi = segIdx * 2;
        posAttr.setXYZ(vi, r.cx + Math.cos(a0) * radius, r.cy + Math.sin(a0) * radius, 0);
        posAttr.setXYZ(vi + 1, r.cx + Math.cos(a1) * radius, r.cy + Math.sin(a1) * radius, 0);

        colAttr.setXYZ(vi, cr, cg, cb);
        colAttr.setXYZ(vi + 1, cr, cg, cb);
        segIdx++;
      }
    }

    // Clear remaining segments
    for (let i = segIdx; i < this.maxSegmentsTotal; i++) {
      const vi = i * 2;
      posAttr.setXYZ(vi, -9999, -9999, 0);
      posAttr.setXYZ(vi + 1, -9999, -9999, 0);
    }

    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
    this.lineMesh.geometry.setDrawRange(0, segIdx * 2);
    (this.lineMesh.material as THREE.LineBasicMaterial).opacity = opacity;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Burst of drops
      for (let i = 0; i < 5; i++) {
        this.spawnRipple();
      }
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level >= 2) {
      this.dropInterval = Math.max(0.05, this.dropInterval - level * 0.05);
      this.rippleSpeed = 40 + level * 10;
    }
  }
}
