import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

interface MetaballPreset {
  ballCount: number;
  threshold: number;
  speed: number;
  resolution: number;
}

/**
 * Metaball / blobby implicit surfaces. Multiple circles with smooth blending
 * via sum-of-1/r^2 fields. Threshold contour extracted via marching squares.
 * Canvas rendered.
 */
export class MetaballMergeElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'metaball-merge',
    meta: {
      shape: 'rectangular',
      roles: ['decorative'],
      moods: ['ambient'],
      sizes: ['needs-medium', 'needs-large'],
      bandAffinity: 'sub',
    } satisfies ElementMeta,
  };

  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private texture!: THREE.CanvasTexture;
  private mesh!: THREE.Mesh;
  private mat!: THREE.MeshBasicMaterial;

  private ballCount = 5;
  private ballX!: Float32Array;
  private ballY!: Float32Array;
  private ballVX!: Float32Array;
  private ballVY!: Float32Array;
  private ballRadius!: Float32Array;
  private threshold = 1.0;
  private speed = 1.0;
  private cw = 0;
  private ch = 0;
  private field!: Float32Array;
  private fieldW = 0;
  private fieldH = 0;
  private intensityLevel = 0;

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;

    const variant = this.rng.int(0, 3);
    const presets: MetaballPreset[] = [
      { ballCount: 5,  threshold: 1.0, speed: 1.0, resolution: 120 },
      { ballCount: 10, threshold: 0.8, speed: 1.5, resolution: 100 },
      { ballCount: 3,  threshold: 1.2, speed: 0.6, resolution: 150 },
      { ballCount: 7,  threshold: 0.9, speed: 2.0, resolution: 90  },
    ];
    const p = presets[variant];
    this.ballCount = p.ballCount;
    this.threshold = p.threshold;
    this.speed = p.speed;

    this.cw = Math.min(Math.round(w), p.resolution * 2);
    this.ch = Math.min(Math.round(h), p.resolution * 2);
    this.fieldW = Math.min(Math.round(w / 2), p.resolution);
    this.fieldH = Math.min(Math.round(h / 2), p.resolution);
    this.field = new Float32Array(this.fieldW * this.fieldH);

    this.canvas = document.createElement('canvas');
    this.canvas.width = this.cw;
    this.canvas.height = this.ch;
    this.ctx = this.get2DContext(this.canvas);
    this.texture = new THREE.CanvasTexture(this.canvas);

    // Initialize balls
    this.ballX = new Float32Array(this.ballCount);
    this.ballY = new Float32Array(this.ballCount);
    this.ballVX = new Float32Array(this.ballCount);
    this.ballVY = new Float32Array(this.ballCount);
    this.ballRadius = new Float32Array(this.ballCount);

    const minDim = Math.min(this.fieldW, this.fieldH);
    for (let i = 0; i < this.ballCount; i++) {
      this.ballX[i] = this.rng.float(this.fieldW * 0.2, this.fieldW * 0.8);
      this.ballY[i] = this.rng.float(this.fieldH * 0.2, this.fieldH * 0.8);
      const angle = this.rng.float(0, Math.PI * 2);
      const spd = this.rng.float(10, 30) * this.speed;
      this.ballVX[i] = Math.cos(angle) * spd;
      this.ballVY[i] = Math.sin(angle) * spd;
      this.ballRadius[i] = this.rng.float(minDim * 0.08, minDim * 0.2);
    }

    const planeGeo = new THREE.PlaneGeometry(w, h);
    this.mat = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      opacity: 0,
    });
    this.mesh = new THREE.Mesh(planeGeo, this.mat);
    this.mesh.position.set(x + w / 2, y + h / 2, 0);
    this.group.add(this.mesh);
  }

  private computeField(): void {
    for (let fy = 0; fy < this.fieldH; fy++) {
      for (let fx = 0; fx < this.fieldW; fx++) {
        let sum = 0;
        for (let b = 0; b < this.ballCount; b++) {
          const dx = fx - this.ballX[b];
          const dy = fy - this.ballY[b];
          const r2 = dx * dx + dy * dy;
          const radius = this.ballRadius[b];
          sum += (radius * radius) / (r2 + 1);
        }
        this.field[fy * this.fieldW + fx] = sum;
      }
    }
  }

  private drawField(): void {
    const ctx = this.ctx;
    const imgData = ctx.createImageData(this.cw, this.ch);
    const data = imgData.data;

    const bg = this.palette.bg;
    const pri = this.palette.primary;
    const sec = this.palette.secondary;
    const dim = this.palette.dim;
    const threshold = this.threshold;

    const scaleX = this.fieldW / this.cw;
    const scaleY = this.fieldH / this.ch;

    for (let py = 0; py < this.ch; py++) {
      for (let px = 0; px < this.cw; px++) {
        const fx = Math.min(this.fieldW - 1, Math.floor(px * scaleX));
        const fy = Math.min(this.fieldH - 1, Math.floor(py * scaleY));
        const val = this.field[fy * this.fieldW + fx];
        const pidx = (py * this.cw + px) * 4;

        if (val >= threshold) {
          // Inside metaball: blend primary to secondary based on field strength
          const t = Math.min(1, (val - threshold) / threshold);
          data[pidx] = Math.floor((pri.r + (sec.r - pri.r) * t) * 255);
          data[pidx + 1] = Math.floor((pri.g + (sec.g - pri.g) * t) * 255);
          data[pidx + 2] = Math.floor((pri.b + (sec.b - pri.b) * t) * 255);
          data[pidx + 3] = Math.floor((0.5 + t * 0.4) * 255);
        } else if (val >= threshold * 0.7) {
          // Edge glow
          const t = (val - threshold * 0.7) / (threshold * 0.3);
          data[pidx] = Math.floor(dim.r * t * 255);
          data[pidx + 1] = Math.floor(dim.g * t * 255);
          data[pidx + 2] = Math.floor(dim.b * t * 255);
          data[pidx + 3] = Math.floor(t * 0.6 * 255);
        } else {
          // Background
          data[pidx] = Math.floor(bg.r * 255);
          data[pidx + 1] = Math.floor(bg.g * 255);
          data[pidx + 2] = Math.floor(bg.b * 255);
          data[pidx + 3] = 60;
        }

        // Contour line at threshold boundary
        if (Math.abs(val - threshold) < threshold * 0.08) {
          data[pidx] = Math.floor(sec.r * 255);
          data[pidx + 1] = Math.floor(sec.g * 255);
          data[pidx + 2] = Math.floor(sec.b * 255);
          data[pidx + 3] = 220;
        }
      }
    }

    ctx.putImageData(imgData, 0, 0);
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);
    const speedMul = 1 + this.intensityLevel * 0.3;

    // Move balls
    for (let i = 0; i < this.ballCount; i++) {
      this.ballX[i] += this.ballVX[i] * dt * speedMul;
      this.ballY[i] += this.ballVY[i] * dt * speedMul;

      // Bounce off field edges
      if (this.ballX[i] < 0 || this.ballX[i] >= this.fieldW) {
        this.ballVX[i] = -this.ballVX[i];
        this.ballX[i] = Math.max(0, Math.min(this.fieldW - 1, this.ballX[i]));
      }
      if (this.ballY[i] < 0 || this.ballY[i] >= this.fieldH) {
        this.ballVY[i] = -this.ballVY[i];
        this.ballY[i] = Math.max(0, Math.min(this.fieldH - 1, this.ballY[i]));
      }
    }

    this.computeField();
    this.drawField();
    this.texture.needsUpdate = true;
    this.mat.opacity = opacity;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Scatter balls with high velocity
      for (let i = 0; i < this.ballCount; i++) {
        const angle = this.rng.float(0, Math.PI * 2);
        const spd = this.rng.float(40, 80) * this.speed;
        this.ballVX[i] = Math.cos(angle) * spd;
        this.ballVY[i] = Math.sin(angle) * spd;
      }
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    this.intensityLevel = level;
    if (level >= 4) {
      // Grow ball radii temporarily
      const minDim = Math.min(this.fieldW, this.fieldH);
      for (let i = 0; i < this.ballCount; i++) {
        this.ballRadius[i] = this.rng.float(minDim * 0.12, minDim * 0.28);
      }
    }
  }
}
