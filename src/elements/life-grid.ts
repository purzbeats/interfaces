import * as THREE from 'three';
import { BaseElement } from './base-element';
import { applyScanlines, drawGlowText } from '../animation/retro-text';

/**
 * Conway's Game of Life rendered on a canvas texture.
 * Styled as a biocontainment monitoring display with generation counter,
 * color-coded cell states, and subtle grid lines.
 */
export class LifeGridElement extends BaseElement {
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private texture!: THREE.CanvasTexture;
  private mesh!: THREE.Mesh;

  private cols: number = 0;
  private rows: number = 0;
  private cellSize: number = 0;

  // Double-buffered cell grids (0 = dead, 1 = alive)
  private current!: Uint8Array;
  private next!: Uint8Array;
  private previous!: Uint8Array; // for detecting born/dying cells

  private generation: number = 0;
  private stepAccum: number = 0;
  private renderAccum: number = 0;
  private stepInterval: number = 0.15; // ~150ms

  // Alert: seed a pattern then resume
  private alertFlashTimer: number = 0;

  glitchAmount = 3;

  build(): void {
    const { x, y, w, h } = this.px;

    // Calculate grid dimensions — target cell size of ~6-10px
    this.cellSize = Math.max(6, Math.min(10, Math.floor(Math.min(w, h) / 30)));
    this.cols = Math.floor(w / this.cellSize);
    this.rows = Math.floor(h / this.cellSize);
    if (this.cols < 4) this.cols = 4;
    if (this.rows < 4) this.rows = 4;

    const total = this.cols * this.rows;
    this.current = new Uint8Array(total);
    this.next = new Uint8Array(total);
    this.previous = new Uint8Array(total);

    // Initialize ~30% alive
    for (let i = 0; i < total; i++) {
      this.current[i] = this.rng.chance(0.3) ? 1 : 0;
      this.previous[i] = 0; // all "new" on first frame
    }

    // Create canvas at device-pixel-scaled resolution
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

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);

    // Alert flash timer
    if (this.alertFlashTimer > 0) {
      this.alertFlashTimer -= dt;
    }

    // Step the automaton
    this.stepAccum += dt;
    if (this.stepAccum >= this.stepInterval) {
      this.stepAccum -= this.stepInterval;
      this.stepAutomaton();
    }

    // Render at ~12fps
    this.renderAccum += dt;
    if (this.renderAccum >= 1 / 12) {
      this.renderAccum = 0;
      this.renderCanvas(time);
    }

