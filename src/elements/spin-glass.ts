import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * 2D Ising spin glass visualization. Spins on a grid with random couplings.
 * Metropolis algorithm updates at each frame. Frustrated bonds shown as
 * colored line segments between misaligned neighbors.
 */
export class SpinGlassElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'spin-glass',
    meta: { shape: 'rectangular', roles: ['data-display'], moods: ['diagnostic', 'tactical'], bandAffinity: 'sub', sizes: ['works-small', 'needs-medium'] },
  };

  private spinMesh!: THREE.InstancedMesh;
  private spinMat!: THREE.MeshBasicMaterial;
  private bondLine!: THREE.LineSegments;
  private bondMat!: THREE.LineBasicMaterial;
  private cols: number = 0;
  private rows: number = 0;
  private cellSize: number = 0;
  private spins!: Int8Array;
  private couplings!: Int8Array; // +1 or -1 for each bond
  private temperature: number = 2.0;
  private sweepsPerFrame: number = 1;
  private dummy = new THREE.Matrix4();
  private originX: number = 0;
  private originY: number = 0;

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;

    const variant = this.rng.int(0, 3);
    const presets = [
      { cell: 8, temp: 2.0, sweeps: 2 },
      { cell: 6, temp: 1.5, sweeps: 3 },
      { cell: 10, temp: 2.5, sweeps: 1 },
      { cell: 5, temp: 1.0, sweeps: 4 },
    ];
    const pr = presets[variant];
    this.cellSize = pr.cell;
    this.temperature = pr.temp;
    this.sweepsPerFrame = pr.sweeps;
    this.cols = Math.max(4, Math.floor(w / this.cellSize));
    this.rows = Math.max(4, Math.floor(h / this.cellSize));
    this.originX = x;
    this.originY = y;

    const count = this.cols * this.rows;
    this.spins = new Int8Array(count);
    // Random initial spins +1 or -1
    for (let i = 0; i < count; i++) {
      this.spins[i] = this.rng.chance(0.5) ? 1 : -1;
    }

    // Random couplings: 2 per site (right and down)
    this.couplings = new Int8Array(count * 2);
    for (let i = 0; i < count * 2; i++) {
      this.couplings[i] = this.rng.chance(0.5) ? 1 : -1;
    }

    // Spin display as instanced mesh
    const geo = new THREE.PlaneGeometry(this.cellSize * 0.7, this.cellSize * 0.7);
    this.spinMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0 });
    this.spinMesh = new THREE.InstancedMesh(geo, this.spinMat, count);
    this.spinMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);

    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const i = r * this.cols + c;
        this.dummy.makeTranslation(
          this.originX + c * this.cellSize + this.cellSize / 2,
          this.originY + r * this.cellSize + this.cellSize / 2,
          0,
        );
        this.spinMesh.setMatrixAt(i, this.dummy);
      }
    }
    this.spinMesh.instanceMatrix.needsUpdate = true;
    this.group.add(this.spinMesh);

    // Frustrated bond lines
    const maxBonds = count * 2;
    const bondPositions = new Float32Array(maxBonds * 6); // 2 verts per bond
    const bondGeo = new THREE.BufferGeometry();
    bondGeo.setAttribute('position', new THREE.BufferAttribute(bondPositions, 3));
    bondGeo.setDrawRange(0, 0);
    this.bondMat = new THREE.LineBasicMaterial({ color: this.palette.secondary, transparent: true, opacity: 0 });
    this.bondLine = new THREE.LineSegments(bondGeo, this.bondMat);
    this.group.add(this.bondLine);
  }

  private metropolisSweep(): void {
    const count = this.cols * this.rows;
    for (let iter = 0; iter < count; iter++) {
      const i = Math.floor(this.rng.next() * count);
      const r = Math.floor(i / this.cols);
      const c = i % this.cols;
      const s = this.spins[i];
      let dE = 0;

      // Neighbor interactions with random couplings
      if (c < this.cols - 1) dE += 2 * s * this.couplings[i * 2] * this.spins[r * this.cols + c + 1];
      if (c > 0) dE += 2 * s * this.couplings[(r * this.cols + c - 1) * 2] * this.spins[r * this.cols + c - 1];
      if (r < this.rows - 1) dE += 2 * s * this.couplings[i * 2 + 1] * this.spins[(r + 1) * this.cols + c];
      if (r > 0) dE += 2 * s * this.couplings[((r - 1) * this.cols + c) * 2 + 1] * this.spins[(r - 1) * this.cols + c];

      if (dE <= 0 || this.rng.next() < Math.exp(-dE / this.temperature)) {
        this.spins[i] = -s as (1 | -1);
      }
    }
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);

    for (let s = 0; s < this.sweepsPerFrame; s++) {
      this.metropolisSweep();
    }

    const count = this.cols * this.rows;
    const colorArr = this.spinMesh.instanceColor!.array as Float32Array;
    const up = this.palette.primary;
    const dn = this.palette.dim;

    for (let i = 0; i < count; i++) {
      const col = this.spins[i] > 0 ? up : dn;
      const j = i * 3;
      colorArr[j] = col.r * opacity;
      colorArr[j + 1] = col.g * opacity;
      colorArr[j + 2] = col.b * opacity;
    }
    this.spinMesh.instanceColor!.needsUpdate = true;
    this.spinMat.opacity = 1;

    // Update frustrated bonds
    const bondPos = this.bondLine.geometry.getAttribute('position') as THREE.BufferAttribute;
    const bArr = bondPos.array as Float32Array;
    let bIdx = 0;

    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const i = r * this.cols + c;
        const sx = this.originX + c * this.cellSize + this.cellSize / 2;
        const sy = this.originY + r * this.cellSize + this.cellSize / 2;
        // Right bond
        if (c < this.cols - 1) {
          const j = r * this.cols + c + 1;
          const frustrated = this.couplings[i * 2] * this.spins[i] * this.spins[j] > 0;
          if (frustrated) {
            bArr[bIdx++] = sx; bArr[bIdx++] = sy; bArr[bIdx++] = 1;
            bArr[bIdx++] = sx + this.cellSize; bArr[bIdx++] = sy; bArr[bIdx++] = 1;
          }
        }
        // Down bond
        if (r < this.rows - 1) {
          const j = (r + 1) * this.cols + c;
          const frustrated = this.couplings[i * 2 + 1] * this.spins[i] * this.spins[j] > 0;
          if (frustrated) {
            bArr[bIdx++] = sx; bArr[bIdx++] = sy; bArr[bIdx++] = 1;
            bArr[bIdx++] = sx; bArr[bIdx++] = sy + this.cellSize; bArr[bIdx++] = 1;
          }
        }
      }
    }
    bondPos.needsUpdate = true;
    this.bondLine.geometry.setDrawRange(0, bIdx / 3);
    this.bondMat.opacity = opacity * 0.6;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') this.glitchTimer = 0.5;
    if (action === 'alert') this.temperature = 0.5; // quench
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level >= 2) this.temperature = 2.0 + level * 0.5;
  }
}
