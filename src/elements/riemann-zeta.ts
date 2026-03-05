import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Riemann zeta function critical strip visualization.
 * Plots |zeta(1/2 + it)| as t varies, highlighting zeros as bright points.
 * The parametric curve traces Re(zeta) vs Im(zeta) showing the famous "random walk".
 */
export class RiemannZetaElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'riemann-zeta',
    meta: { shape: 'rectangular', roles: ['data-display', 'decorative'], moods: ['ambient', 'diagnostic'], sizes: ['needs-medium', 'needs-large'] },
  };

  private magnitudeLine!: THREE.Line;
  private parametricLine!: THREE.Line;
  private zeroDots!: THREE.Points;
  private borderLines!: THREE.LineSegments;

  private magPoints: number = 0;
  private paramPoints: number = 0;
  private tMin: number = 0;
  private tMax: number = 50;
  private scrollSpeed: number = 0;
  private mode: number = 0; // 0=magnitude, 1=parametric, 2=both
  private zeroTs: number[] = [];
  private maxZeroDots: number = 20;
  private intensity: number = 0;

  // Precomputed zeta cache
  private zetaCache: { re: number; im: number; mag: number }[] = [];
  private cacheResolution: number = 0;

  build(): void {
    const variant = this.rng.int(0, 4);
    const presets = [
      { magPts: 300, paramPts: 400, tMax: 50, scrollSpeed: 2, mode: 0 },
      { magPts: 500, paramPts: 600, tMax: 80, scrollSpeed: 1.5, mode: 1 },
      { magPts: 400, paramPts: 500, tMax: 60, scrollSpeed: 3, mode: 2 },
      { magPts: 250, paramPts: 350, tMax: 40, scrollSpeed: 4, mode: 0 },
    ];
    const p = presets[variant];

    this.magPoints = p.magPts;
    this.paramPoints = p.paramPts;
    this.tMax = p.tMax;
    this.scrollSpeed = p.scrollSpeed;
    this.mode = p.mode;

    // Known nontrivial zeros of zeta (imaginary parts on critical line)
    this.zeroTs = [14.1347, 21.0220, 25.0109, 30.4249, 32.9351, 37.5862,
      40.9187, 43.3271, 48.0052, 49.7738, 52.9703, 56.4462, 59.3470,
      60.8318, 65.1125, 67.0798, 69.5464, 72.0672, 75.7047, 77.1448];

    this.precomputeZeta();

    const { x, y, w, h } = this.px;

    // Magnitude plot line
    {
      const positions = new Float32Array(this.magPoints * 3);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      this.magnitudeLine = new THREE.Line(geo, new THREE.LineBasicMaterial({
        color: this.palette.primary, transparent: true, opacity: 0,
      }));
      this.group.add(this.magnitudeLine);
    }

    // Parametric curve line
    {
      const positions = new Float32Array(this.paramPoints * 3);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      this.parametricLine = new THREE.Line(geo, new THREE.LineBasicMaterial({
        color: this.palette.secondary, transparent: true, opacity: 0,
      }));
      this.group.add(this.parametricLine);
    }

    // Zero highlight dots
    {
      const positions = new Float32Array(this.maxZeroDots * 3);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geo.setDrawRange(0, 0);
      this.zeroDots = new THREE.Points(geo, new THREE.PointsMaterial({
        color: this.palette.primary, transparent: true, opacity: 0,
        size: 4, sizeAttenuation: false,
      }));
      this.group.add(this.zeroDots);
    }

    // Border
    const bv = new Float32Array([
      x, y, 0, x + w, y, 0, x + w, y, 0, x + w, y + h, 0,
      x + w, y + h, 0, x, y + h, 0, x, y + h, 0, x, y, 0,
    ]);
    const borderGeo = new THREE.BufferGeometry();
    borderGeo.setAttribute('position', new THREE.BufferAttribute(bv, 3));
    this.borderLines = new THREE.LineSegments(borderGeo, new THREE.LineBasicMaterial({
      color: this.palette.dim, transparent: true, opacity: 0,
    }));
    this.group.add(this.borderLines);
  }

  /** Approximate zeta(1/2 + it) using Dirichlet series with smoothing */
  private zetaApprox(t: number): { re: number; im: number } {
    const N = 80;
    let re = 0, im = 0;
    const s_re = 0.5;
    for (let n = 1; n <= N; n++) {
      // n^(-s) = exp(-s * ln(n)) = n^(-1/2) * exp(-i*t*ln(n))
      const lnN = Math.log(n);
      const mag = Math.pow(n, -s_re);
      const phase = -t * lnN;
      // Lanczos smoothing weight
      const smooth = n <= N - 1 ? 1 - (n - 1) / N : 0;
      re += mag * Math.cos(phase) * smooth;
      im += mag * Math.sin(phase) * smooth;
    }
    return { re, im };
  }

  private precomputeZeta(): void {
    this.cacheResolution = 2000;
    this.zetaCache = [];
    for (let i = 0; i < this.cacheResolution; i++) {
      const t = (i / this.cacheResolution) * this.tMax * 2;
      const z = this.zetaApprox(t);
      this.zetaCache.push({ re: z.re, im: z.im, mag: Math.sqrt(z.re * z.re + z.im * z.im) });
    }
  }

  private getCachedZeta(t: number): { re: number; im: number; mag: number } {
    const maxT = this.tMax * 2;
    const wrappedT = ((t % maxT) + maxT) % maxT;
    const idx = (wrappedT / maxT) * this.cacheResolution;
    const i0 = Math.floor(idx) % this.cacheResolution;
    const i1 = (i0 + 1) % this.cacheResolution;
    const frac = idx - Math.floor(idx);
    const a = this.zetaCache[i0];
    const b = this.zetaCache[i1];
    return {
      re: a.re + (b.re - a.re) * frac,
      im: a.im + (b.im - a.im) * frac,
      mag: a.mag + (b.mag - a.mag) * frac,
    };
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    const { x, y, w, h } = this.px;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const tOffset = time * this.scrollSpeed;

    // --- Magnitude plot |zeta(1/2+it)| vs t ---
    if (this.mode === 0 || this.mode === 2) {
      const pos = this.magnitudeLine.geometry.getAttribute('position') as THREE.BufferAttribute;
      const tRange = this.tMax;
      let maxMag = 3;
      for (let i = 0; i < this.magPoints; i++) {
        const frac = i / (this.magPoints - 1);
        const t = tOffset + frac * tRange;
        const z = this.getCachedZeta(t);
        const px = x + frac * w;
        const py = cy + (z.mag / maxMag) * (h * 0.4) * (1 - 2 * ((i + Math.floor(tOffset * 10)) % 2 === 0 ? 0 : 0));
        const normalizedMag = Math.min(z.mag / maxMag, 1);
        pos.setXYZ(i, px, cy - normalizedMag * h * 0.4, 0);
      }
      pos.needsUpdate = true;
      (this.magnitudeLine.material as THREE.LineBasicMaterial).opacity = opacity * 0.9;
      this.magnitudeLine.visible = true;
    } else {
      this.magnitudeLine.visible = false;
    }

    // --- Parametric curve (Re(zeta), Im(zeta)) ---
    if (this.mode === 1 || this.mode === 2) {
      const pos = this.parametricLine.geometry.getAttribute('position') as THREE.BufferAttribute;
      const tRange = this.tMax;
      const scale = Math.min(w, h) * 0.15;
      for (let i = 0; i < this.paramPoints; i++) {
        const frac = i / (this.paramPoints - 1);
        const t = tOffset * 0.5 + frac * tRange;
        const z = this.getCachedZeta(t);
        const px = cx + z.re * scale;
        const py = cy + z.im * scale;
        pos.setXYZ(i, px, py, 0);
      }
      pos.needsUpdate = true;
      (this.parametricLine.material as THREE.LineBasicMaterial).opacity = opacity * 0.7;
      this.parametricLine.visible = true;
    } else {
      this.parametricLine.visible = false;
    }

    // --- Zero highlights ---
    {
      const pos = this.zeroDots.geometry.getAttribute('position') as THREE.BufferAttribute;
      let count = 0;
      const tRange = this.tMax;
      for (const zt of this.zeroTs) {
        if (count >= this.maxZeroDots) break;
        const visT = zt - tOffset;
        const wrapped = ((visT % tRange) + tRange) % tRange;
        const frac = wrapped / tRange;
        if (frac >= 0 && frac <= 1 && (this.mode === 0 || this.mode === 2)) {
          pos.setXYZ(count, x + frac * w, cy, 0);
          count++;
        }
      }
      this.zeroDots.geometry.setDrawRange(0, count);
      pos.needsUpdate = true;
      const pulse = 0.7 + 0.3 * Math.sin(time * 4);
      (this.zeroDots.material as THREE.PointsMaterial).opacity = opacity * pulse;
    }

    (this.borderLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.2;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      this.mode = (this.mode + 1) % 3;
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    this.intensity = level;
    if (level >= 3) this.scrollSpeed *= 1.2;
  }
}