    (this.mesh.material as THREE.MeshBasicMaterial).opacity = opacity;
  }

  private countNeighbors(col: number, row: number): number {
    let count = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nc = col + dx;
        const nr = row + dy;
        if (nc >= 0 && nc < this.cols && nr >= 0 && nr < this.rows) {
          count += this.current[nr * this.cols + nc];
        }
      }
    }
    return count;
  }

  private stepAutomaton(): void {
    // Copy current to previous for born/dying detection
    this.previous.set(this.current);

    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const idx = r * this.cols + c;
        const neighbors = this.countNeighbors(c, r);
        if (this.current[idx] === 1) {
          // Alive: survive with 2 or 3 neighbors
          this.next[idx] = (neighbors === 2 || neighbors === 3) ? 1 : 0;
        } else {
          // Dead: born with exactly 3 neighbors
          this.next[idx] = (neighbors === 3) ? 1 : 0;
        }
      }
    }

    // Swap buffers
    const tmp = this.current;
    this.current = this.next;
    this.next = tmp;
    this.generation++;

    // If the grid is mostly dead, reseed occasionally
    let alive = 0;
    for (let i = 0; i < this.current.length; i++) alive += this.current[i];
    if (alive < this.cols * this.rows * 0.02) {
      this.seedRandom(0.2);
    }
  }

  private seedRandom(density: number): void {
    for (let i = 0; i < this.current.length; i++) {
      if (this.rng.chance(density)) this.current[i] = 1;
    }
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

    // Draw grid lines
    ctx.strokeStyle = dimHex;
    ctx.lineWidth = 0.5;
    ctx.globalAlpha = 0.15;
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
    const padding = Math.max(1, cellW * 0.12);
    const pulseFlash = this.pulseTimer > 0;

    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const idx = r * this.cols + c;
        const alive = this.current[idx];
        const wasAlive = this.previous[idx];

        if (alive === 0 && wasAlive === 0) continue;

        const cx = c * cellW;
        const cy = r * cellH;

        if (alive === 1) {
          const neighbors = this.countNeighbors(c, r);
          const dying = neighbors < 2 || neighbors > 3;
          const born = wasAlive === 0;

          if (pulseFlash) {
            // Bright flash on pulse
            ctx.fillStyle = primaryHex;
            ctx.shadowColor = primaryHex;
            ctx.shadowBlur = 8;
            ctx.globalAlpha = 1;
          } else if (born) {
            // Newly born — bright primary with glow
            ctx.fillStyle = primaryHex;
            ctx.shadowColor = primaryHex;
            ctx.shadowBlur = 6;
            ctx.globalAlpha = 1;
          } else if (dying) {
            // About to die — secondary color, fading
            ctx.fillStyle = secondaryHex;
            ctx.shadowColor = secondaryHex;
            ctx.shadowBlur = 3;
            ctx.globalAlpha = 0.75;
          } else {
            // Stable alive — dim color
            ctx.fillStyle = dimHex;
            ctx.shadowColor = dimHex;
            ctx.shadowBlur = 2;
            ctx.globalAlpha = 0.85;
          }

          ctx.fillRect(cx + padding, cy + padding, cellW - padding * 2, cellH - padding * 2);
          ctx.shadowBlur = 0;
          ctx.globalAlpha = 1;
        } else if (wasAlive === 1) {
          // Just died — faint afterglow
          ctx.fillStyle = dimHex;
          ctx.globalAlpha = 0.2;
          ctx.fillRect(cx + padding, cy + padding, cellW - padding * 2, cellH - padding * 2);
          ctx.globalAlpha = 1;
        }
      }
    }

    // Alert flash overlay
    if (this.alertFlashTimer > 0) {
      ctx.fillStyle = secondaryHex;
      ctx.globalAlpha = this.alertFlashTimer * 0.4;
      ctx.fillRect(0, 0, cw, ch);
      ctx.globalAlpha = 1;
    }

    // Generation counter label at bottom
    const labelFontSize = Math.max(8, Math.floor(Math.min(cw, ch) * 0.04));
    ctx.font = `${labelFontSize}px monospace`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    const genStr = 'GEN: ' + String(this.generation).padStart(4, '0');
    drawGlowText(ctx, genStr, 4, ch - 4, dimHex, 3);

    // Population counter on the right
    let pop = 0;
    for (let i = 0; i < this.current.length; i++) pop += this.current[i];
    const popStr = 'POP: ' + String(pop).padStart(4, '0');
    ctx.textAlign = 'right';
    drawGlowText(ctx, popStr, cw - 4, ch - 4, dimHex, 3);

    // Header label
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const headerFontSize = Math.max(7, Math.floor(labelFontSize * 0.85));
    ctx.font = `${headerFontSize}px monospace`;
    drawGlowText(ctx, 'BIOCONTAINMENT GRID', cw / 2, 3, dimHex, 2);

    // Scanlines
    applyScanlines(ctx, canvas, 0.04, time);
    this.texture.needsUpdate = true;
  }

  onAction(action: string): void {
    super.onAction(action);

    if (action === 'glitch') {
      // Randomize ~20% of cells
      for (let i = 0; i < this.current.length; i++) {
        if (this.rng.chance(0.2)) {
          this.current[i] = this.current[i] === 1 ? 0 : 1;
        }
      }
    }

    if (action === 'alert') {
      // Clear all then seed an R-pentomino in the center
      this.current.fill(0);
      this.alertFlashTimer = 0.5;
      const mc = Math.floor(this.cols / 2);
      const mr = Math.floor(this.rows / 2);
      // R-pentomino pattern:
      //  .##
      //  ##.
      //  .#.
      const rPentomino = [
        [0, -1], [1, -1],
        [-1, 0], [0, 0],
        [0, 1],
      ];
      for (const [dc, dr] of rPentomino) {
        const c = mc + dc;
        const r = mr + dr;
        if (c >= 0 && c < this.cols && r >= 0 && r < this.rows) {
          this.current[r * this.cols + c] = 1;
        }
      }
      this.generation = 0;
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
