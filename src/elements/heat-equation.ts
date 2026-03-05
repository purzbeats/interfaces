import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * 2D heat equation diffusion with interactive hot spots.
 * Temperature field diffuses outward from sources, rendered as a thermal
 * camera view with smooth gradients — like infrared imagery on a monitoring station.
 */
export class HeatEquationElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'heat-equation',
    meta: { shape: 'rectangular', roles: ['data-display', 'scanner'], moods: ['diagnostic', 'tactical'], bandAffinity: 'bass', sizes: ['needs-medium', 'needs-large'] },
  };

  private cols = 0;
  private rows = 0;
  private temp!: Float32Array;
  private tempNext!: Float32Array;
  private sourceCount = 0;
  private sourceX: number[] = [];
  private sourceY: number[] = [];
  private sourceTemp: number[] = [];
  private sourceDx: number[] = [];
  private sourceDy: number[] = [];
  private diffusionRate = 0.2;

  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private texture!: THREE.CanvasTexture;
  private mesh!: THREE.Mesh;
  private renderAccum = 0;

  build(): void {
    const variant = this.rng.int(0, 3);
    const presets = [
      { res: 120, sources: 3, diffusion: 0.2 },
      { res: 180, sources: 6, diffusion: 0.25 },
      { res: 80, sources: 2, diffusion: 0.15 },
      { res: 150, sources: 5, diffusion: 0.3 },
    ];
    const p = presets[variant];
    this.glitchAmount = 4;

    const { x, y, w, h } = this.px;
    const aspect = w / h;
    this.cols = Math.round(p.res * Math.max(1, aspect));
    this.rows = Math.round(p.res / Math.max(1, 1 / aspect));
    this.diffusionRate = p.diffusion;

    this.temp = new Float32Array(this.cols * this.rows);
    this.tempNext = new Float32Array(this.cols * this.rows);

    // Moving heat sources
    this.sourceCount = p.sources;
    for (let i = 0; i < this.sourceCount; i++) {
      this.sourceX.push(this.rng.float(0.1, 0.9) * this.cols);
      this.sourceY.push(this.rng.float(0.1, 0.9) * this.rows);
      this.sourceTemp.push(this.rng.float(0.5, 1.0));
      this.sourceDx.push(this.rng.float(-5, 5));
      this.sourceDy.push(this.rng.float(-5, 5));
    }

    this.canvas = document.createElement('canvas');
    this.canvas.width = this.cols;
    this.canvas.height = this.rows;
    this.ctx = this.get2DContext(this.canvas);

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;

    const geo = new THREE.PlaneGeometry(w, h);
    this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, opacity: 0 }));
    this.mesh.position.set(x + w / 2, y + h / 2, 0);
    this.group.add(this.mesh);
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);
    const cdt = Math.min(dt, 0.033);

    // Move heat sources
    for (let s = 0; s < this.sourceCount; s++) {
      this.sourceX[s] += this.sourceDx[s] * cdt;
      this.sourceY[s] += this.sourceDy[s] * cdt;
      if (this.sourceX[s] < 2 || this.sourceX[s] > this.cols - 2) this.sourceDx[s] *= -1;
      if (this.sourceY[s] < 2 || this.sourceY[s] > this.rows - 2) this.sourceDy[s] *= -1;

      // Apply heat
      const sx = Math.floor(this.sourceX[s]);
      const sy = Math.floor(this.sourceY[s]);
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const nx = sx + dx, ny = sy + dy;
          if (nx >= 0 && nx < this.cols && ny >= 0 && ny < this.rows) {
            this.temp[ny * this.cols + nx] = Math.min(1, this.temp[ny * this.cols + nx] + this.sourceTemp[s] * 0.3);
          }
        }
      }
    }

    // Diffusion step (Laplacian)
    const d = this.diffusionRate;
    for (let y2 = 1; y2 < this.rows - 1; y2++) {
      for (let x2 = 1; x2 < this.cols - 1; x2++) {
        const idx = y2 * this.cols + x2;
        const laplacian = this.temp[idx - 1] + this.temp[idx + 1] + this.temp[idx - this.cols] + this.temp[idx + this.cols] - 4 * this.temp[idx];
        this.tempNext[idx] = this.temp[idx] + d * laplacian;
      }
    }

    // Swap and cool
    for (let i = 0; i < this.temp.length; i++) {
      this.temp[i] = Math.max(0, this.tempNext[i] * 0.998);
    }

    // Render
    this.renderAccum += dt;
    if (this.renderAccum >= 0.05) {
      this.renderAccum = 0;
      const img = this.ctx.getImageData(0, 0, this.cols, this.rows);
      const data = img.data;
      // Thermal palette: black → primary → secondary → white
      const pr = this.palette.primary.r * 255, pg2 = this.palette.primary.g * 255, pb = this.palette.primary.b * 255;
      const sr = this.palette.secondary.r * 255, sg = this.palette.secondary.g * 255, sb = this.palette.secondary.b * 255;

      for (let i = 0; i < this.temp.length; i++) {
        const v = this.temp[i];
        const idx = i * 4;
        if (v < 0.33) {
          const t = v / 0.33;
          data[idx] = pr * t * 0.5; data[idx + 1] = pg2 * t * 0.3; data[idx + 2] = pb * t * 0.5;
        } else if (v < 0.66) {
          const t = (v - 0.33) / 0.33;
          data[idx] = pr * (1 - t) + sr * t;
          data[idx + 1] = pg2 * (1 - t) + sg * t;
          data[idx + 2] = pb * (1 - t) + sb * t;
        } else {
          const t = (v - 0.66) / 0.34;
          data[idx] = sr + (255 - sr) * t;
          data[idx + 1] = sg + (255 - sg) * t;
          data[idx + 2] = sb + (255 - sb) * t;
        }
        data[idx + 3] = 255;
      }
      this.ctx.putImageData(img, 0, 0);
      this.texture.needsUpdate = true;
    }

    (this.mesh.material as THREE.MeshBasicMaterial).opacity = opacity * 0.9;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') this.temp.fill(0);
    if (action === 'alert') {
      // Heat bomb at center
      const cx = Math.floor(this.cols / 2);
      const cy = Math.floor(this.rows / 2);
      for (let dy = -10; dy <= 10; dy++) {
        for (let dx = -10; dx <= 10; dx++) {
          const nx = cx + dx, ny = cy + dy;
          if (nx >= 0 && nx < this.cols && ny >= 0 && ny < this.rows) {
            this.temp[ny * this.cols + nx] = 1;
          }
        }
      }
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level >= 3) {
      for (let s = 0; s < this.sourceCount; s++) this.sourceTemp[s] = 1;
    }
  }
}
