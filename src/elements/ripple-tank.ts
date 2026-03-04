import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Expanding concentric circular ripples emanating from center.
 * Circles fade as they grow and reset when they reach max radius,
 * creating a continuous ripple-tank effect.
 */
export class RippleTankElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'ripple-tank',
    meta: { shape: 'radial', roles: ['decorative'], moods: ['ambient'], sizes: ['needs-medium', 'needs-large'] },
  };

  private rings: THREE.Line[] = [];
  private phases: number[] = [];
  private ringCount: number = 0;
  private cx: number = 0;
  private cy: number = 0;
  private maxRadius: number = 0;
  private speed: number = 0;
  private segments: number = 64;

  build(): void {
    const { x, y, w, h } = this.px;
    this.cx = x + w / 2;
    this.cy = y + h / 2;
    this.maxRadius = Math.min(w, h) * 0.46;

    const variant = this.rng.int(0, 4);
    const presets = [
      { count: 5, speed: 0.35 },
      { count: 7, speed: 0.25 },
      { count: 4, speed: 0.45 },
      { count: 6, speed: 0.30 },
    ];
    const p = presets[variant];
    this.ringCount = p.count;
    this.speed = p.speed;

    for (let i = 0; i < this.ringCount; i++) {
      // Stagger phases evenly so rings are spaced out
      this.phases.push(i / this.ringCount);

      const positions = new Float32Array((this.segments + 1) * 3);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const ring = new THREE.Line(geo, new THREE.LineBasicMaterial({
        color: i === 0 ? this.palette.primary : this.palette.secondary,
        transparent: true,
        opacity: 0,
      }));
      this.group.add(ring);
      this.rings.push(ring);
    }
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);

    for (let i = 0; i < this.ringCount; i++) {
      // Phase loops from 0 to 1
      const phase = (this.phases[i] + time * this.speed) % 1;
      const radius = phase * this.maxRadius;
      // Fade out as ring expands: bright near center, transparent at edge
      const ringOpacity = opacity * (1 - phase) * 0.7;

      const pos = this.rings[i].geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let s = 0; s <= this.segments; s++) {
        const a = (s / this.segments) * Math.PI * 2;
        pos.setXYZ(s, this.cx + Math.cos(a) * radius, this.cy + Math.sin(a) * radius, 0);
      }
      pos.needsUpdate = true;

      (this.rings[i].material as THREE.LineBasicMaterial).opacity = Math.max(ringOpacity, 0);
    }
  }
}
