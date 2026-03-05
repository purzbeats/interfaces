import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Diffusion-limited aggregation (DLA) — fractal crystal growth.
 * Random walkers stick on contact with the growing cluster,
 * producing dendritic fractal patterns like frost or coral.
 */
export class DiffusionLimitedElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'diffusion-limited',
    meta: { shape: 'rectangular', roles: ['data-display', 'decorative'], moods: ['diagnostic', 'ambient'], bandAffinity: 'mid', sizes: ['needs-medium', 'needs-large'] },
  };

  private gridW = 0;
  private gridH = 0;
  private grid!: Uint8Array; // 1 = occupied
  private clusterCount = 0;

  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private texture!: THREE.CanvasTexture;
  private mesh!: THREE.Mesh;
  private walkersPerFrame = 20;
  private stepsPerWalker = 200;
  private renderAccum = 0;
  private maxCluster = 0;

  build(): void {
    const variant = this.rng.int(0, 3);
    const presets = [
      { res: 150, walkers: 20, steps: 200, max: 8000 },
      { res: 250, walkers: 40, steps: 300, max: 15000 },
      { res: 100, walkers: 10, steps: 150, max: 4000 },
      { res: 200, walkers: 60, steps: 250, max: 12000 },
    ];
    const p = presets[variant];
    this.glitchAmount = 4;

    const { x, y, w, h } = this.px;
    const aspect = w / h;
    this.gridW = Math.round(p.res * Math.max(1, aspect));
    this.gridH = Math.round(p.res / Math.max(1, 1 / aspect));
    this.grid = new Uint8Array(this.gridW * this.gridH);
    this.walkersPerFrame = p.walkers;
    this.stepsPerWalker = p.steps;
    this.maxCluster = p.max;

    // Seed at center
    const cx = Math.floor(this.gridW / 2);
    const cy = Math.floor(this.gridH / 2);
    this.grid[cy * this.gridW + cx] = 1;
    this.clusterCount = 1;

    this.canvas = document.createElement('canvas');
    this.canvas.width = this.gridW;
    this.canvas.height = this.gridH;
    this.ctx = this.get2DContext(this.canvas);

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.magFilter = THREE.NearestFilter;

    const geo = new THREE.PlaneGeometry(w, h);
    this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, opacity: 0 }));
    this.mesh.position.set(x + w / 2, y + h / 2, 0);
    this.group.add(this.mesh);
  }

  private hasNeighbor(gx: number, gy: number): boolean {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = gx + dx, ny = gy + dy;
        if (nx >= 0 && nx < this.gridW && ny >= 0 && ny < this.gridH) {
          if (this.grid[ny * this.gridW + nx]) return true;
        }
      }
    }
    return false;
  }

  private runWalker(): void {
    if (this.clusterCount >= this.maxCluster) return;

    // Spawn on random edge
    let wx: number, wy: number;
    const edge = this.rng.int(0, 3);
    switch (edge) {
      case 0: wx = this.rng.int(0, this.gridW - 1); wy = 0; break;
      case 1: wx = this.gridW - 1; wy = this.rng.int(0, this.gridH - 1); break;
      case 2: wx = this.rng.int(0, this.gridW - 1); wy = this.gridH - 1; break;
      default: wx = 0; wy = this.rng.int(0, this.gridH - 1);
    }

    for (let step = 0; step < this.stepsPerWalker; step++) {
      // Random walk
      const dir = this.rng.int(0, 3);
      if (dir === 0) wx++;
      else if (dir === 1) wx--;
      else if (dir === 2) wy++;
      else wy--;

      if (wx < 0 || wx >= this.gridW || wy < 0 || wy >= this.gridH) return;

      if (this.hasNeighbor(wx, wy) && !this.grid[wy * this.gridW + wx]) {
        this.grid[wy * this.gridW + wx] = 1;
        this.clusterCount++;
        return;
      }
    }
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);

    for (let i = 0; i < this.walkersPerFrame; i++) this.runWalker();

    // Auto-reset when full
    if (this.clusterCount >= this.maxCluster) {
      this.grid.fill(0);
      const cx = Math.floor(this.gridW / 2);
      const cy = Math.floor(this.gridH / 2);
      this.grid[cy * this.gridW + cx] = 1;
      this.clusterCount = 1;
    }

    this.renderAccum += dt;
    if (this.renderAccum >= 0.1) {
      this.renderAccum = 0;
      const img = this.ctx.getImageData(0, 0, this.gridW, this.gridH);
      const data = img.data;
      const pr = Math.floor(this.palette.primary.r * 255);
      const pg2 = Math.floor(this.palette.primary.g * 255);
      const pb = Math.floor(this.palette.primary.b * 255);

      for (let i = 0; i < this.grid.length; i++) {
        const idx = i * 4;
        if (this.grid[i]) {
          data[idx] = pr; data[idx + 1] = pg2; data[idx + 2] = pb; data[idx + 3] = 255;
        } else {
          data[idx] = 0; data[idx + 1] = 0; data[idx + 2] = 0; data[idx + 3] = 255;
        }
      }
      this.ctx.putImageData(img, 0, 0);
      this.texture.needsUpdate = true;
    }

    (this.mesh.material as THREE.MeshBasicMaterial).opacity = opacity * 0.9;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'alert') {
      this.grid.fill(0);
      const cx = Math.floor(this.gridW / 2);
      const cy = Math.floor(this.gridH / 2);
      this.grid[cy * this.gridW + cx] = 1;
      this.clusterCount = 1;
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level >= 3) this.walkersPerFrame = 60;
    if (level >= 5) this.walkersPerFrame = 150;
  }
}
