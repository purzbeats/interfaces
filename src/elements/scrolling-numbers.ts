import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

export class ScrollingNumbersElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'scrolling-numbers',
    meta: { shape: 'rectangular', roles: ['data-display', 'text'], moods: ['tactical', 'diagnostic'], bandAffinity: 'mid', sizes: ['works-small', 'needs-medium'] },
  };
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private texture!: THREE.CanvasTexture;
  private mesh!: THREE.Mesh;
  private borderLines!: THREE.LineSegments;
  private columns: number = 0;
  private rows: number = 0;
  private isHex: boolean = false;
  private scrollSpeeds: number[] = [];
  private scrollOffsets: number[] = [];
  private renderAccum: number = 0;
  private readonly RENDER_INTERVAL = 1 / 20; // 20fps for canvas (saves perf)

  build(): void {
    const variant = this.rng.int(0, 3);
    const presets = [
      { cw: 10, ch: 16, hexChance: 0.5, speedMin: 3, speedMax: 30 },    // Standard
      { cw: 7, ch: 11, hexChance: 0.6, speedMin: 15, speedMax: 60 },    // Dense
      { cw: 14, ch: 22, hexChance: 0.3, speedMin: 1, speedMax: 8 },     // Minimal
      { cw: 8, ch: 14, hexChance: 0.9, speedMin: 5, speedMax: 20 },     // Exotic (nearly all hex)
    ];
    const p = presets[variant];

    const { x, y, w, h } = this.px;
    this.columns = Math.min(30, Math.max(2, Math.floor(w / p.cw)));
    this.rows = Math.min(20, Math.max(2, Math.floor(h / p.ch)));
    this.isHex = this.rng.chance(p.hexChance);

    // Size canvas to actual element dimensions so text renders at native resolution
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.ceil(w);
    this.canvas.height = Math.ceil(h);
    this.ctx = this.get2DContext(this.canvas);
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.magFilter = THREE.NearestFilter;

    for (let c = 0; c < this.columns; c++) {
      this.scrollSpeeds.push(this.rng.float(p.speedMin, p.speedMax));
      this.scrollOffsets.push(this.rng.float(0, 100));
    }

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

    // Advance scroll offsets every frame (cheap)
    for (let c = 0; c < this.columns; c++) {
      this.scrollOffsets[c] += dt * this.scrollSpeeds[c];
    }

    // Only re-render canvas texture at reduced rate
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
    ctx.font = `${Math.floor(charH * 0.8)}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const primaryHex = '#' + this.palette.primary.getHexString();
    const dimHex = '#' + this.palette.dim.getHexString();
    const secondaryHex = '#' + this.palette.secondary.getHexString();
    const isGlitching = this.glitchTimer > 0;

    for (let c = 0; c < this.columns; c++) {
      for (let r = 0; r < this.rows; r++) {
        const val = Math.floor(this.scrollOffsets[c] + r * 7) % (this.isHex ? 16 : 10);
        let char = this.isHex ? val.toString(16).toUpperCase() : val.toString();

        // Glitch: random character substitution
        if (isGlitching && Math.sin((c * 13 + r * 7) * this.glitchTimer * 30) > 0.6) {
          char = String.fromCharCode(33 + ((val * 7 + c * 3) % 60));
        }

        const bright = (r + Math.floor(this.scrollOffsets[c])) % 4 === 0;
        ctx.fillStyle = isGlitching ? secondaryHex : bright ? primaryHex : dimHex;
        ctx.fillText(char, c * charW + charW / 2, r * charH + charH / 2);
      }
    }

    this.texture.needsUpdate = true;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      for (let c = 0; c < this.columns; c++) {
        this.scrollSpeeds[c] = this.rng.float(15, 80);
      }
      this.emitAudio('seekSound', 150);
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) return;
    if (level >= 3) {
      // One-shot offset jump for visual disruption
      for (let c = 0; c < this.columns; c++) {
        this.scrollOffsets[c] += this.rng.float(5, 20);
      }
    }
  }

  dispose(): void {
    this.texture.dispose();
    super.dispose();
  }
}
