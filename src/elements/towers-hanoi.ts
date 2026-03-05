import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

interface HanoiMove {
  from: number;
  to: number;
  disk: number;
}

/**
 * Tower of Hanoi recursive solution visualization. Three pegs with colored
 * disks animate the optimal recursive solution. Canvas rendered with
 * smooth disk sliding and palette-matched colors.
 */
export class TowersHanoiElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'towers-hanoi',
    meta: {
      shape: 'rectangular',
      roles: ['data-display'],
      moods: ['diagnostic', 'ambient'],
      bandAffinity: 'bass',
      sizes: ['works-small', 'needs-medium', 'needs-large'],
    } satisfies ElementMeta,
  };

  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private texture!: THREE.CanvasTexture;
  private mesh!: THREE.Mesh;

  private numDisks: number = 5;
  private pegs: number[][] = [[], [], []]; // each peg holds disk indices (smaller = smaller disk)
  private moves: HanoiMove[] = [];
  private moveIndex: number = 0;
  private moveTimer: number = 0;
  private moveInterval: number = 0.5;
  private speedMult: number = 1;

  // Animation state
  private animating: boolean = false;
  private animDisk: number = -1;
  private animFromPeg: number = 0;
  private animToPeg: number = 0;
  private animProgress: number = 0;
  private animDuration: number = 0.3;

  private diskColors: string[] = [];
  private cw: number = 0;
  private ch: number = 0;

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;

    const variant = this.rng.int(0, 3);
    const presets = [
      { numDisks: 5, moveInterval: 0.5 },
      { numDisks: 7, moveInterval: 0.35 },
      { numDisks: 4, moveInterval: 0.7 },
      { numDisks: 6, moveInterval: 0.4 },
    ];
    const p = presets[variant];
    this.numDisks = p.numDisks;
    this.moveInterval = p.moveInterval;

    this.canvas = document.createElement('canvas');
    this.cw = Math.max(128, Math.floor(w));
    this.ch = Math.max(64, Math.floor(h));
    this.canvas.width = this.cw;
    this.canvas.height = this.ch;
    this.ctx = this.get2DContext(this.canvas);

    // Generate disk colors interpolating between primary and secondary
    const pri = this.palette.primary;
    const sec = this.palette.secondary;
    this.diskColors = [];
    for (let i = 0; i < this.numDisks; i++) {
      const t = this.numDisks > 1 ? i / (this.numDisks - 1) : 0;
      const r = Math.floor((pri.r * (1 - t) + sec.r * t) * 255);
      const g = Math.floor((pri.g * (1 - t) + sec.g * t) * 255);
      const b = Math.floor((pri.b * (1 - t) + sec.b * t) * 255);
      this.diskColors.push(`rgb(${r},${g},${b})`);
    }

    this.resetPuzzle();

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
  }

  private resetPuzzle(): void {
    this.pegs = [[], [], []];
    for (let i = this.numDisks - 1; i >= 0; i--) {
      this.pegs[0].push(i);
    }
    this.moves = [];
    this.generateMoves(this.numDisks, 0, 2, 1);
    this.moveIndex = 0;
    this.moveTimer = 0;
    this.animating = false;
  }

  private generateMoves(n: number, from: number, to: number, aux: number): void {
    if (n === 0) return;
    this.generateMoves(n - 1, from, aux, to);
    this.moves.push({ from, to, disk: n - 1 });
    this.generateMoves(n - 1, aux, to, from);
  }

  private startNextMove(): void {
    if (this.moveIndex >= this.moves.length) {
      this.resetPuzzle();
      return;
    }
    const move = this.moves[this.moveIndex];
    this.animDisk = move.disk;
    this.animFromPeg = move.from;
    this.animToPeg = move.to;
    this.animProgress = 0;
    this.animating = true;
    // Remove from source peg
    this.pegs[move.from].pop();
    this.moveIndex++;
  }

  private finishMove(): void {
    this.pegs[this.animToPeg].push(this.animDisk);
    this.animating = false;
  }

  private pegX(pegIdx: number): number {
    return this.cw * (0.2 + pegIdx * 0.3);
  }

  private renderScene(): void {
    const bgHex = '#' + this.palette.bg.getHexString();
    const dimHex = '#' + this.palette.dim.getHexString();
    this.ctx.fillStyle = bgHex;
    this.ctx.fillRect(0, 0, this.cw, this.ch);
    const baseY = this.ch * 0.85;
    const diskHeight = Math.min(this.ch * 0.06, (this.ch * 0.6) / this.numDisks);
    const maxDiskW = this.cw * 0.22;
    const minDiskW = this.cw * 0.06;
    const pegHeight = (this.numDisks + 1) * diskHeight;
    this.ctx.strokeStyle = dimHex; this.ctx.lineWidth = 2;
    for (let p = 0; p < 3; p++) {
      const px = this.pegX(p);
      this.ctx.beginPath(); this.ctx.moveTo(px, baseY); this.ctx.lineTo(px, baseY - pegHeight); this.ctx.stroke();
    }
    this.ctx.beginPath(); this.ctx.moveTo(this.cw * 0.05, baseY); this.ctx.lineTo(this.cw * 0.95, baseY); this.ctx.stroke();
    // Resting disks
    for (let p = 0; p < 3; p++) {
      const px = this.pegX(p);
      for (let s = 0; s < this.pegs[p].length; s++) {
        const disk = this.pegs[p][s];
        const dw = minDiskW + (maxDiskW - minDiskW) * ((disk + 1) / this.numDisks);
        this.ctx.fillStyle = this.diskColors[disk];
        this.ctx.fillRect(px - dw / 2, baseY - (s + 1) * diskHeight, dw, diskHeight - 1);
      }
    }
    // Animating disk
    if (this.animating && this.animDisk >= 0) {
      const disk = this.animDisk;
      const dw = minDiskW + (maxDiskW - minDiskW) * ((disk + 1) / this.numDisks);
      const fromX = this.pegX(this.animFromPeg); const toX = this.pegX(this.animToPeg);
      const fromY = baseY - (this.pegs[this.animFromPeg].length + 1) * diskHeight;
      const toY = baseY - (this.pegs[this.animToPeg].length + 1) * diskHeight;
      const liftY = baseY - pegHeight - diskHeight;
      let dx: number, dy: number; const t = this.animProgress;
      if (t < 0.3) { dx = fromX; dy = fromY + (liftY - fromY) * (t / 0.3); }
      else if (t < 0.7) { dx = fromX + (toX - fromX) * ((t - 0.3) / 0.4); dy = liftY; }
      else { dx = toX; dy = liftY + (toY - liftY) * ((t - 0.7) / 0.3); }
      this.ctx.fillStyle = this.diskColors[disk];
      this.ctx.fillRect(dx - dw / 2, dy, dw, diskHeight - 1);
    }
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);

    if (this.animating) {
      this.animProgress += dt / (this.animDuration / this.speedMult);
      if (this.animProgress >= 1) {
        this.animProgress = 1;
        this.finishMove();
      }
    } else {
      this.moveTimer += dt * this.speedMult;
      if (this.moveTimer >= this.moveInterval) {
        this.moveTimer = 0;
        this.startNextMove();
      }
    }

    this.renderScene();
    this.texture.needsUpdate = true;
    (this.mesh.material as THREE.MeshBasicMaterial).opacity = opacity * 0.9;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Scramble pegs: shuffle disks randomly
      const all: number[] = [];
      for (const peg of this.pegs) {
        while (peg.length) all.push(peg.pop()!);
      }
      for (const d of all) {
        this.pegs[this.rng.int(0, 2)].push(d);
      }
      this.moves = [];
      this.generateMoves(this.numDisks, 0, 2, 1);
      this.moveIndex = 0;
      this.animating = false;
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
      this.resetPuzzle();
    }
  }
}
