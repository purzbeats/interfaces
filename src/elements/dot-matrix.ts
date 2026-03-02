import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Grid of small circles whose brightness animates in wave patterns.
 * Like a pin-art display or LED matrix with ripple/wave effects.
 */
export class DotMatrixElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'dot-matrix',
    meta: { shape: 'rectangular', roles: ['data-display', 'decorative'], moods: ['ambient', 'diagnostic'], sizes: ['needs-medium'] },
  };
  private dotMesh!: THREE.Points;
  private cols: number = 0;
  private rows: number = 0;
  private dotCount: number = 0;
  private waveFreqX: number = 0;
  private waveFreqY: number = 0;
  private waveSpeed: number = 0;
  private waveMode: number = 0;

  build(): void {
    const { x, y, w, h } = this.px;
    const spacing = this.rng.pick([8, 10, 12, 14]);
    this.cols = Math.max(4, Math.floor(w / spacing));
    this.rows = Math.max(4, Math.floor(h / spacing));
    this.dotCount = this.cols * this.rows;
    this.waveFreqX = this.rng.float(0.05, 0.15);
    this.waveFreqY = this.rng.float(0.05, 0.15);
    this.waveSpeed = this.rng.float(2, 5);
    this.waveMode = this.rng.int(0, 3); // 0=ripple, 1=diagonal, 2=horizontal, 3=radial

    const positions = new Float32Array(this.dotCount * 3);
    const colors = new Float32Array(this.dotCount * 3);
    const sizes = new Float32Array(this.dotCount);

    const pr = this.palette.primary.r;
    const pg = this.palette.primary.g;
    const pb = this.palette.primary.b;

    const cellW = w / this.cols;
    const cellH = h / this.rows;

    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        const i = row * this.cols + col;
        positions[i * 3] = x + col * cellW + cellW / 2;
        positions[i * 3 + 1] = y + row * cellH + cellH / 2;
        positions[i * 3 + 2] = 0;
        colors[i * 3] = pr;
        colors[i * 3 + 1] = pg;
        colors[i * 3 + 2] = pb;
        sizes[i] = Math.min(cellW, cellH) * 0.4;
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

    const mat = new THREE.PointsMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0,
      size: spacing * 0.4,
      sizeAttenuation: false,
    });

    this.dotMesh = new THREE.Points(geo, mat);
    this.group.add(this.dotMesh);
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);

    (this.dotMesh.material as THREE.PointsMaterial).opacity = opacity;

    const colors = this.dotMesh.geometry.getAttribute('color') as THREE.BufferAttribute;
    const pr = this.palette.primary.r;
    const pg = this.palette.primary.g;
    const pb = this.palette.primary.b;
    const dr = this.palette.dim.r;
    const dg = this.palette.dim.g;
    const db = this.palette.dim.b;
    const sr = this.palette.secondary.r;
    const sg = this.palette.secondary.g;
    const sb = this.palette.secondary.b;

    const t = time * this.waveSpeed;
    const midCol = this.cols / 2;
    const midRow = this.rows / 2;

    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        const i = row * this.cols + col;
        let brightness: number;

        switch (this.waveMode) {
          case 0: { // radial ripple
            const dist = Math.sqrt((col - midCol) ** 2 + (row - midRow) ** 2);
            brightness = (Math.sin(dist * 0.8 - t) + 1) * 0.5;
            break;
          }
          case 1: { // diagonal sweep
            brightness = (Math.sin((col + row) * 0.5 - t) + 1) * 0.5;
            break;
          }
          case 2: { // horizontal bands
            brightness = (Math.sin(row * this.waveFreqY * 20 - t) + 1) * 0.5;
            brightness *= (Math.sin(col * this.waveFreqX * 10 + t * 0.3) + 1) * 0.5;
            break;
          }
          default: { // concentric diamond
            const dist = Math.abs(col - midCol) + Math.abs(row - midRow);
            brightness = (Math.sin(dist * 0.6 - t) + 1) * 0.5;
          }
        }

        brightness = brightness * 0.85 + 0.15;
        const hot = brightness > 0.75;
        const r = hot ? sr : dr + (pr - dr) * brightness;
        const g = hot ? sg : dg + (pg - dg) * brightness;
        const b = hot ? sb : db + (pb - db) * brightness;
        colors.setXYZ(i, r, g, b);
      }
    }
    colors.needsUpdate = true;
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) return;
    if (level >= 5) {
      this.waveMode = (this.waveMode + 1) % 4;
    }
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') { this.waveMode = (this.waveMode + 1) % 4; }
  }
}
