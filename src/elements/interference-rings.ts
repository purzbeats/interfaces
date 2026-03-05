import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Circular wave interference pattern from multiple emitters.
 * Expanding rings from point sources create constructive/destructive interference patterns.
 */
export class InterferenceRingsElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'interference-rings',
    meta: { shape: 'rectangular', roles: ['data-display', 'decorative'], moods: ['diagnostic', 'ambient'], bandAffinity: 'mid', sizes: ['needs-medium', 'needs-large'] },
  };

  private emitterCount = 0;
  private emitterX: number[] = [];
  private emitterY: number[] = [];
  private emitterFreq: number[] = [];
  private emitterPhase: number[] = [];

  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private texture!: THREE.CanvasTexture;
  private mesh!: THREE.Mesh;
  private cw = 0;
  private ch = 0;
  private renderAccum = 0;

  build(): void {
    const variant = this.rng.int(0, 3);
    const presets = [
      { emitters: 3, res: 160, freq: 0.15 },
      { emitters: 5, res: 220, freq: 0.2 },
      { emitters: 2, res: 120, freq: 0.1 },
      { emitters: 4, res: 180, freq: 0.25 },
    ];
    const p = presets[variant];
    this.glitchAmount = 4;

    const { x, y, w, h } = this.px;
    const aspect = w / h;
    this.cw = Math.round(p.res * Math.max(1, aspect));
    this.ch = Math.round(p.res / Math.max(1, 1 / aspect));
    this.emitterCount = p.emitters;

    for (let i = 0; i < this.emitterCount; i++) {
      this.emitterX.push(this.rng.float(this.cw * 0.2, this.cw * 0.8));
      this.emitterY.push(this.rng.float(this.ch * 0.2, this.ch * 0.8));
      this.emitterFreq.push(p.freq * this.rng.float(0.8, 1.2));
      this.emitterPhase.push(this.rng.float(0, Math.PI * 2));
    }

    this.canvas = document.createElement('canvas');
    this.canvas.width = this.cw;
    this.canvas.height = this.ch;
    this.ctx = this.get2DContext(this.canvas);

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;

    const geo = new THREE.PlaneGeometry(w, h);
    this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, opacity: 0 }));
    this.mesh.position.set(x + w / 2, y + h / 2, 0);
    this.group.add(this.mesh);
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);

    this.renderAccum += dt;
    if (this.renderAccum < 0.05) {
      (this.mesh.material as THREE.MeshBasicMaterial).opacity = opacity * 0.85;
      return;
    }
    this.renderAccum = 0;

    const img = this.ctx.getImageData(0, 0, this.cw, this.ch);
    const data = img.data;
    const pr = this.palette.primary.r * 255;
    const pg2 = this.palette.primary.g * 255;
    const pb = this.palette.primary.b * 255;
    const sr = this.palette.secondary.r * 255;
    const sg = this.palette.secondary.g * 255;
    const sb = this.palette.secondary.b * 255;

    for (let py = 0; py < this.ch; py++) {
      for (let px = 0; px < this.cw; px++) {
        let sum = 0;
        for (let e = 0; e < this.emitterCount; e++) {
          const dx = px - this.emitterX[e];
          const dy = py - this.emitterY[e];
          const d = Math.sqrt(dx * dx + dy * dy);
          sum += Math.sin(d * this.emitterFreq[e] - time * 3 + this.emitterPhase[e]);
        }
        sum /= this.emitterCount;

        const idx = (py * this.cw + px) * 4;
        const v = sum * 0.5 + 0.5; // 0..1
        if (v > 0.5) {
          const t = (v - 0.5) * 2;
          data[idx] = pr * t; data[idx + 1] = pg2 * t; data[idx + 2] = pb * t;
        } else {
          const t = v * 2;
          data[idx] = sr * t * 0.3; data[idx + 1] = sg * t * 0.3; data[idx + 2] = sb * t * 0.3;
        }
        data[idx + 3] = 255;
      }
    }

    this.ctx.putImageData(img, 0, 0);
    this.texture.needsUpdate = true;
    (this.mesh.material as THREE.MeshBasicMaterial).opacity = opacity * 0.85;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      for (let i = 0; i < this.emitterCount; i++) {
        this.emitterFreq[i] = this.rng.float(0.05, 0.35);
      }
    }
    if (action === 'alert') {
      this.emitterX.push(this.cw / 2);
      this.emitterY.push(this.ch / 2);
      this.emitterFreq.push(0.2);
      this.emitterPhase.push(0);
      this.emitterCount++;
      setTimeout(() => {
        this.emitterX.pop(); this.emitterY.pop();
        this.emitterFreq.pop(); this.emitterPhase.pop();
        this.emitterCount--;
      }, 3000);
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level >= 3) {
      for (let i = 0; i < this.emitterCount; i++) this.emitterFreq[i] *= 1.5;
    }
  }
}
