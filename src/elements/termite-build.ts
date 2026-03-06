import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

interface Termite {
  x: number;
  y: number;
  dx: number;
  dy: number;
  carrying: boolean;
}

/**
 * Termite-inspired construction. Agents pick up and drop "dirt" following
 * simple rules. Emergent pile structures form over time.
 * Canvas rendered with agent dots and dirt accumulation.
 */
export class TermiteBuildElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'termite-build',
    meta: {
      shape: 'rectangular',
      roles: ['data-display', 'decorative'],
      moods: ['ambient', 'diagnostic'],
      bandAffinity: 'bass',
      sizes: ['needs-medium', 'needs-large'],
    } satisfies ElementMeta,
  };

  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private texture!: THREE.CanvasTexture;
  private mesh!: THREE.Mesh;

  // Grid
  private gridW: number = 0;
  private gridH: number = 0;
  private dirt!: Uint8Array; // dirt density per cell (0-4)

  // Agents
  private termites: Termite[] = [];
  private stepsPerFrame: number = 0;
  private agentSpeed: number = 0;
  private initialDirtRatio: number = 0;
  private renderAccum = 0;

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;
    const variant = this.rng.int(0, 3);

    const presets = [
      { agents: 30, gridScale: 2, steps: 3,  dirtRatio: 0.25, speed: 1 },
      { agents: 60, gridScale: 2, steps: 3,  dirtRatio: 0.3,  speed: 1.2 },
      { agents: 15, gridScale: 3, steps: 2,  dirtRatio: 0.2,  speed: 0.8 },
      { agents: 45, gridScale: 2, steps: 3, dirtRatio: 0.35, speed: 1.5 },
    ];
    const p = presets[variant];

    // Cap grid resolution — simulation iterates all cells per step
    const maxGrid = 200;
    const gScale = Math.max(p.gridScale, Math.max(w, h) / maxGrid);
    this.gridW = Math.max(16, Math.floor(w / gScale));
    this.gridH = Math.max(16, Math.floor(h / gScale));
    this.stepsPerFrame = p.steps;
    this.agentSpeed = p.speed;
    this.initialDirtRatio = p.dirtRatio;

    this.dirt = new Uint8Array(this.gridW * this.gridH);
    this.initDirt();
    this.initTermites(p.agents);

    // Canvas
    const maxRes = 256;
    const scale = Math.min(1, maxRes / Math.max(w, h));
    const cw = Math.max(64, Math.floor(w * scale));
    const ch = Math.max(64, Math.floor(h * scale));
    this.canvas = document.createElement('canvas');
    this.canvas.width = cw;
    this.canvas.height = ch;
    this.ctx = this.get2DContext(this.canvas);

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.magFilter = THREE.NearestFilter;

    const geo = new THREE.PlaneGeometry(w, h);
    const mat = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      opacity: 0,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.set(x + w / 2, y + h / 2, 0);
    this.group.add(this.mesh);
  }

  private initDirt(): void {
    this.dirt.fill(0);
    const totalCells = this.gridW * this.gridH;
    const dirtCells = Math.floor(totalCells * this.initialDirtRatio);
    for (let i = 0; i < dirtCells; i++) {
      const idx = this.rng.int(0, totalCells - 1);
      if (this.dirt[idx] < 4) {
        this.dirt[idx]++;
      }
    }
  }

  private initTermites(count: number): void {
    this.termites = [];
    for (let i = 0; i < count; i++) {
      const angle = this.rng.float(0, Math.PI * 2);
      this.termites.push({
        x: this.rng.int(0, this.gridW - 1),
        y: this.rng.int(0, this.gridH - 1),
        dx: Math.cos(angle) > 0 ? 1 : -1,
        dy: Math.sin(angle) > 0 ? 1 : -1,
        carrying: false,
      });
    }
  }

  private stepSimulation(): void {
    for (const t of this.termites) {
      // Random walk with slight direction persistence
      if (this.rng.float(0, 1) < 0.3) {
        const angle = this.rng.float(0, Math.PI * 2);
        t.dx = Math.cos(angle) > 0 ? 1 : -1;
        t.dy = Math.sin(angle) > 0 ? 1 : -1;
      }

      // Move
      t.x = ((t.x + t.dx) % this.gridW + this.gridW) % this.gridW;
      t.y = ((t.y + t.dy) % this.gridH + this.gridH) % this.gridH;

      const idx = t.y * this.gridW + t.x;

      if (!t.carrying) {
        // Pick up dirt if present
        if (this.dirt[idx] > 0) {
          this.dirt[idx]--;
          t.carrying = true;
        }
      } else {
        // Drop dirt if cell has dirt (creates piles)
        if (this.dirt[idx] > 0 && this.dirt[idx] < 4) {
          this.dirt[idx]++;
          t.carrying = false;
        }
      }
    }
  }

  private renderCanvas(): void {
    const cw = this.canvas.width;
    const ch = this.canvas.height;

    const bg = this.palette.bg;
    const pr = this.palette.primary;
    const sc = this.palette.secondary;
    const dm = this.palette.dim;

    // Use ImageData for fast pixel-level rendering
    const imgData = this.ctx.createImageData(cw, ch);
    const data = imgData.data;

    const bgR = Math.round(bg.r * 255);
    const bgG = Math.round(bg.g * 255);
    const bgB = Math.round(bg.b * 255);

    // Fill background
    for (let i = 0; i < data.length; i += 4) {
      data[i] = bgR; data[i + 1] = bgG; data[i + 2] = bgB; data[i + 3] = 255;
    }

    const cellW = cw / this.gridW;
    const cellH = ch / this.gridH;

    // Draw dirt via ImageData
    for (let gy = 0; gy < this.gridH; gy++) {
      for (let gx = 0; gx < this.gridW; gx++) {
        const d = this.dirt[gy * this.gridW + gx];
        if (d === 0) continue;

        const t = d / 4;
        const cr = Math.round((dm.r * (1 - t) + sc.r * t) * 255);
        const cg = Math.round((dm.g * (1 - t) + sc.g * t) * 255);
        const cb = Math.round((dm.b * (1 - t) + sc.b * t) * 255);

        const x0 = Math.floor(gx * cellW);
        const y0 = Math.floor(gy * cellH);
        const x1 = Math.min(cw, Math.ceil((gx + 1) * cellW));
        const y1 = Math.min(ch, Math.ceil((gy + 1) * cellH));
        for (let py = y0; py < y1; py++) {
          for (let px = x0; px < x1; px++) {
            const idx = (py * cw + px) * 4;
            data[idx] = cr; data[idx + 1] = cg; data[idx + 2] = cb;
          }
        }
      }
    }

    // Draw termites
    const prR = Math.round(pr.r * 255);
    const prG = Math.round(pr.g * 255);
    const prB = Math.round(pr.b * 255);
    const dmR = Math.round(dm.r * 200);
    const dmG = Math.round(dm.g * 200);
    const dmB = Math.round(dm.b * 200);
    for (const term of this.termites) {
      const tx = Math.floor(term.x * cellW);
      const ty = Math.floor(term.y * cellH);
      const sz = Math.max(1, Math.ceil(cellW * 0.8));
      const cr = term.carrying ? prR : dmR;
      const cg = term.carrying ? prG : dmG;
      const cb = term.carrying ? prB : dmB;
      for (let py = ty; py < Math.min(ch, ty + sz); py++) {
        for (let px = tx; px < Math.min(cw, tx + sz); px++) {
          const idx = (py * cw + px) * 4;
          data[idx] = cr; data[idx + 1] = cg; data[idx + 2] = cb;
        }
      }
    }

    this.ctx.putImageData(imgData, 0, 0);
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);

    (this.mesh.material as THREE.MeshBasicMaterial).opacity = opacity;

    this.renderAccum += dt;
    if (this.renderAccum < 0.066) return;
    this.renderAccum = 0;

    for (let i = 0; i < this.stepsPerFrame; i++) {
      this.stepSimulation();
    }

    this.renderCanvas();
    this.texture.needsUpdate = true;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Earthquake: scatter dirt randomly
      const totalCells = this.gridW * this.gridH;
      for (let i = 0; i < totalCells; i++) {
        if (this.dirt[i] > 0 && this.rng.float(0, 1) < 0.4) {
          const target = this.rng.int(0, totalCells - 1);
          if (this.dirt[target] < 4) {
            this.dirt[i]--;
            this.dirt[target]++;
          }
        }
      }
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) {
      this.stepsPerFrame = 3;
      return;
    }
    this.stepsPerFrame = Math.min(3 + level, 6);
    if (level >= 5) {
      // All termites drop what they carry
      for (const t of this.termites) {
        if (t.carrying) {
          const idx = t.y * this.gridW + t.x;
          if (this.dirt[idx] < 4) {
            this.dirt[idx]++;
          }
          t.carrying = false;
        }
      }
    }
  }
}
