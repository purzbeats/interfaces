import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Scrolling 3D-ish wireframe terrain with layered sine noise.
 * Horizontal scan lines at varying heights create a retro vector-graphics
 * landscape that scrolls forward endlessly — like an 80s flight simulator.
 */
export class PerlinTerrainElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'perlin-terrain',
    meta: { shape: 'rectangular', roles: ['decorative', 'data-display'], moods: ['ambient', 'tactical'], bandAffinity: 'bass', sizes: ['needs-medium', 'needs-large'] },
  };

  private rowCount = 0;
  private colCount = 0;
  private lineMeshes: THREE.Line[] = [];
  private lineMats: THREE.LineBasicMaterial[] = [];
  private scrollOffset = 0;
  private scrollSpeed = 20;
  private heightScale = 0;

  build(): void {
    const variant = this.rng.int(0, 3);
    const presets = [
      { rows: 20, cols: 40, speed: 20, heightMul: 0.15 },
      { rows: 35, cols: 60, speed: 30, heightMul: 0.12 },
      { rows: 12, cols: 25, speed: 12, heightMul: 0.2 },
      { rows: 28, cols: 50, speed: 40, heightMul: 0.1 },
    ];
    const p = presets[variant];
    this.glitchAmount = 4;

    const { x, y, w, h } = this.px;
    this.rowCount = p.rows;
    this.colCount = p.cols;
    this.scrollSpeed = p.speed;
    this.heightScale = h * p.heightMul;

    for (let r = 0; r < this.rowCount; r++) {
      const pts = new Float32Array(this.colCount * 3);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pts, 3));
      const depth = r / this.rowCount;
      const color = this.palette.primary.clone().lerp(this.palette.dim, depth);
      const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0 });
      const line = new THREE.Line(geo, mat);
      this.lineMeshes.push(line);
      this.lineMats.push(mat);
      this.group.add(line);
    }
  }

  private terrainHeight(gx: number, gz: number): number {
    let h2 = 0;
    h2 += Math.sin(gx * 0.15 + gz * 0.1) * 0.5;
    h2 += Math.sin(gx * 0.3 + gz * 0.25) * 0.25;
    h2 += Math.sin(gx * 0.6 + gz * 0.5) * 0.15;
    h2 += Math.cos(gx * 0.08 - gz * 0.12) * 0.3;
    return h2;
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);
    const { x, y, w, h } = this.px;
    this.scrollOffset += this.scrollSpeed * dt;

    for (let r = 0; r < this.rowCount; r++) {
      const depth = r / (this.rowCount - 1); // 0 = near, 1 = far
      const perspective = 1 - depth * 0.6; // Perspective scale
      const rowY = y + h * (0.4 + depth * 0.55); // Horizon at ~40%
      const rowWidth = w * perspective;
      const rowX = x + (w - rowWidth) / 2;

      const pos = this.lineMeshes[r].geometry.getAttribute('position') as THREE.BufferAttribute;
      const gz = this.scrollOffset + r * 2;

      for (let c = 0; c < this.colCount; c++) {
        const t = c / (this.colCount - 1);
        const gx = (t - 0.5) * 30;
        const elev = this.terrainHeight(gx, gz) * this.heightScale * perspective;
        pos.setXYZ(c, rowX + t * rowWidth, rowY - elev, -depth);
      }
      pos.needsUpdate = true;

      this.lineMats[r].opacity = opacity * (1 - depth * 0.7);
    }
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') this.scrollSpeed *= -1;
    if (action === 'alert') this.scrollSpeed *= 3;
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level >= 3) this.heightScale *= 1.5;
    if (level >= 5) this.scrollSpeed = 80;
  }
}
