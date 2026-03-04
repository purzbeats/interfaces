import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Magnetic field lines curving between two poles (left and right).
 * Lines breathe slowly via oscillating curve heights.
 */
export class MagnetFieldElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'magnet-field',
    meta: {
      shape: 'radial',
      roles: ['decorative'],
      moods: ['ambient'],
      sizes: ['needs-medium', 'needs-large'],
    },
  };

  private fieldLines: THREE.Line[] = [];
  private lineData: { yOffset: number; amplitude: number; phase: number; speed: number }[] = [];
  private pointsPerLine: number = 32;

  build(): void {
    const { x, y, w, h } = this.px;

    const lineCount = 6 + this.rng.int(0, 6);
    const cx = x + w / 2;
    const cy = y + h / 2;

    // Left and right pole positions
    const poleMargin = w * 0.1;
    const leftPoleX = x + poleMargin;
    const rightPoleX = x + w - poleMargin;

    for (let i = 0; i < lineCount; i++) {
      // Distribute lines above and below center
      const t = (i / (lineCount - 1)) - 0.5; // -0.5 to 0.5
      const yOffset = t * h * 0.7;
      const amplitude = Math.abs(t) * h * 0.3 + h * 0.08;
      const phase = this.rng.float(0, Math.PI * 2);
      const speed = this.rng.float(0.3, 0.8) * (this.rng.chance(0.5) ? 1 : -1);

      this.lineData.push({ yOffset, amplitude, phase, speed });

      // Create the line geometry
      const positions = new Float32Array(this.pointsPerLine * 3);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

      const brightness = 1.0 - Math.abs(t) * 0.6;
      const color = new THREE.Color().copy(this.palette.primary).multiplyScalar(brightness);

      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity: 0,
      }));
      this.fieldLines.push(line);
      this.group.add(line);
    }
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    const { x, y, w, h } = this.px;

    const poleMargin = w * 0.1;
    const leftPoleX = x + poleMargin;
    const rightPoleX = x + w - poleMargin;
    const cy = y + h / 2;

    for (let li = 0; li < this.fieldLines.length; li++) {
      const data = this.lineData[li];
      const line = this.fieldLines[li];
      const posAttr = line.geometry.getAttribute('position') as THREE.BufferAttribute;

      // Breathing effect on amplitude
      const breathe = 1.0 + 0.2 * Math.sin(time * data.speed + data.phase);
      const amp = data.amplitude * breathe;

      // Sign: lines above center curve up, lines below curve down
      const sign = data.yOffset >= 0 ? 1 : -1;

      for (let p = 0; p < this.pointsPerLine; p++) {
        const t = p / (this.pointsPerLine - 1); // 0..1

        // X position: lerp between poles
        const px = leftPoleX + (rightPoleX - leftPoleX) * t;

        // Y position: cubic bezier-like curve
        // Peaks in the middle (t=0.5), returns to pole Y at t=0 and t=1
        const curveFactor = 4 * t * (1 - t); // parabola peaking at 0.5
        const py = cy + data.yOffset + sign * amp * curveFactor;

        posAttr.setXYZ(p, px, py, 0);
      }

      posAttr.needsUpdate = true;
      (line.material as THREE.LineBasicMaterial).opacity = opacity * 0.7;
    }
  }
}
