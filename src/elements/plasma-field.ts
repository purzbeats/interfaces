import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Oldschool demoscene plasma effect — smooth, undulating interference patterns
 * from overlapping sine waves, mapped to palette colors.
 * Renders at quarter resolution via ImageData for high performance.
 */

interface SineComponent {
  freqX: number;
  freqY: number;
  freqR: number;   // radial frequency (for distance-based terms)
  speedX: number;
  speedY: number;
  speedR: number;
  phase: number;    // initial phase offset
}

export class PlasmaFieldElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'plasma-field',
    meta: { shape: 'rectangular', roles: ['decorative'], moods: ['ambient'], bandAffinity: 'high', audioSensitivity: 1.5, sizes: ['needs-medium', 'needs-large'] },
  };
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private texture!: THREE.CanvasTexture;
  private mesh!: THREE.Mesh;

  private resW: number = 0;
  private resH: number = 0;
  private components: SineComponent[] = [];

  private renderAccum: number = 0;
  private readonly RENDER_INTERVAL = 1 / 20;

  // Precomputed color LUT (256 entries)
  private colorLUT: Uint8Array = new Uint8Array(0);

  // Action state
  private brightnessBoost: number = 0;
  private speedMultiplier: number = 1;
  private alertPulseTimer: number = 0;
  private savedFreqs: number[] | null = null;

  build(): void {
    this.glitchAmount = 5;
    const { x, y, w, h } = this.px;

    // Render at quarter resolution for performance
    const scale = 0.25;
    this.resW = Math.max(32, Math.floor(w * scale));
    this.resH = Math.max(24, Math.floor(h * scale));

    this.canvas = document.createElement('canvas');
    this.canvas.width = this.resW;
    this.canvas.height = this.resH;
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;

    const geo = new THREE.PlaneGeometry(w, h);
    this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      opacity: 0,
    }));
    this.mesh.position.set(x + w / 2, y + h / 2, 1);
    this.group.add(this.mesh);

    // Generate 5 sine components with randomized parameters
    const compCount = 5;
    for (let i = 0; i < compCount; i++) {
      this.components.push({
        freqX: this.rng.float(0.01, 0.08),
        freqY: this.rng.float(0.01, 0.08),
        freqR: this.rng.float(0.02, 0.06),
        speedX: this.rng.float(0.3, 1.5) * (this.rng.chance(0.5) ? 1 : -1),
        speedY: this.rng.float(0.3, 1.5) * (this.rng.chance(0.5) ? 1 : -1),
        speedR: this.rng.float(0.2, 1.0) * (this.rng.chance(0.5) ? 1 : -1),
        phase: this.rng.float(0, Math.PI * 2),
      });
    }

    // Build color lookup table: 256 entries mapping normalized value to RGBA
    this.buildColorLUT();
  }

  private buildColorLUT(): void {
    this.colorLUT = new Uint8Array(256 * 3);

    const bgR = Math.floor(this.palette.bg.r * 255);
    const bgG = Math.floor(this.palette.bg.g * 255);
    const bgB = Math.floor(this.palette.bg.b * 255);
    const dimR = Math.floor(this.palette.dim.r * 255);
    const dimG = Math.floor(this.palette.dim.g * 255);
    const dimB = Math.floor(this.palette.dim.b * 255);
    const priR = Math.floor(this.palette.primary.r * 255);
    const priG = Math.floor(this.palette.primary.g * 255);
    const priB = Math.floor(this.palette.primary.b * 255);
    const secR = Math.floor(this.palette.secondary.r * 255);
    const secG = Math.floor(this.palette.secondary.g * 255);
    const secB = Math.floor(this.palette.secondary.b * 255);

    // Map 0..255 across four color stops: bg -> dim -> primary -> secondary
    for (let i = 0; i < 256; i++) {
      const t = i / 255;
      let r: number, g: number, b: number;

      if (t < 0.25) {
        // bg -> dim
        const s = t / 0.25;
        r = bgR + (dimR - bgR) * s;
        g = bgG + (dimG - bgG) * s;
        b = bgB + (dimB - bgB) * s;
      } else if (t < 0.55) {
        // dim -> primary
        const s = (t - 0.25) / 0.30;
        r = dimR + (priR - dimR) * s;
        g = dimG + (priG - dimG) * s;
        b = dimB + (priB - dimB) * s;
      } else if (t < 0.85) {
        // primary -> secondary
        const s = (t - 0.55) / 0.30;
        r = priR + (secR - priR) * s;
        g = priG + (secG - priG) * s;
        b = priB + (secB - priB) * s;
      } else {
        // secondary -> bright secondary (bloom)
        const s = (t - 0.85) / 0.15;
        r = secR + (255 - secR) * s * 0.3;
        g = secG + (255 - secG) * s * 0.3;
        b = secB + (255 - secB) * s * 0.3;
      }

      this.colorLUT[i * 3] = Math.floor(Math.max(0, Math.min(255, r)));
      this.colorLUT[i * 3 + 1] = Math.floor(Math.max(0, Math.min(255, g)));
      this.colorLUT[i * 3 + 2] = Math.floor(Math.max(0, Math.min(255, b)));
    }
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);

    // Decay brightness boost
    if (this.brightnessBoost > 0) {
      this.brightnessBoost -= dt * 3;
      if (this.brightnessBoost < 0) this.brightnessBoost = 0;
    }

    // Alert pulse overlay
    if (this.alertPulseTimer > 0) {
      this.alertPulseTimer -= dt;
      // Also ramp speed back to normal gradually
      this.speedMultiplier = 1 + this.alertPulseTimer * 4;
    } else {
      this.speedMultiplier = 1;
    }

    // Render at fixed rate
    this.renderAccum += dt;
    if (this.renderAccum >= this.RENDER_INTERVAL) {
      this.renderAccum = 0;
      this.renderCanvas(time);
    }

    (this.mesh.material as THREE.MeshBasicMaterial).opacity = opacity;
  }

  private renderCanvas(time: number): void {
    const { ctx, canvas, resW, resH, components } = this;
    const imgData = ctx.createImageData(resW, resH);
    const data = imgData.data;

    const t = time * this.speedMultiplier;
    const centerX = resW * 0.5;
    const centerY = resH * 0.5;
    const lut = this.colorLUT;

    // Brightness from boost and alert pulse
    const alertPulse = this.alertPulseTimer > 0
      ? Math.sin(this.alertPulseTimer * 20) * 0.3 + 0.3
      : 0;
    const brightnessExtra = this.brightnessBoost + alertPulse;

    for (let py = 0; py < resH; py++) {
      for (let px = 0; px < resW; px++) {
        // Compute distance from center for radial terms
        const dx = px - centerX;
        const dy = py - centerY;
        const dist = Math.sqrt(dx * dx + dy * dy);

        // Sum sine components
        let value = 0;
        for (let i = 0; i < components.length; i++) {
          const c = components[i];
          value +=
            Math.sin(px * c.freqX + t * c.speedX + c.phase) +
            Math.sin(py * c.freqY + t * c.speedY + c.phase * 1.7) +
            Math.sin(dist * c.freqR + t * c.speedR + c.phase * 0.3);
        }

        // Normalize from [-3*compCount, +3*compCount] to [0, 1]
        const range = 3 * components.length;
        let norm = (value + range) / (2 * range);

        // Apply brightness boost
        norm = Math.min(1, norm + brightnessExtra * 0.15);

        // Look up color from LUT
        const lutIdx = Math.floor(Math.max(0, Math.min(255, norm * 255)));
        const pixIdx = (py * resW + px) * 4;
        data[pixIdx] = lut[lutIdx * 3];
        data[pixIdx + 1] = lut[lutIdx * 3 + 1];
        data[pixIdx + 2] = lut[lutIdx * 3 + 2];
        data[pixIdx + 3] = 255;
      }
    }

    ctx.putImageData(imgData, 0, 0);
    this.texture.needsUpdate = true;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Save current frequencies for potential restoration, then randomize
      this.savedFreqs = [];
      for (const c of this.components) {
        this.savedFreqs.push(c.freqX, c.freqY, c.freqR);
        c.freqX = this.rng.float(0.01, 0.12);
        c.freqY = this.rng.float(0.01, 0.12);
        c.freqR = this.rng.float(0.02, 0.10);
      }
      // Restore after glitch duration
      const saved = this.savedFreqs;
      setTimeout(() => {
        if (saved === this.savedFreqs) {
          let idx = 0;
          for (const c of this.components) {
            c.freqX = saved[idx++];
            c.freqY = saved[idx++];
            c.freqR = saved[idx++];
          }
          this.savedFreqs = null;
        }
      }, 500);
    }
    if (action === 'alert') {
      // Dramatically increase speeds and add pulsing brightness
      this.speedMultiplier = 5;
      this.alertPulseTimer = 1.5;
    }
    if (action === 'pulse') {
      this.brightnessBoost = 1;
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) return;
    // Color cycle speed and brightness scale with level
    this.speedMultiplier = 1 + level * 0.5;
    this.brightnessBoost = Math.max(this.brightnessBoost, level * 0.15);
    if (level >= 5) {
      this.alertPulseTimer = 1.5;
    } else if (level >= 3) {
      this.alertPulseTimer = Math.max(this.alertPulseTimer, 0.4);
    }
  }

  dispose(): void {
    this.texture.dispose();
    super.dispose();
  }
}
