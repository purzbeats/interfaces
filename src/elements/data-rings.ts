import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Multiple concentric data rings with gaps, like a circular barcode.
 * Each ring rotates at a different speed with random arc segments missing.
 */
export class DataRingsElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'data-rings',
    meta: { shape: 'radial', roles: ['data-display', 'decorative'], moods: ['diagnostic', 'ambient'], sizes: ['needs-medium', 'needs-large'] },
  };
  private rings: THREE.LineSegments[] = [];
  private ringAngles: number[] = [];
  private ringSpeeds: number[] = [];
  private ringCount: number = 0;
  private ringRadii: number[] = [];
  private ringGaps: Array<Array<{ start: number; size: number }>> = [];
  private segments: number = 64;

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;
    const maxR = Math.min(w, h) / 2 * 0.9;
    const minR = maxR * 0.25;

    this.ringCount = this.rng.int(4, 8);
    const colors = [this.palette.primary, this.palette.secondary, this.palette.dim];

    for (let r = 0; r < this.ringCount; r++) {
      const radius = minR + (maxR - minR) * (r / (this.ringCount - 1));
      this.ringRadii.push(radius);
      this.ringSpeeds.push(this.rng.float(-0.5, 0.5));
      this.ringAngles.push(0);

      // Generate gap data
      const gapCount = this.rng.int(2, 6);
      const gaps: Array<{ start: number; size: number }> = [];
      for (let g = 0; g < gapCount; g++) {
        gaps.push({
          start: this.rng.float(0, Math.PI * 2),
          size: this.rng.float(0.15, 0.6),
        });
      }
      this.ringGaps.push(gaps);

      // Build initial geometry (will be updated each frame)
      const maxVerts = this.segments * 2 * 3; // max possible pairs
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(maxVerts), 3));
      geo.setDrawRange(0, 0);
      const ring = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
        color: colors[r % colors.length],
        transparent: true,
        opacity: 0,
      }));
      this.rings.push(ring);
      this.group.add(ring);
    }

    // Center dot
    const cx = x + w / 2;
    const cy = y + h / 2;
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
    const gx = this.group.position.x;

    for (let r = 0; r < this.ringCount; r++) {
      this.ringAngles[r] += dt * this.ringSpeeds[r];
      const rotation = this.ringAngles[r];
      const radius = this.ringRadii[r];
      const gaps = this.ringGaps[r];
      const positions = this.rings[r].geometry.getAttribute('position') as THREE.BufferAttribute;

      let vertIdx = 0;
      for (let i = 0; i < this.segments; i++) {
        const a1 = (i / this.segments) * Math.PI * 2 + rotation;
        const a2 = ((i + 1) / this.segments) * Math.PI * 2 + rotation;
        const midA = ((i + 0.5) / this.segments) * Math.PI * 2 + rotation;

        // Normalize midA to [0, 2PI) for gap check
        const normA = ((midA % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);

        let inGap = false;
        for (const gap of gaps) {
          const gStart = ((gap.start % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
          const gEnd = gStart + gap.size;
          if (normA >= gStart && normA <= gEnd) {
            inGap = true;
            break;
          }
          // Handle wrap-around
          if (gEnd > Math.PI * 2 && normA <= gEnd - Math.PI * 2) {
            inGap = true;
            break;
          }
        }

        if (!inGap) {
          positions.setXYZ(vertIdx++, cx + Math.cos(a1) * radius + gx, cy + Math.sin(a1) * radius, 1);
          positions.setXYZ(vertIdx++, cx + Math.cos(a2) * radius + gx, cy + Math.sin(a2) * radius, 1);
        }
      }

      positions.needsUpdate = true;
      this.rings[r].geometry.setDrawRange(0, vertIdx);
      (this.rings[r].material as THREE.LineBasicMaterial).opacity = opacity * 0.7;
    }

    // Center dot
    const dot = this.group.children[this.ringCount] as THREE.Mesh;
    dot.position.x = cx + gx;
    (dot.material as THREE.MeshBasicMaterial).opacity = opacity * 0.6;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      for (let i = 0; i < this.ringCount; i++) {
        this.ringSpeeds[i] *= 8;
      }
      setTimeout(() => {
        for (let i = 0; i < this.ringCount; i++) {
          this.ringSpeeds[i] /= 8;
        }
      }, 500);
    }
    if (action === 'alert') {
      this.pulseTimer = 2.0;
    }
  }
}
