import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Sierpinski carpet fractal — remove the center ninth recursively.
 * Canvas rendered, animating through iteration depths. Each iteration
 * removes more squares, revealing the self-similar structure.
 */
export class SierpinskiCarpetElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'sierpinski-carpet',
    meta: {
      shape: 'rectangular',
      roles: ['decorative', 'data-display'],
      moods: ['ambient', 'diagnostic'],
      bandAffinity: 'mid',
      sizes: ['needs-medium', 'needs-large'],
    },
  };

  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private texture!: THREE.CanvasTexture;
  private mesh!: THREE.Mesh;
  private cw = 0;
  private ch = 0;

  private maxIter = 5;
  private currentLevel = 1;
  private levelTimer = 0;
  private levelDuration = 2.5;
  private ascending = true;
  private fillColorIdx = 0;
  private holeColorIdx = 0;
  private borderGlow = 0;

  build(): void {
    this.glitchAmount = 4;
    const variant = this.rng.int(0, 4);
    const { x, y, w, h } = this.px;

    const presets = [
      { maxIter: 5, levelDuration: 2.5, fillColorIdx: 0, holeColorIdx: 1 },
      { maxIter: 6, levelDuration: 3.5, fillColorIdx: 1, holeColorIdx: 0 },
      { maxIter: 4, levelDuration: 1.8, fillColorIdx: 0, holeColorIdx: 2 },
      { maxIter: 5, levelDuration: 3.0, fillColorIdx: 2, holeColorIdx: 1 },
    ];
    const p = presets[variant];
    this.maxIter = p.maxIter;
    this.levelDuration = p.levelDuration;
    this.fillColorIdx = p.fillColorIdx;
    this.holeColorIdx = p.holeColorIdx;

    const maxRes = 512;
    const aspect = w / h;
    this.cw = Math.min(maxRes, Math.ceil(w));
    this.ch = Math.max(1, Math.ceil(this.cw / aspect));
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.cw;
    this.canvas.height = this.ch;
    this.ctx = this.get2DContext(this.canvas);

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.LinearFilter;
    const geo = new THREE.PlaneGeometry(w, h);
    this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      map: this.texture, transparent: true, opacity: 0,
    }));
    this.mesh.position.set(x + w / 2, y + h / 2, 0);
    this.group.add(this.mesh);
  }

  /** Recursively draw the Sierpinski carpet */
  private drawCarpet(
    ctx: CanvasRenderingContext2D,
    cx: number, cy: number, size: number,
    depth: number, maxDepth: number,
    holeColor: string,
  ): void {
    if (depth >= maxDepth) return;
    const third = size / 3;

    // Remove center square
    ctx.fillStyle = holeColor;
    ctx.fillRect(cx + third, cy + third, third, third);

    // Recurse into 8 surrounding squares
    if (depth + 1 < maxDepth) {
      for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 3; col++) {
          if (row === 1 && col === 1) continue; // skip center
          this.drawCarpet(
            ctx,
            cx + col * third,
            cy + row * third,
            third,
            depth + 1,
            maxDepth,
            holeColor,
          );
        }
      }
    }
  }

  private getColorString(idx: number): string {
    const colors = [this.palette.primary, this.palette.secondary, this.palette.dim];
    const c = colors[idx % colors.length];
    return `rgb(${(c.r * 255) | 0},${(c.g * 255) | 0},${(c.b * 255) | 0})`;
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);

    this.levelTimer += dt;
    if (this.levelTimer >= this.levelDuration) {
      this.levelTimer = 0;
      if (this.ascending) {
        this.currentLevel++;
        if (this.currentLevel >= this.maxIter) this.ascending = false;
      } else {
        this.currentLevel--;
        if (this.currentLevel <= 1) this.ascending = true;
      }
    }

    // Clear and draw
    const bgC = this.palette.bg;
    this.ctx.fillStyle = `rgb(${(bgC.r * 255) | 0},${(bgC.g * 255) | 0},${(bgC.b * 255) | 0})`;
    this.ctx.fillRect(0, 0, this.cw, this.ch);

    // Fill base square
    const margin = 4;
    const size = Math.min(this.cw - margin * 2, this.ch - margin * 2);
    const offX = (this.cw - size) / 2;
    const offY = (this.ch - size) / 2;

    this.ctx.fillStyle = this.getColorString(this.fillColorIdx);
    this.ctx.fillRect(offX, offY, size, size);

    // Animate partial reveal of current level
    const partialFrac = Math.min(1, this.levelTimer / (this.levelDuration * 0.4));
    const drawLevel = this.currentLevel - 1 + partialFrac;
    const fullLevels = Math.floor(drawLevel);
    const partial = drawLevel - fullLevels;

    // Draw full levels
    const holeColor = this.getColorString(this.holeColorIdx);
    if (fullLevels > 0) {
      this.drawCarpet(this.ctx, offX, offY, size, 0, fullLevels, holeColor);
    }

    // Draw partial next level with reduced opacity
    if (partial > 0 && fullLevels < this.maxIter) {
      this.ctx.globalAlpha = partial;
      this.drawCarpet(this.ctx, offX, offY, size, fullLevels, fullLevels + 1, holeColor);
      this.ctx.globalAlpha = 1;
    }

    // Border glow effect
    this.borderGlow = Math.sin(time * 1.5) * 0.3 + 0.7;
    const dimC = this.palette.dim;
    this.ctx.strokeStyle = `rgba(${(dimC.r * 255) | 0},${(dimC.g * 255) | 0},${(dimC.b * 255) | 0},${this.borderGlow})`;
    this.ctx.lineWidth = 1;
    this.ctx.strokeRect(offX, offY, size, size);

    // Iteration count label
    const primC = this.palette.primary;
    this.ctx.fillStyle = `rgba(${(primC.r * 255) | 0},${(primC.g * 255) | 0},${(primC.b * 255) | 0},0.6)`;
    this.ctx.font = `${Math.max(8, this.ch * 0.06)}px monospace`;
    this.ctx.fillText(`n=${this.currentLevel}`, offX + 3, offY + size - 4);

    this.texture.needsUpdate = true;
    (this.mesh.material as THREE.MeshBasicMaterial).opacity = opacity;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      this.currentLevel = this.rng.int(1, this.maxIter);
      this.levelTimer = 0;
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level >= 3) {
      this.levelDuration = Math.max(0.5, 2.5 - level * 0.3);
    }
    if (level === 0) {
      this.levelDuration = 2.5;
    }
  }
}
