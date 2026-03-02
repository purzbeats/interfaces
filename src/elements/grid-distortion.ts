import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Regular grid that warps and distorts with time-varying sine wave displacement.
 * Creates a breathing, organic distortion over a rigid structure.
 */
export class GridDistortionElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'grid-distortion',
    meta: { shape: 'rectangular', roles: ['decorative', 'data-display'], moods: ['ambient', 'diagnostic'], sizes: ['needs-medium', 'needs-large'] },
  };
  private gridLines!: THREE.LineSegments;
  private borderLines!: THREE.LineSegments;
  private divisionsX: number = 0;
  private divisionsY: number = 0;
  private waveFreqX: number = 0;
  private waveFreqY: number = 0;
  private waveAmp: number = 0;
  private alertMode: boolean = false;

  build(): void {
    this.glitchAmount = 6;
    const { x, y, w, h } = this.px;

    this.divisionsX = this.rng.int(10, 20);
    this.divisionsY = this.rng.int(10, 20);
    this.waveFreqX = this.rng.float(2, 5);
    this.waveFreqY = this.rng.float(2, 5);
    this.waveAmp = this.rng.float(3, 8);

    // Grid lines: horizontal + vertical
    // Horizontal lines: (divisionsY + 1) lines, each with divisionsX segments = divisionsX * 2 vertices per line
    // Vertical lines: (divisionsX + 1) lines, each with divisionsY segments = divisionsY * 2 vertices per line
    const hLineCount = (this.divisionsY + 1) * this.divisionsX * 2;
    const vLineCount = (this.divisionsX + 1) * this.divisionsY * 2;
    const totalVerts = hLineCount + vLineCount;

    const positions = new Float32Array(totalVerts * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.gridLines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.gridLines);

    // Border
    const bv = new Float32Array([
      x, y, 0, x + w, y, 0,
      x + w, y, 0, x + w, y + h, 0,
      x + w, y + h, 0, x, y + h, 0,
      x, y + h, 0, x, y, 0,
    ]);
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.BufferAttribute(bv, 3));
    this.borderLines = new THREE.LineSegments(bg, new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.borderLines);
  }

  private getDisplacement(gx: number, gy: number, time: number): [number, number] {
    const amp = this.waveAmp * (this.alertMode ? 2.5 : 1);
    const dx = Math.sin(gy * this.waveFreqY + time * 1.3) * amp
      + Math.sin((gx + gy) * 0.7 + time * 2.1) * amp * 0.3;
    const dy = Math.sin(gx * this.waveFreqX + time * 1.7) * amp
      + Math.cos((gx - gy) * 0.5 + time * 1.1) * amp * 0.3;
    return [dx, dy];
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    const { x, y, w, h } = this.px;
    const dx = this.divisionsX;
    const dy = this.divisionsY;
    const positions = this.gridLines.geometry.getAttribute('position') as THREE.BufferAttribute;

    let vi = 0;

    // Horizontal lines
    for (let row = 0; row <= dy; row++) {
      const gy = row / dy;
      const baseY = y + gy * h;
      for (let col = 0; col < dx; col++) {
        const gx1 = col / dx;
        const gx2 = (col + 1) / dx;
        const [d1x, d1y] = this.getDisplacement(gx1, gy, time);
        const [d2x, d2y] = this.getDisplacement(gx2, gy, time);
        positions.setXYZ(vi, x + gx1 * w + d1x, baseY + d1y, 1);
        positions.setXYZ(vi + 1, x + gx2 * w + d2x, baseY + d2y, 1);
        vi += 2;
      }
    }

    // Vertical lines
    for (let col = 0; col <= dx; col++) {
      const gx = col / dx;
      const baseX = x + gx * w;
      for (let row = 0; row < dy; row++) {
        const gy1 = row / dy;
        const gy2 = (row + 1) / dy;
        const [d1x, d1y] = this.getDisplacement(gx, gy1, time);
        const [d2x, d2y] = this.getDisplacement(gx, gy2, time);
        positions.setXYZ(vi, baseX + d1x, y + gy1 * h + d1y, 1);
        positions.setXYZ(vi + 1, baseX + d2x, y + gy2 * h + d2y, 1);
        vi += 2;
      }
    }

    positions.needsUpdate = true;
    (this.gridLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.7;
    (this.borderLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.3;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      this.waveAmp *= 4;
      setTimeout(() => { this.waveAmp /= 4; }, 400);
    }
    if (action === 'alert') {
      this.alertMode = true;
      this.pulseTimer = 1.5;
      (this.gridLines.material as THREE.LineBasicMaterial).color.copy(this.palette.alert);
      setTimeout(() => {
        this.alertMode = false;
        (this.gridLines.material as THREE.LineBasicMaterial).color.copy(this.palette.primary);
      }, 3000);
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) { this.alertMode = false; return; }
    if (level >= 4) { this.alertMode = true; }
  }
}
