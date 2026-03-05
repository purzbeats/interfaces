import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

interface RainColumn {
  y: number;       // head position (row)
  speed: number;   // rows per second
  length: number;  // trail length
  depth: number;   // 0-1, affects brightness (depth layering)
  active: boolean;
  cooldown: number;
}

/**
 * Vertical digital rain columns with depth-varying speed. Columns have
 * variable density and depth layering (far columns are dimmer and slower).
 * Characters splash at the bottom and fade. Uses mathematical/scientific
 * Unicode symbols for a sci-fi aesthetic.
 */
export class RainMatrixElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'rain-matrix',
    meta: {
      shape: 'rectangular',
      roles: ['decorative', 'text'],
      moods: ['tactical', 'ambient'],
      bandAffinity: 'high',
      sizes: ['works-small', 'needs-medium', 'needs-large'],
    } satisfies ElementMeta,
  };

  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private texture!: THREE.CanvasTexture;
  private mesh!: THREE.Mesh;
  private meshMat!: THREE.MeshBasicMaterial;
  private borderLines!: THREE.LineSegments;
  private borderMat!: THREE.LineBasicMaterial;

  private cols = 0;
  private rows = 0;
  private cellSize = 0;
  private columns: RainColumn[] = [];
  private charGrid!: string[];
  private brightGrid!: Float32Array;
  private splashGrid!: Float32Array;  // splash brightness at bottom
  private symbols: string;
  private depthLayers = 3;
  private density = 0;
  private intensityLevel = 0;

  constructor(...args: ConstructorParameters<typeof BaseElement>) {
    super(...args);
    // Scientific/math symbols for a unique look
    this.symbols = '\u03A3\u222B\u03C0\u0394\u03B8\u03BB\u03C6\u03C9\u2202\u221E\u2207\u2200\u2203\u2208\u2211\u220F\u221A\u2264\u2265\u2260\u03B1\u03B2\u03B3\u03B4\u03B5\u03B6\u03B7\u0278\u03A8\u03A9\u2295\u2297\u22C5\u2248\u2261\u2282\u2283';
  }

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;

    const variant = this.rng.int(0, 3);
    const presets = [
      { cell: 11, speedMin: 5, speedMax: 16, dens: 0.6, layers: 3 },
      { cell: 8,  speedMin: 8, speedMax: 22, dens: 0.8, layers: 4 },
      { cell: 14, speedMin: 3, speedMax: 10, dens: 0.4, layers: 2 },
      { cell: 10, speedMin: 10, speedMax: 25, dens: 0.7, layers: 3 },
    ];
    const p = presets[variant];
    this.cellSize = p.cell;
    this.depthLayers = p.layers;
    this.density = p.dens;
    this.cols = Math.max(3, Math.floor(w / p.cell));
    this.rows = Math.max(4, Math.floor(h / p.cell));

    const total = this.cols * this.rows;
    this.charGrid = [];
    this.brightGrid = new Float32Array(total);
    this.splashGrid = new Float32Array(this.cols);

    // Fill character grid
    for (let i = 0; i < total; i++) {
      this.charGrid.push(this.symbols[this.rng.int(0, this.symbols.length - 1)]);
    }

    // Initialize columns with depth layering
    this.columns = [];
    for (let c = 0; c < this.cols; c++) {
      const depth = this.rng.int(0, this.depthLayers - 1) / (this.depthLayers - 1);
      const active = this.rng.chance(this.density);
      const speedScale = 1 - depth * 0.5; // far columns slower
      this.columns.push({
        y: active ? this.rng.float(-this.rows * 0.5, 0) : -100,
        speed: this.rng.float(p.speedMin, p.speedMax) * speedScale,
        length: this.rng.int(6, Math.min(20, this.rows)),
        depth,
        active,
        cooldown: active ? 0 : this.rng.float(0.5, 5),
      });
    }

    this.canvas = document.createElement('canvas');
    this.canvas.width = this.cols * this.cellSize;
    this.canvas.height = this.rows * this.cellSize;
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

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);
    const trailFade = 0.85;

    // Decay splash grid
    for (let c = 0; c < this.cols; c++) {
      this.splashGrid[c] *= 0.92;
    }

    // Advance columns
    for (let c = 0; c < this.cols; c++) {
      const col = this.columns[c];
      if (!col.active) {
        col.cooldown -= dt;
        if (col.cooldown <= 0) {
          col.active = true;
          col.y = this.rng.float(-col.length, -2);
          col.speed = this.rng.float(5, 20) * (1 - col.depth * 0.5);
          col.length = this.rng.int(6, Math.min(20, this.rows));
        }
        continue;
      }

      col.y += col.speed * dt;

      // Hit bottom: splash and reset
      if (col.y > this.rows + col.length + 2) {
        this.splashGrid[c] = 0.8;
        col.active = false;
        col.cooldown = this.rng.float(0.3, 4) * (1 - this.density * 0.5);
      }
    }

    // Compute brightness grid
    this.brightGrid.fill(0);
    for (let c = 0; c < this.cols; c++) {
      const col = this.columns[c];
      if (!col.active) continue;
      const head = col.y;
      const depthDim = 1 - col.depth * 0.6; // dim far columns

      for (let r = 0; r < this.rows; r++) {
        const dist = head - r;
        const idx = r * this.cols + c;
        if (dist >= 0 && dist <= col.length) {
          const t = dist / col.length;
          this.brightGrid[idx] = Math.max(this.brightGrid[idx], (1 - t * trailFade) * depthDim);
        }
      }

      // Add splash brightness at bottom rows
      if (this.splashGrid[c] > 0.05) {
        for (let r = this.rows - 3; r < this.rows; r++) {
          if (r >= 0) {
            const idx = r * this.cols + c;
            this.brightGrid[idx] = Math.max(this.brightGrid[idx], this.splashGrid[c] * 0.5);
          }
        }
      }
    }

    // Randomly swap characters
    for (let i = 0; i < 5; i++) {
      const idx = this.rng.int(0, this.charGrid.length - 1);
      this.charGrid[idx] = this.symbols[this.rng.int(0, this.symbols.length - 1)];
    }

    // Render
    this.ctx.fillStyle = 'rgba(0,0,0,1)';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    const pr = this.palette.primary;
    const cs = this.cellSize;
    this.ctx.font = `${cs - 2}px monospace`;
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';

    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const b = this.brightGrid[r * this.cols + c];
        if (b < 0.01) continue;

        const col = this.columns[c];
        const head = Math.floor(col.y);
        const isHead = r === head && col.active;

        if (isHead) {
          // Head is bright white
          this.ctx.fillStyle = `rgba(255,255,255,${Math.min(1, b * 1.2)})`;
        } else if (b > 0.7) {
          // Near-head chars are brighter
          this.ctx.fillStyle = `rgba(${Math.floor(pr.r * 255)},${Math.floor(pr.g * 255)},${Math.floor(pr.b * 255)},${b})`;
        } else {
          // Dim trail
          const dim = b * 0.7;
          this.ctx.fillStyle = `rgba(${Math.floor(pr.r * 200)},${Math.floor(pr.g * 200)},${Math.floor(pr.b * 200)},${dim})`;
        }
        this.ctx.fillText(this.charGrid[r * this.cols + c], c * cs + cs / 2, r * cs + cs / 2);
      }
    }

    this.texture.needsUpdate = true;
    this.meshMat.opacity = opacity;
    this.borderMat.opacity = opacity * 0.15;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Scramble all characters and boost speeds
      for (let i = 0; i < this.charGrid.length; i++) {
        this.charGrid[i] = this.symbols[this.rng.int(0, this.symbols.length - 1)];
      }
      for (const col of this.columns) {
        col.speed *= 2;
      }
      setTimeout(() => {
        for (const col of this.columns) col.speed *= 0.5;
      }, 500);
    }
    if (action === 'pulse') {
      // Activate all columns
      for (const col of this.columns) {
        col.active = true;
        col.y = this.rng.float(-5, 0);
      }
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    this.intensityLevel = level;
    if (level === 0) return;
    this.density = Math.min(1, 0.6 + level * 0.08);
    for (const col of this.columns) {
      col.speed = this.rng.float(8, 22) * (1 + level * 0.15);
    }
  }
}
