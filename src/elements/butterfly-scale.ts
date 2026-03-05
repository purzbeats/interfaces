import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Butterfly wing scale tiling. Overlapping rounded rectangles in rows,
 * shifted like roof tiles. Color varies by position creating wing-like
 * gradient patterns. Canvas rendered.
 */
export class ButterflyScaleElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'butterfly-scale',
    meta: {
      shape: 'rectangular',
      roles: ['decorative'],
      moods: ['ambient'],
      bandAffinity: 'high',
      sizes: ['works-small', 'needs-medium', 'needs-large'],
    } satisfies ElementMeta,
  };

  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private texture!: THREE.CanvasTexture;
  private mesh!: THREE.Mesh;

  private scaleW: number = 12;
  private scaleH: number = 16;
  private cols: number = 0;
  private rows: number = 0;
  private shimmerSpeed: number = 2;
  private patternType: number = 0; // 0=radial, 1=bands, 2=eyespot, 3=chevron
  private scalePhases!: Float32Array;
  private speedMult: number = 1;
  private renderAccum: number = 0;

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;

    const variant = this.rng.int(0, 3);
    const presets = [
      { sw: 12, sh: 16, shimmer: 2.0, pattern: 0 },
      { sw: 8, sh: 10, shimmer: 3.0, pattern: 1 },
      { sw: 16, sh: 20, shimmer: 1.5, pattern: 2 },
      { sw: 10, sh: 14, shimmer: 2.5, pattern: 3 },
    ];
    const p = presets[variant];
    this.scaleW = p.sw;
    this.scaleH = p.sh;
    this.shimmerSpeed = p.shimmer;
    this.patternType = p.pattern;

    // Cap canvas resolution to avoid huge per-frame canvas2D draws
    const maxRes = 400;
    const scale = Math.min(1, maxRes / Math.max(w, h));
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.max(64, Math.floor(w * scale));
    this.canvas.height = Math.max(64, Math.floor(h * scale));
    this.ctx = this.get2DContext(this.canvas);

    this.cols = Math.ceil(this.canvas.width / this.scaleW) + 2;
    this.rows = Math.ceil(this.canvas.height / (this.scaleH * 0.7)) + 2;

    // Pre-generate per-scale phase offsets
    const totalScales = this.cols * this.rows;
    this.scalePhases = new Float32Array(totalScales);
    for (let i = 0; i < totalScales; i++) {
      this.scalePhases[i] = this.rng.float(0, Math.PI * 2);
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
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    (this.mesh.material as THREE.MeshBasicMaterial).opacity = opacity * 0.9;

    // Throttle canvas redraws to ~15fps
    this.renderAccum += dt;
    if (this.renderAccum < 0.065) return;
    this.renderAccum = 0;

    const cw = this.canvas.width;
    const ch = this.canvas.height;
    const ctx = this.ctx;
    const effTime = time * this.speedMult;

    // Clear
    ctx.clearRect(0, 0, cw, ch);

    const priR = this.palette.primary.r;
    const priG = this.palette.primary.g;
    const priB = this.palette.primary.b;
    const secR = this.palette.secondary.r;
    const secG = this.palette.secondary.g;
    const secB = this.palette.secondary.b;
    const dimR = this.palette.dim.r;
    const dimG = this.palette.dim.g;
    const dimB = this.palette.dim.b;

    const centerX = cw / 2;
    const centerY = ch / 2;
    const maxDist = Math.sqrt(centerX * centerX + centerY * centerY);

    const rowH = this.scaleH * 0.7;

    for (let row = 0; row < this.rows; row++) {
      const yy = row * rowH - this.scaleH * 0.3;
      const offsetX = (row % 2) * (this.scaleW * 0.5);

      for (let col = 0; col < this.cols; col++) {
        const xx = col * this.scaleW + offsetX - this.scaleW;
        const scaleIdx = row * this.cols + col;
        const phase = this.scalePhases[scaleIdx];

        // Compute color based on pattern type
        let t: number;
        switch (this.patternType) {
          case 0: { // radial gradient from center
            const dx = xx + this.scaleW / 2 - centerX;
            const dy = yy + this.scaleH / 2 - centerY;
            t = Math.sqrt(dx * dx + dy * dy) / maxDist;
            break;
          }
          case 1: { // horizontal bands
            t = (row / this.rows);
            break;
          }
          case 2: { // eyespot
            const dx = xx + this.scaleW / 2 - centerX;
            const dy = yy + this.scaleH / 2 - centerY;
            const dist = Math.sqrt(dx * dx + dy * dy) / maxDist;
            t = Math.abs(Math.sin(dist * Math.PI * 3));
            break;
          }
          case 3: { // chevron
            const nx = (xx + this.scaleW / 2) / cw;
            const ny = (yy + this.scaleH / 2) / ch;
            t = Math.abs(nx - 0.5) * 2 + ny * 0.3;
            t = t % 1;
            break;
          }
          default:
            t = 0.5;
        }

        // Shimmer
        const shimmer = Math.sin(effTime * this.shimmerSpeed + phase) * 0.15 + 0.85;
        t = Math.max(0, Math.min(1, t));

        // Interpolate color: primary -> secondary -> dim
        let r: number, g: number, b: number;
        if (t < 0.5) {
          const f = t * 2;
          r = priR + (secR - priR) * f;
          g = priG + (secG - priG) * f;
          b = priB + (secB - priB) * f;
        } else {
          const f = (t - 0.5) * 2;
          r = secR + (dimR - secR) * f;
          g = secG + (dimG - secG) * f;
          b = secB + (dimB - secB) * f;
        }

        r *= shimmer;
        g *= shimmer;
        b *= shimmer;

        const ri = Math.floor(Math.min(255, r * 255));
        const gi = Math.floor(Math.min(255, g * 255));
        const bi = Math.floor(Math.min(255, b * 255));

        // Draw rounded scale
        ctx.fillStyle = `rgb(${ri},${gi},${bi})`;
        ctx.beginPath();
        const sw = this.scaleW - 1;
        const sh = this.scaleH - 1;
        const rr = Math.min(sw, sh) * 0.3; // corner radius

        ctx.moveTo(xx + rr, yy);
        ctx.lineTo(xx + sw - rr, yy);
        ctx.quadraticCurveTo(xx + sw, yy, xx + sw, yy + rr);
        ctx.lineTo(xx + sw, yy + sh - rr);
        ctx.quadraticCurveTo(xx + sw, yy + sh, xx + sw - rr, yy + sh);
        ctx.lineTo(xx + rr, yy + sh);
        ctx.quadraticCurveTo(xx, yy + sh, xx, yy + sh - rr);
        ctx.lineTo(xx, yy + rr);
        ctx.quadraticCurveTo(xx, yy, xx + rr, yy);
        ctx.closePath();
        ctx.fill();

        // Subtle edge highlight
        ctx.strokeStyle = `rgba(${ri},${gi},${bi},0.3)`;
        ctx.lineWidth = 0.5;
        ctx.stroke();
      }
    }

    this.texture.needsUpdate = true;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      this.speedMult = 4;
      setTimeout(() => { this.speedMult = 1; }, 400);
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) {
      this.speedMult = 1;
      return;
    }
    this.speedMult = 1 + level * 0.3;
  }
}
