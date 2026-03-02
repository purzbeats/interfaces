import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Converging radial lines with expanding depth rings.
 * Radial LineSegments from vanishing point + rings that spawn at center and expand.
 */
export class WarpTunnelElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'warp-tunnel',
    meta: { shape: 'radial', roles: ['decorative'], moods: ['ambient'], sizes: ['needs-medium', 'needs-large'] },
  };
  private radialLines!: THREE.LineSegments;
  private rings: THREE.Line[] = [];
  private ringRadii: number[] = [];
  private maxRadius: number = 0;
  private spawnTimer: number = 0;
  private spawnInterval: number = 0;
  private nextRing: number = 0;
  private expandSpeed: number = 0;

  build(): void {
    this.glitchAmount = 5;
    const { x, y, w, h } = this.px;
    const cx = x + w / 2;
    const cy = y + h / 2;
    this.maxRadius = Math.sqrt(w * w + h * h) / 2;
    this.spawnInterval = this.rng.float(0.3, 0.8);
    this.expandSpeed = this.rng.float(80, 200);

    // Radial lines from center
    const rayCount = this.rng.int(12, 24);
    const rayVerts: number[] = [];
    for (let i = 0; i < rayCount; i++) {
      const a = (i / rayCount) * Math.PI * 2;
      rayVerts.push(cx, cy, 0);
      rayVerts.push(cx + Math.cos(a) * this.maxRadius, cy + Math.sin(a) * this.maxRadius, 0);
    }
    const rayGeo = new THREE.BufferGeometry();
    rayGeo.setAttribute('position', new THREE.Float32BufferAttribute(rayVerts, 3));
    this.radialLines = new THREE.LineSegments(rayGeo, new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.radialLines);

    // Ring pool
    const ringCount = 8;
    const segments = 48;
    for (let r = 0; r < ringCount; r++) {
      const verts = new Float32Array((segments + 1) * 3);
      for (let i = 0; i <= segments; i++) {
        const a = (i / segments) * Math.PI * 2;
        verts[i * 3] = cx + Math.cos(a);
        verts[i * 3 + 1] = cy + Math.sin(a);
        verts[i * 3 + 2] = 1;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
      const ring = new THREE.Line(geo, new THREE.LineBasicMaterial({
        color: this.palette.primary,
        transparent: true,
        opacity: 0,
      }));
      this.rings.push(ring);
      this.ringRadii.push(-1);
      this.group.add(ring);
    }
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);
    const { x, y, w, h } = this.px;
    const cx = x + w / 2;
    const cy = y + h / 2;

    // Spawn rings
    this.spawnTimer += dt;
    if (this.spawnTimer >= this.spawnInterval) {
      this.spawnTimer = 0;
      this.ringRadii[this.nextRing] = 1;
      this.nextRing = (this.nextRing + 1) % this.rings.length;
    }

    // Expand rings
    const segments = 48;
    for (let r = 0; r < this.rings.length; r++) {
      if (this.ringRadii[r] < 0) {
        (this.rings[r].material as THREE.LineBasicMaterial).opacity = 0;
        continue;
      }
      this.ringRadii[r] += this.expandSpeed * dt;
      const fade = Math.max(0, 1 - this.ringRadii[r] / this.maxRadius);

      if (this.ringRadii[r] > this.maxRadius) {
        this.ringRadii[r] = -1;
        continue;
      }

      const pos = this.rings[r].geometry.getAttribute('position') as THREE.BufferAttribute;
      const rad = this.ringRadii[r];
      for (let i = 0; i <= segments; i++) {
        const a = (i / segments) * Math.PI * 2;
        pos.setXY(i, cx + Math.cos(a) * rad, cy + Math.sin(a) * rad);
      }
      pos.needsUpdate = true;
      (this.rings[r].material as THREE.LineBasicMaterial).opacity = opacity * fade * 0.7;
    }

    (this.radialLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.15;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      this.expandSpeed = this.rng.float(300, 600);
    }
    if (action === 'alert') {
      this.pulseTimer = 2.0;
      this.spawnInterval *= 0.3;
    }
  }
}
