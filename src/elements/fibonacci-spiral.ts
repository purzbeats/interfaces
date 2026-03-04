import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * A golden/logarithmic spiral that slowly rotates with a breathing
 * grow/contract effect. The trail fades from bright at the outer end
 * to dim near the center using multiple line segments.
 */
export class FibonacciSpiralElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'fibonacci-spiral',
    meta: { shape: 'radial', roles: ['decorative'], moods: ['ambient'], sizes: ['needs-medium', 'needs-large'] },
  };

  private spiralSegments: THREE.Line[] = [];
  private cx: number = 0;
  private cy: number = 0;
  private maxRadius: number = 0;
  private totalPoints: number = 0;
  private segmentSize: number = 0;
  private segmentCount: number = 0;
  private rotSpeed: number = 0;
  private breathSpeed: number = 0;
  private breathAmp: number = 0;
  private growthRate: number = 0;
  private maxTurns: number = 0;

  build(): void {
    const { x, y, w, h } = this.px;
    this.cx = x + w / 2;
    this.cy = y + h / 2;
    this.maxRadius = Math.min(w, h) * 0.44;

    const variant = this.rng.int(0, 4);
    const presets = [
      { points: 200, segments: 10, rotSpeed: 0.15, breathSpeed: 0.4, breathAmp: 0.12, growth: 0.1, turns: 4 },
      { points: 300, segments: 15, rotSpeed: 0.10, breathSpeed: 0.3, breathAmp: 0.08, growth: 0.08, turns: 5 },
      { points: 250, segments: 12, rotSpeed: 0.20, breathSpeed: 0.5, breathAmp: 0.15, growth: 0.12, turns: 3.5 },
      { points: 180, segments: 8, rotSpeed: 0.25, breathSpeed: 0.6, breathAmp: 0.10, growth: 0.15, turns: 3 },
    ];
    const p = presets[variant];

    this.totalPoints = p.points;
    this.segmentCount = p.segments;
    this.segmentSize = Math.floor(this.totalPoints / this.segmentCount);
    this.rotSpeed = p.rotSpeed;
    this.breathSpeed = p.breathSpeed;
    this.breathAmp = p.breathAmp;
    this.growthRate = p.growth;
    this.maxTurns = p.turns;

    // Create segments with fading opacity (bright at outer, dim at center)
    for (let s = 0; s < this.segmentCount; s++) {
      // Extra point for overlap between segments
      const count = this.segmentSize + 1;
      const positions = new Float32Array(count * 3);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

      // Lerp color from dim (center) to primary (outer)
      const t = s / (this.segmentCount - 1);
      const color = new THREE.Color().copy(this.palette.dim).lerp(this.palette.primary, t);

      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity: 0,
      }));
      this.group.add(line);
      this.spiralSegments.push(line);
    }
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    const rotation = time * this.rotSpeed;
    const breathScale = 1 + this.breathAmp * Math.sin(time * this.breathSpeed * Math.PI * 2);

    // Golden ratio for logarithmic spiral
    const phi = 1.618033988749895;
    const b = Math.log(phi) / (Math.PI * 0.5); // growth factor

    for (let s = 0; s < this.segmentCount; s++) {
      const startIdx = s * this.segmentSize;
      const count = this.segmentSize + 1;
      const pos = this.spiralSegments[s].geometry.getAttribute('position') as THREE.BufferAttribute;

      for (let i = 0; i < count; i++) {
        const idx = startIdx + i;
        if (idx >= this.totalPoints) {
          // Clamp to last valid point
          const t = (this.totalPoints - 1) / (this.totalPoints - 1);
          const angle = t * this.maxTurns * Math.PI * 2 + rotation;
          const r = this.maxRadius * this.growthRate * Math.exp(b * t * this.maxTurns * Math.PI * 2 / (Math.PI * 2)) * breathScale;
          const clampedR = Math.min(r, this.maxRadius * breathScale);
          pos.setXYZ(i, this.cx + Math.cos(angle) * clampedR, this.cy + Math.sin(angle) * clampedR, 0);
          continue;
        }
        const t = idx / (this.totalPoints - 1);
        const angle = t * this.maxTurns * Math.PI * 2 + rotation;
        // Logarithmic spiral: r = a * e^(b*theta)
        const r = this.maxRadius * this.growthRate * Math.exp(b * t * this.maxTurns * Math.PI * 2 / (Math.PI * 2)) * breathScale;
        const clampedR = Math.min(r, this.maxRadius * breathScale);
        pos.setXYZ(i, this.cx + Math.cos(angle) * clampedR, this.cy + Math.sin(angle) * clampedR, 0);
      }
      pos.needsUpdate = true;

      // Opacity fades from dim at center (segment 0) to bright at outer edge
      const segT = s / (this.segmentCount - 1);
      const segOpacity = opacity * (0.2 + 0.6 * segT);
      (this.spiralSegments[s].material as THREE.LineBasicMaterial).opacity = segOpacity;
    }
  }
}
