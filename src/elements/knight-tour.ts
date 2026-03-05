import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Knight's tour on a chessboard. The knight visits every square exactly
 * once, animated step by step. Uses Warnsdorff's heuristic for path
 * finding. Canvas rendered with grid and progressive path drawing.
 */
export class KnightTourElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'knight-tour',
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

  private boardSize: number = 8;
  private cellSize: number = 0;
  private offsetX: number = 0;
  private offsetY: number = 0;
  private cw: number = 0;
  private ch: number = 0;

  private visited!: Int8Array;
  private path: number[] = []; // indices into board (row*boardSize+col)
  private currentStep: number = 0;
  private stepTimer: number = 0;
  private stepInterval: number = 0.15;
  private speedMult: number = 1;
  private tourComplete: boolean = false;
  private restartTimer: number = 0;

  // Knight move offsets
  private static readonly MOVES = [
    [-2, -1], [-2, 1], [-1, -2], [-1, 2],
    [1, -2], [1, 2], [2, -1], [2, 1],
  ];

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;

    const variant = this.rng.int(0, 3);
    const presets = [
      { boardSize: 8, stepInterval: 0.12 },
      { boardSize: 6, stepInterval: 0.18 },
      { boardSize: 10, stepInterval: 0.08 },
      { boardSize: 8, stepInterval: 0.06 },
    ];
    const p = presets[variant];
    this.boardSize = p.boardSize;
    this.stepInterval = p.stepInterval;

    this.canvas = document.createElement('canvas');
    this.cw = Math.max(64, Math.floor(w));
    this.ch = Math.max(64, Math.floor(h));
    this.canvas.width = this.cw;
    this.canvas.height = this.ch;
    this.ctx = this.get2DContext(this.canvas);

    this.cellSize = Math.floor(Math.min(this.cw, this.ch) * 0.9 / this.boardSize);
    this.offsetX = Math.floor((this.cw - this.cellSize * this.boardSize) / 2);
    this.offsetY = Math.floor((this.ch - this.cellSize * this.boardSize) / 2);

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;

    const geo = new THREE.PlaneGeometry(w, h);
    const mat = new THREE.MeshBasicMaterial({
      map: this.texture, transparent: true, opacity: 0,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.set(x + w / 2, y + h / 2, 0);
    this.group.add(this.mesh);

    this.startTour();
  }

  private startTour(): void {
    const n = this.boardSize;
    this.visited = new Int8Array(n * n);
    this.path = [];
    this.currentStep = 0;
    this.tourComplete = false;
    this.restartTimer = 0;

    // Random start position
    const startR = this.rng.int(0, n - 1);
    const startC = this.rng.int(0, n - 1);

    // Compute full tour using Warnsdorff's heuristic
    this.computeTour(startR, startC);
  }

  private computeTour(startR: number, startC: number): void {
    const n = this.boardSize;
    const vis = new Int8Array(n * n);
    const path: number[] = [];
    let r = startR, c = startC;
    vis[r * n + c] = 1; path.push(r * n + c);
    for (let step = 1; step < n * n; step++) {
      let bestR = -1, bestC = -1, bestDeg = 9;
      const order = [0, 1, 2, 3, 4, 5, 6, 7];
      for (let i = 7; i > 0; i--) { const j = this.rng.int(0, i); const tmp = order[i]; order[i] = order[j]; order[j] = tmp; }
      for (const mi of order) {
        const nr = r + KnightTourElement.MOVES[mi][0];
        const nc = c + KnightTourElement.MOVES[mi][1];
        if (nr < 0 || nr >= n || nc < 0 || nc >= n || vis[nr * n + nc]) continue;
        let deg = 0;
        for (const m of KnightTourElement.MOVES) {
          const nnr = nr + m[0]; const nnc = nc + m[1];
          if (nnr >= 0 && nnr < n && nnc >= 0 && nnc < n && !vis[nnr * n + nnc]) deg++;
        }
        if (deg < bestDeg) { bestDeg = deg; bestR = nr; bestC = nc; }
      }
      if (bestR < 0) break;
      r = bestR; c = bestC; vis[r * n + c] = 1; path.push(r * n + c);
    }
    this.path = path;
  }

  private renderBoard(): void {
    const bgHex = '#' + this.palette.bg.getHexString();
    const dimHex = '#' + this.palette.dim.getHexString();
    const priHex = '#' + this.palette.primary.getHexString();
    const secHex = '#' + this.palette.secondary.getHexString();
    this.ctx.fillStyle = bgHex;
    this.ctx.fillRect(0, 0, this.cw, this.ch);
    const n = this.boardSize;
    const cs = this.cellSize;
    // Checkerboard
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      if ((r + c) % 2 === 1) {
        this.ctx.fillStyle = dimHex; this.ctx.globalAlpha = 0.15;
        this.ctx.fillRect(this.offsetX + c * cs, this.offsetY + r * cs, cs, cs);
        this.ctx.globalAlpha = 1;
      }
    }
    this.ctx.strokeStyle = dimHex; this.ctx.lineWidth = 1;
    this.ctx.strokeRect(this.offsetX, this.offsetY, n * cs, n * cs);
    // Visited cells
    for (let i = 0; i < this.currentStep && i < this.path.length; i++) {
      const idx = this.path[i]; const r = Math.floor(idx / n); const c = idx % n;
      this.ctx.fillStyle = priHex; this.ctx.globalAlpha = 0.15 + (i / this.path.length) * 0.35;
      this.ctx.fillRect(this.offsetX + c * cs + 1, this.offsetY + r * cs + 1, cs - 2, cs - 2);
      this.ctx.globalAlpha = 1;
    }
    // Path lines
    if (this.currentStep > 1) {
      this.ctx.strokeStyle = secHex; this.ctx.lineWidth = 1.5; this.ctx.beginPath();
      for (let i = 0; i < this.currentStep && i < this.path.length; i++) {
        const idx = this.path[i]; const r = Math.floor(idx / n); const c = idx % n;
        const px = this.offsetX + c * cs + cs / 2; const py = this.offsetY + r * cs + cs / 2;
        if (i === 0) this.ctx.moveTo(px, py); else this.ctx.lineTo(px, py);
      }
      this.ctx.stroke();
    }
    // Knight position
    if (this.currentStep > 0 && this.currentStep <= this.path.length) {
      const idx = this.path[this.currentStep - 1]; const r = Math.floor(idx / n); const c = idx % n;
      this.ctx.fillStyle = secHex; this.ctx.beginPath();
      this.ctx.arc(this.offsetX + c * cs + cs / 2, this.offsetY + r * cs + cs / 2, cs * 0.3, 0, Math.PI * 2);
      this.ctx.fill();
    }
    this.ctx.fillStyle = dimHex; this.ctx.font = `${Math.floor(cs * 0.5)}px monospace`;
    this.ctx.fillText(`${this.currentStep}/${this.path.length}`, this.offsetX, this.offsetY - 4);
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);

    if (this.tourComplete) {
      this.restartTimer += dt * this.speedMult;
      if (this.restartTimer > 3) {
        this.startTour();
      }
    } else {
      this.stepTimer += dt * this.speedMult;
      if (this.stepTimer >= this.stepInterval) {
        this.stepTimer = 0;
        this.currentStep++;
        if (this.currentStep >= this.path.length) {
          this.tourComplete = true;
        }
      }
    }

    this.renderBoard();
    this.texture.needsUpdate = true;
    (this.mesh.material as THREE.MeshBasicMaterial).opacity = opacity * 0.9;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Jump ahead several steps
      this.currentStep = Math.min(this.currentStep + 8, this.path.length);
      if (this.currentStep >= this.path.length) {
        this.tourComplete = true;
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
      this.startTour();
    }
  }
}
