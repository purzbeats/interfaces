import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Fourier series solution of the 1D heat equation. Shows individual harmonics
 * decaying at different rates (e^(-n^2 * alpha * t)) and their sum.
 * Modes are plotted as colored curves; the sum is bright.
 */
export class FourierHeatElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'fourier-heat',
    meta: { shape: 'rectangular', roles: ['data-display', 'gauge'], moods: ['diagnostic', 'ambient'], bandAffinity: 'mid', sizes: ['works-small', 'needs-medium', 'needs-large'] },
  };

  private modelines: THREE.Line[] = [];
  private modeMats: THREE.LineBasicMaterial[] = [];
  private sumLine!: THREE.Line;
  private sumMat!: THREE.LineBasicMaterial;
  private numModes: number = 5;
  private numPoints: number = 100;
  private alpha: number = 0.3;
  private coefficients: number[] = [];
  private heatTime: number = 0;
  private resetInterval: number = 8;
  private originX: number = 0;
  private originY: number = 0;
  private plotW: number = 0;
  private plotH: number = 0;

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;
    this.originX = x + 4;
    this.originY = y + h / 2;
    this.plotW = w - 8;
    this.plotH = h * 0.4;

    const variant = this.rng.int(0, 3);
    const presets = [
      { modes: 5, points: 100, alpha: 0.3, reset: 8 },
      { modes: 8, points: 150, alpha: 0.2, reset: 10 },
      { modes: 3, points: 80, alpha: 0.5, reset: 6 },
      { modes: 6, points: 120, alpha: 0.15, reset: 12 },
    ];
    const pr = presets[variant];
    this.numModes = pr.modes;
    this.numPoints = pr.points;
    this.alpha = pr.alpha;
    this.resetInterval = pr.reset;

    this.randomizeCoefficients();

    // Create mode lines
    for (let m = 0; m < this.numModes; m++) {
      const positions = new Float32Array(this.numPoints * 3);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

      const t = m / (this.numModes - 1);
      const color = new THREE.Color().copy(this.palette.dim).lerp(this.palette.primary, 0.3 + t * 0.3);
      const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0 });
      const line = new THREE.Line(geo, mat);

      this.modelines.push(line);
      this.modeMats.push(mat);
      this.group.add(line);
    }

    // Sum line (brighter)
    const sumPos = new Float32Array(this.numPoints * 3);
    const sumGeo = new THREE.BufferGeometry();
    sumGeo.setAttribute('position', new THREE.BufferAttribute(sumPos, 3));
    this.sumMat = new THREE.LineBasicMaterial({
      color: this.palette.secondary,
      transparent: true,
      opacity: 0,
    });
    this.sumLine = new THREE.Line(sumGeo, this.sumMat);
    this.group.add(this.sumLine);
  }

  private randomizeCoefficients(): void {
    this.coefficients = [];
    // Initial condition: e.g., square wave Fourier coefficients b_n = 4/(n*pi) for odd n
    for (let n = 1; n <= this.numModes; n++) {
      if (this.rng.chance(0.5)) {
        // Square wave mode
        this.coefficients.push(n % 2 === 1 ? 4 / (n * Math.PI) : 0);
      } else {
        // Random coefficient
        this.coefficients.push(this.rng.float(-1, 1) / n);
      }
    }
    this.heatTime = 0;
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);
    this.heatTime += dt;

    if (this.heatTime > this.resetInterval) {
      this.randomizeCoefficients();
    }

    const sumArr = (this.sumLine.geometry.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;

    // Clear sum
    for (let p = 0; p < this.numPoints; p++) {
      sumArr[p * 3] = this.originX + (p / (this.numPoints - 1)) * this.plotW;
      sumArr[p * 3 + 1] = this.originY;
      sumArr[p * 3 + 2] = 0;
    }

    for (let m = 0; m < this.numModes; m++) {
      const n = m + 1;
      const decay = Math.exp(-n * n * this.alpha * this.heatTime);
      const amp = this.coefficients[m] * decay;
      const pos = this.modelines[m].geometry.getAttribute('position') as THREE.BufferAttribute;
      const arr = pos.array as Float32Array;

      for (let p = 0; p < this.numPoints; p++) {
        const xNorm = p / (this.numPoints - 1); // 0..1 spatial
        const px = this.originX + xNorm * this.plotW;
        const val = amp * Math.sin(n * Math.PI * xNorm);

        arr[p * 3] = px;
        arr[p * 3 + 1] = this.originY + val * this.plotH;
        arr[p * 3 + 2] = 0;

        // Accumulate sum
        sumArr[p * 3 + 1] += val * this.plotH;
      }
      pos.needsUpdate = true;
      this.modeMats[m].opacity = opacity * Math.max(0.1, Math.abs(decay)) * 0.5;
    }

    (this.sumLine.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    this.sumMat.opacity = opacity * 0.9;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') this.glitchTimer = 0.5;
    if (action === 'alert') this.randomizeCoefficients();
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level >= 3) this.alpha *= 0.8; // slow decay = more visible modes
  }
}
