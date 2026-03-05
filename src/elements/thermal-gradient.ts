import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * 1D/2D heat conduction simulation. Hot source on one side, cold sink
 * on the other. Temperature shown as color gradient evolving over time
 * using the heat equation. Canvas rendered.
 */
export class ThermalGradientElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'thermal-gradient',
    meta: {
      shape: 'rectangular',
      roles: ['data-display', 'gauge'],
      moods: ['diagnostic', 'tactical'],
      bandAffinity: 'sub',
      sizes: ['works-small', 'needs-medium'],
    },
  };

  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private texture!: THREE.CanvasTexture;
  private mesh!: THREE.Mesh;

  private gridW: number = 0;
  private gridH: number = 0;
  private temp: Float32Array = new Float32Array(0);
  private tempNext: Float32Array = new Float32Array(0);
  private alpha: number = 0.2;  // thermal diffusivity
  private hotTemp: number = 1;
  private coldTemp: number = 0;
  private mode: string = '2d';
  private hotSide: string = 'left';
  private speedMult: number = 1;
  private hotPulse: number = 0;

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;

    const variant = this.rng.int(0, 3);
    const presets = [
      { mode: '2d', gridScale: 0.8, alpha: 0.25, hotSide: 'left' },
      { mode: '2d', gridScale: 0.7, alpha: 0.15, hotSide: 'bottom' },
      { mode: '1d', gridScale: 0.9, alpha: 0.3, hotSide: 'left' },
      { mode: '2d', gridScale: 0.6, alpha: 0.4, hotSide: 'center' },
    ];
    const p = presets[variant];
    this.mode = p.mode;
    this.alpha = p.alpha;
    this.hotSide = p.hotSide;

    if (this.mode === '1d') {
      this.gridW = Math.max(16, Math.floor(w * p.gridScale));
      this.gridH = 1;
    } else {
      this.gridW = Math.max(16, Math.floor(w * p.gridScale));
      this.gridH = Math.max(16, Math.floor(h * p.gridScale));
    }

    this.temp = new Float32Array(this.gridW * this.gridH);
    this.tempNext = new Float32Array(this.gridW * this.gridH);

    // Initialize with cold temperature
    this.temp.fill(this.coldTemp);
    this.tempNext.fill(this.coldTemp);

    // Canvas
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.gridW;
    this.canvas.height = this.mode === '1d' ? Math.max(8, Math.floor(h * 0.3)) : this.gridH;
    this.ctx = this.get2DContext(this.canvas);

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.magFilter = THREE.NearestFilter;

    const geo = new THREE.PlaneGeometry(w, h);
    const mat = new THREE.MeshBasicMaterial({
      map: this.texture, transparent: true, opacity: 0,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.set(x + w / 2, y + h / 2, 0);
    this.group.add(this.mesh);
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    const effDt = Math.min(dt, 0.05) * this.speedMult;

    // Apply boundary conditions
    const hotVal = this.hotTemp + this.hotPulse;
    if (this.hotSide === 'left') {
      for (let j = 0; j < this.gridH; j++) this.temp[j * this.gridW] = hotVal;
      for (let j = 0; j < this.gridH; j++) this.temp[j * this.gridW + this.gridW - 1] = this.coldTemp;
    } else if (this.hotSide === 'bottom') {
      for (let i = 0; i < this.gridW; i++) this.temp[(this.gridH - 1) * this.gridW + i] = hotVal;
      for (let i = 0; i < this.gridW; i++) this.temp[i] = this.coldTemp;
    } else if (this.hotSide === 'center') {
      const cx = Math.floor(this.gridW / 2);
      const cy = Math.floor(this.gridH / 2);
      const r = Math.max(3, Math.floor(Math.min(this.gridW, this.gridH) * 0.08));
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const gx = cx + dx;
          const gy = cy + dy;
          if (gx >= 0 && gx < this.gridW && gy >= 0 && gy < this.gridH) {
            this.temp[gy * this.gridW + gx] = hotVal;
          }
        }
      }
    }

    // Decay hot pulse
    if (this.hotPulse > 0) this.hotPulse = Math.max(0, this.hotPulse - dt * 2);

    // Heat equation: dT/dt = alpha * laplacian(T)
    const iterations = 6;
    for (let iter = 0; iter < iterations; iter++) {
      if (this.mode === '1d') {
        // 1D heat equation
        for (let i = 1; i < this.gridW - 1; i++) {
          const laplacian = this.temp[i - 1] - 2 * this.temp[i] + this.temp[i + 1];
          this.tempNext[i] = this.temp[i] + this.alpha * laplacian * effDt;
        }
        this.tempNext[0] = this.temp[0];
        this.tempNext[this.gridW - 1] = this.temp[this.gridW - 1];
      } else {
        // 2D heat equation
        for (let j = 1; j < this.gridH - 1; j++) {
          for (let i = 1; i < this.gridW - 1; i++) {
            const idx = j * this.gridW + i;
            const laplacian =
              this.temp[idx - 1] + this.temp[idx + 1] +
              this.temp[idx - this.gridW] + this.temp[idx + this.gridW] -
              4 * this.temp[idx];
            this.tempNext[idx] = this.temp[idx] + this.alpha * laplacian * effDt;
          }
        }
        // Copy boundaries
        for (let i = 0; i < this.gridW; i++) {
          this.tempNext[i] = this.temp[i];
          this.tempNext[(this.gridH - 1) * this.gridW + i] = this.temp[(this.gridH - 1) * this.gridW + i];
        }
        for (let j = 0; j < this.gridH; j++) {
          this.tempNext[j * this.gridW] = this.temp[j * this.gridW];
          this.tempNext[j * this.gridW + this.gridW - 1] = this.temp[j * this.gridW + this.gridW - 1];
        }
      }
      // Swap buffers
      const swap = this.temp;
      this.temp = this.tempNext;
      this.tempNext = swap;
    }

    // Render to canvas
    const canvasH = this.canvas.height;
    const imgData = this.ctx.createImageData(this.gridW, canvasH);
    const data = imgData.data;

    // Color palette: cold (bg/dim) -> hot (primary -> secondary)
    const cr = this.palette.bg.r; const cg = this.palette.bg.g; const cb = this.palette.bg.b;
    const mr = this.palette.primary.r; const mg = this.palette.primary.g; const mb = this.palette.primary.b;
    const hr = this.palette.secondary.r; const hg = this.palette.secondary.g; const hb = this.palette.secondary.b;

    for (let py = 0; py < canvasH; py++) {
      for (let px = 0; px < this.gridW; px++) {
        const tempIdx = this.mode === '1d' ? px : py * this.gridW + px;
        const t = Math.max(0, Math.min(1, this.temp[tempIdx] ?? 0));

        let r: number, g: number, b: number;
        if (t < 0.5) {
          const f = t * 2;
          r = cr + (mr - cr) * f;
          g = cg + (mg - cg) * f;
          b = cb + (mb - cb) * f;
        } else {
          const f = (t - 0.5) * 2;
          r = mr + (hr - mr) * f;
          g = mg + (hg - mg) * f;
          b = mb + (hb - mb) * f;
        }

        const idx = (py * this.gridW + px) * 4;
        data[idx] = Math.floor(r * 255);
        data[idx + 1] = Math.floor(g * 255);
        data[idx + 2] = Math.floor(b * 255);
        data[idx + 3] = 255;
      }
    }

    this.ctx.putImageData(imgData, 0, 0);
    this.texture.needsUpdate = true;

    (this.mesh.material as THREE.MeshBasicMaterial).opacity = opacity * 0.9;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Heat spike
      this.hotPulse = 2;
      this.speedMult = 3;
      setTimeout(() => { this.speedMult = 1; }, 400);
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level >= 3) {
      this.hotPulse = Math.max(this.hotPulse, level * 0.3);
      this.speedMult = 1 + level * 0.2;
    } else {
      this.speedMult = 1;
    }
  }
}
