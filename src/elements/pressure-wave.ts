import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Acoustic pressure wavefronts expanding from source points.
 * Compression (bright) and rarefaction (dark) bands propagate outward.
 * Multiple sources produce interference patterns. Canvas rendered.
 */
export class PressureWaveElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'pressure-wave',
    meta: {
      shape: 'rectangular',
      roles: ['scanner', 'decorative'],
      moods: ['ambient', 'tactical'],
      bandAffinity: 'sub',
      sizes: ['needs-medium', 'needs-large'],
    },
  };

  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private texture!: THREE.CanvasTexture;
  private mesh!: THREE.Mesh;

  private sources: { x: number; y: number; freq: number; phase: number }[] = [];
  private waveSpeed: number = 80;
  private wavelength: number = 30;
  private sourceCount: number = 1;
  private speedMult: number = 1;
  private canvasW: number = 0;
  private canvasH: number = 0;

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;

    const variant = this.rng.int(0, 3);
    const presets = [
      { sources: 1, waveLen: 30, speed: 80, pattern: 'center' },
      { sources: 2, waveLen: 20, speed: 60, pattern: 'stereo' },
      { sources: 3, waveLen: 25, speed: 100, pattern: 'triangle' },
      { sources: 4, waveLen: 15, speed: 50, pattern: 'corners' },
    ];
    const p = presets[variant];
    this.wavelength = p.waveLen;
    this.waveSpeed = p.speed;
    this.sourceCount = p.sources;

    // Canvas at reduced resolution for performance
    const scale = 0.5;
    this.canvasW = Math.max(32, Math.floor(w * scale));
    this.canvasH = Math.max(32, Math.floor(h * scale));
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvasW;
    this.canvas.height = this.canvasH;
    this.ctx = this.get2DContext(this.canvas);

    // Place sources based on pattern
    if (p.pattern === 'center') {
      this.sources.push({
        x: this.canvasW / 2, y: this.canvasH / 2,
        freq: this.rng.float(1.5, 3.0), phase: 0,
      });
    } else if (p.pattern === 'stereo') {
      this.sources.push({
        x: this.canvasW * 0.3, y: this.canvasH / 2,
        freq: this.rng.float(2.0, 3.5), phase: 0,
      });
      this.sources.push({
        x: this.canvasW * 0.7, y: this.canvasH / 2,
        freq: this.rng.float(2.0, 3.5), phase: this.rng.float(0, Math.PI),
      });
    } else if (p.pattern === 'triangle') {
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 - Math.PI / 2;
        this.sources.push({
          x: this.canvasW / 2 + Math.cos(a) * this.canvasW * 0.3,
          y: this.canvasH / 2 + Math.sin(a) * this.canvasH * 0.3,
          freq: this.rng.float(2.0, 4.0),
          phase: i * Math.PI * 0.3,
        });
      }
    } else {
      // corners
      const cx = [0.2, 0.8, 0.2, 0.8];
      const cy = [0.2, 0.2, 0.8, 0.8];
      for (let i = 0; i < 4; i++) {
        this.sources.push({
          x: this.canvasW * cx[i], y: this.canvasH * cy[i],
          freq: this.rng.float(1.5, 3.0),
          phase: this.rng.float(0, Math.PI * 2),
        });
      }
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
    const t = time * this.speedMult;

    const imgData = this.ctx.createImageData(this.canvasW, this.canvasH);
    const data = imgData.data;

    // Get palette colors as 0-255
    const pr = Math.floor(this.palette.primary.r * 255);
    const pg = Math.floor(this.palette.primary.g * 255);
    const pb = Math.floor(this.palette.primary.b * 255);
    const bgr = Math.floor(this.palette.bg.r * 255);
    const bgg = Math.floor(this.palette.bg.g * 255);
    const bgb = Math.floor(this.palette.bg.b * 255);

    const k = (2 * Math.PI) / this.wavelength;

    for (let py = 0; py < this.canvasH; py++) {
      for (let px = 0; px < this.canvasW; px++) {
        let pressure = 0;

        // Superposition of all source waves
        for (const src of this.sources) {
          const dx = px - src.x;
          const dy = py - src.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          // Pressure = sin(k*r - omega*t + phase) / sqrt(r)
          const amp = 1 / Math.max(Math.sqrt(dist * 0.1), 0.5);
          pressure += amp * Math.sin(k * dist - src.freq * t * 2 * Math.PI + src.phase);
        }

        // Normalize pressure to 0-1 range
        const norm = (pressure / this.sourceCount + 1) * 0.5;
        const clamped = Math.max(0, Math.min(1, norm));

        const idx = (py * this.canvasW + px) * 4;
        // Compression = bright (primary), rarefaction = dark (bg)
        data[idx] = bgr + (pr - bgr) * clamped;
        data[idx + 1] = bgg + (pg - bgg) * clamped;
        data[idx + 2] = bgb + (pb - bgb) * clamped;
        data[idx + 3] = 255;
      }
    }

    this.ctx.putImageData(imgData, 0, 0);
    this.texture.needsUpdate = true;

    (this.mesh.material as THREE.MeshBasicMaterial).opacity = opacity * 0.85;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Randomize source phases
      for (const src of this.sources) {
        src.phase = this.rng.float(0, Math.PI * 2);
      }
      this.speedMult = 3;
      setTimeout(() => { this.speedMult = 1; }, 400);
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level >= 3) this.speedMult = 1 + level * 0.3;
    else this.speedMult = 1;
  }
}
