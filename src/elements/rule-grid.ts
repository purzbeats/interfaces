import * as THREE from 'three';
import { BaseElement } from './base-element';
import { applyScanlines, drawGlowText } from '../animation/retro-text';

/**
 * Wolfram elementary cellular automaton display.
 * Renders a 1D CA that generates descending pyramid/triangle patterns,
 * scrolling continuously as new generations are computed.
 * Rule 90 produces the Sierpinski triangle, Rule 30 produces chaos, etc.
 */
export class RuleGridElement extends BaseElement {
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private texture!: THREE.CanvasTexture;
  private mesh!: THREE.Mesh;

  private cols: number = 0;
  private rows: number = 0;
  private cellSize: number = 0;

  /** 2D grid stored as flat array: grid[row * cols + col], 0 or 1 */
  private grid!: Uint8Array;

  /** The 8-entry rule lookup table (3-bit neighborhood -> output bit) */
  private ruleTable: Uint8Array = new Uint8Array(8);
  private ruleNumber: number = 0;
  private generation: number = 0;
  private filledRows: number = 0;

  private stepAccum: number = 0;
  private stepInterval: number = 0;
  private renderAccum: number = 0;

  // Glitch: temporarily switch rule
  private savedRuleNumber: number = 0;
  private savedRuleTable: Uint8Array = new Uint8Array(8);
  private glitchRuleTimer: number = 0;

  // Alert flash
  private alertFlashTimer: number = 0;

  // Looping: detect dead/uniform patterns and restart
  private deadRowCount: number = 0;
  private readonly DEAD_THRESHOLD = 8; // consecutive dead bottom rows before restart

  private static readonly GOOD_RULES = [
    30, 45, 54, 60, 73, 75, 86, 89, 90, 105, 110, 124, 135, 150, 169, 182, 193, 225,
  ];

  glitchAmount = 3;

