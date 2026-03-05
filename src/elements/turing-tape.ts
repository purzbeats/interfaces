import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Turing machine tape visualization. A read/write head moves on an infinite
 * tape executing state transitions with visual state display. Runs classic
 * busy beaver and other interesting TM programs.
 */
export class TuringTapeElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'turing-tape',
    meta: {
      shape: 'linear',
      roles: ['data-display', 'decorative'],
      moods: ['diagnostic', 'tactical'],
      bandAffinity: 'high',
      sizes: ['works-small', 'needs-medium'],
    },
  };

  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private texture!: THREE.CanvasTexture;
  private mesh!: THREE.Mesh;
  private material!: THREE.MeshBasicMaterial;

  private cw: number = 0;
  private ch: number = 0;

  // TM state
  private tape: Map<number, number> = new Map();
  private headPos: number = 0;
  private state: number = 0;
  private halted: boolean = false;
  private totalSteps: number = 0;
  private maxSteps: number = 2000;
  private stepsPerFrame: number = 3;

  // Transition table: [state][symbol] => { write, move, nextState }
  private transitions: { write: number; move: number; next: number }[][] = [];
  private numStates: number = 0;
  private numSymbols: number = 2;
  private haltState: number = -1;

  // View window
  private viewCenter: number = 0;
  private viewWidth: number = 40;
  private intensityLevel: number = 0;

  // Classic TM programs
  private static readonly MACHINES = [
    { // 3-state 2-symbol busy beaver
      states: 3, symbols: 2, halt: 3,
      table: [
        [{ write: 1, move: 1, next: 1 }, { write: 1, move: -1, next: 2 }],
        [{ write: 1, move: -1, next: 0 }, { write: 1, move: 1, next: 1 }],
        [{ write: 1, move: -1, next: 1 }, { write: 1, move: 1, next: 3 }],
      ],
    },
    { // 2-state 3-symbol busy beaver
      states: 2, symbols: 3, halt: 2,
      table: [
        [{ write: 1, move: 1, next: 1 }, { write: 2, move: -1, next: 0 }, { write: 1, move: -1, next: 2 }],
        [{ write: 2, move: -1, next: 0 }, { write: 2, move: 1, next: 1 }, { write: 0, move: 1, next: 0 }],
      ],
    },
    { // Binary counter
      states: 3, symbols: 2, halt: 3,
      table: [
        [{ write: 0, move: 1, next: 0 }, { write: 1, move: -1, next: 1 }],
        [{ write: 0, move: -1, next: 1 }, { write: 1, move: 1, next: 2 }],
        [{ write: 0, move: 1, next: 0 }, { write: 0, move: -1, next: 3 }],
      ],
    },
    { // Unary doubler
      states: 4, symbols: 2, halt: 4,
      table: [
        [{ write: 0, move: 1, next: 1 }, { write: 1, move: -1, next: 3 }],
        [{ write: 1, move: 1, next: 1 }, { write: 0, move: 1, next: 2 }],
        [{ write: 1, move: -1, next: 2 }, { write: 1, move: -1, next: 0 }],
        [{ write: 1, move: -1, next: 3 }, { write: 1, move: 1, next: 4 }],
      ],
    },
  ];

  build(): void {
    const variant = this.rng.int(0, 3);
    const presets = [
      { machine: 0, stepsFrame: 3, maxSteps: 2000, viewW: 40 },
      { machine: 1, stepsFrame: 5, maxSteps: 3000, viewW: 50 },
      { machine: 2, stepsFrame: 2, maxSteps: 1500, viewW: 30 },
      { machine: 3, stepsFrame: 4, maxSteps: 2500, viewW: 45 },
    ];
    const p = presets[variant];

    this.stepsPerFrame = p.stepsFrame;
    this.maxSteps = p.maxSteps;
    this.viewWidth = p.viewW;
    this.glitchAmount = 4;

    this.loadMachine(p.machine);

    const { x, y, w, h } = this.px;
    this.cw = Math.max(64, Math.floor(w * 0.85));
    this.ch = Math.max(32, Math.floor(h * 0.85));

    this.canvas = document.createElement('canvas');
    this.canvas.width = this.cw;
    this.canvas.height = this.ch;
    this.ctx = this.get2DContext(this.canvas);

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;

    this.material = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      opacity: 0,
    });

    const geo = new THREE.PlaneGeometry(w, h);
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.position.set(x + w / 2, y + h / 2, 0);
    this.group.add(this.mesh);
  }

  private loadMachine(index: number): void {
    const m = TuringTapeElement.MACHINES[index];
    this.numStates = m.states;
    this.numSymbols = m.symbols;
    this.haltState = m.halt;
    this.transitions = m.table;
    this.tape.clear();
    this.headPos = 0;
    this.state = 0;
    this.halted = false;
    this.totalSteps = 0;
    this.viewCenter = 0;
  }

  private stepTM(): boolean {
    if (this.halted || this.state === this.haltState || this.totalSteps >= this.maxSteps) {
      this.halted = true;
      return false;
    }

    const symbol = this.tape.get(this.headPos) ?? 0;
    if (this.state >= this.transitions.length || symbol >= this.transitions[this.state].length) {
      this.halted = true;
      return false;
    }

    const trans = this.transitions[this.state][symbol];
    this.tape.set(this.headPos, trans.write);
    this.headPos += trans.move;
    this.state = trans.next;
    this.totalSteps++;

    // Follow head with view
    this.viewCenter += (this.headPos - this.viewCenter) * 0.1;

    return true;
  }

  private renderState(): void {
    const ctx = this.ctx;
    const cw = this.cw;
    const ch = this.ch;
    const bg = this.palette.bg;
    const pr = this.palette.primary;
    const sr = this.palette.secondary;
    const dm = this.palette.dim;

    ctx.fillStyle = `rgb(${Math.floor(bg.r * 255)},${Math.floor(bg.g * 255)},${Math.floor(bg.b * 255)})`;
    ctx.fillRect(0, 0, cw, ch);

    // Tape visualization
    const tapeY = ch * 0.35;
    const tapeH = ch * 0.35;
    const halfView = Math.floor(this.viewWidth / 2);
    const startCell = Math.floor(this.viewCenter) - halfView;
    const endCell = startCell + this.viewWidth;
    const cellW = cw / this.viewWidth;

    for (let cell = startCell; cell < endCell; cell++) {
      const sym = this.tape.get(cell) ?? 0;
      const screenX = (cell - startCell) * cellW;
      const isHead = cell === this.headPos;

      // Cell background
      if (isHead) {
        ctx.fillStyle = `rgba(${Math.floor(sr.r * 255)},${Math.floor(sr.g * 255)},${Math.floor(sr.b * 255)},0.3)`;
      } else {
        ctx.fillStyle = `rgba(${Math.floor(dm.r * 255)},${Math.floor(dm.g * 255)},${Math.floor(dm.b * 255)},0.05)`;
      }
      ctx.fillRect(screenX, tapeY, cellW - 1, tapeH);

      // Symbol value
      if (sym > 0) {
        const t = sym / (this.numSymbols - 1);
        ctx.fillStyle = `rgb(${Math.floor(pr.r * (1 - t * 0.5) * 255)},${Math.floor(pr.g * (1 - t * 0.5) * 255)},${Math.floor(pr.b * (1 - t * 0.5) * 255)})`;
        const barH = (sym / this.numSymbols) * tapeH * 0.8;
        ctx.fillRect(screenX + 2, tapeY + tapeH - barH - 2, cellW - 5, barH);
      }

      // Cell border
      ctx.strokeStyle = `rgba(${Math.floor(dm.r * 255)},${Math.floor(dm.g * 255)},${Math.floor(dm.b * 255)},0.15)`;
      ctx.lineWidth = 0.5;
      ctx.strokeRect(screenX, tapeY, cellW - 1, tapeH);
    }

    // Head indicator
    const headScreenX = (this.headPos - startCell) * cellW + cellW / 2;
    ctx.fillStyle = `rgb(${Math.floor(sr.r * 255)},${Math.floor(sr.g * 255)},${Math.floor(sr.b * 255)})`;
    ctx.beginPath();
    ctx.moveTo(headScreenX, tapeY - 2);
    ctx.lineTo(headScreenX - 5, tapeY - 10);
    ctx.lineTo(headScreenX + 5, tapeY - 10);
    ctx.closePath();
    ctx.fill();

    // State display
    const fontSize = Math.max(8, Math.floor(ch * 0.08));
    ctx.font = `${fontSize}px monospace`;
    ctx.fillStyle = `rgba(${Math.floor(pr.r * 255)},${Math.floor(pr.g * 255)},${Math.floor(pr.b * 255)},0.7)`;
    ctx.textAlign = 'left';

    const stateLabel = this.halted ? 'HALT' : `q${this.state}`;
    ctx.fillText(`STATE: ${stateLabel}`, 4, ch - fontSize - 2);
    ctx.fillText(`POS: ${this.headPos}`, 4, ch - 2);

    ctx.textAlign = 'right';
    ctx.fillStyle = `rgba(${Math.floor(dm.r * 255)},${Math.floor(dm.g * 255)},${Math.floor(dm.b * 255)},0.4)`;
    ctx.fillText(`STEP ${this.totalSteps}`, cw - 4, ch - 2);
    ctx.textAlign = 'left';

    // History track (bottom strip showing tape write pattern)
    const histY = tapeY + tapeH + 5;
    const histH = ch - histY - fontSize * 2 - 8;
    if (histH > 4) {
      const row = this.totalSteps % Math.floor(histH);
      for (let cell = startCell; cell < endCell; cell++) {
        const sym = this.tape.get(cell) ?? 0;
        if (sym > 0 && cell === this.headPos) {
          const sx = (cell - startCell) * cellW;
          ctx.fillStyle = `rgba(${Math.floor(pr.r * 255)},${Math.floor(pr.g * 255)},${Math.floor(pr.b * 255)},0.5)`;
          ctx.fillRect(sx, histY + row, cellW - 1, 1);
        }
      }
    }
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);
    this.material.opacity = opacity;

    const steps = this.stepsPerFrame + this.intensityLevel * 2;
    for (let i = 0; i < steps; i++) {
      if (!this.stepTM()) break;
    }

    if (this.halted) {
      // Reload after pause
      this.loadMachine(this.rng.int(0, TuringTapeElement.MACHINES.length - 1));
    }

    this.renderState();
    this.texture.needsUpdate = true;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Corrupt tape
      for (let i = this.headPos - 10; i < this.headPos + 10; i++) {
        if (this.rng.chance(0.3)) {
          this.tape.set(i, this.rng.int(0, this.numSymbols - 1));
        }
      }
    }
    if (action === 'pulse') {
      this.loadMachine(this.rng.int(0, TuringTapeElement.MACHINES.length - 1));
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    this.intensityLevel = level;
  }
}
