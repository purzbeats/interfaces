import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Barcode-style strip of varying width vertical lines.
 * Periodically regenerates the pattern for a data-refresh effect.
 */
export class BarcodeStripElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'barcode-strip',
    meta: { shape: 'linear', roles: ['data-display', 'decorative'], moods: ['tactical', 'diagnostic'], sizes: ['works-small'] },
  };
  private barLines!: THREE.LineSegments;
  private barCount: number = 0;
  private maxBars: number = 80;
  private regenTimer: number = 0;
  private regenInterval: number = 0;
  private shiftOffset: number = 0;
  private alertMode: boolean = false;

  build(): void {
    this.glitchAmount = 3;
    const { w } = this.px;

    this.maxBars = Math.max(40, Math.min(80, Math.floor(w / 3)));
    this.regenInterval = this.rng.float(3, 7);
    this.regenTimer = this.regenInterval;

    // Each bar is a vertical line segment = 2 vertices
    const positions = new Float32Array(this.maxBars * 2 * 3);
    const colors = new Float32Array(this.maxBars * 2 * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setDrawRange(0, 0);
    this.barLines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.barLines);

    this.generateBars();
  }

  private generateBars(): void {
    const { x, y, w, h } = this.px;
    const positions = this.barLines.geometry.getAttribute('position') as THREE.BufferAttribute;
    const colors = this.barLines.geometry.getAttribute('color') as THREE.BufferAttribute;
    const primary = this.alertMode ? this.palette.alert : this.palette.primary;
    const secondary = this.palette.secondary;

    let cursor = 0;
    this.barCount = 0;

    while (cursor < w && this.barCount < this.maxBars) {
      const isThick = this.rng.chance(0.35);
      const barW = isThick ? this.rng.float(2, 5) : this.rng.float(0.5, 1.5);
      const gap = this.rng.float(1, 4);

      const bx = x + cursor + barW / 2 + this.shiftOffset;
      const vi = this.barCount * 2;

      positions.setXYZ(vi, bx, y + 1, 1);
      positions.setXYZ(vi + 1, bx, y + h - 1, 1);

      const col = isThick ? primary : secondary;
      const bright = this.rng.float(0.5, 1.0);
      colors.setXYZ(vi, col.r * bright, col.g * bright, col.b * bright);
      colors.setXYZ(vi + 1, col.r * bright, col.g * bright, col.b * bright);

      cursor += barW + gap;
      this.barCount++;
    }

    positions.needsUpdate = true;
    colors.needsUpdate = true;
    this.barLines.geometry.setDrawRange(0, this.barCount * 2);
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);

    this.regenTimer -= dt;
    if (this.regenTimer <= 0) {
      this.regenTimer = this.regenInterval;
      this.shiftOffset = this.rng.float(-2, 2);
      this.generateBars();
    }

    (this.barLines.material as THREE.LineBasicMaterial).opacity = opacity;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      this.generateBars();
      this.regenTimer = 0.2; // rapid regen
    }
    if (action === 'alert') {
      this.alertMode = true;
      this.pulseTimer = 1.5;
      this.generateBars();
      setTimeout(() => { this.alertMode = false; }, 3000);
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) { this.alertMode = false; return; }
    if (level >= 3) { this.generateBars(); }
    if (level >= 5) { this.alertMode = true; }
  }
}
