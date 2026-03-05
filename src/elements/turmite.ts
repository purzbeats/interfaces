import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/** Turmite state transition: [writeColor, turnDir, nextState] */
type TurmiteRule = [number, number, number]; // color, turn (-1=L, 0=N, 1=R, 2=U), nextState

/**
 * Turmite (2D Turing machine). A multi-state ant on a grid follows
 * state/color rules producing different patterns: highways, chaotic
 * regions, and symmetric structures. Canvas rendered.
 */
export class TurmiteElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'turmite',
    meta: {
      shape: 'rectangular',
      roles: ['data-display', 'decorative'],
      moods: ['diagnostic', 'ambient'],
      bandAffinity: 'high',
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
  private numColors: number = 2;

  private antX: number = 0;
  private antY: number = 0;
  private antDir: number = 0; // 0=up, 1=right, 2=down, 3=left
  private antState: number = 0;

  // Rules: rules[state][color] = [writeColor, turn, nextState]
  private rules: TurmiteRule[][] = [];
  private stepsPerFrame: number = 20;
  private speedMult: number = 1;
  private totalSteps: number = 0;
  private maxSteps: number = 50000;
  private colorHexes: string[] = [];

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;

    const variant = this.rng.int(0, 3);
    const presets: Array<{ cellSize: number; stepsPerFrame: number; numColors: number; numStates: number; rules: TurmiteRule[][] }> = [
      // Langton's ant (RL) - produces highway after chaos
      { cellSize: 2, stepsPerFrame: 150, numColors: 2, numStates: 1,
        rules: [[[1, 1, 0], [0, -1, 0]]] },
      // Spiral turmite - produces spiral patterns
      { cellSize: 2, stepsPerFrame: 120, numColors: 2, numStates: 2,
        rules: [[[1, 1, 1], [1, -1, 0]], [[1, 0, 0], [0, 0, 1]]] },
      // Chaotic turmite - fills space chaotically
      { cellSize: 2, stepsPerFrame: 100, numColors: 2, numStates: 2,
        rules: [[[1, 1, 0], [1, -1, 1]], [[0, 1, 1], [0, -1, 0]]] },
      // Symmetric highway builder
      { cellSize: 2, stepsPerFrame: 130, numColors: 2, numStates: 2,
        rules: [[[1, 1, 1], [0, 1, 1]], [[1, -1, 0], [0, -1, 0]]] },
    ];
    const p = presets[variant];

    this.cellSize = p.cellSize;
    this.stepsPerFrame = p.stepsPerFrame;
    this.numColors = p.numColors;
    this.rules = p.rules;

    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.max(64, Math.floor(w));
    this.canvas.height = Math.max(64, Math.floor(h));
    this.ctx = this.get2DContext(this.canvas);

    this.cols = Math.floor(this.canvas.width / this.cellSize);
    this.rows = Math.floor(this.canvas.height / this.cellSize);
    this.grid = new Uint8Array(this.cols * this.rows);

    this.antX = Math.floor(this.cols / 2);
    this.antY = Math.floor(this.rows / 2);
    this.antDir = this.rng.int(0, 3);
    this.antState = 0;
    this.totalSteps = 0;

    // Build color palette
    const bgHex = '#' + this.palette.bg.getHexString();
    const priHex = '#' + this.palette.primary.getHexString();
    const dimHex = '#' + this.palette.dim.getHexString();
    this.colorHexes = [dimHex, priHex];

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

    // Initial clear
    this.ctx.fillStyle = this.colorHexes[0];
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  private step(): void {
    const idx = this.antY * this.cols + this.antX;
    const color = this.grid[idx];
    const state = this.antState;
    const rule = this.rules[state][color];

    // Write color
    this.grid[idx] = rule[0];
    const cs = this.cellSize;
    this.ctx.fillStyle = this.colorHexes[rule[0]];
    this.ctx.fillRect(this.antX * cs, this.antY * cs, cs, cs);

    // Turn: -1=left, 0=none, 1=right, 2=u-turn
    const turn = rule[1];
    if (turn === -1) this.antDir = (this.antDir + 3) % 4;
    else if (turn === 1) this.antDir = (this.antDir + 1) % 4;
    else if (turn === 2) this.antDir = (this.antDir + 2) % 4;

    // Next state
    this.antState = rule[2];

    // Move
    const dx = [0, 1, 0, -1];
    const dy = [-1, 0, 1, 0];
    this.antX = ((this.antX + dx[this.antDir]) % this.cols + this.cols) % this.cols;
    this.antY = ((this.antY + dy[this.antDir]) % this.rows + this.rows) % this.rows;
    this.totalSteps++;
  }

  private resetGrid(): void {
    this.grid.fill(0);
    this.antX = Math.floor(this.cols / 2) + this.rng.int(-5, 5);
    this.antY = Math.floor(this.rows / 2) + this.rng.int(-5, 5);
    this.antDir = this.rng.int(0, 3);
    this.antState = 0;
    this.totalSteps = 0;
    this.ctx.fillStyle = this.colorHexes[0];
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);

    const steps = Math.floor(this.stepsPerFrame * this.speedMult);
    for (let i = 0; i < steps; i++) {
      this.step();
    }

    if (this.totalSteps > this.maxSteps) {
      this.resetGrid();
    }

    // Draw ant position as bright dot
    const cs = this.cellSize;
    const secHex = '#' + this.palette.secondary.getHexString();
    this.ctx.fillStyle = secHex;
    this.ctx.fillRect(this.antX * cs, this.antY * cs, cs, cs);

    this.texture.needsUpdate = true;
    (this.mesh.material as THREE.MeshBasicMaterial).opacity = opacity * 0.9;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Scatter random cells
      const count = Math.floor(this.cols * this.rows * 0.05);
      for (let i = 0; i < count; i++) {
        const idx = this.rng.int(0, this.grid.length - 1);
        this.grid[idx] = this.rng.int(0, this.numColors - 1);
        const c = idx % this.cols;
        const r = Math.floor(idx / this.cols);
        this.ctx.fillStyle = this.colorHexes[this.grid[idx]];
        this.ctx.fillRect(c * this.cellSize, r * this.cellSize, this.cellSize, this.cellSize);
      }
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) {
      this.speedMult = 1;
      return;
    }
    this.speedMult = 1 + level * 0.6;
    if (level >= 5) {
      this.resetGrid();
    }
  }
}
