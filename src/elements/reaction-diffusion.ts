import * as THREE from 'three';
import { BaseElement } from './base-element';

/**
 * Gray-Scott reaction-diffusion system producing evolving Turing patterns —
 * organic spots, stripes, and labyrinthine structures that resemble a
 * containment field or biological culture analysis display.
 * Canvas-based rendering at half resolution with linear upscaling.
 */
export class ReactionDiffusionElement extends BaseElement {
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private texture!: THREE.CanvasTexture;
  private mesh!: THREE.Mesh;

  private cols: number = 0;
  private rows: number = 0;
  private u!: Float32Array;
  private v!: Float32Array;

  // Gray-Scott parameters
  private readonly Du = 0.16;
  private readonly Dv = 0.08;
  private f: number = 0;
  private k: number = 0;

  private renderAccum: number = 0;
  private readonly RENDER_INTERVAL = 1 / 20;

  // Action state
  private feedBoostTimer: number = 0;
  private baseFeedRate: number = 0;

  // Looping: detect stagnation and reinitialize
  private prevVSum: number = 0;
  private stagnantFrames: number = 0;
  private readonly STAGNANT_THRESHOLD = 40; // frames with no meaningful change before reset

  build(): void {
    this.glitchAmount = 5;
    const { x, y, w, h } = this.px;

    // Half-resolution canvas for performance
    this.cols = Math.max(40, Math.floor(w / 2));
    this.rows = Math.max(30, Math.floor(h / 2));

    // Initialize Gray-Scott parameters
    this.f = this.rng.float(0.03, 0.06);
    this.k = this.rng.float(0.06, 0.065);
    this.baseFeedRate = this.f;

    // Allocate chemical grids
    const size = this.cols * this.rows;
    this.u = new Float32Array(size);
    this.v = new Float32Array(size);

    // Initialize and seed
    this.initializeGrid();

    // Run some warmup steps so patterns are visible immediately
    for (let i = 0; i < 200; i++) {
      this.simulate(1);
    }

    // Canvas setup
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.cols;
    this.canvas.height = this.rows;
    this.ctx = this.canvas.getContext('2d')!;

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;

    const geo = new THREE.PlaneGeometry(w, h);
    this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      opacity: 0,
    }));
    this.mesh.position.set(x + w / 2, y + h / 2, 1);
    this.group.add(this.mesh);
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);

    // Handle feed rate boost from pulse action
    if (this.feedBoostTimer > 0) {
      this.feedBoostTimer -= dt;
      this.f = this.baseFeedRate * 2.0;
      if (this.feedBoostTimer <= 0) {
        this.f = this.baseFeedRate;
      }
    }

    // Run simulation substeps every frame
    const substeps = 6;
    this.simulate(substeps);

    // Detect stagnation: if v-sum barely changes, pattern has converged
    let vSum = 0;
    for (let i = 0, len = this.v.length; i < len; i++) vSum += this.v[i];
    const delta = Math.abs(vSum - this.prevVSum);
    this.prevVSum = vSum;

    if (delta < 0.01) {
      this.stagnantFrames++;
      if (this.stagnantFrames >= this.STAGNANT_THRESHOLD) {
        // Pattern has converged — reinitialize with new parameters
        this.f = this.rng.float(0.03, 0.06);
        this.k = this.rng.float(0.06, 0.065);
        this.baseFeedRate = this.f;
        this.initializeGrid();
        for (let i = 0; i < 200; i++) this.simulate(1);
        this.stagnantFrames = 0;
      }
    } else {
      this.stagnantFrames = 0;
    }

    // Render at ~20fps
    this.renderAccum += dt;
    if (this.renderAccum >= this.RENDER_INTERVAL) {
      this.renderAccum = 0;
      this.renderCanvas();
    }

    (this.mesh.material as THREE.MeshBasicMaterial).opacity = opacity;
  }

  /** Initialize u=1 everywhere, v=0 everywhere, then seed v patches. */
  private initializeGrid(): void {
    const size = this.cols * this.rows;

    // u=1, v=0 everywhere
    for (let i = 0; i < size; i++) {
      this.u[i] = 1.0;
      this.v[i] = 0.0;
    }

    // Seed 3-5 rectangular patches of v=1
    const patchCount = this.rng.int(3, 5);
    for (let p = 0; p < patchCount; p++) {
      const pw = this.rng.int(4, Math.max(5, Math.floor(this.cols * 0.12)));
      const ph = this.rng.int(4, Math.max(5, Math.floor(this.rows * 0.12)));
      const px = this.rng.int(0, this.cols - pw);
      const py = this.rng.int(0, this.rows - ph);

      for (let ry = py; ry < py + ph; ry++) {
        for (let rx = px; rx < px + pw; rx++) {
          const idx = ry * this.cols + rx;
          this.u[idx] = 0.5;
          this.v[idx] = 0.25;
        }
      }
    }

    // Seed a few small circular spots
    const circleCount = this.rng.int(3, 6);
    for (let c = 0; c < circleCount; c++) {
      const cx = this.rng.int(5, this.cols - 5);
      const cy = this.rng.int(5, this.rows - 5);
      const radius = this.rng.int(2, 5);

      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (dx * dx + dy * dy <= radius * radius) {
            const gx = (cx + dx + this.cols) % this.cols;
            const gy = (cy + dy + this.rows) % this.rows;
            const idx = gy * this.cols + gx;
            this.u[idx] = 0.5;
            this.v[idx] = 0.25;
          }
        }
      }
    }
  }

  /** Run n substeps of the Gray-Scott equations. */
  private simulate(substeps: number): void {
    const { cols, rows, Du, Dv, f, k } = this;
    const size = cols * rows;

    for (let step = 0; step < substeps; step++) {
      const newU = new Float32Array(size);
      const newV = new Float32Array(size);

      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const idx = y * cols + x;

          // 5-point Laplacian with wrapping edges
          const left  = y * cols + ((x - 1 + cols) % cols);
          const right = y * cols + ((x + 1) % cols);
          const up    = ((y - 1 + rows) % rows) * cols + x;
          const down  = ((y + 1) % rows) * cols + x;

          const lapU = this.u[left] + this.u[right] + this.u[up] + this.u[down] - 4.0 * this.u[idx];
          const lapV = this.v[left] + this.v[right] + this.v[up] + this.v[down] - 4.0 * this.v[idx];

          const uVal = this.u[idx];
          const vVal = this.v[idx];
          const uvv = uVal * vVal * vVal;

          newU[idx] = uVal + (Du * lapU - uvv + f * (1.0 - uVal));
          newV[idx] = vVal + (Dv * lapV + uvv - (f + k) * vVal);

          // Clamp to [0, 1]
          if (newU[idx] < 0) newU[idx] = 0;
          if (newU[idx] > 1) newU[idx] = 1;
          if (newV[idx] < 0) newV[idx] = 0;
          if (newV[idx] > 1) newV[idx] = 1;
        }
      }

      this.u = newU;
      this.v = newV;
    }
  }

  /** Render v-values to canvas using palette colors. */
  private renderCanvas(): void {
    const { ctx, canvas, cols, rows } = this;
    const imgData = ctx.createImageData(canvas.width, canvas.height);
    const data = imgData.data;

    const bg = this.palette.bg;
    const dim = this.palette.dim;
    const primary = this.palette.primary;
    const secondary = this.palette.secondary;

    // Pre-compute palette RGB values
    const bgR = bg.r * 255, bgG = bg.g * 255, bgB = bg.b * 255;
    const dimR = dim.r * 255, dimG = dim.g * 255, dimB = dim.b * 255;
    const priR = primary.r * 255, priG = primary.g * 255, priB = primary.b * 255;
    const secR = secondary.r * 255, secG = secondary.g * 255, secB = secondary.b * 255;

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const idx = y * cols + x;
        const val = Math.min(1, Math.max(0, this.v[idx]));
        const px = (y * cols + x) * 4;

        let r: number, g: number, b: number;

        if (val < 0.15) {
          // Background to dim (wider bg zone)
          const t = val / 0.15;
          r = bgR + (dimR - bgR) * t * 0.5;
          g = bgG + (dimG - bgG) * t * 0.5;
          b = bgB + (dimB - bgB) * t * 0.5;
        } else if (val < 0.4) {
          // Dim to primary (subdued)
          const t = (val - 0.15) / 0.25;
          r = dimR * 0.5 + (priR * 0.6 - dimR * 0.5) * t;
          g = dimG * 0.5 + (priG * 0.6 - dimG * 0.5) * t;
          b = dimB * 0.5 + (priB * 0.6 - dimB * 0.5) * t;
        } else {
          // Primary at reduced intensity — no bright bloom
          const t = Math.min(1, (val - 0.4) / 0.6);
          r = priR * 0.6 + (secR * 0.5 - priR * 0.6) * t;
          g = priG * 0.6 + (secG * 0.5 - priG * 0.6) * t;
          b = priB * 0.6 + (secB * 0.5 - priB * 0.6) * t;
        }

        data[px]     = Math.floor(r);
        data[px + 1] = Math.floor(g);
        data[px + 2] = Math.floor(b);
        data[px + 3] = 255;
      }
    }

    ctx.putImageData(imgData, 0, 0);
    this.texture.needsUpdate = true;
  }

  /** Seed random v-patches at random positions. */
  private seedRandomPatches(): void {
    const patchCount = this.rng.int(2, 4);
    for (let p = 0; p < patchCount; p++) {
      const pw = this.rng.int(3, Math.max(4, Math.floor(this.cols * 0.08)));
      const ph = this.rng.int(3, Math.max(4, Math.floor(this.rows * 0.08)));
      const px = this.rng.int(0, this.cols - pw);
      const py = this.rng.int(0, this.rows - ph);

      for (let ry = py; ry < py + ph; ry++) {
        for (let rx = px; rx < px + pw; rx++) {
          const idx = ry * this.cols + rx;
          this.u[idx] = 0.5;
          this.v[idx] = 0.25;
        }
      }
    }
  }

  onAction(action: string): void {
    super.onAction(action);

    if (action === 'glitch') {
      // Seed new random patches at random positions
      this.seedRandomPatches();
    }

    if (action === 'alert') {
      // Reset entire grid and reseed with different f/k parameters
      this.f = this.rng.float(0.03, 0.06);
      this.k = this.rng.float(0.06, 0.065);
      this.baseFeedRate = this.f;
      this.initializeGrid();
      this.pulseTimer = 2.0;
    }

    if (action === 'pulse') {
      // Briefly boost feed rate for faster pattern emergence
      this.feedBoostTimer = 1.5;
    }
  }

  dispose(): void {
    this.texture.dispose();
    super.dispose();
  }
}
