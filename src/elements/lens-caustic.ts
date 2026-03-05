import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Optical caustic patterns from parallel rays refracted by a curved surface.
 * Rays concentrate into bright caustic curves. Canvas rendered with ray tracing.
 */
export class LensCausticElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'lens-caustic',
    meta: { shape: 'rectangular', roles: ['decorative', 'data-display'], moods: ['ambient'], bandAffinity: 'high', sizes: ['needs-medium', 'needs-large'] },
  };

  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private texture!: THREE.CanvasTexture;
  private mesh!: THREE.Mesh;

  private rayCount = 120;
  private lensType: 'spherical' | 'sinusoidal' | 'parabolic' | 'random' = 'spherical';
  private lensAmplitude = 0.15;
  private lensFreq = 2.0;
  private refractIndex = 1.5;
  private perturbPhase = 0;
  private perturbSpeed = 0.3;

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;

    const variant = this.rng.int(0, 3);
    type LensShape = 'spherical' | 'sinusoidal' | 'parabolic' | 'random';
    const presets: Array<{ rays: number; lens: LensShape; amp: number; freq: number; ri: number; speed: number }> = [
      { rays: 120, lens: 'spherical', amp: 0.15, freq: 2.0, ri: 1.5, speed: 0.3 },
      { rays: 200, lens: 'sinusoidal', amp: 0.1, freq: 3.0, ri: 1.4, speed: 0.5 },
      { rays: 80, lens: 'parabolic', amp: 0.2, freq: 1.5, ri: 1.6, speed: 0.2 },
      { rays: 150, lens: 'random', amp: 0.12, freq: 2.5, ri: 1.45, speed: 0.4 },
    ];
    const p = presets[variant];
    this.rayCount = p.rays;
    this.lensType = p.lens;
    this.lensAmplitude = p.amp;
    this.lensFreq = p.freq;
    this.refractIndex = p.ri;
    this.perturbSpeed = p.speed;

    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.max(64, Math.min(512, Math.round(w)));
    this.canvas.height = Math.max(32, Math.min(256, Math.round(h)));
    this.ctx = this.get2DContext(this.canvas);
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;

    const geo = new THREE.PlaneGeometry(w, h);
    const mat = new THREE.MeshBasicMaterial({ map: this.texture, transparent: true });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.set(x + w / 2, y + h / 2, 0);
    this.group.add(this.mesh);
  }

  /** Surface height of the lens at position t (0 to 1). */
  private lensHeight(t: number, time: number): number {
    const phase = this.perturbPhase + time * this.perturbSpeed;
    const centered = t - 0.5;
    switch (this.lensType) {
      case 'spherical':
        return this.lensAmplitude * (1 - 4 * centered * centered) * (1 + 0.2 * Math.sin(phase * 2));
      case 'sinusoidal':
        return this.lensAmplitude * Math.sin(this.lensFreq * Math.PI * t + phase);
      case 'parabolic':
        return this.lensAmplitude * (0.25 - centered * centered) * 4 * (1 + 0.15 * Math.sin(phase));
      case 'random':
        // Sum of a few harmonics
        return this.lensAmplitude * (
          0.5 * Math.sin(this.lensFreq * Math.PI * t + phase) +
          0.3 * Math.sin(2.7 * Math.PI * t + phase * 1.3) +
          0.2 * Math.cos(4.1 * Math.PI * t + phase * 0.7)
        );
    }
  }

  /** Surface normal slope at position t (numerical derivative). */
  private lensSlopeY(t: number, time: number): number {
    const eps = 0.001;
    return (this.lensHeight(t + eps, time) - this.lensHeight(t - eps, time)) / (2 * eps);
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    (this.mesh.material as THREE.MeshBasicMaterial).opacity = opacity;

    const cw = this.canvas.width;
    const ch = this.canvas.height;
    const ctx = this.ctx;

    // Fade previous frame
    ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
    ctx.fillRect(0, 0, cw, ch);

    const lensY = ch * 0.25; // Lens surface vertical position
    const pr = Math.round(this.palette.primary.r * 255);
    const pg = Math.round(this.palette.primary.g * 255);
    const pb = Math.round(this.palette.primary.b * 255);
    const sr = Math.round(this.palette.secondary.r * 255);
    const sg = Math.round(this.palette.secondary.g * 255);
    const sb = Math.round(this.palette.secondary.b * 255);

    // Draw lens surface
    ctx.beginPath();
    ctx.strokeStyle = `rgba(${Math.round(this.palette.dim.r * 255)}, ${Math.round(this.palette.dim.g * 255)}, ${Math.round(this.palette.dim.b * 255)}, 0.6)`;
    ctx.lineWidth = 1.5;
    for (let i = 0; i <= cw; i++) {
      const t = i / cw;
      const h = this.lensHeight(t, time) * ch;
      const py = lensY - h;
      if (i === 0) ctx.moveTo(i, py);
      else ctx.lineTo(i, py);
    }
    ctx.stroke();

    // Trace rays: parallel rays coming from top, refracted by lens
    ctx.lineWidth = 0.5;
    for (let r = 0; r < this.rayCount; r++) {
      const t = (r + 0.5) / this.rayCount;
      const rayX = t * cw;

      // Surface normal slope
      const slope = this.lensSlopeY(t, time);
      // Normal vector: (-slope, 1) normalized
      const nLen = Math.sqrt(slope * slope + 1);
      const nx = -slope / nLen;
      const ny = 1 / nLen;

      // Incoming ray direction: (0, 1) (downward)
      // Snell's law: n1*sin(theta1) = n2*sin(theta2)
      const cosI = ny; // dot(incoming, normal)
      const sinI = Math.sqrt(Math.max(0, 1 - cosI * cosI));
      const sinR = sinI / this.refractIndex;
      const cosR = Math.sqrt(Math.max(0, 1 - sinR * sinR));

      // Refracted direction
      const ratio = 1 / this.refractIndex;
      const refDx = ratio * 0 + (ratio * cosI - cosR) * nx;
      const refDy = ratio * 1 + (ratio * cosI - cosR) * ny;
      const refLen = Math.sqrt(refDx * refDx + refDy * refDy);

      const surfH = this.lensHeight(t, time) * ch;
      const surfY = lensY - surfH;

      // Draw incoming ray (faint)
      ctx.strokeStyle = `rgba(${sr}, ${sg}, ${sb}, 0.15)`;
      ctx.beginPath();
      ctx.moveTo(rayX, 0);
      ctx.lineTo(rayX, surfY);
      ctx.stroke();

      // Draw refracted ray
      if (refLen > 0.001) {
        const ndx = refDx / refLen;
        const ndy = refDy / refLen;
        const rayLen = ch - surfY;
        const endX = rayX + ndx * rayLen;
        const endY = surfY + ndy * rayLen;

        // Brightness increases where rays converge
        const alpha = 0.08 + 0.02 * Math.abs(slope) * 10;
        ctx.strokeStyle = `rgba(${pr}, ${pg}, ${pb}, ${Math.min(0.4, alpha).toFixed(2)})`;
        ctx.beginPath();
        ctx.moveTo(rayX, surfY);
        ctx.lineTo(endX, endY);
        ctx.stroke();
      }
    }

    // Caustic intensity: accumulate ray endpoints on a histogram to find bright spots
    const bins = new Float32Array(cw);
    for (let r = 0; r < this.rayCount * 2; r++) {
      const t = (r + 0.5) / (this.rayCount * 2);
      const slope = this.lensSlopeY(t, time);
      const nLen = Math.sqrt(slope * slope + 1);
      const nxL = -slope / nLen;
      const nyL = 1 / nLen;
      const cosI = nyL;
      const sinI = Math.sqrt(Math.max(0, 1 - cosI * cosI));
      const sinR = sinI / this.refractIndex;
      const cosR = Math.sqrt(Math.max(0, 1 - sinR * sinR));
      const ratio = 1 / this.refractIndex;
      const rdx = ratio * 0 + (ratio * cosI - cosR) * nxL;
      const rdy = ratio * 1 + (ratio * cosI - cosR) * nyL;
      const rl = Math.sqrt(rdx * rdx + rdy * rdy);
      if (rl < 0.001) continue;
      const surfH = this.lensHeight(t, time) * ch;
      const surfYR = lensY - surfH;
      const targetY = ch * 0.85;
      const tParam = (targetY - surfYR) / (rdy / rl);
      if (tParam < 0) continue;
      const hitX = t * cw + (rdx / rl) * tParam;
      const bin = Math.round(hitX);
      if (bin >= 0 && bin < cw) bins[bin] += 1;
    }

    // Draw caustic bright line
    const maxBin = Math.max(1, ...bins);
    const causticY = ch * 0.85;
    for (let i = 0; i < cw; i++) {
      const intensity = bins[i] / maxBin;
      if (intensity > 0.1) {
        const alpha = Math.min(1, intensity * 2);
        ctx.fillStyle = `rgba(${pr}, ${pg}, ${pb}, ${alpha.toFixed(2)})`;
        ctx.fillRect(i, causticY - 2, 1, 4);
      }
    }

    this.texture.needsUpdate = true;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      this.perturbPhase += this.rng.float(1, 4);
      this.lensAmplitude *= 0.7 + this.rng.float(0, 0.8);
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level >= 2) {
      this.perturbSpeed = 0.3 + level * 0.2;
    }
  }
}
