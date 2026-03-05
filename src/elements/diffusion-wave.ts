import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Fractional diffusion equation: anomalous subdiffusion where a concentration
 * profile spreads with a stretched exponential tail instead of Gaussian.
 * Multiple point sources emit pulses that spread with non-standard exponents,
 * rendered on a canvas with contour-style coloring.
 */
export class DiffusionWaveElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'diffusion-wave',
    meta: {
      shape: 'rectangular',
      roles: ['data-display', 'decorative'],
      moods: ['diagnostic', 'ambient'],
      bandAffinity: 'sub',
      sizes: ['needs-medium', 'needs-large'],
    } satisfies ElementMeta,
  };

  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private texture!: THREE.CanvasTexture;
  private mesh!: THREE.Mesh;
  private meshMat!: THREE.MeshBasicMaterial;
  private profileLine!: THREE.Line;
  private profilePositions!: Float32Array;
  private profileMat!: THREE.LineBasicMaterial;
  private borderLines!: THREE.LineSegments;
  private borderMat!: THREE.LineBasicMaterial;

  private gridW = 0;
  private gridH = 0;
  private grid!: Float32Array;
  private gridNext!: Float32Array;
  private gridPrev!: Float32Array;  // for fractional time stepping
  private diffusionRate = 0;
  private alpha = 0;  // fractional order (0 < alpha <= 1 for subdiffusion)
  private sourceCount = 0;
  private sources: { gx: number; gy: number; phase: number; freq: number; active: boolean }[] = [];
  private stepsPerFrame = 0;
  private profileRes = 0;
  private intensityLevel = 0;

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;

    const variant = this.rng.int(0, 3);
    const presets = [
      { cellSize: 4, diffRate: 0.15, alpha: 0.7, sources: 3, steps: 3, profile: 120 },
      { cellSize: 3, diffRate: 0.1,  alpha: 0.5, sources: 5, steps: 2, profile: 160 },
      { cellSize: 5, diffRate: 0.2,  alpha: 0.85, sources: 2, steps: 4, profile: 100 },
      { cellSize: 4, diffRate: 0.08, alpha: 0.6, sources: 6, steps: 3, profile: 140 },
    ];
    const p = presets[variant];
    this.diffusionRate = p.diffRate;
    this.alpha = p.alpha;
    this.stepsPerFrame = p.steps;
    this.sourceCount = p.sources;
    this.profileRes = p.profile;

    this.gridW = Math.max(8, Math.floor(w / p.cellSize));
    this.gridH = Math.max(8, Math.floor(h / p.cellSize));
    const total = this.gridW * this.gridH;
    this.grid = new Float32Array(total);
    this.gridNext = new Float32Array(total);
    this.gridPrev = new Float32Array(total);

    // Oscillating sources
    this.sources = [];
    for (let i = 0; i < this.sourceCount; i++) {
      this.sources.push({
        gx: this.rng.int(2, this.gridW - 3),
        gy: this.rng.int(2, this.gridH - 3),
        phase: this.rng.float(0, Math.PI * 2),
        freq: this.rng.float(0.3, 1.5),
        active: true,
      });
    }

    // Canvas
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.gridW;
    this.canvas.height = this.gridH;
    this.ctx = this.get2DContext(this.canvas);
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.magFilter = THREE.NearestFilter;

    const geo = new THREE.PlaneGeometry(w, h);
    this.meshMat = new THREE.MeshBasicMaterial({
      map: this.texture, transparent: true, opacity: 0, depthWrite: false,
    });
    this.mesh = new THREE.Mesh(geo, this.meshMat);
    this.mesh.position.set(x + w / 2, y + h / 2, 0);
    this.group.add(this.mesh);

    // 1D profile line (horizontal cross-section through middle)
    this.profilePositions = new Float32Array(this.profileRes * 3);
    const profGeo = new THREE.BufferGeometry();
    profGeo.setAttribute('position', new THREE.BufferAttribute(this.profilePositions, 3));
    this.profileMat = new THREE.LineBasicMaterial({
      color: this.palette.secondary, transparent: true, opacity: 0,
    });
    this.profileLine = new THREE.Line(profGeo, this.profileMat);
    this.group.add(this.profileLine);

    // Border
    const bv = new Float32Array([
      x, y, 0, x + w, y, 0, x + w, y, 0, x + w, y + h, 0,
      x + w, y + h, 0, x, y + h, 0, x, y + h, 0, x, y, 0,
    ]);
    const bGeo = new THREE.BufferGeometry();
    bGeo.setAttribute('position', new THREE.BufferAttribute(bv, 3));
    this.borderMat = new THREE.LineBasicMaterial({
      color: this.palette.dim, transparent: true, opacity: 0,
    });
    this.borderLines = new THREE.LineSegments(bGeo, this.borderMat);
    this.group.add(this.borderLines);
  }

  private diffuseStep(time: number): void {
    const W = this.gridW;
    const H = this.gridH;
    const rate = this.diffusionRate;
    const a = this.alpha;

    // Inject sources
    for (const s of this.sources) {
      if (!s.active) continue;
      const heat = Math.max(0, Math.sin(time * s.freq + s.phase));
      const idx = s.gy * W + s.gx;
      this.grid[idx] = Math.max(this.grid[idx], heat);
    }

    // Fractional diffusion step using Grunwald-Letnikov approximation
    // U_{n+1} = (1-alpha)*U_n + alpha*U_{n-1} + rate * laplacian(U_n)
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const idx = y * W + x;
        const laplacian = this.grid[idx - 1] + this.grid[idx + 1]
                        + this.grid[idx - W] + this.grid[idx + W]
                        - 4 * this.grid[idx];
        // Fractional time derivative blends current with previous
        const fractionalPart = (1 - a) * this.grid[idx] + a * this.gridPrev[idx];
        this.gridNext[idx] = fractionalPart + rate * laplacian;
        // Slight decay
        this.gridNext[idx] *= 0.9985;
        if (this.gridNext[idx] < 0.001) this.gridNext[idx] = 0;
      }
    }

    // Rotate buffers
    const tmp = this.gridPrev;
    this.gridPrev = this.grid;
    this.grid = this.gridNext;
    this.gridNext = tmp;
  }

  private renderField(): void {
    const imgData = this.ctx.createImageData(this.gridW, this.gridH);
    const data = imgData.data;
    const pr = this.palette.primary;
    const sr = this.palette.secondary;
    const bg = this.palette.bg;

    for (let i = 0; i < this.gridW * this.gridH; i++) {
      const v = Math.max(0, Math.min(1, this.grid[i]));
      const idx = i * 4;

      // Three-band color: bg -> secondary -> primary
      let r: number, g: number, b: number;
      if (v < 0.5) {
        const t = v * 2;
        r = bg.r + (sr.r - bg.r) * t;
        g = bg.g + (sr.g - bg.g) * t;
        b = bg.b + (sr.b - bg.b) * t;
      } else {
        const t = (v - 0.5) * 2;
        r = sr.r + (pr.r - sr.r) * t;
        g = sr.g + (pr.g - sr.g) * t;
        b = sr.b + (pr.b - sr.b) * t;
      }

      // Add contour lines
      const contourVal = v * 10;
      const contourDist = Math.abs(contourVal - Math.round(contourVal));
      const contourBoost = contourDist < 0.1 ? 1.3 : 1.0;

      data[idx]     = Math.min(255, Math.floor(r * 255 * contourBoost));
      data[idx + 1] = Math.min(255, Math.floor(g * 255 * contourBoost));
      data[idx + 2] = Math.min(255, Math.floor(b * 255 * contourBoost));
      data[idx + 3] = Math.floor((0.05 + v * 0.95) * 255);
    }

    this.ctx.putImageData(imgData, 0, 0);
    this.texture.needsUpdate = true;
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    const { x, y, w, h } = this.px;

    for (let s = 0; s < this.stepsPerFrame; s++) {
      this.diffuseStep(time);
    }
    this.renderField();

    // Update 1D profile line through vertical center (clamped to region)
    const midRow = Math.floor(this.gridH / 2);
    const profileBase = y + h * 0.85;
    const profileH = h * 0.15;
    for (let i = 0; i < this.profileRes; i++) {
      const gx = Math.floor((i / this.profileRes) * this.gridW);
      const val = Math.max(0, Math.min(1, this.grid[midRow * this.gridW + Math.min(gx, this.gridW - 1)]));
      this.profilePositions[i * 3]     = x + (i / this.profileRes) * w;
      this.profilePositions[i * 3 + 1] = Math.max(y, Math.min(y + h, profileBase - val * profileH));
      this.profilePositions[i * 3 + 2] = 0.1;
    }
    const pPos = this.profileLine.geometry.getAttribute('position') as THREE.BufferAttribute;
    pPos.needsUpdate = true;

    this.meshMat.opacity = opacity;
    this.profileMat.opacity = opacity * 0.7;
    this.borderMat.opacity = opacity * 0.2;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Explosion at center
      const cx = Math.floor(this.gridW / 2);
      const cy = Math.floor(this.gridH / 2);
      for (let dy = -4; dy <= 4; dy++) {
        for (let dx = -4; dx <= 4; dx++) {
          const gx = cx + dx, gy = cy + dy;
          if (gx >= 0 && gx < this.gridW && gy >= 0 && gy < this.gridH) {
            this.grid[gy * this.gridW + gx] = 1;
          }
        }
      }
    }
    if (action === 'pulse') {
      // Temporarily increase diffusion
      this.diffusionRate *= 3;
      setTimeout(() => { this.diffusionRate /= 3; }, 500);
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    this.intensityLevel = level;
    if (level === 0) return;
    this.diffusionRate = 0.15 + level * 0.04;
    this.stepsPerFrame = 3 + level;
  }
}
