import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';
import type { AudioFrame } from '../audio/audio-reactive';

/**
 * Waterfall spectrogram display — frequency bands scroll vertically over time.
 * Canvas-based rendering with color-mapped intensity.
 */
export class SpectrogramElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'spectrogram',
    meta: { shape: 'rectangular', roles: ['data-display'], moods: ['diagnostic'], bandAffinity: 'bass', audioSensitivity: 0.5, sizes: ['needs-medium'] },
  };
  private canvas!: HTMLCanvasElement;
  private canvasCtx!: CanvasRenderingContext2D;
  private texture!: THREE.CanvasTexture;
  private mesh!: THREE.Mesh;
  private borderLines!: THREE.LineSegments;
  private freqBands: number = 0;
  private scrollRows: number = 0;
  private bandValues: number[] = [];
  private bandTargets: number[] = [];
  private bandVelocities: number[] = [];
  private updateAccum: number = 0;
  private readonly UPDATE_INTERVAL = 1 / 4; // slower target changes for visible peak drift
  private renderAccum: number = 0;
  private readonly RENDER_INTERVAL = 1 / 12;
  private liveSpectrum: Float32Array | null = null;
  private springK: number = 8;
  private springDamping: number = 4;

  build(): void {
    const variant = this.rng.int(0, 3);
    const presets = [
      { bandsDivisor: 8, rowsDivisor: 4, springK: 8, damping: 4 },
      { bandsDivisor: 4, rowsDivisor: 2, springK: 15, damping: 3 },
      { bandsDivisor: 16, rowsDivisor: 8, springK: 4, damping: 6 },
      { bandsDivisor: 6, rowsDivisor: 3, springK: 20, damping: 2 },
    ];
    const p = presets[variant];

    const { x, y, w, h } = this.px;
    this.freqBands = Math.max(16, Math.min(128, Math.floor(w / p.bandsDivisor)));
    this.scrollRows = Math.max(32, Math.min(200, Math.floor(h / p.rowsDivisor)));
    this.springK = p.springK + this.rng.float(-1, 1);
    this.springDamping = p.damping + this.rng.float(-0.3, 0.3);

    this.bandValues = new Array(this.freqBands).fill(0);
    this.bandTargets = new Array(this.freqBands).fill(0);
    this.bandVelocities = new Array(this.freqBands).fill(0);
    this.generateTargets();
    // Initialize band values to targets so first frame has data
    for (let i = 0; i < this.freqBands; i++) {
      this.bandValues[i] = this.bandTargets[i];
    }

    this.canvas = document.createElement('canvas');
    this.canvas.width = this.freqBands;
    this.canvas.height = this.scrollRows;
    this.canvasCtx = this.canvas.getContext('2d')!;
    this.canvasCtx.fillStyle = '#000';
    this.canvasCtx.fillRect(0, 0, this.freqBands, this.scrollRows);

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.magFilter = THREE.LinearFilter;

    // Pre-fill waterfall with historical data so it's not empty on first view
    for (let row = 0; row < this.scrollRows; row++) {
      if (row % 3 === 0) this.generateTargets();
      for (let i = 0; i < this.freqBands; i++) {
        this.bandValues[i] += (this.bandTargets[i] - this.bandValues[i]) * 0.3;
      }
      this.renderWaterfall();
    }

    const geo = new THREE.PlaneGeometry(w, h);
    this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      opacity: 0,
    }));
    this.mesh.position.set(x + w / 2, y + h / 2, 1);
    this.group.add(this.mesh);

    // Border
    const bv = new Float32Array([
      x, y, 0, x + w, y, 0,
      x + w, y, 0, x + w, y + h, 0,
      x + w, y + h, 0, x, y + h, 0,
      x, y + h, 0, x, y, 0,
    ]);
    const borderGeo = new THREE.BufferGeometry();
    borderGeo.setAttribute('position', new THREE.BufferAttribute(bv, 3));
    this.borderLines = new THREE.LineSegments(borderGeo, new THREE.LineBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.borderLines);
  }

  private generateTargets(): void {
    // Simulate a frequency spectrum with narrow peaks and lots of silence
    const peakCount = 2 + Math.floor(Math.random() * 3);
    const peaks: { center: number; width: number; height: number }[] = [];
    for (let p = 0; p < peakCount; p++) {
      peaks.push({
        center: Math.random() * this.freqBands,
        width: 2 + Math.random() * 5,
        height: 0.2 + Math.random() * 0.6,
      });
    }

    for (let i = 0; i < this.freqBands; i++) {
      let val = Math.random() * 0.05; // low noise floor
      for (const peak of peaks) {
        const dist = Math.abs(i - peak.center);
        val += peak.height * Math.exp(-(dist * dist) / (2 * peak.width * peak.width));
      }
      this.bandTargets[i] = Math.min(1, val);
    }
  }

  tickAudio(frame: AudioFrame): void {
    this.liveSpectrum = frame.spectrum;
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);

    // Use real spectrum when available
    if (this.liveSpectrum) {
      const specLen = this.liveSpectrum.length;
      for (let i = 0; i < this.freqBands; i++) {
        const specIdx = Math.floor((i / this.freqBands) * specLen);
        this.bandTargets[i] = this.liveSpectrum[Math.min(specIdx, specLen - 1)];
      }
    } else {
      // Procedural fallback
      this.updateAccum += dt;
      if (this.updateAccum >= this.UPDATE_INTERVAL) {
        this.updateAccum = 0;
        this.generateTargets();
      }
    }

    // Spring animate band values
    for (let i = 0; i < this.freqBands; i++) {
      const force = (this.bandTargets[i] - this.bandValues[i]) * this.springK;
      this.bandVelocities[i] += force * dt;
      this.bandVelocities[i] *= Math.exp(-this.springDamping * dt);
      this.bandValues[i] += this.bandVelocities[i] * dt;
    }

    // Render to canvas
    this.renderAccum += dt;
    if (this.renderAccum >= this.RENDER_INTERVAL) {
      this.renderAccum = 0;
      this.renderWaterfall();
    }

    (this.mesh.material as THREE.MeshBasicMaterial).opacity = opacity * 0.85;
    (this.borderLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.6;
  }

  private renderWaterfall(): void {
    const ctx = this.canvasCtx;
    // Scroll down by 1 pixel using ImageData (avoids alpha compositing)
    const imageData = ctx.getImageData(0, 0, this.freqBands, this.scrollRows);
    ctx.putImageData(imageData, 0, 1);

    // Write new top row directly as pixel data — no alpha compositing
    const topRow = ctx.createImageData(this.freqBands, 1);
    const data = topRow.data;

    const pr = this.palette.primary.r;
    const pg = this.palette.primary.g;
    const pb = this.palette.primary.b;
    const sr = this.palette.secondary.r;
    const sg = this.palette.secondary.g;
    const sb = this.palette.secondary.b;
    const bgr = this.palette.bg.r;
    const bgg = this.palette.bg.g;
    const bgb = this.palette.bg.b;

    for (let i = 0; i < this.freqBands; i++) {
      const v = Math.max(0, Math.min(1, this.bandValues[i]));
      const bright = v * v; // squared gamma — keeps contrast but stays visible

      let r: number, g: number, b: number;
      if (v > 0.6) {
        // Hot: primary → secondary
        const t = (v - 0.6) / 0.4;
        r = pr + (sr - pr) * t;
        g = pg + (sg - pg) * t;
        b = pb + (sb - pb) * t;
      } else {
        // Cool: background → primary, scaled by brightness
        r = bgr + (pr - bgr) * bright;
        g = bgg + (pg - bgg) * bright;
        b = bgb + (pb - bgb) * bright;
      }

      data[i * 4] = Math.floor(r * 255);
      data[i * 4 + 1] = Math.floor(g * 255);
      data[i * 4 + 2] = Math.floor(b * 255);
      data[i * 4 + 3] = 255; // fully opaque
    }

    ctx.putImageData(topRow, 0, 0);
    this.texture.needsUpdate = true;
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) return;
    if (level >= 5) {
      for (let i = 0; i < this.freqBands; i++) {
        this.bandTargets[i] = 1.0;
      }
    } else if (level >= 3) {
      for (let i = 0; i < this.freqBands; i++) {
        this.bandTargets[i] = Math.min(1.0, this.bandTargets[i] + level * 0.15);
      }
    }
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Scramble bands
      for (let i = 0; i < this.freqBands; i++) {
        this.bandTargets[i] = Math.random();
      }
    }
  }

  dispose(): void {
    this.texture.dispose();
    super.dispose();
  }
}
