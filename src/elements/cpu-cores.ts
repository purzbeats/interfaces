import * as THREE from 'three';
import { BaseElement } from './base-element';
import { stateOpacity, pulse, glitchOffset } from '../animation/fx';

/**
 * Grid of squares showing independent core load levels.
 * Grid of PlaneGeometry meshes, each with independent brightness via random walk.
 */
export class CpuCoresElement extends BaseElement {
  private cores: THREE.Mesh[] = [];
  private coreLoads: number[] = [];
  private coreTargets: number[] = [];
  private borderLines!: THREE.LineSegments;
  private cols: number = 0;
  private rows: number = 0;
  private updateTimer: number = 0;
  private updateInterval: number = 0;
  private pulseTimer: number = 0;
  private glitchTimer: number = 0;

  build(): void {
    const { x, y, w, h } = this.px;
    this.cols = this.rng.int(4, 8);
    this.rows = this.rng.int(2, 6);
    this.updateInterval = this.rng.float(0.3, 1.0);

    const gap = Math.min(w, h) * 0.02;
    const cellW = (w - gap * (this.cols + 1)) / this.cols;
    const cellH = (h - gap * (this.rows + 1)) / this.rows;
    const cellSize = Math.min(cellW, cellH);

    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const cx = x + gap + (cellSize + gap) * c + cellSize / 2;
        const cy = y + gap + (cellSize + gap) * r + cellSize / 2;
        const geo = new THREE.PlaneGeometry(cellSize * 0.9, cellSize * 0.9);
        const mat = new THREE.MeshBasicMaterial({
          color: this.palette.primary,
          transparent: true,
          opacity: 0,
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(cx, cy, 1);
        this.cores.push(mesh);
        this.group.add(mesh);

        const load = this.rng.float(0.1, 0.9);
        this.coreLoads.push(load);
        this.coreTargets.push(load);
      }
    }

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
    let opacity = stateOpacity(this.stateMachine.state, this.stateMachine.progress);

    if (this.pulseTimer > 0) {
      this.pulseTimer -= dt;
      opacity *= pulse(this.pulseTimer);
    }

    const gx = this.glitchTimer > 0 ? glitchOffset(this.glitchTimer, 3) : 0;
    if (this.glitchTimer > 0) this.glitchTimer -= dt;
    this.group.position.x = gx;

    // Update targets periodically
    this.updateTimer += dt;
    if (this.updateTimer >= this.updateInterval) {
      this.updateTimer = 0;
      for (let i = 0; i < this.cores.length; i++) {
        this.coreTargets[i] = Math.max(0.05, Math.min(1, this.coreTargets[i] + this.rng.float(-0.3, 0.3)));
      }
    }

    // Smooth toward targets
    for (let i = 0; i < this.cores.length; i++) {
      this.coreLoads[i] += (this.coreTargets[i] - this.coreLoads[i]) * dt * 5;
      const load = this.coreLoads[i];
      const mat = this.cores[i].material as THREE.MeshBasicMaterial;
      mat.opacity = opacity * (0.15 + load * 0.65);
      mat.color.copy(load > 0.85 ? this.palette.alert : this.palette.primary);
    }

    (this.borderLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.3;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'pulse') {
      this.pulseTimer = 0.5;
      for (let i = 0; i < this.cores.length; i++) {
        this.coreTargets[i] = this.rng.float(0.5, 1);
      }
    }
    if (action === 'glitch') {
      this.glitchTimer = 0.4;
      for (let i = 0; i < this.cores.length; i++) {
        this.coreLoads[i] = this.rng.float(0, 1);
      }
    }
    if (action === 'alert') {
      this.pulseTimer = 1.5;
      for (let i = 0; i < this.cores.length; i++) {
        this.coreTargets[i] = 1;
      }
    }
  }
}
