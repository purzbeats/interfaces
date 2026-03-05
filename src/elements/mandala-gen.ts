import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Procedural mandala generator with N-fold symmetry. Concentric rings of
 * geometric patterns. Layers rotate at different speeds creating a
 * kaleidoscopic effect.
 */
export class MandalaGenElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'mandala-gen',
    meta: { shape: 'radial', roles: ['decorative'], moods: ['ambient'], bandAffinity: 'sub', sizes: ['needs-medium', 'needs-large'] },
  };

  private rings: { line: THREE.Line; mat: THREE.LineBasicMaterial; speed: number; baseRadius: number }[] = [];
  private cx: number = 0;
  private cy: number = 0;
  private maxRadius: number = 0;
  private symmetry: number = 6;
  private ringCount: number = 5;
  private pointsPerRing: number = 0;

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;
    this.cx = x + w / 2;
    this.cy = y + h / 2;
    this.maxRadius = Math.min(w, h) * 0.44;

    const variant = this.rng.int(0, 3);
    const presets = [
      { sym: 6, rings: 5, ptsPerSector: 12 },
      { sym: 8, rings: 6, ptsPerSector: 10 },
      { sym: 12, rings: 4, ptsPerSector: 8 },
      { sym: 5, rings: 7, ptsPerSector: 14 },
    ];
    const pr = presets[variant];
    this.symmetry = pr.sym;
    this.ringCount = pr.rings;
    this.pointsPerRing = pr.ptsPerSector * pr.sym + 1; // +1 to close loop

    for (let r = 0; r < this.ringCount; r++) {
      const positions = new Float32Array(this.pointsPerRing * 3);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

      const t = r / (this.ringCount - 1);
      const color = new THREE.Color().copy(this.palette.dim).lerp(this.palette.primary, t);
      const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0 });
      const line = new THREE.Line(geo, mat);

      const speed = (r % 2 === 0 ? 1 : -1) * this.rng.float(0.05, 0.2);
      const baseRadius = this.maxRadius * (0.15 + 0.85 * (r + 1) / this.ringCount);

      this.rings.push({ line, mat, speed, baseRadius });
      this.group.add(line);
    }
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    const N = this.symmetry;
    const sectorAngle = (Math.PI * 2) / N;

    for (let ri = 0; ri < this.rings.length; ri++) {
      const ring = this.rings[ri];
      const pos = ring.line.geometry.getAttribute('position') as THREE.BufferAttribute;
      const arr = pos.array as Float32Array;
      const rot = time * ring.speed;
      const R = ring.baseRadius;
      const ptsPerSector = (this.pointsPerRing - 1) / N;

      let idx = 0;
      for (let s = 0; s < N; s++) {
        const sectorBase = s * sectorAngle + rot;
        for (let p = 0; p < ptsPerSector; p++) {
          const t = p / ptsPerSector;
          const angle = sectorBase + t * sectorAngle;

          // Radial modulation: petal shapes with harmonic variation
          const mod1 = Math.cos(N * angle * 0.5 + time * 0.3 * (ri + 1));
          const mod2 = Math.sin(N * 2 * angle + time * 0.2);
          const rMod = R * (1 + 0.15 * mod1 + 0.08 * mod2);

          // Additional radial breathing per ring
          const breath = 1 + 0.05 * Math.sin(time * 0.5 + ri * 0.7);
          const finalR = rMod * breath;

          arr[idx++] = this.cx + Math.cos(angle) * finalR;
          arr[idx++] = this.cy + Math.sin(angle) * finalR;
          arr[idx++] = 0;
        }
      }
      // Close the loop
      arr[idx] = arr[0];
      arr[idx + 1] = arr[1];
      arr[idx + 2] = 0;

      pos.needsUpdate = true;
      ring.mat.opacity = opacity * (0.3 + 0.5 * (ri / this.rings.length));
    }
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') this.glitchTimer = 0.5;
    if (action === 'alert') {
      // Randomize rotation speeds
      for (const ring of this.rings) {
        ring.speed = (this.rng.chance(0.5) ? 1 : -1) * this.rng.float(0.1, 0.4);
      }
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level >= 2) {
      for (const ring of this.rings) {
        ring.speed *= 1 + level * 0.1;
      }
    }
  }
}
