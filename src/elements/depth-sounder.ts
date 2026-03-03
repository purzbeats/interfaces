import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Scrolling bathymetric depth profile chart.
 * Line shifts left each frame, new terrain appended from noise, depth grid behind.
 */
export class DepthSounderElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'depth-sounder',
    meta: { shape: 'rectangular', roles: ['data-display', 'scanner'], moods: ['tactical'], bandAffinity: 'sub', sizes: ['needs-medium'] },
  };
  private terrainLine!: THREE.Line;
  private gridLines!: THREE.LineSegments;
  private borderLines!: THREE.LineSegments;
  private numPoints: number = 0;
  private depths: number[] = [];
  private scrollAccum: number = 0;
  private scrollRate: number = 0;
  private noisePhase: number = 0;
  build(): void {
    const { x, y, w, h } = this.px;
    this.numPoints = Math.max(64, Math.floor(w * 0.5));
    this.scrollRate = this.rng.float(8, 20);
    this.noisePhase = this.rng.float(0, 1000);

    // Init depths
    for (let i = 0; i < this.numPoints; i++) {
      this.depths.push(this.terrainNoise(this.noisePhase + i * 0.05));
    }

    // Terrain line
    const positions = new Float32Array(this.numPoints * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.terrainLine = new THREE.Line(geo, new THREE.LineBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.terrainLine);

    // Depth grid (horizontal lines)
    const gridVerts: number[] = [];
    const gridCount = 5;
    for (let i = 0; i <= gridCount; i++) {
      const gy = y + h * 0.1 + (h * 0.8) * (i / gridCount);
      gridVerts.push(x, gy, 0, x + w, gy, 0);
    }
    // Vertical grid
    const vGridCount = 8;
    for (let i = 0; i <= vGridCount; i++) {
      const gx = x + w * (i / vGridCount);
      gridVerts.push(gx, y + h * 0.1, 0, gx, y + h * 0.9, 0);
    }
    const gridGeo = new THREE.BufferGeometry();
    gridGeo.setAttribute('position', new THREE.Float32BufferAttribute(gridVerts, 3));
    this.gridLines = new THREE.LineSegments(gridGeo, new THREE.LineBasicMaterial({
      color: this.palette.dim,
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

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);
    const { x, y, w, h } = this.px;

    // Scroll terrain
    this.scrollAccum += dt * this.scrollRate;
    while (this.scrollAccum >= 1) {
      this.scrollAccum -= 1;
      this.noisePhase += 0.05;
      this.depths.shift();
      this.depths.push(this.terrainNoise(this.noisePhase + this.numPoints * 0.05));
    }

    // Update line positions
    const pos = this.terrainLine.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < this.numPoints; i++) {
      const px = x + (w * i) / (this.numPoints - 1);
      const py = y + h * 0.1 + this.depths[i] * h * 0.8;
      pos.setXYZ(i, px, py, 1);
    }
    pos.needsUpdate = true;

    (this.terrainLine.material as THREE.LineBasicMaterial).opacity = opacity;
    (this.gridLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.15;
    (this.borderLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.3;
  }

  private terrainNoise(phase: number): number {
    return 0.3 + Math.sin(phase * 1.3) * 0.2
      + Math.sin(phase * 3.7) * 0.1
      + Math.sin(phase * 7.1) * 0.05
      + Math.sin(phase * 13.3) * 0.03;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      this.scrollRate = this.rng.float(40, 80);
    }
    if (action === 'alert') {
      (this.terrainLine.material as THREE.LineBasicMaterial).color.copy(this.palette.alert);
    }
  }
}
