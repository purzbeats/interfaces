import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Double-slit interference pattern building up over time.
 * Plane wave passes through two slits producing classic bright/dark fringes.
 * Canvas rendered with accumulating detection pattern.
 */
export class DoubleSlitElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'double-slit',
    meta: { shape: 'rectangular', roles: ['data-display', 'decorative'], moods: ['diagnostic', 'ambient'], bandAffinity: 'high', sizes: ['needs-medium', 'needs-large'] },
  };

  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private texture!: THREE.CanvasTexture;
  private mesh!: THREE.Mesh;
  private accumulator: Float32Array = new Float32Array(0);

  private slitSep = 0.1;
  private slitWidth = 0.02;
  private wavelength = 0.03;
  private screenDist = 0.6;
  private particlesPerFrame = 8;
  private maxAccum = 50;
  private wavePhase = 0;

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;

    const variant = this.rng.int(0, 3);
    const presets = [
      { sep: 0.10, sw: 0.02, wl: 0.030, dist: 0.6, ppf: 8 },
      { sep: 0.15, sw: 0.03, wl: 0.025, dist: 0.5, ppf: 12 },
      { sep: 0.06, sw: 0.015, wl: 0.035, dist: 0.7, ppf: 6 },
      { sep: 0.12, sw: 0.025, wl: 0.020, dist: 0.55, ppf: 10 },
    ];
    const p = presets[variant];
    this.slitSep = p.sep;
    this.slitWidth = p.sw;
    this.wavelength = p.wl;
    this.screenDist = p.dist;
    this.particlesPerFrame = p.ppf;

    this.canvas = document.createElement('canvas');
    const maxRes = 800;
    const scale = Math.min(1, maxRes / Math.max(w, h));
    this.canvas.width = Math.max(64, Math.floor(w * scale));
    this.canvas.height = Math.max(64, Math.floor(h * scale));
    this.ctx = this.get2DContext(this.canvas);
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.magFilter = THREE.NearestFilter;

    this.accumulator = new Float32Array(this.canvas.width);

    const geo = new THREE.PlaneGeometry(w, h);
    const mat = new THREE.MeshBasicMaterial({ map: this.texture, transparent: true });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.set(x + w / 2, y + h / 2, 0);
    this.group.add(this.mesh);
  }

  /** Double-slit intensity at screen position y (-0.5 to 0.5). */
  private intensity(yPos: number): number {
    const k = 2 * Math.PI / this.wavelength;
    const d = this.slitSep;
    const a = this.slitWidth;
    const L = this.screenDist;

    const sinTheta = yPos / Math.sqrt(yPos * yPos + L * L);

    // Single slit diffraction envelope
    const alpha = k * a * sinTheta / 2;
    const singleSlit = alpha === 0 ? 1 : Math.sin(alpha) / alpha;

    // Double slit interference
    const beta = k * d * sinTheta / 2;
    const doubleSlit = Math.cos(beta);

    return singleSlit * singleSlit * doubleSlit * doubleSlit;
  }

  /** Sample from the intensity distribution using rejection sampling. */
  private sampleParticle(): number {
    for (let attempt = 0; attempt < 50; attempt++) {
      const yCandidate = this.rng.float(-0.4, 0.4);
      const prob = this.intensity(yCandidate);
      if (this.rng.float(0, 1) < prob) return yCandidate;
    }
    return 0;
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    (this.mesh.material as THREE.MeshBasicMaterial).opacity = opacity;
    this.wavePhase += dt * 2;

    const cw = this.canvas.width;
    const ch = this.canvas.height;
    const ctx = this.ctx;

    // Accumulate particles
    for (let i = 0; i < this.particlesPerFrame; i++) {
      const yNorm = this.sampleParticle();
      const screenX = Math.floor((yNorm + 0.5) * cw);
      if (screenX >= 0 && screenX < cw) {
        this.accumulator[screenX] = Math.min(this.maxAccum, this.accumulator[screenX] + 1);
      }
    }

    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, cw, ch);

    const pr = Math.round(this.palette.primary.r * 255);
    const pg = Math.round(this.palette.primary.g * 255);
    const pb = Math.round(this.palette.primary.b * 255);
    const sr = Math.round(this.palette.secondary.r * 255);
    const sgr = Math.round(this.palette.secondary.g * 255);
    const sb = Math.round(this.palette.secondary.b * 255);

    // Draw barrier with slits (left portion)
    const barrierX = cw * 0.25;
    const slitCenterY = ch / 2;
    const slitHalfSep = (this.slitSep / 0.8) * ch / 2;
    const slitHalfW = (this.slitWidth / 0.8) * ch / 2;

    ctx.fillStyle = `rgba(${Math.round(this.palette.dim.r * 255)}, ${Math.round(this.palette.dim.g * 255)}, ${Math.round(this.palette.dim.b * 255)}, 0.5)`;
    const barW = Math.max(2, cw * 0.012);
    ctx.fillRect(barrierX - barW / 2, 0, barW, slitCenterY - slitHalfSep - slitHalfW);
    ctx.fillRect(barrierX - barW / 2, slitCenterY - slitHalfSep + slitHalfW, barW, slitHalfSep * 2 - slitHalfW * 2);
    ctx.fillRect(barrierX - barW / 2, slitCenterY + slitHalfSep + slitHalfW, barW, ch - (slitCenterY + slitHalfSep + slitHalfW));

    // Draw incoming plane wave (left side)
    const waveCount = 8;
    ctx.strokeStyle = `rgba(${sr}, ${sgr}, ${sb}, 0.3)`;
    ctx.lineWidth = 1;
    for (let w = 0; w < waveCount; w++) {
      const wx = ((w / waveCount + this.wavePhase * 0.1) % 1) * barrierX;
      ctx.beginPath();
      ctx.moveTo(wx, 0);
      ctx.lineTo(wx, ch);
      ctx.stroke();
    }

    // Draw accumulator as histogram on the right side
    const histLeft = cw * 0.55;
    const histWidth = cw * 0.4;
    for (let ix = 0; ix < cw; ix++) {
      const val = this.accumulator[ix] / this.maxAccum;
      if (val > 0.01) {
        const barH = val * histWidth;
        const screenY = (ix / cw) * ch;
        const alpha = Math.min(1, val * 1.5);
        ctx.fillStyle = `rgba(${pr}, ${pg}, ${pb}, ${alpha.toFixed(2)})`;
        ctx.fillRect(histLeft, screenY - 0.5, barH, 1.5);
      }
    }

    // Draw theoretical envelope as overlay
    ctx.beginPath();
    ctx.strokeStyle = `rgba(${sr}, ${sgr}, ${sb}, 0.4)`;
    ctx.lineWidth = 1;
    for (let iy = 0; iy < ch; iy++) {
      const yNorm = (iy / ch) - 0.5;
      const I = this.intensity(yNorm);
      const px = histLeft + I * histWidth;
      if (iy === 0) ctx.moveTo(px, iy);
      else ctx.lineTo(px, iy);
    }
    ctx.stroke();

    this.texture.needsUpdate = true;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      this.accumulator.fill(0);
      this.slitSep *= 0.8 + this.rng.float(0, 0.4);
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level >= 2) {
      this.particlesPerFrame = 8 + level * 4;
    }
  }
}
