import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Scrolling ribbon of binary/hex characters flowing left-to-right.
 * Canvas-based rendering at reduced framerate.
 */
export class BinaryStreamElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'binary-stream',
    meta: { shape: 'linear', roles: ['data-display', 'decorative'], moods: ['ambient', 'diagnostic'], bandAffinity: 'mid', sizes: ['works-small'] },
  };
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private texture!: THREE.CanvasTexture;
  private mesh!: THREE.Mesh;
  private borderLines!: THREE.LineSegments;
  private rows: number = 0;
  private columns: number = 0;
  private scrollOffset: number = 0;
  private scrollSpeed: number = 0;
  private isHex: boolean = false;
  private renderAccum: number = 0;
  private RENDER_INTERVAL = 1 / 15;

  build(): void {
    const variant = this.rng.int(0, 3);
    const presets = [
      { cw: 8, ch: 14, hexChance: 0.4, speedMin: 8, speedMax: 25, renderFps: 15 },    // Standard
      { cw: 5, ch: 10, hexChance: 0.6, speedMin: 20, speedMax: 50, renderFps: 24 },    // Dense
      { cw: 12, ch: 20, hexChance: 0.2, speedMin: 3, speedMax: 10, renderFps: 8 },     // Minimal
      { cw: 6, ch: 12, hexChance: 0.8, speedMin: 5, speedMax: 15, renderFps: 12 },     // Exotic (mostly hex, moderate)
    ];
    const p = presets[variant];

    this.glitchAmount = 3;
    const { x, y, w, h } = this.px;
    const charW = p.cw;
    const charH = p.ch;
    this.columns = Math.max(4, Math.floor(w / charW));
    this.rows = Math.max(1, Math.floor(h / charH));
    this.isHex = this.rng.chance(p.hexChance);
    this.scrollSpeed = this.rng.float(p.speedMin, p.speedMax);
    this.RENDER_INTERVAL = 1 / p.renderFps;

    this.canvas = document.createElement('canvas');
    this.canvas.width = this.columns * charW;
    this.canvas.height = this.rows * charH;
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
    this.mesh.position.set(x + w / 2, y + h / 2, 1);
    this.group.add(this.mesh);

    // Border
    const bv = new Float32Array([
      x, y, 0, x + w, y, 0,
      x + w, y, 0, x + w, y + h, 0,
      x + w, y + h, 0, x, y + h, 0,
      x, y + h, 0, x, y, 0,
    ]);
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.BufferAttribute(bv, 3));
    this.borderLines = new THREE.LineSegments(bg, new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.borderLines);
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);

    this.scrollOffset += dt * this.scrollSpeed;

    this.renderAccum += dt;
    if (this.renderAccum >= this.RENDER_INTERVAL) {
      this.renderAccum = 0;
      this.renderCanvas();
    }

    (this.mesh.material as THREE.MeshBasicMaterial).opacity = opacity * 0.85;
    (this.borderLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.3;
  }

  private renderCanvas(): void {
    const { ctx, canvas } = this;
    const charW = canvas.width / this.columns;
    const charH = canvas.height / this.rows;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.font = `${Math.floor(charH * 0.75)}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const primaryHex = '#' + this.palette.primary.getHexString();
    const dimHex = '#' + this.palette.dim.getHexString();
    const secondaryHex = '#' + this.palette.secondary.getHexString();
    const isGlitching = this.glitchTimer > 0;

    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.columns; c++) {
        const idx = Math.floor(this.scrollOffset + c + r * 31) & 0xFFFF;
        const hash = (idx * 2654435761) >>> 0;
        let char: string;

        if (isGlitching && (hash & 7) === 0) {
          char = String.fromCharCode(33 + (hash % 60));
        } else if (this.isHex) {
          char = (hash & 0xF).toString(16).toUpperCase();
        } else {
          char = (hash & 1).toString();
        }

        const bright = (hash & 3) === 0;
        ctx.fillStyle = isGlitching ? secondaryHex : bright ? primaryHex : dimHex;
        ctx.fillText(char, c * charW + charW / 2, r * charH + charH / 2);
      }
    }

    this.texture.needsUpdate = true;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      this.scrollSpeed *= 4;
      setTimeout(() => { this.scrollSpeed /= 4; }, 500);
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) return;
    // One-shot effects only — no permanent state mutation
  }

  dispose(): void {
    this.texture.dispose();
    super.dispose();
  }
}
