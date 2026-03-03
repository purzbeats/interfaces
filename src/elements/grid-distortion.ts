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
  meshes: THREE.Mesh[];       // one quad per cell
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
    meta: { shape: 'rectangular', roles: ['decorative', 'data-display'], moods: ['ambient', 'diagnostic'], bandAffinity: 'mid', sizes: ['needs-medium', 'needs-large'] },
  };
  private gridLines!: THREE.LineSegments;
  private borderLines!: THREE.LineSegments;
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
    const variant = this.rng.int(0, 3);
    const presets = [
      { divMin: 10, divMax: 20, freqMin: 2, freqMax: 5, ampMin: 3, ampMax: 8, spawnMin: 0.8, spawnMax: 2.0, maxAct: [2, 4] },    // Standard
      { divMin: 20, divMax: 35, freqMin: 3, freqMax: 7, ampMin: 5, ampMax: 12, spawnMin: 0.3, spawnMax: 0.8, maxAct: [4, 6] },   // Dense
      { divMin: 5, divMax: 10, freqMin: 1, freqMax: 3, ampMin: 1, ampMax: 4, spawnMin: 2.0, spawnMax: 4.0, maxAct: [1, 2] },     // Minimal
      { divMin: 8, divMax: 15, freqMin: 4, freqMax: 9, ampMin: 6, ampMax: 15, spawnMin: 0.5, spawnMax: 1.5, maxAct: [3, 5] },    // Exotic
    ];
    const p = presets[variant];

    this.glitchAmount = 6;
    const { x, y, w, h } = this.px;

    this.divisionsX = this.rng.int(p.divMin, p.divMax);
    this.divisionsY = this.rng.int(p.divMin, p.divMax);
    this.waveFreqX = this.rng.float(p.freqMin, p.freqMax);
    this.waveFreqY = this.rng.float(p.freqMin, p.freqMax);
    this.waveAmp = this.rng.float(p.ampMin, p.ampMax);
    this.spawnInterval = this.rng.float(p.spawnMin, p.spawnMax);
    this.maxActive = this.rng.int(p.maxAct[0], p.maxAct[1]);

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

    // Create a real Mesh quad for each cell
    const meshes: THREE.Mesh[] = [];
    for (let i = 0; i < cells.length; i++) {
      const cellGeo = new THREE.PlaneGeometry(1, 1);
      const cellMat = new THREE.MeshBasicMaterial({
        color: this.palette.secondary,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(cellGeo, cellMat);
      mesh.position.set(0, 0, 1.5);
      meshes.push(mesh);
      this.group.add(mesh);
    }

    this.activeTetros.push({
      cells,
      meshes,
      opacity: 0,
      age: 0,
      lifespan: 1.5 + Math.random() * 2.0,
    });
  }

  private removeTetromino(idx: number): void {
    const tetro = this.activeTetros[idx];
    for (const mesh of tetro.meshes) {
      this.group.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as THREE.MeshBasicMaterial).dispose();
    }
    this.activeTetros.splice(idx, 1);
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

    // Update tetro lifetimes and positions
    const cellW = iw / divX;
    const cellH = ih / divY;

    for (let i = this.activeTetros.length - 1; i >= 0; i--) {
      const t = this.activeTetros[i];
      t.age += dt;
      // Fade in over 0.3s, hold, fade out over 0.4s at end of life
      const fadeIn = Math.min(1, t.age / 0.3);
      const fadeOut = Math.max(0, 1 - Math.max(0, t.age - (t.lifespan - 0.4)) / 0.4);
      t.opacity = fadeIn * fadeOut;

      if (t.age >= t.lifespan) {
        this.removeTetromino(i);
        continue;
      }

      // Position and fade each cell mesh
      for (let c = 0; c < t.cells.length; c++) {
        const [col, row] = t.cells[c];
        const mesh = t.meshes[c];
        const gx = (col + 0.5) / divX;
        const gy = (row + 0.5) / divY;
        const [dispX, dispY] = this.getDisplacement(gx, gy, time);
        mesh.position.set(
          ix + gx * iw + dispX,
          iy + gy * ih + dispY,
          1.5,
        );
        mesh.scale.set(cellW * 0.9, cellH * 0.9, 1);
        (mesh.material as THREE.MeshBasicMaterial).opacity = t.opacity * opacity * 0.7;
      }
    }
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
      this.spawnTetromino();
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) { this.alertMode = false; return; }
    if (level >= 4) { this.alertMode = true; }
    if (level >= 3) this.spawnTetromino();
  }

  dispose(): void {
    for (let i = this.activeTetros.length - 1; i >= 0; i--) {
      this.removeTetromino(i);
    }
    super.dispose();
  }
}
