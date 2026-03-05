import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Truchet tiling patterns. Square tiles with arcs in corners, randomly
 * oriented. Produces maze-like or organic flowing patterns. Canvas
 * rendered with periodic re-shuffling of tile orientations.
 */
export class TruchetTileElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'truchet-tile',
    meta: {
      shape: 'rectangular',
      roles: ['decorative'],
      moods: ['ambient', 'tactical'],
      bandAffinity: 'mid',
      sizes: ['works-small', 'needs-medium', 'needs-large'],
    } satisfies ElementMeta,
  };

  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private texture!: THREE.CanvasTexture;
  private mesh!: THREE.Mesh;

  private cols: number = 0;
  private rows: number = 0;
  private tileSize: number = 0;
  private orientations!: Uint8Array; // 0 or 1 for each tile
  private cw: number = 0;
  private ch: number = 0;

  private lineWidth: number = 2;
  private shuffleTimer: number = 0;
  private shuffleInterval: number = 4;
  private shuffleCount: number = 0;
  private maxShufflePerCycle: number = 10;
  private shuffling: boolean = false;
  private shuffleProgress: number = 0;
  private speedMult: number = 1;
  private tileStyle: number = 0; // 0=arcs, 1=diagonals, 2=quarter-circles, 3=mixed

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;

    const variant = this.rng.int(0, 3);
    const presets = [
      { tileSize: 20, lineWidth: 2, style: 0, shuffleInt: 4, shufflePer: 10 },
      { tileSize: 12, lineWidth: 1.5, style: 1, shuffleInt: 3, shufflePer: 15 },
      { tileSize: 30, lineWidth: 3, style: 2, shuffleInt: 5, shufflePer: 6 },
      { tileSize: 16, lineWidth: 2, style: 3, shuffleInt: 3.5, shufflePer: 12 },
    ];
    const p = presets[variant];
    this.tileSize = p.tileSize;
    this.lineWidth = p.lineWidth;
    this.tileStyle = p.style;
    this.shuffleInterval = p.shuffleInt;
    this.maxShufflePerCycle = p.shufflePer;

    this.canvas = document.createElement('canvas');
    this.cw = Math.max(64, Math.floor(w));
    this.ch = Math.max(64, Math.floor(h));
    this.canvas.width = this.cw;
    this.canvas.height = this.ch;
    this.ctx = this.get2DContext(this.canvas);

    this.cols = Math.ceil(this.cw / this.tileSize);
    this.rows = Math.ceil(this.ch / this.tileSize);
    this.orientations = new Uint8Array(this.cols * this.rows);

    // Random initial orientations
    for (let i = 0; i < this.orientations.length; i++) {
      this.orientations[i] = this.rng.int(0, 1);
    }

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

    this.renderTiles();
  }

  private renderTiles(): void {
    const bgHex = '#' + this.palette.bg.getHexString();
    const priHex = '#' + this.palette.primary.getHexString();
    const secHex = '#' + this.palette.secondary.getHexString();

    this.ctx.fillStyle = bgHex;
    this.ctx.fillRect(0, 0, this.cw, this.ch);

    this.ctx.lineWidth = this.lineWidth;
    this.ctx.lineCap = 'round';

    const ts = this.tileSize;
    const r = ts / 2;

    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        const orient = this.orientations[row * this.cols + col];
        const tx = col * ts;
        const ty = row * ts;

        // Alternate colors in a checker pattern
        const colorIdx = (row + col) % 2;
        this.ctx.strokeStyle = colorIdx === 0 ? priHex : secHex;

        const style = this.tileStyle === 3 ? ((row + col) % 2) : this.tileStyle;

        if (style === 0) {
          // Arc style: two quarter-circle arcs connecting opposite corners
          if (orient === 0) {
            // Arcs from top-left and bottom-right
            this.ctx.beginPath();
            this.ctx.arc(tx, ty, r, 0, Math.PI / 2);
            this.ctx.stroke();
            this.ctx.beginPath();
            this.ctx.arc(tx + ts, ty + ts, r, Math.PI, Math.PI * 1.5);
            this.ctx.stroke();
          } else {
            // Arcs from top-right and bottom-left
            this.ctx.beginPath();
            this.ctx.arc(tx + ts, ty, r, Math.PI / 2, Math.PI);
            this.ctx.stroke();
            this.ctx.beginPath();
            this.ctx.arc(tx, ty + ts, r, Math.PI * 1.5, Math.PI * 2);
            this.ctx.stroke();
          }
        } else if (style === 1) {
          // Diagonal style
          this.ctx.beginPath();
          if (orient === 0) {
            this.ctx.moveTo(tx, ty);
            this.ctx.lineTo(tx + ts, ty + ts);
          } else {
            this.ctx.moveTo(tx + ts, ty);
            this.ctx.lineTo(tx, ty + ts);
          }
          this.ctx.stroke();
        } else {
          // Quarter-circle filled style
          this.ctx.fillStyle = colorIdx === 0 ? priHex : secHex;
          this.ctx.globalAlpha = 0.2;
          this.ctx.beginPath();
          if (orient === 0) {
            this.ctx.arc(tx, ty, r, 0, Math.PI / 2);
            this.ctx.lineTo(tx, ty);
            this.ctx.closePath();
          } else {
            this.ctx.arc(tx + ts, ty, r, Math.PI / 2, Math.PI);
            this.ctx.lineTo(tx + ts, ty);
            this.ctx.closePath();
          }
          this.ctx.fill();
          this.ctx.globalAlpha = 1;

          // Also draw the arc outline
          this.ctx.beginPath();
          if (orient === 0) {
            this.ctx.arc(tx, ty, r, 0, Math.PI / 2);
          } else {
            this.ctx.arc(tx + ts, ty, r, Math.PI / 2, Math.PI);
          }
          this.ctx.stroke();
        }
      }
    }
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);

    this.shuffleTimer += dt * this.speedMult;
    if (this.shuffleTimer >= this.shuffleInterval) {
      this.shuffleTimer = 0;
      this.shuffling = true;
      this.shuffleCount = 0;
      this.shuffleProgress = 0;
    }

    if (this.shuffling) {
      this.shuffleProgress += dt * this.speedMult * 10;
      const target = Math.floor(this.shuffleProgress);
      while (this.shuffleCount < target && this.shuffleCount < this.maxShufflePerCycle) {
        const idx = this.rng.int(0, this.orientations.length - 1);
        this.orientations[idx] = 1 - this.orientations[idx];
        this.shuffleCount++;
      }
      if (this.shuffleCount >= this.maxShufflePerCycle) {
        this.shuffling = false;
      }
      this.renderTiles();
      this.texture.needsUpdate = true;
    }

    (this.mesh.material as THREE.MeshBasicMaterial).opacity = opacity * 0.85;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Flip many tiles at once
      const count = Math.floor(this.orientations.length * 0.3);
      for (let i = 0; i < count; i++) {
        const idx = this.rng.int(0, this.orientations.length - 1);
        this.orientations[idx] = 1 - this.orientations[idx];
      }
      this.renderTiles();
      this.texture.needsUpdate = true;
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
      // Total re-randomize
      for (let i = 0; i < this.orientations.length; i++) {
        this.orientations[i] = this.rng.int(0, 1);
      }
      this.renderTiles();
      this.texture.needsUpdate = true;
    }
  }
}
