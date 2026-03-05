import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/** Cell states for wireworld automaton */
const EMPTY = 0;
const WIRE = 1;
const HEAD = 2;
const TAIL = 3;

/**
 * Wireworld cellular automaton. Four states: empty, wire, electron head,
 * electron tail. Electrons flow along wire paths forming circuit-like
 * patterns. Canvas rendered with palette-matched colors.
 */
export class WireworldElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'wireworld',
    meta: {
      shape: 'rectangular',
      roles: ['data-display', 'decorative'],
      moods: ['tactical', 'diagnostic'],
      bandAffinity: 'mid',
      sizes: ['works-small', 'needs-medium', 'needs-large'],
    } satisfies ElementMeta,
  };

  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private texture!: THREE.CanvasTexture;
  private mesh!: THREE.Mesh;

  private cols: number = 0;
  private rows: number = 0;
  private cellSize: number = 0;
  private grid!: Uint8Array;
  private nextGrid!: Uint8Array;
  private stepAccum: number = 0;
  private stepInterval: number = 0.1;
  private speedMult: number = 1;

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;

    const variant = this.rng.int(0, 3);
    const presets = [
      { cellSize: 6, stepInterval: 0.1, wireChance: 0.35, electronChance: 0.08 },
      { cellSize: 4, stepInterval: 0.06, wireChance: 0.45, electronChance: 0.12 },
      { cellSize: 8, stepInterval: 0.15, wireChance: 0.25, electronChance: 0.05 },
      { cellSize: 5, stepInterval: 0.08, wireChance: 0.40, electronChance: 0.10 },
    ];
    const p = presets[variant];
    this.cellSize = p.cellSize;
    this.stepInterval = p.stepInterval;

    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.max(64, Math.floor(w));
    this.canvas.height = Math.max(64, Math.floor(h));
    this.ctx = this.get2DContext(this.canvas);

    this.cols = Math.floor(this.canvas.width / this.cellSize);
    this.rows = Math.floor(this.canvas.height / this.cellSize);
    const total = this.cols * this.rows;
    this.grid = new Uint8Array(total);
    this.nextGrid = new Uint8Array(total);

    // Build wire patterns: a mix of horizontal/vertical lines and loops
    this.generateCircuit(p.wireChance, p.electronChance);

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.NearestFilter;

    const geo = new THREE.PlaneGeometry(w, h);
    const mat = new THREE.MeshBasicMaterial({
      map: this.texture, transparent: true, opacity: 0,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.set(x + w / 2, y + h / 2, 0);
    this.group.add(this.mesh);
  }

  private generateCircuit(wireChance: number, electronChance: number): void {
    this.grid.fill(EMPTY);

    // Draw some horizontal wires
    const numHWires = this.rng.int(3, Math.floor(this.rows * 0.4));
    for (let i = 0; i < numHWires; i++) {
      const row = this.rng.int(1, this.rows - 2);
      const startCol = this.rng.int(0, Math.floor(this.cols * 0.3));
      const endCol = this.rng.int(Math.floor(this.cols * 0.5), this.cols - 1);
      for (let c = startCol; c <= endCol; c++) {
        this.grid[row * this.cols + c] = WIRE;
      }
    }

    // Draw some vertical wires
    const numVWires = this.rng.int(3, Math.floor(this.cols * 0.4));
    for (let i = 0; i < numVWires; i++) {
      const col = this.rng.int(1, this.cols - 2);
      const startRow = this.rng.int(0, Math.floor(this.rows * 0.3));
      const endRow = this.rng.int(Math.floor(this.rows * 0.5), this.rows - 1);
      for (let r = startRow; r <= endRow; r++) {
        this.grid[r * this.cols + col] = WIRE;
      }
    }

    // Add some random wire cells for connectivity
    for (let i = 0; i < this.grid.length; i++) {
      if (this.grid[i] === EMPTY && this.rng.float(0, 1) < wireChance * 0.3) {
        this.grid[i] = WIRE;
      }
    }

    // Inject electron heads on some wire cells
    for (let i = 0; i < this.grid.length; i++) {
      if (this.grid[i] === WIRE && this.rng.float(0, 1) < electronChance) {
        this.grid[i] = HEAD;
      }
    }
  }

  private stepSimulation(): void {
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const idx = r * this.cols + c;
        const state = this.grid[idx];

        if (state === EMPTY) {
          this.nextGrid[idx] = EMPTY;
        } else if (state === HEAD) {
          this.nextGrid[idx] = TAIL;
        } else if (state === TAIL) {
          this.nextGrid[idx] = WIRE;
        } else {
          // WIRE: becomes HEAD if exactly 1 or 2 neighbors are HEAD
          let headCount = 0;
          for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
              if (dr === 0 && dc === 0) continue;
              const nr = r + dr;
              const nc = c + dc;
              if (nr >= 0 && nr < this.rows && nc >= 0 && nc < this.cols) {
                if (this.grid[nr * this.cols + nc] === HEAD) headCount++;
              }
            }
          }
          this.nextGrid[idx] = (headCount === 1 || headCount === 2) ? HEAD : WIRE;
        }
      }
    }
    // Swap
    const tmp = this.grid;
    this.grid = this.nextGrid;
    this.nextGrid = tmp;
  }

  private renderGrid(): void {
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    this.ctx.clearRect(0, 0, cw, ch);

    const bgHex = '#' + this.palette.bg.getHexString();
    const dimHex = '#' + this.palette.dim.getHexString();
    const priHex = '#' + this.palette.primary.getHexString();
    const secHex = '#' + this.palette.secondary.getHexString();

    this.ctx.fillStyle = bgHex;
    this.ctx.fillRect(0, 0, cw, ch);

    const cs = this.cellSize;
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const state = this.grid[r * this.cols + c];
        if (state === EMPTY) continue;

        if (state === WIRE) {
          this.ctx.fillStyle = dimHex;
        } else if (state === HEAD) {
          this.ctx.fillStyle = priHex;
        } else {
          this.ctx.fillStyle = secHex;
        }
        this.ctx.fillRect(c * cs, r * cs, cs - 1, cs - 1);
      }
    }
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);

    this.stepAccum += dt * this.speedMult;
    while (this.stepAccum >= this.stepInterval) {
      this.stepAccum -= this.stepInterval;
      this.stepSimulation();
    }

    this.renderGrid();
    this.texture.needsUpdate = true;
    (this.mesh.material as THREE.MeshBasicMaterial).opacity = opacity * 0.9;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Inject random electron heads
      for (let i = 0; i < this.grid.length; i++) {
        if (this.grid[i] === WIRE && this.rng.float(0, 1) < 0.15) {
          this.grid[i] = HEAD;
        }
      }
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) {
      this.speedMult = 1;
      return;
    }
    this.speedMult = 1 + level * 0.5;
    if (level >= 5) {
      // Mass injection of electrons
      for (let i = 0; i < this.grid.length; i++) {
        if (this.grid[i] === WIRE && this.rng.float(0, 1) < 0.25) {
          this.grid[i] = HEAD;
        }
      }
    }
  }
}
