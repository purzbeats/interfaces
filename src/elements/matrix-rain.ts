import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Vertical columns of falling characters, Matrix-style.
 * Canvas-based rendering at ~15fps with bright head and fading trail.
 */
export class MatrixRainElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'matrix-rain',
    meta: { shape: 'rectangular', roles: ['decorative', 'data-display'], moods: ['ambient'], sizes: ['needs-medium', 'needs-large'] },
  };
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private texture!: THREE.CanvasTexture;
  private mesh!: THREE.Mesh;
  private columns: number = 0;
  private rows: number = 0;
  private heads: number[] = [];
  private speeds: number[] = [];
  private trails: number[] = [];
  private renderAccum: number = 0;
  private readonly RENDER_INTERVAL = 1 / 15;
  private readonly CHAR_W = 10;
  private readonly CHAR_H = 16;

  build(): void {
    this.glitchAmount = 6;
    const { x, y, w, h } = this.px;

    this.columns = Math.max(4, Math.floor(w / this.CHAR_W));
    this.rows = Math.max(4, Math.floor(h / this.CHAR_H));

    this.canvas = document.createElement('canvas');
    this.canvas.width = this.columns * this.CHAR_W;
    this.canvas.height = this.rows * this.CHAR_H;
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.magFilter = THREE.NearestFilter;

    const geo = new THREE.PlaneGeometry(w, h);
    this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      opacity: 0,
    }));
    this.mesh.position.set(x + w / 2, y + h / 2, 1);
    this.group.add(this.mesh);

    // Initialize column heads
    for (let c = 0; c < this.columns; c++) {
      this.heads.push(this.rng.int(-this.rows, 0));
      this.speeds.push(this.rng.float(0.3, 1.0));
      this.trails.push(this.rng.int(4, Math.min(this.rows, 16)));
    }
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);

    this.renderAccum += dt;
    if (this.renderAccum >= this.RENDER_INTERVAL) {
      this.renderAccum = 0;

      // Advance heads
      for (let c = 0; c < this.columns; c++) {
        this.heads[c] += this.speeds[c];
        if (this.heads[c] > this.rows + this.trails[c]) {
          this.heads[c] = this.rng.int(-this.rows / 2, 0);
          this.speeds[c] = this.rng.float(0.3, 1.0);
          this.trails[c] = this.rng.int(4, Math.min(this.rows, 16));
        }
      }

      this.renderCanvas();
    }

    (this.mesh.material as THREE.MeshBasicMaterial).opacity = opacity * 0.9;
  }

  private renderCanvas(): void {
    const { ctx, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const primaryHex = '#' + this.palette.primary.getHexString();
    const fontSize = Math.floor(this.CHAR_H * 0.75);
    ctx.font = `${fontSize}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const pr = this.palette.primary;
    const isGlitching = this.glitchTimer > 0;

    for (let c = 0; c < this.columns; c++) {
      const head = Math.floor(this.heads[c]);
      const trail = this.trails[c];

      for (let r = 0; r < this.rows; r++) {
        const dist = head - r;
        if (dist < 0 || dist > trail) continue;

        // Random character — mix of alphanumeric and katakana-range
        const hash = ((r * 31 + c * 997 + head * 7) * 2654435761) >>> 0;
        let charCode: number;
        if (isGlitching) {
          charCode = 33 + (hash % 93);
        } else if ((hash & 3) === 0) {
          // Katakana-like range
          charCode = 0x30A0 + (hash % 96);
        } else {
          charCode = 48 + (hash % 42); // 0-9, A-Z and some symbols
        }
        const char = String.fromCharCode(charCode);

        const brightness = dist === 0 ? 1.0 : Math.max(0, 1 - dist / trail);

        if (dist === 0) {
          // Bright white head
          ctx.fillStyle = '#ffffff';
        } else {
          const g = Math.floor(brightness * 255);
          const rr = Math.floor(pr.r * g);
          const gg = Math.floor(pr.g * g);
          const bb = Math.floor(pr.b * g);
          ctx.fillStyle = `rgb(${rr},${gg},${bb})`;
        }

        ctx.fillText(
          char,
          c * this.CHAR_W + this.CHAR_W / 2,
          r * this.CHAR_H + this.CHAR_H / 2,
        );
      }
    }

    this.texture.needsUpdate = true;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Speed burst
      for (let c = 0; c < this.columns; c++) {
        this.speeds[c] *= 3;
      }
      setTimeout(() => {
        for (let c = 0; c < this.columns; c++) {
          this.speeds[c] /= 3;
        }
      }, 500);
    }
    if (action === 'alert') {
      this.pulseTimer = 1.5;
    }
  }

  dispose(): void {
    this.texture.dispose();
    super.dispose();
  }
}
