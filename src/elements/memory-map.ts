import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Grid of tiny blocks showing allocation/deallocation waves.
 * Canvas-based rendering of memory block states.
 */
export class MemoryMapElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'memory-map',
    meta: { shape: 'rectangular', roles: ['data-display', 'decorative'], moods: ['diagnostic', 'ambient'], bandAffinity: 'mid', sizes: ['needs-medium'] },
  };
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private texture!: THREE.CanvasTexture;
  private mesh!: THREE.Mesh;
  private borderLines!: THREE.LineSegments;
  private gridW: number = 0;
  private gridH: number = 0;
  private blockStates: number[] = []; // 0=free, 1=allocated, transitioning values
  private wavePhase: number = 0;
  private waveSpeed: number = 0;
  private allocTimer: number = 0;
  private renderAccum: number = 0;
  private readonly RENDER_INTERVAL = 1 / 15;

  build(): void {
    const variant = this.rng.int(0, 3);
    const presets = [
      { blockPicks: [10, 12, 14], waveMin: 1, waveMax: 3, fillChance: 0.3 },    // Standard
      { blockPicks: [7, 8, 10], waveMin: 3, waveMax: 6, fillChance: 0.4 },     // Dense
      { blockPicks: [14, 16, 20], waveMin: 0.5, waveMax: 1.5, fillChance: 0.15 }, // Minimal
      { blockPicks: [9, 11, 13], waveMin: 2, waveMax: 5, fillChance: 0.5 },    // Exotic
    ];
    const p = presets[variant];

    const { x, y, w, h } = this.px;
    const blockSize = this.rng.pick(p.blockPicks);
    this.gridW = Math.max(8, Math.floor(w / blockSize));
    this.gridH = Math.max(8, Math.floor(h / blockSize));
    this.waveSpeed = this.rng.float(p.waveMin, p.waveMax);

    // Initialize with random allocation
    for (let i = 0; i < this.gridW * this.gridH; i++) {
      this.blockStates.push(this.rng.chance(p.fillChance) ? 1 : 0);
    }

    this.canvas = document.createElement('canvas');
    this.canvas.width = this.gridW;
    this.canvas.height = this.gridH;
    this.ctx = this.get2DContext(this.canvas);
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.magFilter = THREE.NearestFilter;

    const geo = new THREE.PlaneGeometry(w, h);
    this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      opacity: 0,
    }));
    this.mesh.position.set(x + w / 2, y + h / 2, 1);
    this.group.add(this.mesh);

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

    // Advance wave
    this.wavePhase += dt * this.waveSpeed;

    // Periodic allocation/deallocation events
    this.allocTimer += dt;
    if (this.allocTimer > 0.1) {
      this.allocTimer = 0;
      // Allocate/deallocate small blocks in waves
      const waveX = ((Math.sin(this.wavePhase) + 1) / 2) * this.gridW;
      const waveY = ((Math.cos(this.wavePhase * 0.7) + 1) / 2) * this.gridH;
      const radius = 3;

      for (let gy = Math.max(0, Math.floor(waveY - radius)); gy < Math.min(this.gridH, Math.ceil(waveY + radius)); gy++) {
        for (let gx2 = Math.max(0, Math.floor(waveX - radius)); gx2 < Math.min(this.gridW, Math.ceil(waveX + radius)); gx2++) {
          const dist = Math.sqrt((gx2 - waveX) ** 2 + (gy - waveY) ** 2);
          if (dist < radius) {
            const idx = gy * this.gridW + gx2;
            this.blockStates[idx] = this.rng.chance(0.6) ? 1 : 0;
          }
        }
      }

      // Random scattered changes
      for (let i = 0; i < 5; i++) {
        const idx = this.rng.int(0, this.blockStates.length - 1);
        this.blockStates[idx] = this.rng.chance(0.5) ? 1 : 0;
      }
    }

    this.renderAccum += dt;
    if (this.renderAccum >= this.RENDER_INTERVAL) {
      this.renderAccum = 0;
      this.renderCanvas();
    }

    (this.mesh.material as THREE.MeshBasicMaterial).opacity = opacity * 0.55;
    (this.borderLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.3;
  }

  private renderCanvas(): void {
    const { ctx, canvas } = this;
    const imgData = ctx.createImageData(canvas.width, canvas.height);
    const data = imgData.data;

    const primary = this.palette.primary;
    const dim = this.palette.dim;
    const secondary = this.palette.secondary;
    const isGlitching = this.glitchTimer > 0;

    for (let i = 0; i < this.blockStates.length; i++) {
      const v = this.blockStates[i];
      let color: THREE.Color;

      if (isGlitching) {
        color = this.rng.chance(0.5) ? secondary : primary;
      } else if (v > 0.5) {
        color = primary;
      } else {
        color = dim;
      }

      const brightness = v > 0.5 ? 0.55 : 0.08;
      data[i * 4] = Math.floor(color.r * 255 * brightness);
      data[i * 4 + 1] = Math.floor(color.g * 255 * brightness);
      data[i * 4 + 2] = Math.floor(color.b * 255 * brightness);
      data[i * 4 + 3] = v > 0.5 ? 230 : 100;
    }

    ctx.putImageData(imgData, 0, 0);
    this.texture.needsUpdate = true;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Scramble blocks
      for (let i = 0; i < this.blockStates.length; i++) {
        this.blockStates[i] = this.rng.chance(0.5) ? 1 : 0;
      }
    }
    if (action === 'alert') {
      // Flood allocate
      for (let i = 0; i < this.blockStates.length; i++) {
        this.blockStates[i] = 1;
      }
    }
  }

  dispose(): void {
    this.texture.dispose();
    super.dispose();
  }
}