  build(): void {
    const { x, y, w, h } = this.px;

    // Cell size ~4-6px, derive grid dimensions
    this.cellSize = Math.max(4, Math.min(6, Math.floor(Math.min(w, h) / 40)));
    this.cols = Math.floor(w / this.cellSize);
    this.rows = Math.floor(h / this.cellSize);
    if (this.cols < 8) this.cols = 8;
    if (this.rows < 8) this.rows = 8;

    this.grid = new Uint8Array(this.cols * this.rows);

    // Pick a rule and build lookup table
    this.ruleNumber = this.rng.pick(RuleGridElement.GOOD_RULES);
    this.buildRuleTable(this.ruleNumber, this.ruleTable);

    // Initialize top row
    this.initTopRow();

    // Step interval: 50-80ms
    this.stepInterval = this.rng.float(0.05, 0.08);

    // Create canvas
    const scale = Math.min(2, window.devicePixelRatio);
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.ceil(w * scale);
    this.canvas.height = Math.ceil(h * scale);
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.LinearFilter;

    const geo = new THREE.PlaneGeometry(w, h);
    this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      opacity: 0,
    }));
    this.mesh.position.set(x + w / 2, y + h / 2, 1);
    this.group.add(this.mesh);
  }

  private buildRuleTable(ruleNum: number, table: Uint8Array): void {
    for (let i = 0; i < 8; i++) {
      table[i] = (ruleNum >> i) & 1;
    }
  }

  private initTopRow(): void {
    this.grid.fill(0);
    this.filledRows = 1;
    this.generation = 0;

    if (this.rng.chance(0.3)) {
      // Random top row
      for (let c = 0; c < this.cols; c++) {
        this.grid[c] = this.rng.chance(0.5) ? 1 : 0;
      }
    } else {
      // Single center cell ON (classic pyramid)
      this.grid[Math.floor(this.cols / 2)] = 1;
    }
  }

  /** Compute a new row from a source row using the current rule table */
  private computeRow(srcRow: number, dstRow: number): void {
    const srcOffset = srcRow * this.cols;
    const dstOffset = dstRow * this.cols;

    for (let c = 0; c < this.cols; c++) {
      const left = c > 0 ? this.grid[srcOffset + c - 1] : 0;
      const center = this.grid[srcOffset + c];
      const right = c < this.cols - 1 ? this.grid[srcOffset + c + 1] : 0;
      const neighborhood = (left << 2) | (center << 1) | right;
      this.grid[dstOffset + c] = this.ruleTable[neighborhood];
    }
  }

  private stepAutomaton(): void {
    if (this.filledRows < this.rows) {
      // Still filling the grid from top to bottom
      this.computeRow(this.filledRows - 1, this.filledRows);
      this.filledRows++;
    } else {
      // Grid is full: scroll all rows up by one, compute new bottom row
      // Shift rows up: copy row[1..rows-1] to row[0..rows-2]
      this.grid.copyWithin(0, this.cols);

      // Compute new bottom row from the row above it
      this.computeRow(this.rows - 2, this.rows - 1);
    }

    this.generation++;
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);

    // Glitch rule timer
    if (this.glitchRuleTimer > 0) {
      this.glitchRuleTimer -= dt;
      if (this.glitchRuleTimer <= 0) {
        // Restore original rule
        this.ruleNumber = this.savedRuleNumber;
        this.ruleTable.set(this.savedRuleTable);
      }
    }

    // Alert flash timer
    if (this.alertFlashTimer > 0) {
      this.alertFlashTimer -= dt;
    }

    // Step the automaton
    this.stepAccum += dt;
    if (this.stepAccum >= this.stepInterval) {
      this.stepAccum -= this.stepInterval;
      this.stepAutomaton();

      // Only check for dead patterns after the grid has fully filled
      if (this.filledRows >= this.rows) {
        const lastRowOffset = (this.rows - 1) * this.cols;
        let alive = 0;
        for (let c = 0; c < this.cols; c++) alive += this.grid[lastRowOffset + c];

        if (alive === 0 || alive === this.cols) {
          this.deadRowCount++;
          if (this.deadRowCount >= this.DEAD_THRESHOLD) {
          // Pattern died or went uniform — pick a new rule and restart
          let newRule: number;
          do {
            newRule = this.rng.pick(RuleGridElement.GOOD_RULES);
          } while (newRule === this.ruleNumber && RuleGridElement.GOOD_RULES.length > 1);
          this.ruleNumber = newRule;
          this.buildRuleTable(newRule, this.ruleTable);
          this.glitchRuleTimer = 0;
          this.initTopRow();
          this.deadRowCount = 0;
        }
        } else {
          this.deadRowCount = 0;
        }
      }
    }

    // Render at ~15fps
    this.renderAccum += dt;
    if (this.renderAccum >= 1 / 15) {
      this.renderAccum = 0;
      this.renderCanvas(time);
    }

    (this.mesh.material as THREE.MeshBasicMaterial).opacity = opacity;
  }

  private renderCanvas(time: number): void {
    const { ctx, canvas } = this;
    const cw = canvas.width;
    const ch = canvas.height;
    ctx.clearRect(0, 0, cw, ch);

    const primaryHex = '#' + this.palette.primary.getHexString();
    const secondaryHex = '#' + this.palette.secondary.getHexString();
    const dimHex = '#' + this.palette.dim.getHexString();
    const bgHex = '#' + this.palette.bg.getHexString();

    // Scale factor from region pixels to canvas pixels
    const sx = cw / (this.cols * this.cellSize);
    const sy = ch / (this.rows * this.cellSize);

    // Faint background fill
    ctx.fillStyle = bgHex;
    ctx.globalAlpha = 0.3;
    ctx.fillRect(0, 0, cw, ch);
    ctx.globalAlpha = 1;

    // Draw grid overlay (very faint lines between cells)
    ctx.strokeStyle = dimHex;
    ctx.lineWidth = 0.5;
    ctx.globalAlpha = 0.08;
    for (let c = 0; c <= this.cols; c++) {
      const gx = c * this.cellSize * sx;
      ctx.beginPath();
      ctx.moveTo(gx, 0);
      ctx.lineTo(gx, ch);
      ctx.stroke();
    }
    for (let r = 0; r <= this.rows; r++) {
      const gy = r * this.cellSize * sy;
      ctx.beginPath();
      ctx.moveTo(0, gy);
      ctx.lineTo(cw, gy);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // Draw cells
    const cellW = this.cellSize * sx;
    const cellH = this.cellSize * sy;
    const pulseFlash = this.pulseTimer > 0;

    // Determine active front: bottom 3-4 rows are "recently computed"
    const activeFrontStart = Math.max(0, this.filledRows - 4);

    for (let r = 0; r < this.filledRows && r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const idx = r * this.cols + c;
        if (this.grid[idx] === 0) continue;

        const cx = c * cellW;
        const cy = r * cellH;

        if (pulseFlash) {
          // Moderate flash on pulse
          ctx.fillStyle = primaryHex;
          ctx.shadowBlur = 0;
          ctx.globalAlpha = 0.8;
        } else if (r >= activeFrontStart) {
          // Active front rows: dim secondary color, no glow
          ctx.fillStyle = dimHex;
          ctx.shadowBlur = 0;
          ctx.globalAlpha = 0.7;
        } else {
          // Normal ON cells: dim primary, no glow
          ctx.fillStyle = dimHex;
          ctx.shadowBlur = 0;
          ctx.globalAlpha = 0.5;
        }

        ctx.fillRect(cx, cy, cellW, cellH);
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 1;
      }
    }

    // Alert flash overlay
    if (this.alertFlashTimer > 0) {
      ctx.fillStyle = secondaryHex;
      ctx.globalAlpha = this.alertFlashTimer * 0.5;
      ctx.fillRect(0, 0, cw, ch);
      ctx.globalAlpha = 1;
    }

    // Header label: "RULE {N}"
    const labelFontSize = Math.max(8, Math.floor(Math.min(cw, ch) * 0.04));
    ctx.font = `${labelFontSize}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    drawGlowText(ctx, `RULE ${this.ruleNumber}`, cw / 2, 3, dimHex, 3);

    // Generation counter at bottom
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    const genStr = 'GEN: ' + String(this.generation).padStart(5, '0');
    drawGlowText(ctx, genStr, 4, ch - 4, dimHex, 2);

    // Scanlines
    applyScanlines(ctx, canvas, 0.04, time);
    this.texture.needsUpdate = true;
  }

  onAction(action: string): void {
    super.onAction(action);

    if (action === 'glitch') {
      // Temporarily switch to a different random rule for 1 second
      if (this.glitchRuleTimer <= 0) {
        this.savedRuleNumber = this.ruleNumber;
        this.savedRuleTable.set(this.ruleTable);
      }

      // Pick a different rule
      let newRule: number;
      do {
        newRule = this.rng.pick(RuleGridElement.GOOD_RULES);
      } while (newRule === this.ruleNumber && RuleGridElement.GOOD_RULES.length > 1);

      this.ruleNumber = newRule;
      this.buildRuleTable(newRule, this.ruleTable);
      this.glitchRuleTimer = 1.0;
    }

    if (action === 'alert') {
      // Clear grid, pick a new rule, restart from center seed
      let newRule: number;
      do {
        newRule = this.rng.pick(RuleGridElement.GOOD_RULES);
      } while (newRule === this.ruleNumber && RuleGridElement.GOOD_RULES.length > 1);

      this.ruleNumber = newRule;
      this.buildRuleTable(newRule, this.ruleTable);
      this.glitchRuleTimer = 0; // cancel any pending glitch restore
      this.initTopRow();
      this.pulseTimer = 2.0;
      this.alertFlashTimer = 0.5;
    }

    if (action === 'pulse') {
      // pulseTimer already set by super — triggers bright flash in render
    }
  }

  dispose(): void {
    this.texture.dispose();
    super.dispose();
  }
}
