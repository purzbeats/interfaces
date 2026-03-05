import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Buddhabrot rendering. Tracks orbits of points that ESCAPE the Mandelbrot set,
 * accumulating visit counts in a histogram. Dense regions glow brighter.
 * Canvas rendered with incremental sampling for progressive refinement.
 */
export class BuddhabrotElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'buddhabrot',
    meta: {
      shape: 'rectangular',
      roles: ['data-display', 'decorative'],
      moods: ['ambient', 'diagnostic'],
      bandAffinity: 'sub',
      sizes: ['needs-medium', 'needs-large'],
    },
  };

  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private texture!: THREE.CanvasTexture;
  private mesh!: THREE.Mesh;
  private cw = 0;
  private ch = 0;

  private histogram!: Float32Array;
  private maxIter = 0;
  private samplesPerFrame = 0;
  private maxHits = 1;
  private totalSamples = 0;

  // View bounds in complex plane
  private realMin = -2; private realMax = 1;
  private imagMin = -1.2; private imagMax = 1.2;

  private renderTimer = 0;
  private renderInterval = 0.15;
  private orbitBuf!: Float32Array;

  build(): void {
    this.glitchAmount = 4;
    const variant = this.rng.int(0, 3);
    const { x, y, w, h } = this.px;

    const presets = [
      { maxIter: 100,  samples: 500,  rMin: -2,   rMax: 1,   iMin: -1.2, iMax: 1.2, interval: 0.12 },
      { maxIter: 200,  samples: 300,  rMin: -1.8, rMax: 0.8, iMin: -1.0, iMax: 1.0, interval: 0.15 },
      { maxIter: 50,   samples: 800,  rMin: -2.2, rMax: 1.2, iMin: -1.4, iMax: 1.4, interval: 0.10 },
      { maxIter: 150,  samples: 400,  rMin: -1.5, rMax: 0.5, iMin: -0.8, iMax: 0.8, interval: 0.18 },
    ];
    const p = presets[variant];

    this.maxIter = p.maxIter;
    this.samplesPerFrame = p.samples;
    this.realMin = p.rMin; this.realMax = p.rMax;
    this.imagMin = p.iMin; this.imagMax = p.iMax;
    this.renderInterval = p.interval;

    const maxRes = 200;
    const aspect = w / h;
    this.cw = Math.min(maxRes, Math.ceil(w));
    this.ch = Math.max(1, Math.ceil(this.cw / aspect));

    this.canvas = document.createElement('canvas');
    this.canvas.width = this.cw;
    this.canvas.height = this.ch;
    this.ctx = this.get2DContext(this.canvas);

    this.histogram = new Float32Array(this.cw * this.ch);
    this.orbitBuf = new Float32Array(this.maxIter * 2);
    this.maxHits = 1;
    this.totalSamples = 0;

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.LinearFilter;
    const geo = new THREE.PlaneGeometry(w, h);
    this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      map: this.texture, transparent: true, opacity: 0,
    }));
    this.mesh.position.set(x + w / 2, y + h / 2, 0);
    this.group.add(this.mesh);
  }

  private sampleOrbits(): void {
    const rRange = this.realMax - this.realMin;
    const iRange = this.imagMax - this.imagMin;

    for (let s = 0; s < this.samplesPerFrame; s++) {
      // Pick a random point in the complex plane
      const c_re = this.realMin + this.rng.float(0, 1) * rRange;
      const c_im = this.imagMin + this.rng.float(0, 1) * iRange;

      let zr = 0, zi = 0;
      let escaped = false;
      let orbitLen = 0;

      // Iterate z = z^2 + c
      for (let i = 0; i < this.maxIter; i++) {
        const zr2 = zr * zr - zi * zi + c_re;
        const zi2 = 2 * zr * zi + c_im;
        zr = zr2;
        zi = zi2;
        this.orbitBuf[orbitLen * 2] = zr;
        this.orbitBuf[orbitLen * 2 + 1] = zi;
        orbitLen++;

        if (zr * zr + zi * zi > 4) {
          escaped = true;
          break;
        }
      }

      // Only accumulate orbits of ESCAPING points (buddhabrot)
      if (escaped) {
        for (let i = 0; i < orbitLen; i++) {
          const re = this.orbitBuf[i * 2];
          const im = this.orbitBuf[i * 2 + 1];

          // Map to pixel coords
          const px = ((re - this.realMin) / rRange) * this.cw;
          const py = ((im - this.imagMin) / iRange) * this.ch;
          const ix = px | 0;
          const iy = py | 0;

          if (ix >= 0 && ix < this.cw && iy >= 0 && iy < this.ch) {
            const idx = iy * this.cw + ix;
            this.histogram[idx]++;
            if (this.histogram[idx] > this.maxHits) {
              this.maxHits = this.histogram[idx];
            }
          }
        }
      }
      this.totalSamples++;
    }
  }

  private renderHistogram(): void {
    const data = this.ctx.createImageData(this.cw, this.ch);
    const pr = (this.palette.primary.r * 255) | 0;
    const pg = (this.palette.primary.g * 255) | 0;
    const pb = (this.palette.primary.b * 255) | 0;
    const sr = (this.palette.secondary.r * 255) | 0;
    const sg = (this.palette.secondary.g * 255) | 0;
    const sb = (this.palette.secondary.b * 255) | 0;

    const logMax = Math.log(this.maxHits + 1);

    for (let i = 0; i < this.cw * this.ch; i++) {
      const val = this.histogram[i];
      const t = logMax > 0 ? Math.log(val + 1) / logMax : 0;
      const idx = i * 4;

      // Low density = secondary, high density = primary
      data.data[idx]     = (sr + (pr - sr) * t) | 0;
      data.data[idx + 1] = (sg + (pg - sg) * t) | 0;
      data.data[idx + 2] = (sb + (pb - sb) * t) | 0;
      data.data[idx + 3] = Math.min(255, (t * 300) | 0);
    }
    this.ctx.putImageData(data, 0, 0);
    this.texture.needsUpdate = true;
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);

    this.sampleOrbits();

    this.renderTimer += dt;
    if (this.renderTimer >= this.renderInterval) {
      this.renderTimer = 0;
      this.renderHistogram();
    }

    (this.mesh.material as THREE.MeshBasicMaterial).opacity = opacity;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Reset histogram for fresh accumulation
      this.histogram.fill(0);
      this.maxHits = 1;
      this.totalSamples = 0;
      // Shift view slightly
      const shift = this.rng.float(-0.3, 0.3);
      this.realMin += shift;
      this.realMax += shift;
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) {
      this.samplesPerFrame = 500;
      return;
    }
    // More samples at higher intensity for faster convergence
    this.samplesPerFrame = 500 + level * 200;
  }
}
