import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Animated hex board game where two AI players compete to connect opposite
 * sides. Player 1 (primary color) connects top-to-bottom, Player 2 (secondary)
 * connects left-to-right. Cells fill in as moves are played with simple
 * weighted-random AI. Canvas-rendered hex grid with glow on recent moves.
 */
export class GameOfHexElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'game-of-hex',
    meta: {
      shape: 'rectangular',
      roles: ['data-display', 'decorative'],
      moods: ['tactical', 'ambient'],
      bandAffinity: 'bass',
      sizes: ['needs-medium', 'needs-large'],
    } satisfies ElementMeta,
  };

  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private texture!: THREE.CanvasTexture;
  private mesh!: THREE.Mesh;
  private meshMat!: THREE.MeshBasicMaterial;
  private borderLines!: THREE.LineSegments;
  private borderMat!: THREE.LineBasicMaterial;

  private boardSize = 0;
  private board!: Int8Array;   // 0=empty, 1=P1, 2=P2
  private moveAge!: Float32Array; // time since move was made (for glow)
  private moveTimer = 0;
  private moveInterval = 0;
  private currentPlayer = 1;
  private gameOver = false;
  private winner = 0;
  private totalMoves = 0;
  private hexR = 0;
  private originX = 0;
  private originY = 0;
  private intensityLevel = 0;
  private pauseTimer = 0;

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;

    const variant = this.rng.int(0, 3);
    const presets = [
      { size: 7,  interval: 0.5 },
      { size: 9,  interval: 0.35 },
      { size: 5,  interval: 0.7 },
      { size: 11, interval: 0.25 },
    ];
    const p = presets[variant];
    this.boardSize = p.size;
    this.moveInterval = p.interval;

    const n = this.boardSize;
    this.board = new Int8Array(n * n);
    this.moveAge = new Float32Array(n * n);
    this.moveAge.fill(-1);

    // Calculate hex size to fit the rhombus-shaped board
    const totalW = n * 1.5 + 0.5;
    const totalH = (n + 0.5) * Math.sqrt(3) / 2;
    this.hexR = Math.min((w * 0.8) / (totalW + 2), (h * 0.8) / (totalH * 2 + 1)) * 0.9;
    this.originX = w * 0.5 - n * this.hexR * 0.5;
    this.originY = h * 0.15;

    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.ceil(w);
    this.canvas.height = Math.ceil(h);
    this.ctx = this.get2DContext(this.canvas);

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.magFilter = THREE.NearestFilter;
    const geo = new THREE.PlaneGeometry(w, h);
    this.meshMat = new THREE.MeshBasicMaterial({
      map: this.texture, transparent: true, opacity: 0, depthWrite: false,
    });
    this.mesh = new THREE.Mesh(geo, this.meshMat);
    this.mesh.position.set(x + w / 2, y + h / 2, 0);
    this.group.add(this.mesh);

    // Border
    const bv = new Float32Array([
      x, y, 0, x + w, y, 0, x + w, y, 0, x + w, y + h, 0,
      x + w, y + h, 0, x, y + h, 0, x, y + h, 0, x, y, 0,
    ]);
    const bGeo = new THREE.BufferGeometry();
    bGeo.setAttribute('position', new THREE.BufferAttribute(bv, 3));
    this.borderMat = new THREE.LineBasicMaterial({
      color: this.palette.dim, transparent: true, opacity: 0,
    });
    this.borderLines = new THREE.LineSegments(bGeo, this.borderMat);
    this.group.add(this.borderLines);
  }

  private hexCenter(row: number, col: number): { hx: number; hy: number } {
    const r = this.hexR;
    const hx = this.originX + col * r * 1.5 + row * r * 0.75 + r;
    const hy = this.originY + row * r * Math.sqrt(3) * 0.5 + col * 0 + r * Math.sqrt(3) * 0.5;
    // Offset for rhombus shape
    return { hx: hx + row * r * 0.4, hy };
  }

  private getNeighbors(r: number, c: number): number[] {
    const n = this.boardSize;
    const result: number[] = [];
    const dirs = [[-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0]];
    for (const [dr, dc] of dirs) {
      const nr = r + dr, nc = c + dc;
      if (nr >= 0 && nr < n && nc >= 0 && nc < n) {
        result.push(nr * n + nc);
      }
    }
    return result;
  }

  private makeMove(): void {
    if (this.gameOver) return;
    const n = this.boardSize;
    const empty: number[] = [];
    for (let i = 0; i < n * n; i++) {
      if (this.board[i] === 0) empty.push(i);
    }
    if (empty.length === 0) { this.resetGame(); return; }

    // Weighted random AI: prefer center, neighbors of own pieces, bridge patterns
    const weights = new Float32Array(empty.length);
    for (let i = 0; i < empty.length; i++) {
      const idx = empty[i];
      const r = Math.floor(idx / n);
      const c = idx % n;
      const dr = r - n / 2;
      const dc = c - n / 2;
      weights[i] = 1 + 1 / (1 + dr * dr + dc * dc);
      const neighbors = this.getNeighbors(r, c);
      for (const ni of neighbors) {
        if (this.board[ni] === this.currentPlayer) weights[i] += 2.5;
        if (this.board[ni] === (3 - this.currentPlayer)) weights[i] += 1; // block
      }
    }

    let total = 0;
    for (let i = 0; i < weights.length; i++) total += weights[i];
    let roll = this.rng.float(0, total);
    let chosen = empty[0];
    for (let i = 0; i < weights.length; i++) {
      roll -= weights[i];
      if (roll <= 0) { chosen = empty[i]; break; }
    }

    this.board[chosen] = this.currentPlayer;
    this.moveAge[chosen] = 0;
    this.totalMoves++;

    if (this.checkWin(this.currentPlayer)) {
      this.gameOver = true;
      this.winner = this.currentPlayer;
      this.pauseTimer = 3;
    }
    this.currentPlayer = this.currentPlayer === 1 ? 2 : 1;
  }

  private checkWin(player: number): boolean {
    const n = this.boardSize;
    const visited = new Uint8Array(n * n);
    const queue: number[] = [];

    if (player === 1) {
      for (let c = 0; c < n; c++) {
        if (this.board[c] === player) { queue.push(c); visited[c] = 1; }
      }
      while (queue.length > 0) {
        const idx = queue.shift()!;
        const r = Math.floor(idx / n);
        if (r === n - 1) return true;
        const c = idx % n;
        for (const ni of this.getNeighbors(r, c)) {
          if (!visited[ni] && this.board[ni] === player) {
            visited[ni] = 1; queue.push(ni);
          }
        }
      }
    } else {
      for (let r = 0; r < n; r++) {
        const idx = r * n;
        if (this.board[idx] === player) { queue.push(idx); visited[idx] = 1; }
      }
      while (queue.length > 0) {
        const idx = queue.shift()!;
        const c = idx % n;
        if (c === n - 1) return true;
        const r = Math.floor(idx / n);
        for (const ni of this.getNeighbors(r, c)) {
          if (!visited[ni] && this.board[ni] === player) {
            visited[ni] = 1; queue.push(ni);
          }
        }
      }
    }
    return false;
  }

  private resetGame(): void {
    this.board.fill(0);
    this.moveAge.fill(-1);
    this.currentPlayer = 1;
    this.gameOver = false;
    this.winner = 0;
    this.totalMoves = 0;
  }

  private renderBoard(): void {
    const n = this.boardSize;
    const r = this.hexR;
    const pr = this.palette.primary;
    const sr = this.palette.secondary;
    const dm = this.palette.dim;

    this.ctx.fillStyle = 'rgba(0,0,0,0.95)';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    for (let row = 0; row < n; row++) {
      for (let col = 0; col < n; col++) {
        const { hx, hy } = this.hexCenter(row, col);
        const idx = row * n + col;
        const state = this.board[idx];
        const age = this.moveAge[idx];

        // Draw hexagon
        this.ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = (Math.PI / 3) * i - Math.PI / 6;
          const px = hx + r * 0.85 * Math.cos(a);
          const py = hy + r * 0.85 * Math.sin(a);
          if (i === 0) this.ctx.moveTo(px, py);
          else this.ctx.lineTo(px, py);
        }
        this.ctx.closePath();

        if (state === 1) {
          const glow = age >= 0 && age < 1 ? 1 + (1 - age) * 0.5 : 1;
          const ri = Math.min(255, Math.floor(pr.r * 255 * glow));
          const gi = Math.min(255, Math.floor(pr.g * 255 * glow));
          const bi = Math.min(255, Math.floor(pr.b * 255 * glow));
          this.ctx.fillStyle = `rgb(${ri},${gi},${bi})`;
          this.ctx.fill();
        } else if (state === 2) {
          const glow = age >= 0 && age < 1 ? 1 + (1 - age) * 0.5 : 1;
          const ri = Math.min(255, Math.floor(sr.r * 255 * glow));
          const gi = Math.min(255, Math.floor(sr.g * 255 * glow));
          const bi = Math.min(255, Math.floor(sr.b * 255 * glow));
          this.ctx.fillStyle = `rgb(${ri},${gi},${bi})`;
          this.ctx.fill();
        } else {
          this.ctx.fillStyle = `rgba(${Math.floor(dm.r * 255)},${Math.floor(dm.g * 255)},${Math.floor(dm.b * 255)},0.15)`;
          this.ctx.fill();
        }

        // Hex outline
        this.ctx.strokeStyle = `rgba(${Math.floor(dm.r * 255)},${Math.floor(dm.g * 255)},${Math.floor(dm.b * 255)},0.3)`;
        this.ctx.lineWidth = 0.5;
        this.ctx.stroke();
      }
    }

    // Winner indicator
    if (this.gameOver) {
      const col = this.winner === 1 ? pr : sr;
      this.ctx.fillStyle = `rgba(${Math.floor(col.r * 255)},${Math.floor(col.g * 255)},${Math.floor(col.b * 255)},0.3)`;
      this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }

    this.texture.needsUpdate = true;
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);

    // Age moves
    for (let i = 0; i < this.moveAge.length; i++) {
      if (this.moveAge[i] >= 0) this.moveAge[i] += dt;
    }

    if (this.gameOver) {
      this.pauseTimer -= dt;
      if (this.pauseTimer <= 0) this.resetGame();
    } else {
      this.moveTimer += dt;
      if (this.moveTimer >= this.moveInterval) {
        this.moveTimer = 0;
        this.makeMove();
      }
    }

    this.renderBoard();
    this.meshMat.opacity = opacity;
    this.borderMat.opacity = opacity * 0.2;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') { this.resetGame(); }
    if (action === 'pulse') {
      this.moveInterval *= 0.2;
      setTimeout(() => { this.moveInterval /= 0.2; }, 1000);
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    this.intensityLevel = level;
    if (level === 0) return;
    this.moveInterval = Math.max(0.05, 0.5 - level * 0.08);
  }
}
