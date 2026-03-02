import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

// Classic tetromino shapes as [col, row] offsets from anchor
const TETROMINOES: [number, number][][] = [
  [[0,0],[1,0],[2,0],[3,0]],           // I
  [[0,0],[1,0],[0,1],[1,1]],           // O
  [[0,0],[1,0],[2,0],[1,1]],           // T
  [[0,0],[1,0],[1,1],[2,1]],           // S
  [[1,0],[2,0],[0,1],[1,1]],           // Z
  [[0,0],[0,1],[1,1],[2,1]],           // J
  [[2,0],[0,1],[1,1],[2,1]],           // L
];

interface ActiveTetromino {
  cells: [number, number][];  // grid cell coordinates
  opacity: number;            // current opacity (fades in then out)
  age: number;                // seconds alive
  lifespan: number;           // total life before fade-out
}

/**
 * Regular grid that warps and distorts with time-varying sine wave displacement.
 * Creates a breathing, organic distortion over a rigid structure.
 * Random tetromino shapes light up cells periodically.
 */
export class GridDistortionElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'grid-distortion',
    meta: { shape: 'rectangular', roles: ['decorative', 'data-display'], moods: ['ambient', 'diagnostic'], sizes: ['needs-medium', 'needs-large'] },
  };
  private gridLines!: THREE.LineSegments;
  private borderLines!: THREE.LineSegments;
  private cellMesh!: THREE.Mesh;
  private cellInstanceCount: number = 0;
  private divisionsX: number = 0;
  private divisionsY: number = 0;
  private waveFreqX: number = 0;
  private waveFreqY: number = 0;
  private waveAmp: number = 0;
  private alertMode: boolean = false;

  // Tetromino highlight system
  private activeTetros: ActiveTetromino[] = [];
  private spawnTimer: number = 0;
  private spawnInterval: number = 0;
  private maxActive: number = 0;

  build(): void {
    this.glitchAmount = 6;
    const { x, y, w, h } = this.px;

    this.divisionsX = this.rng.int(10, 20);
    this.divisionsY = this.rng.int(10, 20);
    this.waveFreqX = this.rng.float(2, 5);
    this.waveFreqY = this.rng.float(2, 5);
    this.waveAmp = this.rng.float(3, 8);
    this.spawnInterval = this.rng.float(0.8, 2.0);
    this.maxActive = this.rng.int(2, 4);

    // Grid lines
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

    // Tetromino cell quads — use InstancedMesh for up to maxActive * 4 cells
    this.cellInstanceCount = this.maxActive * 4;
    const cellGeo = new THREE.PlaneGeometry(1, 1);
    const cellMat = new THREE.MeshBasicMaterial({
      color: this.palette.secondary,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    this.cellMesh = new THREE.InstancedMesh(cellGeo, cellMat, this.cellInstanceCount);
    (this.cellMesh as THREE.InstancedMesh).count = 0;
    this.group.add(this.cellMesh);

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

  private spawnTetromino(): void {
    const shape = TETROMINOES[Math.floor(Math.random() * TETROMINOES.length)];
    // Random position within grid bounds
    const maxCol = this.divisionsX - 4;
    const maxRow = this.divisionsY - 2;
    if (maxCol < 0 || maxRow < 0) return;
    const anchorCol = Math.floor(Math.random() * maxCol);
    const anchorRow = Math.floor(Math.random() * maxRow);

    const cells: [number, number][] = shape.map(([c, r]) => [anchorCol + c, anchorRow + r]);

    // Don't overlap existing active tetros
    for (const existing of this.activeTetros) {
      for (const [ec, er] of existing.cells) {
        for (const [nc, nr] of cells) {
          if (ec === nc && er === nr) return;
        }
      }
    }

    this.activeTetros.push({
      cells,
      opacity: 0,
      age: 0,
      lifespan: 1.5 + Math.random() * 2.0,
    });
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    const { x, y, w, h } = this.px;
    // Inset the grid to keep displacement within the tile border
    const maxAmp = this.waveAmp * (this.alertMode ? 2.5 : 1) * 1.3;
    const pad = Math.max(maxAmp, Math.min(w, h) * 0.08);
    const ix = x + pad;
    const iy = y + pad;
    const iw = w - pad * 2;
    const ih = h - pad * 2;
    const divX = this.divisionsX;
    const divY = this.divisionsY;
    const positions = this.gridLines.geometry.getAttribute('position') as THREE.BufferAttribute;

    let vi = 0;

    // Horizontal lines
    for (let row = 0; row <= divY; row++) {
      const gy = row / divY;
      const baseY = iy + gy * ih;
      for (let col = 0; col < divX; col++) {
        const gx1 = col / divX;
        const gx2 = (col + 1) / divX;
        const [d1x, d1y] = this.getDisplacement(gx1, gy, time);
        const [d2x, d2y] = this.getDisplacement(gx2, gy, time);
        positions.setXYZ(vi, ix + gx1 * iw + d1x, baseY + d1y, 1);
        positions.setXYZ(vi + 1, ix + gx2 * iw + d2x, baseY + d2y, 1);
        vi += 2;
      }
    }

    // Vertical lines
    for (let col = 0; col <= divX; col++) {
      const gx = col / divX;
      const baseX = ix + gx * iw;
      for (let row = 0; row < divY; row++) {
        const gy1 = row / divY;
        const gy2 = (row + 1) / divY;
        const [d1x, d1y] = this.getDisplacement(gx, gy1, time);
        const [d2x, d2y] = this.getDisplacement(gx, gy2, time);
        positions.setXYZ(vi, baseX + d1x, iy + gy1 * ih + d1y, 1);
        positions.setXYZ(vi + 1, baseX + d2x, iy + gy2 * ih + d2y, 1);
        vi += 2;
      }
    }

    positions.needsUpdate = true;
    (this.gridLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.7;
    (this.borderLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.3;

    // --- Tetromino highlights ---
    this.spawnTimer += dt;
    if (this.spawnTimer >= this.spawnInterval && this.activeTetros.length < this.maxActive) {
      this.spawnTimer = 0;
      this.spawnTetromino();
    }

    // Update tetro lifetimes
    for (let i = this.activeTetros.length - 1; i >= 0; i--) {
      const t = this.activeTetros[i];
      t.age += dt;
      // Fade in over 0.3s, hold, fade out over 0.4s at end of life
      const fadeIn = Math.min(1, t.age / 0.3);
      const fadeOut = Math.max(0, 1 - Math.max(0, t.age - (t.lifespan - 0.4)) / 0.4);
      t.opacity = fadeIn * fadeOut;
      if (t.age >= t.lifespan) {
        this.activeTetros.splice(i, 1);
      }
    }

    // Write instanced cell transforms
    const cellW = iw / divX;
    const cellH = ih / divY;
    const dummy = new THREE.Object3D();
    const instMesh = this.cellMesh as THREE.InstancedMesh;
    let ci = 0;

    for (const tetro of this.activeTetros) {
      for (const [col, row] of tetro.cells) {
        if (ci >= this.cellInstanceCount) break;
        // Cell center in grid coords (normalized)
        const gx = (col + 0.5) / divX;
        const gy = (row + 0.5) / divY;
        const [dispX, dispY] = this.getDisplacement(gx, gy, time);
        dummy.position.set(
          ix + gx * iw + dispX,
          iy + gy * ih + dispY,
          0.5
        );
        dummy.scale.set(cellW * 0.85, cellH * 0.85, 1);
        dummy.updateMatrix();
        instMesh.setMatrixAt(ci, dummy.matrix);

        // Per-instance color with opacity baked into alpha
        const color = new THREE.Color().copy(this.palette.secondary);
        instMesh.setColorAt(ci, color);

        ci++;
      }
    }
    instMesh.count = ci;
    if (ci > 0) {
      instMesh.instanceMatrix.needsUpdate = true;
      if (instMesh.instanceColor) instMesh.instanceColor.needsUpdate = true;
    }

    // Set shared material opacity as max of all active tetros
    let maxTetroOpacity = 0;
    for (const t of this.activeTetros) {
      if (t.opacity > maxTetroOpacity) maxTetroOpacity = t.opacity;
    }
    (instMesh.material as THREE.MeshBasicMaterial).opacity = opacity * maxTetroOpacity * 0.25;
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
    if (action === 'pulse') {
      // Spawn an extra tetromino on pulse
      this.spawnTetromino();
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) { this.alertMode = false; return; }
    if (level >= 4) { this.alertMode = true; }
    // Higher intensity = more tetros
    if (level >= 3) this.spawnTetromino();
  }
}
