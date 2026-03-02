import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Three nested rotating rings like a gyroscope/gimbal.
 * Each ring rotates around a different axis, simulated in 2D by squishing.
 */
export class GyroscopeElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'gyroscope',
    meta: { shape: 'radial', roles: ['decorative', 'gauge'], moods: ['tactical', 'diagnostic'], sizes: ['needs-medium', 'needs-large'] },
  };
  private rings: THREE.Line[] = [];
  private speeds: number[] = [];
  private segments: number = 64;

  build(): void {
    this.glitchAmount = 5;
    const { x, y, w, h } = this.px;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const maxR = Math.min(w, h) / 2 * 0.9;
    const colors = [this.palette.primary, this.palette.secondary, this.palette.dim];

    this.speeds = [
      this.rng.float(0.8, 1.5),
      this.rng.float(1.2, 2.2),
      this.rng.float(0.5, 1.0),
    ];

    for (let r = 0; r < 3; r++) {
      const radius = maxR * (0.5 + r * 0.2);
      const positions = new Float32Array((this.segments + 1) * 3);
      for (let i = 0; i <= this.segments; i++) {
        const a = (i / this.segments) * Math.PI * 2;
        positions[i * 3] = cx + Math.cos(a) * radius;
        positions[i * 3 + 1] = cy + Math.sin(a) * radius;
        positions[i * 3 + 2] = 1;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const ring = new THREE.Line(geo, new THREE.LineBasicMaterial({
        color: colors[r],
        transparent: true,
        opacity: 0,
      }));
      this.rings.push(ring);
      this.group.add(ring);
    }

    // Center dot
    const dotGeo = new THREE.CircleGeometry(Math.max(2, maxR * 0.03), 12);
    const dot = new THREE.Mesh(dotGeo, new THREE.MeshBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
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

    for (let r = 0; r < 3; r++) {
      const radius = maxR * (0.5 + r * 0.2);
      const positions = this.rings[r].geometry.getAttribute('position') as THREE.BufferAttribute;
      const t = time * this.speeds[r];

      for (let i = 0; i <= this.segments; i++) {
        const a = (i / this.segments) * Math.PI * 2;
        let px: number, py: number;

        if (r === 0) {
          // Ring 1: rotate around Y — squish X
          const squish = Math.cos(t);
          px = cx + Math.cos(a) * radius * squish + gx;
          py = cy + Math.sin(a) * radius;
        } else if (r === 1) {
          // Ring 2: rotate around X — squish Y
          const squish = Math.cos(t);
          px = cx + Math.cos(a) * radius + gx;
          py = cy + Math.sin(a) * radius * squish;
        } else {
          // Ring 3: rotate around Z — standard rotation
          const ra = a + t;
          px = cx + Math.cos(ra) * radius + gx;
          py = cy + Math.sin(ra) * radius;
        }

        positions.setXYZ(i, px, py, 1);
      }
      positions.needsUpdate = true;
      (this.rings[r].material as THREE.LineBasicMaterial).opacity = opacity * 0.8;
    }

    // Center dot
    const dot = this.group.children[3] as THREE.Mesh;
    dot.position.x = cx + gx;
    (dot.material as THREE.MeshBasicMaterial).opacity = opacity * 0.6;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      for (let i = 0; i < 3; i++) this.speeds[i] *= 5;
      setTimeout(() => { for (let i = 0; i < 3; i++) this.speeds[i] /= 5; }, 500);
    }
    if (action === 'alert') {
      this.pulseTimer = 2.0;
    }
  }
}
