import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';
import { hexagonPoints } from '../layout/hex-grid';

/**
 * Concentric expanding rings that ripple outward from center.
 * Each ring spawns at center and grows outward, fading as it expands.
 */
export class ConcentricRingsElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'concentric-rings',
    meta: { shape: 'radial', roles: ['decorative'], moods: ['ambient'], bandAffinity: 'bass', sizes: ['needs-medium'] },
  };
  private ringMeshes: THREE.Line[] = [];
  private ringPhases: number[] = [];
  private maxRings: number = 0;
  private rippleSpeed: number = 0;
  private segments: number = 0;
  private isHex: boolean = false;
  private _fadeExp: number = 0;

  build(): void {
    const variant = this.rng.int(0, 3);
    const presets = [
      { ringMin: 5, ringMax: 10, speedMin: 0.3, speedMax: 0.8, segments: 64, fadeExp: 1.0 },
      { ringMin: 12, ringMax: 20, speedMin: 0.6, speedMax: 1.5, segments: 96, fadeExp: 0.7 },
      { ringMin: 3, ringMax: 5, speedMin: 0.15, speedMax: 0.35, segments: 48, fadeExp: 1.5 },
      { ringMin: 8, ringMax: 15, speedMin: 1.0, speedMax: 2.0, segments: 64, fadeExp: 0.5 },
    ];
    const p = presets[variant];

    const { x, y, w, h } = this.px;
    const cx = x + w / 2;
    const cy = y + h / 2;
    this.maxRings = this.rng.int(p.ringMin, p.ringMax);
    this.rippleSpeed = this.rng.float(p.speedMin, p.speedMax);
    this.segments = p.segments;
    this.isHex = !!this.region.hexCell;
    this._fadeExp = p.fadeExp;

    for (let i = 0; i < this.maxRings; i++) {
      const positions = new Float32Array((this.segments + 1) * 3);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const ring = new THREE.Line(geo, new THREE.LineBasicMaterial({
        color: i % 2 === 0 ? this.palette.primary : this.palette.secondary,
        transparent: true,
        opacity: 0,
      }));
      this.ringMeshes.push(ring);
      this.ringPhases.push(i / this.maxRings); // staggered
      this.group.add(ring);
    }

    // Center dot
    const maxR = Math.min(w, h) / 2 * 0.9;
    const dotGeo = new THREE.CircleGeometry(Math.max(3, maxR * 0.02), 16);
    const dot = new THREE.Mesh(dotGeo, new THREE.MeshBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0.6,
    }));
    dot.position.set(cx, cy, 2);
    this.group.add(dot);
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    const { x, y, w, h } = this.px;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const maxR = Math.min(w, h) / 2 * 0.9;
    const gx = this.group.position.x;

    for (let i = 0; i < this.maxRings; i++) {
      this.ringPhases[i] = (this.ringPhases[i] + dt * this.rippleSpeed) % 1;
      const phase = this.ringPhases[i];
      const radius = phase * maxR;

      // Ease out the expansion — starts fast, slows down
      const easedRadius = maxR * (1 - Math.pow(1 - phase, 2.5));
      const fadeOut = Math.pow(1 - phase, this._fadeExp); // fade as it expands

      const positions = this.ringMeshes[i].geometry.getAttribute('position') as THREE.BufferAttribute;
      if (this.isHex) {
        const ptsPerEdge = Math.max(1, Math.floor(this.segments / 6));
        const pts = hexagonPoints(cx + gx, cy, easedRadius, ptsPerEdge);
        for (let s = 0; s <= this.segments; s++) {
          const pt = pts[s % pts.length];
          positions.setXYZ(s, pt.x, pt.y, 1);
        }
      } else {
        for (let s = 0; s <= this.segments; s++) {
          const a = (s / this.segments) * Math.PI * 2;
          positions.setXYZ(s, cx + Math.cos(a) * easedRadius + gx, cy + Math.sin(a) * easedRadius, 1);
        }
      }
      positions.needsUpdate = true;

      (this.ringMeshes[i].material as THREE.LineBasicMaterial).opacity = opacity * fadeOut * 0.85;
    }

    // Update center dot
    const dot = this.group.children[this.group.children.length - 1] as THREE.Mesh;
    dot.position.x = cx + gx;
    (dot.material as THREE.MeshBasicMaterial).opacity = opacity * 0.6;
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) return;
    // Reset all ring phases for a burst effect
    for (let i = 0; i < this.maxRings; i++) {
      this.ringPhases[i] = 0;
    }
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'pulse') {
      // Reset all rings to center for a burst effect
      for (let i = 0; i < this.maxRings; i++) {
        this.ringPhases[i] = i * 0.05;
      }
    }
    if (action === 'alert') {
      this.rippleSpeed *= 2.5;
    }
  }
}
