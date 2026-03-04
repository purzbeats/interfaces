import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Interlocking sine waves that scroll horizontally.
 * Multiple waves with different amplitudes, frequencies, and phase offsets
 * create a woven, organic line pattern.
 */
export class SineWeaveElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'sine-weave',
    meta: { shape: 'linear', roles: ['decorative'], moods: ['ambient'], sizes: ['works-small', 'needs-medium'] },
  };

  private waves: THREE.Line[] = [];
  private waveConfigs: Array<{ amp: number; freq: number; phase: number; speed: number }> = [];
  private numPoints: number = 0;

  build(): void {
    const { x, y, w, h } = this.px;
    const variant = this.rng.int(0, 4);
    const presets = [
      { count: 3, ampRange: [0.25, 0.40], freqRange: [2, 4], speedRange: [0.8, 1.5] },
      { count: 4, ampRange: [0.15, 0.35], freqRange: [3, 6], speedRange: [1.0, 2.0] },
      { count: 5, ampRange: [0.10, 0.30], freqRange: [2, 5], speedRange: [0.6, 1.8] },
      { count: 3, ampRange: [0.30, 0.45], freqRange: [1, 3], speedRange: [0.4, 1.0] },
    ];
    const p = presets[variant];

    this.numPoints = Math.max(60, Math.floor(w / 2));
    const colors = [this.palette.primary, this.palette.secondary, this.palette.dim, this.palette.secondary, this.palette.dim];

    for (let i = 0; i < p.count; i++) {
      const amp = this.rng.float(p.ampRange[0], p.ampRange[1]) * h * 0.5;
      const freq = this.rng.float(p.freqRange[0], p.freqRange[1]);
      const phase = (i / p.count) * Math.PI * 2;
      const speed = this.rng.float(p.speedRange[0], p.speedRange[1]) * (this.rng.float(0, 1) > 0.5 ? 1 : -1);
      this.waveConfigs.push({ amp, freq, phase, speed });

      const positions = new Float32Array(this.numPoints * 3);
      const cy = y + h / 2;
      for (let j = 0; j < this.numPoints; j++) {
        const t = j / (this.numPoints - 1);
        positions[j * 3] = x + t * w;
        positions[j * 3 + 1] = cy;
        positions[j * 3 + 2] = 0;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
        color: colors[i % colors.length],
        transparent: true,
        opacity: 0,
      }));
      this.group.add(line);
      this.waves.push(line);
    }
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    const { y, h } = this.px;
    const cy = y + h / 2;

    for (let i = 0; i < this.waves.length; i++) {
      const cfg = this.waveConfigs[i];
      const pos = this.waves[i].geometry.getAttribute('position') as THREE.BufferAttribute;
      const mat = this.waves[i].material as THREE.LineBasicMaterial;

      // Primary wave gets higher opacity
      mat.opacity = opacity * (i === 0 ? 0.8 : 0.45);

      for (let j = 0; j < this.numPoints; j++) {
        const t = j / (this.numPoints - 1);
        const yVal = cy + cfg.amp * Math.sin(cfg.freq * t * Math.PI * 2 + time * cfg.speed + cfg.phase);
        pos.setY(j, yVal);
      }
      pos.needsUpdate = true;
    }
  }
}
