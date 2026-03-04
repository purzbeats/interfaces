import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * A triangular prism with an incoming beam on the left that splits
 * into a fan of spectrum-colored rays on the right side.
 * Fan lines shimmer and wave gently over time.
 */
export class PrismSplitElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'prism-split',
    meta: { shape: 'linear', roles: ['decorative'], moods: ['ambient'], sizes: ['needs-medium'] },
  };

  private prismOutline!: THREE.Line;
  private inBeam!: THREE.Line;
  private fanLines: THREE.Line[] = [];
  private fanCount: number = 0;
  private fanBaseX: number = 0;
  private fanBaseY: number = 0;
  private fanLength: number = 0;
  private fanSpread: number = 0;

  build(): void {
    const { x, y, w, h } = this.px;

    const variant = this.rng.int(0, 4);
    const presets = [
      { fanCount: 7, spread: 0.35, prismSize: 0.25 },
      { fanCount: 9, spread: 0.40, prismSize: 0.22 },
      { fanCount: 5, spread: 0.30, prismSize: 0.28 },
      { fanCount: 11, spread: 0.45, prismSize: 0.20 },
    ];
    const p = presets[variant];
    this.fanCount = p.fanCount;
    this.fanSpread = p.spread;

    const cy = y + h / 2;
    // Prism triangle positioned in the left-center area
    const prismW = w * p.prismSize;
    const prismH = h * 0.6;
    const prismLeft = x + w * 0.25 - prismW / 2;
    const prismRight = prismLeft + prismW;
    const prismTop = cy - prismH / 2;
    const prismBot = cy + prismH / 2;
    const prismApexX = prismLeft + prismW / 2;

    // Prism outline: triangle (apex top, base on right side)
    const prismVerts = new Float32Array([
      prismApexX, prismTop, 0,
      prismLeft, prismBot, 0,
      prismRight, prismBot, 0,
      prismApexX, prismTop, 0,
    ]);
    const prismGeo = new THREE.BufferGeometry();
    prismGeo.setAttribute('position', new THREE.BufferAttribute(prismVerts, 3));
    this.prismOutline = new THREE.Line(prismGeo, new THREE.LineBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.prismOutline);

    // Incoming beam: from left edge to prism left face midpoint
    const beamEntryY = cy;
    const beamVerts = new Float32Array([
      x, beamEntryY, 0,
      prismApexX - prismW * 0.15, beamEntryY, 0,
    ]);
    const beamGeo = new THREE.BufferGeometry();
    beamGeo.setAttribute('position', new THREE.BufferAttribute(beamVerts, 3));
    this.inBeam = new THREE.Line(beamGeo, new THREE.LineBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.inBeam);

    // Fan lines emanating from prism right face
    this.fanBaseX = prismRight;
    this.fanBaseY = cy + prismH * 0.1; // slightly below center of right edge
    this.fanLength = (x + w) - prismRight - w * 0.05;

    // Build spectrum colors by lerping through primary -> secondary -> alert
    const spectrumColors: THREE.Color[] = [];
    for (let i = 0; i < this.fanCount; i++) {
      const t = i / (this.fanCount - 1);
      const color = new THREE.Color();
      if (t < 0.5) {
        // primary -> secondary
        color.copy(this.palette.primary).lerp(this.palette.secondary, t * 2);
      } else {
        // secondary -> alert
        color.copy(this.palette.secondary).lerp(this.palette.alert, (t - 0.5) * 2);
      }
      spectrumColors.push(color);
    }

    for (let i = 0; i < this.fanCount; i++) {
      const positions = new Float32Array(2 * 3);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
        color: spectrumColors[i],
        transparent: true,
        opacity: 0,
      }));
      this.group.add(line);
      this.fanLines.push(line);
    }
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);

    (this.prismOutline.material as THREE.LineBasicMaterial).opacity = opacity * 0.8;
    (this.inBeam.material as THREE.LineBasicMaterial).opacity = opacity * 0.7;

    const halfSpread = this.fanSpread * Math.PI;

    for (let i = 0; i < this.fanCount; i++) {
      const t = i / (this.fanCount - 1);
      // Fan angle spread: centered vertically, fanning out
      const baseAngle = (t - 0.5) * halfSpread * 2;
      // Add gentle shimmer/wave
      const shimmer = Math.sin(time * 1.5 + i * 0.9) * 0.03 + Math.sin(time * 2.3 + i * 1.7) * 0.02;
      const angle = baseAngle + shimmer;

      const endX = this.fanBaseX + Math.cos(angle) * this.fanLength;
      const endY = this.fanBaseY + Math.sin(angle) * this.fanLength;

      const pos = this.fanLines[i].geometry.getAttribute('position') as THREE.BufferAttribute;
      pos.setXYZ(0, this.fanBaseX, this.fanBaseY, 0);
      pos.setXYZ(1, endX, endY, 0);
      pos.needsUpdate = true;

      // Slight opacity variation per line for shimmer
      const lineOpacity = opacity * (0.5 + 0.3 * Math.sin(time * 2.0 + i * 1.2));
      (this.fanLines[i].material as THREE.LineBasicMaterial).opacity = lineOpacity;
    }
  }
}
