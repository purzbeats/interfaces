import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Visual Brainfuck interpreter. Memory tape displayed as bars, pointer moves,
 * output builds. Runs random short programs that produce interesting patterns
 * on the memory tape visualization.
 */
export class BrainfuckVmElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'brainfuck-vm',
    meta: {
      shape: 'rectangular',
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

  // VM state
  private memory: Uint8Array = new Uint8Array(64);
  private memPtr: number = 0;
  private program: string = '';
  private pc: number = 0;
  private output: string = '';
  private stepsPerFrame: number = 10;
  private totalSteps: number = 0;
  private maxSteps: number = 5000;
  private bracketMap: Map<number, number> = new Map();
  private intensityLevel: number = 0;

  // Program library
  private static readonly PROGRAMS = [
    '++++++[>++++++++<-]>.',
    '++++++++[>++++[>++>+++>+++>+<<<<-]>+>+>->>+[<]<-]>>.',
    '+[-->-[>>+>-----<<]<--<---]>-.>>>+.>>..+++[.>]<<<<.',
    '>>++++[<++++[<++++>-]>-]<<.[-]++++++++++.',
    '++++[>++++<-]>[>+>++>+++<<<-]>>+.',
    '+++[>+++[>+++<-]<-]>>+.',
    '++++++++++[>+++++++>++++++++++>+++>+<<<<-]>++.',
    '+++++[>+++++<-]>[>+>+++<<-]>>.',
  ];

  build(): void {
    const variant = this.rng.int(0, 3);
    const presets = [
      { steps: 10, maxSteps: 5000, memSize: 64 },
      { steps: 20, maxSteps: 8000, memSize: 128 },
      { steps: 5, maxSteps: 3000, memSize: 32 },
      { steps: 30, maxSteps: 10000, memSize: 64 },
    ];
    const p = presets[variant];

    this.stepsPerFrame = p.steps;
    this.maxSteps = p.maxSteps;
    this.memory = new Uint8Array(p.memSize);
    this.memPtr = 0;
    this.pc = 0;
    this.output = '';
    this.totalSteps = 0;
    this.glitchAmount = 4;

    this.loadRandomProgram();

    const { x, y, w, h } = this.px;
    this.cw = Math.max(64, Math.floor(w * 0.8));
    this.ch = Math.max(48, Math.floor(h * 0.8));

    this.canvas = document.createElement('canvas');
    this.canvas.width = this.cw;
    this.canvas.height = this.ch;
    this.ctx = this.get2DContext(this.canvas);

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.magFilter = THREE.NearestFilter;

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

  private loadRandomProgram(): void {
    this.program = this.rng.pick(BrainfuckVmElement.PROGRAMS);
    this.pc = 0;
    this.output = '';
    this.totalSteps = 0;
    this.memory.fill(0);
    this.memPtr = 0;

    // Build bracket map
    this.bracketMap.clear();
    const stack: number[] = [];
    for (let i = 0; i < this.program.length; i++) {
      if (this.program[i] === '[') {
        stack.push(i);
      } else if (this.program[i] === ']') {
        const open = stack.pop();
        if (open !== undefined) {
          this.bracketMap.set(open, i);
          this.bracketMap.set(i, open);
        }
      }
    }
  }

  private stepVM(): boolean {
    if (this.pc >= this.program.length || this.totalSteps >= this.maxSteps) {
      return false;
    }

    const cmd = this.program[this.pc];
    switch (cmd) {
      case '>':
        this.memPtr = (this.memPtr + 1) % this.memory.length;
        break;
      case '<':
        this.memPtr = (this.memPtr - 1 + this.memory.length) % this.memory.length;
        break;
      case '+':
        this.memory[this.memPtr] = (this.memory[this.memPtr] + 1) & 0xFF;
        break;
      case '-':
        this.memory[this.memPtr] = (this.memory[this.memPtr] - 1) & 0xFF;
        break;
      case '.':
        this.output += String.fromCharCode(this.memory[this.memPtr]);
        if (this.output.length > 40) this.output = this.output.slice(-40);
        break;
      case '[':
        if (this.memory[this.memPtr] === 0) {
          const target = this.bracketMap.get(this.pc);
          if (target !== undefined) this.pc = target;
        }
        break;
      case ']':
        if (this.memory[this.memPtr] !== 0) {
          const target = this.bracketMap.get(this.pc);
          if (target !== undefined) this.pc = target;
        }
        break;
    }

    this.pc++;
    this.totalSteps++;
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

    // Memory tape bars
    const tapeY = ch * 0.3;
    const tapeH = ch * 0.5;
    const cellW = cw / this.memory.length;

    for (let i = 0; i < this.memory.length; i++) {
      const val = this.memory[i];
      const barH = (val / 255) * tapeH;
      const cx = i * cellW;
      const isPtr = i === this.memPtr;

      if (isPtr) {
        ctx.fillStyle = `rgb(${Math.floor(sr.r * 255)},${Math.floor(sr.g * 255)},${Math.floor(sr.b * 255)})`;
      } else if (val > 0) {
        const t = val / 255;
        ctx.fillStyle = `rgba(${Math.floor(pr.r * 255)},${Math.floor(pr.g * 255)},${Math.floor(pr.b * 255)},${0.3 + t * 0.7})`;
      } else {
        ctx.fillStyle = `rgba(${Math.floor(dm.r * 255)},${Math.floor(dm.g * 255)},${Math.floor(dm.b * 255)},0.2)`;
      }

      ctx.fillRect(cx, tapeY + tapeH - barH, cellW - 1, barH);
      ctx.strokeStyle = `rgba(${Math.floor(dm.r * 255)},${Math.floor(dm.g * 255)},${Math.floor(dm.b * 255)},0.1)`;
      ctx.lineWidth = 0.5;
      ctx.strokeRect(cx, tapeY, cellW - 1, tapeH);
    }

    // Pointer arrow
    const ptrX = this.memPtr * cellW + cellW / 2;
    ctx.fillStyle = `rgb(${Math.floor(sr.r * 255)},${Math.floor(sr.g * 255)},${Math.floor(sr.b * 255)})`;
    ctx.beginPath();
    ctx.moveTo(ptrX, tapeY - 3);
    ctx.lineTo(ptrX - 4, tapeY - 8);
    ctx.lineTo(ptrX + 4, tapeY - 8);
    ctx.closePath();
    ctx.fill();

    // Program display
    const fontSize = Math.max(8, Math.floor(ch * 0.06));
    ctx.font = `${fontSize}px monospace`;
    const visChars = Math.floor(cw / (fontSize * 0.6));
    const start = Math.max(0, this.pc - Math.floor(visChars / 2));
    const progSlice = this.program.slice(start, start + visChars);

    for (let i = 0; i < progSlice.length; i++) {
      const charIdx = start + i;
      if (charIdx === this.pc) {
        ctx.fillStyle = `rgb(${Math.floor(sr.r * 255)},${Math.floor(sr.g * 255)},${Math.floor(sr.b * 255)})`;
      } else {
        ctx.fillStyle = `rgba(${Math.floor(dm.r * 255)},${Math.floor(dm.g * 255)},${Math.floor(dm.b * 255)},0.4)`;
      }
      ctx.fillText(progSlice[i], i * fontSize * 0.6 + 4, fontSize + 2);
    }

    // Output line
    if (this.output.length > 0) {
      ctx.fillStyle = `rgba(${Math.floor(pr.r * 255)},${Math.floor(pr.g * 255)},${Math.floor(pr.b * 255)},0.6)`;
      ctx.textAlign = 'left';
      ctx.fillText('OUT: ' + this.output.replace(/[^\x20-\x7E]/g, '.'), 4, ch - 4);
    }

    // Step counter
    ctx.fillStyle = `rgba(${Math.floor(dm.r * 255)},${Math.floor(dm.g * 255)},${Math.floor(dm.b * 255)},0.3)`;
    ctx.textAlign = 'right';
    ctx.fillText(`${this.totalSteps}`, cw - 4, fontSize + 2);
    ctx.textAlign = 'left';
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);
    this.material.opacity = opacity;

    const steps = this.stepsPerFrame + this.intensityLevel * 5;
    let running = true;
    for (let i = 0; i < steps && running; i++) {
      running = this.stepVM();
    }

    if (!running) {
      this.loadRandomProgram();
    }

    this.renderState();
    this.texture.needsUpdate = true;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      for (let i = 0; i < this.memory.length; i++) {
        if (this.rng.chance(0.2)) {
          this.memory[i] = this.rng.int(0, 255);
        }
      }
    }
    if (action === 'pulse') {
      this.loadRandomProgram();
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    this.intensityLevel = level;
  }
}
