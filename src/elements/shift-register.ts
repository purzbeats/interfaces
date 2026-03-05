import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * LFSR (Linear Feedback Shift Register). Row of bit cells that shift
 * each clock cycle. XOR feedback from tap positions generates pseudo-random
 * sequence. Canvas rendered with bit cells and feedback lines.
 */
export class ShiftRegisterElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'shift-register',
    meta: {
      shape: 'rectangular',
      roles: ['data-display', 'decorative'],
      moods: ['tactical', 'diagnostic'],
      bandAffinity: 'bass',
      sizes: ['works-small', 'needs-medium'],
    } satisfies ElementMeta,
  };

  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private texture!: THREE.CanvasTexture;
  private mesh!: THREE.Mesh;

  private bits: number[] = [];
  private regSize: number = 8;
  private taps: number[] = [];
  private clockInterval: number = 0.3;
  private clockTimer: number = 0;
  private history: number[][] = [];
  private maxHistory: number = 16;
  private outputBits: number[] = [];
  private maxOutput: number = 64;

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;
    const variant = this.rng.int(0, 3);

    const presets = [
      { size: 8,  taps: [5, 3],      clock: 0.3,  histRows: 12 },
      { size: 16, taps: [15, 12, 3], clock: 0.15, histRows: 16 },
      { size: 8,  taps: [7, 5, 4],   clock: 0.5,  histRows: 8 },
      { size: 12, taps: [11, 9, 4],  clock: 0.2,  histRows: 14 },
    ];
    const p = presets[variant];

    this.regSize = p.size;
    this.taps = p.taps;
    this.clockInterval = p.clock;
    this.maxHistory = p.histRows;

    // Initialize register with non-zero seed
    this.bits = [];
    for (let i = 0; i < this.regSize; i++) {
      this.bits.push(this.rng.int(0, 1));
    }
    // Ensure at least one bit is set
    const allZero = this.bits.every((b) => b === 0);
    if (allZero) {
      this.bits[0] = 1;
    }

    this.history = [];
    this.outputBits = [];

    const cw = Math.max(64, Math.min(512, Math.round(w)));
    const ch = Math.max(64, Math.min(512, Math.round(h)));
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

  private clockStep(): void {
    // Save current state to history
    this.history.push([...this.bits]);
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }

    // XOR feedback from taps
    let feedback = 0;
    for (const tap of this.taps) {
      if (tap < this.regSize) {
        feedback ^= this.bits[tap];
      }
    }

    // Output bit (last bit)
    this.outputBits.push(this.bits[this.regSize - 1]);
    if (this.outputBits.length > this.maxOutput) {
      this.outputBits.shift();
    }

    // Shift right, insert feedback at position 0
    for (let i = this.regSize - 1; i > 0; i--) {
      this.bits[i] = this.bits[i - 1];
    }
    this.bits[0] = feedback;
  }

  private renderCanvas(): void {
    const ctx = this.ctx;
    const cw = this.canvas.width;
    const ch = this.canvas.height;

    const bg = this.palette.bg;
    ctx.fillStyle = `rgb(${Math.round(bg.r * 255)},${Math.round(bg.g * 255)},${Math.round(bg.b * 255)})`;
    ctx.fillRect(0, 0, cw, ch);

    const pr = this.palette.primary;
    const sc = this.palette.secondary;
    const dm = this.palette.dim;

    // Layout: register at top, history below, output sequence at bottom
    const regH = ch * 0.2;
    const histH = ch * 0.5;
    const outH = ch * 0.25;
    const gap = ch * 0.05;

    // Draw current register
    const cellW = (cw * 0.85) / this.regSize;
    const cellH = regH * 0.7;
    const regX = cw * 0.075;
    const regY = gap;

    for (let i = 0; i < this.regSize; i++) {
      const cx = regX + i * cellW;
      const isTap = this.taps.includes(i);

      // Cell border
      ctx.strokeStyle = isTap
        ? `rgb(${Math.round(sc.r * 255)},${Math.round(sc.g * 255)},${Math.round(sc.b * 255)})`
        : `rgb(${Math.round(dm.r * 255)},${Math.round(dm.g * 255)},${Math.round(dm.b * 255)})`;
      ctx.lineWidth = isTap ? 2 : 1;
      ctx.strokeRect(cx, regY, cellW - 2, cellH);

      // Bit value fill
      if (this.bits[i] === 1) {
        ctx.fillStyle = `rgb(${Math.round(pr.r * 255)},${Math.round(pr.g * 255)},${Math.round(pr.b * 255)})`;
        ctx.fillRect(cx + 2, regY + 2, cellW - 6, cellH - 4);
      }

      // Bit label
      ctx.fillStyle = this.bits[i] === 1
        ? `rgb(${Math.round(bg.r * 255)},${Math.round(bg.g * 255)},${Math.round(bg.b * 255)})`
        : `rgb(${Math.round(dm.r * 255)},${Math.round(dm.g * 255)},${Math.round(dm.b * 255)})`;
      ctx.font = `${Math.max(8, cellH * 0.5)}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(this.bits[i]), cx + cellW / 2 - 1, regY + cellH / 2);
    }

    // Draw feedback arrows (simplified as lines)
    ctx.strokeStyle = `rgb(${Math.round(sc.r * 255)},${Math.round(sc.g * 255)},${Math.round(sc.b * 255)})`;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    const arrowY = regY + cellH + 4;
    for (const tap of this.taps) {
      if (tap < this.regSize) {
        const tx = regX + tap * cellW + cellW / 2;
        ctx.beginPath();
        ctx.moveTo(tx, regY + cellH);
        ctx.lineTo(tx, arrowY + 6);
        ctx.lineTo(regX + cellW / 2, arrowY + 6);
        ctx.lineTo(regX + cellW / 2, regY + cellH);
        ctx.stroke();
      }
    }
    ctx.setLineDash([]);

    // XOR label
    ctx.fillStyle = `rgb(${Math.round(sc.r * 255)},${Math.round(sc.g * 255)},${Math.round(sc.b * 255)})`;
    ctx.font = `${Math.max(7, cellH * 0.35)}px monospace`;
    ctx.textAlign = 'left';
    ctx.fillText('XOR', regX, arrowY + 18);

    // Draw history rows
    const hRowH = histH / this.maxHistory;
    const histY = regH + gap * 2;
    for (let r = 0; r < this.history.length; r++) {
      const row = this.history[r];
      const ry = histY + r * hRowH;
      const age = 1 - r / this.maxHistory;
      for (let i = 0; i < row.length; i++) {
        const cx = regX + i * cellW;
        if (row[i] === 1) {
          const a = age * 0.7 + 0.15;
          const rr = Math.round(pr.r * 255 * a);
          const gg = Math.round(pr.g * 255 * a);
          const bb = Math.round(pr.b * 255 * a);
          ctx.fillStyle = `rgb(${rr},${gg},${bb})`;
          ctx.fillRect(cx, ry, cellW - 2, hRowH - 1);
        }
      }
    }

    // Draw output bit sequence at bottom
    const outY = histY + histH + gap;
    const outBitW = Math.max(2, (cw * 0.85) / this.maxOutput);
    for (let i = 0; i < this.outputBits.length; i++) {
      const bx = regX + i * outBitW;
      if (this.outputBits[i] === 1) {
        ctx.fillStyle = `rgb(${Math.round(sc.r * 255)},${Math.round(sc.g * 255)},${Math.round(sc.b * 255)})`;
      } else {
        ctx.fillStyle = `rgb(${Math.round(dm.r * 100)},${Math.round(dm.g * 100)},${Math.round(dm.b * 100)})`;
      }
      ctx.fillRect(bx, outY, outBitW - 1, outH * 0.6);
    }

    // Label
    ctx.fillStyle = `rgb(${Math.round(dm.r * 255)},${Math.round(dm.g * 255)},${Math.round(dm.b * 255)})`;
    ctx.font = `${Math.max(7, outH * 0.2)}px monospace`;
    ctx.textAlign = 'left';
    ctx.fillText('OUTPUT', regX, outY + outH * 0.85);
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);

    this.clockTimer += dt;
    while (this.clockTimer >= this.clockInterval) {
      this.clockTimer -= this.clockInterval;
      this.clockStep();
    }

    this.renderCanvas();
    this.texture.needsUpdate = true;
    (this.mesh.material as THREE.MeshBasicMaterial).opacity = opacity;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Corrupt random bits
      for (let i = 0; i < this.regSize; i++) {
        if (this.rng.float(0, 1) < 0.4) {
          this.bits[i] ^= 1;
        }
      }
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) {
      this.clockInterval = 0.3;
      return;
    }
    this.clockInterval = Math.max(0.05, 0.3 - level * 0.05);
    if (level >= 5) {
      for (let i = 0; i < this.regSize; i++) {
        this.bits[i] = this.rng.int(0, 1);
      }
      const allZ = this.bits.every((b) => b === 0);
      if (allZ) this.bits[0] = 1;
    }
  }
}
