import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

type GateType = 'AND' | 'OR' | 'XOR' | 'NOT';

interface Gate {
  type: GateType;
  x: number;
  y: number;
  inputs: number[]; // indices into gates array or -1 for primary input
  output: number;   // 0 or 1
  inputVals: number[];
}

/**
 * Logic gate cascade. AND, OR, XOR, NOT gates connected in a circuit.
 * Input signals propagate through, outputs computed. Canvas rendered
 * with gate symbols and signal lines.
 */
export class LogicCascadeElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'logic-cascade',
    meta: {
      shape: 'rectangular',
      roles: ['data-display', 'structural'],
      moods: ['tactical', 'diagnostic'],
      bandAffinity: 'mid',
      sizes: ['needs-medium', 'needs-large'],
    } satisfies ElementMeta,
  };

  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private texture!: THREE.CanvasTexture;
  private mesh!: THREE.Mesh;

  private gates: Gate[] = [];
  private primaryInputs: number[] = [];
  private layers: number = 3;
  private gatesPerLayer: number = 4;
  private inputCount: number = 4;
  private clockInterval: number = 0.5;
  private clockTimer: number = 0;
  private propagateLayer: number = -1;
  private gateW: number = 0;
  private gateH: number = 0;

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;
    const variant = this.rng.int(0, 3);

    const presets = [
      { layers: 3, perLayer: 3, inputs: 4, clock: 0.5 },
      { layers: 4, perLayer: 4, inputs: 6, clock: 0.3 },
      { layers: 2, perLayer: 2, inputs: 3, clock: 0.8 },
      { layers: 4, perLayer: 3, inputs: 5, clock: 0.4 },
    ];
    const p = presets[variant];

    this.layers = p.layers;
    this.gatesPerLayer = p.perLayer;
    this.inputCount = p.inputs;
    this.clockInterval = p.clock;

    // Cap resolution while preserving tile aspect ratio to prevent stretching
    const maxRes = 400;
    const scale = Math.min(1, maxRes / Math.max(w, h));
    const cw = Math.max(64, Math.floor(w * scale));
    const ch = Math.max(64, Math.floor(h * scale));
    this.canvas = document.createElement('canvas');
    this.canvas.width = cw;
    this.canvas.height = ch;
    this.ctx = this.get2DContext(this.canvas);

    this.buildCircuit();

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

  private buildCircuit(): void {
    this.gates = [];
    const gateTypes: GateType[] = ['AND', 'OR', 'XOR', 'NOT'];
    const cw = this.canvas ? this.canvas.width : Math.round(this.px.w);
    const ch = this.canvas ? this.canvas.height : Math.round(this.px.h);

    const totalCols = this.layers + 1; // inputs + layers
    const colW = cw / (totalCols + 1);
    const maxRows = Math.max(this.inputCount, this.gatesPerLayer);
    const rowH = ch / (maxRows + 1);

    // Keep gates proportional regardless of tile aspect ratio
    const cellSize = Math.min(colW, rowH);
    this.gateW = cellSize * 0.7;
    this.gateH = cellSize * 0.5;

    // Primary inputs (not real gates, but stored for wiring)
    this.primaryInputs = [];
    for (let i = 0; i < this.inputCount; i++) {
      this.primaryInputs.push(this.rng.int(0, 1));
    }

    // Build gate layers
    let prevLayerStart = -1;
    let prevLayerCount = this.inputCount;

    for (let layer = 0; layer < this.layers; layer++) {
      const count = layer === this.layers - 1 ? Math.max(1, Math.floor(this.gatesPerLayer / 2)) : this.gatesPerLayer;
      const gx = colW * (layer + 1.5);

      for (let g = 0; g < count; g++) {
        const gy = rowH * (g + 1) + (ch - rowH * (count + 1)) / 2;
        const gType = gateTypes[this.rng.int(0, gateTypes.length - 1)];

        const inputIndices: number[] = [];
        const numInputs = gType === 'NOT' ? 1 : 2;

        for (let inp = 0; inp < numInputs; inp++) {
          if (layer === 0) {
            // Connect to primary input
            inputIndices.push(-(this.rng.int(0, this.inputCount - 1) + 1));
          } else {
            // Connect to previous layer gate
            inputIndices.push(prevLayerStart + this.rng.int(0, prevLayerCount - 1));
          }
        }

        this.gates.push({
          type: gType,
          x: gx,
          y: gy,
          inputs: inputIndices,
          output: 0,
          inputVals: new Array(numInputs).fill(0),
        });
      }

      prevLayerStart = this.gates.length - count;
      prevLayerCount = count;
    }

    this.propagateAll();
  }

  private getGateInput(idx: number): number {
    if (idx < 0) {
      // Primary input: idx is -(inputIndex+1)
      const pi = -(idx + 1);
      return pi < this.primaryInputs.length ? this.primaryInputs[pi] : 0;
    }
    return idx < this.gates.length ? this.gates[idx].output : 0;
  }

  private computeGate(gate: Gate): number {
    const vals = gate.inputs.map((i) => this.getGateInput(i));
    gate.inputVals = vals;
    switch (gate.type) {
      case 'AND': return vals.length >= 2 ? vals[0] & vals[1] : vals[0];
      case 'OR':  return vals.length >= 2 ? vals[0] | vals[1] : vals[0];
      case 'XOR': return vals.length >= 2 ? vals[0] ^ vals[1] : vals[0];
      case 'NOT': return vals[0] ^ 1;
      default: return 0;
    }
  }

  private propagateAll(): void {
    for (const gate of this.gates) {
      gate.output = this.computeGate(gate);
    }
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

    const colW = cw / (this.layers + 2);
    const maxRows = Math.max(this.inputCount, this.gatesPerLayer);
    const rowH = ch / (maxRows + 1);

    const colorHi = `rgb(${Math.round(sc.r * 255)},${Math.round(sc.g * 255)},${Math.round(sc.b * 255)})`;
    const colorLo = `rgb(${Math.round(dm.r * 200)},${Math.round(dm.g * 200)},${Math.round(dm.b * 200)})`;
    const colorGate = `rgb(${Math.round(pr.r * 255)},${Math.round(pr.g * 255)},${Math.round(pr.b * 255)})`;
    const colorWire = `rgb(${Math.round(dm.r * 255)},${Math.round(dm.g * 255)},${Math.round(dm.b * 255)})`;

    // Draw primary inputs
    const inputX = colW * 0.5;
    for (let i = 0; i < this.inputCount; i++) {
      const iy = rowH * (i + 1) + (ch - rowH * (this.inputCount + 1)) / 2;
      ctx.fillStyle = this.primaryInputs[i] ? colorHi : colorLo;
      ctx.beginPath();
      ctx.arc(inputX, iy, Math.max(4, rowH * 0.15), 0, Math.PI * 2);
      ctx.fill();

      // Label
      ctx.fillStyle = colorGate;
      ctx.font = `${Math.max(8, rowH * 0.2)}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(this.primaryInputs[i]), inputX, iy);
    }

    // Draw wires first (behind gates)
    ctx.lineWidth = 1;
    for (const gate of this.gates) {
      for (const inp of gate.inputs) {
        let sx: number, sy: number;
        if (inp < 0) {
          const pi = -(inp + 1);
          sx = inputX;
          sy = rowH * (pi + 1) + (ch - rowH * (this.inputCount + 1)) / 2;
        } else {
          sx = this.gates[inp].x + this.gateW * 0.5;
          sy = this.gates[inp].y;
        }
        const val = this.getGateInput(inp);
        ctx.strokeStyle = val ? colorHi : colorWire;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        // Elbow routing
        const midX = (sx + gate.x - this.gateW * 0.5) / 2;
        ctx.lineTo(midX, sy);
        ctx.lineTo(midX, gate.y);
        ctx.lineTo(gate.x - this.gateW * 0.5, gate.y);
        ctx.stroke();
      }
    }

    // Draw gates
    for (const gate of this.gates) {
      const gx = gate.x - this.gateW * 0.5;
      const gy = gate.y - this.gateH * 0.5;

      // Gate body
      ctx.strokeStyle = colorGate;
      ctx.lineWidth = 1.5;

      switch (gate.type) {
        case 'AND':
          ctx.beginPath();
          ctx.moveTo(gx, gy);
          ctx.lineTo(gx + this.gateW * 0.5, gy);
          ctx.arc(gx + this.gateW * 0.5, gate.y, this.gateH * 0.5, -Math.PI / 2, Math.PI / 2);
          ctx.lineTo(gx, gy + this.gateH);
          ctx.closePath();
          ctx.stroke();
          break;
        case 'OR':
          ctx.beginPath();
          ctx.moveTo(gx, gy);
          ctx.quadraticCurveTo(gx + this.gateW * 0.8, gy, gx + this.gateW, gate.y);
          ctx.quadraticCurveTo(gx + this.gateW * 0.8, gy + this.gateH, gx, gy + this.gateH);
          ctx.quadraticCurveTo(gx + this.gateW * 0.3, gate.y, gx, gy);
          ctx.stroke();
          break;
        case 'XOR':
          ctx.beginPath();
          ctx.moveTo(gx + 3, gy);
          ctx.quadraticCurveTo(gx + this.gateW * 0.8, gy, gx + this.gateW, gate.y);
          ctx.quadraticCurveTo(gx + this.gateW * 0.8, gy + this.gateH, gx + 3, gy + this.gateH);
          ctx.quadraticCurveTo(gx + this.gateW * 0.3, gate.y, gx + 3, gy);
          ctx.stroke();
          // Extra curve for XOR
          ctx.beginPath();
          ctx.moveTo(gx, gy);
          ctx.quadraticCurveTo(gx + this.gateW * 0.25, gate.y, gx, gy + this.gateH);
          ctx.stroke();
          break;
        case 'NOT':
          ctx.beginPath();
          ctx.moveTo(gx, gy);
          ctx.lineTo(gx + this.gateW * 0.8, gate.y);
          ctx.lineTo(gx, gy + this.gateH);
          ctx.closePath();
          ctx.stroke();
          // Bubble
          ctx.beginPath();
          ctx.arc(gx + this.gateW * 0.9, gate.y, this.gateH * 0.12, 0, Math.PI * 2);
          ctx.stroke();
          break;
      }

      // Gate label
      ctx.fillStyle = colorGate;
      ctx.font = `${Math.max(7, this.gateH * 0.3)}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(gate.type, gate.x, gate.y);

      // Output value
      ctx.fillStyle = gate.output ? colorHi : colorLo;
      ctx.beginPath();
      ctx.arc(gate.x + this.gateW * 0.55, gate.y, Math.max(2, this.gateH * 0.1), 0, Math.PI * 2);
      ctx.fill();
    }

    // Output wires from last layer
    if (this.gates.length > 0) {
      const lastStart = this.gates.length - Math.max(1, Math.floor(this.gatesPerLayer / 2));
      for (let i = lastStart; i < this.gates.length; i++) {
        const gate = this.gates[i];
        ctx.strokeStyle = gate.output ? colorHi : colorWire;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(gate.x + this.gateW * 0.5, gate.y);
        ctx.lineTo(cw - colW * 0.3, gate.y);
        ctx.stroke();

        // Output dot
        ctx.fillStyle = gate.output ? colorHi : colorLo;
        ctx.beginPath();
        ctx.arc(cw - colW * 0.3, gate.y, Math.max(3, rowH * 0.1), 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);

    this.clockTimer += dt;
    if (this.clockTimer >= this.clockInterval) {
      this.clockTimer -= this.clockInterval;
      // Toggle a random primary input
      const idx = this.rng.int(0, this.inputCount - 1);
      this.primaryInputs[idx] ^= 1;
      this.propagateAll();
    }

    this.renderCanvas();
    this.texture.needsUpdate = true;
    (this.mesh.material as THREE.MeshBasicMaterial).opacity = opacity;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Randomize all inputs
      for (let i = 0; i < this.inputCount; i++) {
        this.primaryInputs[i] = this.rng.int(0, 1);
      }
      this.propagateAll();
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) {
      this.clockInterval = 0.5;
      return;
    }
    this.clockInterval = Math.max(0.08, 0.5 - level * 0.08);
    if (level >= 4) {
      for (let i = 0; i < this.inputCount; i++) {
        this.primaryInputs[i] = this.rng.int(0, 1);
      }
      this.propagateAll();
    }
  }
}
