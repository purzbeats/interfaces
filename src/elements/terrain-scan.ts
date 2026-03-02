import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Side-view terrain profile with a scrolling scan line.
 * Pre-generates a wide terrain buffer using layered sine waves and scrolls a viewport across it.
 */
export class TerrainScanElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'terrain-scan',
    meta: { shape: 'rectangular', roles: ['scanner', 'data-display'], moods: ['tactical'], sizes: ['needs-medium', 'needs-large'] },
  };
  private terrainLine!: THREE.Line;
  private scanLine!: THREE.LineSegments;
  private fillMesh!: THREE.Mesh;
  private terrainBuffer: number[] = [];
  private bufferLength: number = 0;
  private scrollOffset: number = 0;
  private scrollSpeed: number = 0;
  private scanPhase: number = 0;
  private scanSpeed: number = 0;
  private phases: number[] = [];
  private amplitudes: number[] = [];
  private frequencies: number[] = [];
  private columns: number = 0;

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;
    this.columns = Math.max(20, Math.floor(w / 3));
    this.scrollSpeed = this.rng.float(15, 40);
    this.scanSpeed = this.rng.float(0.4, 0.8);

    // Generate layered sine wave parameters
    const layers = this.rng.int(3, 6);
    for (let i = 0; i < layers; i++) {
      this.phases.push(this.rng.float(0, Math.PI * 2));
      this.amplitudes.push(this.rng.float(0.05, 0.3) / (i + 1));
      this.frequencies.push(this.rng.float(0.01, 0.06) * (i + 1));
    }

    // Pre-generate terrain buffer (wider than viewport)
    this.bufferLength = this.columns * 4;
    for (let i = 0; i < this.bufferLength; i++) {
      this.terrainBuffer.push(this.sampleTerrain(i));
    }

    // Terrain line
    const positions = new Float32Array(this.columns * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.terrainLine = new THREE.Line(geo, new THREE.LineBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.terrainLine);

    // Fill mesh below terrain (using PlaneGeometry we'll deform)
    const fillPositions = new Float32Array(this.columns * 2 * 3);
    const fillIndices: number[] = [];
    for (let i = 0; i < this.columns - 1; i++) {
      const topL = i * 2;
      const botL = i * 2 + 1;
      const topR = (i + 1) * 2;
      const botR = (i + 1) * 2 + 1;
      fillIndices.push(topL, botL, topR);
      fillIndices.push(topR, botL, botR);
    }
    const fillGeo = new THREE.BufferGeometry();
    fillGeo.setAttribute('position', new THREE.BufferAttribute(fillPositions, 3));
    fillGeo.setIndex(fillIndices);
    this.fillMesh = new THREE.Mesh(fillGeo, new THREE.MeshBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.fillMesh);

    // Scan line (vertical)
    const scanGeo = new THREE.BufferGeometry();
    scanGeo.setAttribute('position', new THREE.Float32BufferAttribute([
      x, y, 2, x, y + h, 2,
    ], 3));
    this.scanLine = new THREE.LineSegments(scanGeo, new THREE.LineBasicMaterial({
      color: this.palette.secondary,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.scanLine);
  }

  private sampleTerrain(i: number): number {
    let val = 0.5;
    for (let l = 0; l < this.phases.length; l++) {
      val += Math.sin(i * this.frequencies[l] + this.phases[l]) * this.amplitudes[l];
    }
    return val;
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    const { x, y, w, h } = this.px;
    const gx = this.group.position.x;

    this.scrollOffset += dt * this.scrollSpeed;

    // Extend terrain buffer as needed
    while (this.scrollOffset + this.columns >= this.terrainBuffer.length) {
      this.terrainBuffer.push(this.sampleTerrain(this.terrainBuffer.length));
    }

    const baseIdx = Math.floor(this.scrollOffset);
    const frac = this.scrollOffset - baseIdx;

    // Update terrain line positions
    const positions = this.terrainLine.geometry.getAttribute('position') as THREE.BufferAttribute;
    const fillPositions = this.fillMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const colW = w / (this.columns - 1);
    const margin = h * 0.1;

    for (let i = 0; i < this.columns; i++) {
      const bufIdx = baseIdx + i;
      const t0 = this.terrainBuffer[bufIdx] ?? 0.5;
      const t1 = this.terrainBuffer[bufIdx + 1] ?? 0.5;
      const terrainVal = t0 + (t1 - t0) * frac;
      const ty = y + margin + terrainVal * (h - margin * 2);
      const tx = x + i * colW + gx;

      positions.setXYZ(i, tx, ty, 1);

      // Fill: top vertex = terrain, bottom vertex = floor
      fillPositions.setXYZ(i * 2, tx, ty, 0);
      fillPositions.setXYZ(i * 2 + 1, tx, y + margin, 0);
    }
    positions.needsUpdate = true;
    fillPositions.needsUpdate = true;

    (this.terrainLine.material as THREE.LineBasicMaterial).opacity = opacity * 0.9;
    (this.fillMesh.material as THREE.MeshBasicMaterial).opacity = opacity * 0.15;

    // Scan line sweeps right to left
    this.scanPhase = (this.scanPhase + dt * this.scanSpeed) % 1;
    const scanX = x + w * (1 - this.scanPhase) + gx;
    const scanPos = this.scanLine.geometry.getAttribute('position') as THREE.BufferAttribute;
    scanPos.setXYZ(0, scanX, y, 2);
    scanPos.setXYZ(1, scanX, y + h, 2);
    scanPos.needsUpdate = true;
    (this.scanLine.material as THREE.LineBasicMaterial).opacity = opacity * 0.6;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      this.scrollSpeed *= 4;
      setTimeout(() => { this.scrollSpeed /= 4; }, 500);
    }
    if (action === 'alert') {
      this.pulseTimer = 2.0;
      this.scanSpeed *= 3;
      setTimeout(() => { this.scanSpeed /= 3; }, 1500);
    }
  }
}
