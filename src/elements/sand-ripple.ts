import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Sand ripple wave formation. Parallel ridges with wavelength dependent
 * on wind strength. Ripples migrate slowly. Cross-section view showing
 * ridge profiles rendered with line geometry.
 */
export class SandRippleElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'sand-ripple',
    meta: {
      shape: 'rectangular',
      roles: ['decorative'],
      moods: ['ambient'],
      bandAffinity: 'sub',
      sizes: ['works-small', 'needs-medium'],
    } satisfies ElementMeta,
  };

  private profileLines: THREE.Line[] = [];
  private profileMats: THREE.LineBasicMaterial[] = [];
  private ridgeCount: number = 12;
  private profileRows: number = 5;
  private wavelength: number = 30;
  private amplitude: number = 8;
  private windSpeed: number = 10;
  private segments: number = 80;
  private driftPhase: number = 0;
  private speedMult: number = 1;

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;

    const variant = this.rng.int(0, 3);
    const presets = [
      { ridges: 10, rows: 5, wavelength: 0.08, amplitude: 0.06, wind: 8, segs: 80 },
      { ridges: 16, rows: 7, wavelength: 0.05, amplitude: 0.04, wind: 15, segs: 100 },
      { ridges: 6, rows: 3, wavelength: 0.14, amplitude: 0.10, wind: 4, segs: 60 },
      { ridges: 12, rows: 5, wavelength: 0.07, amplitude: 0.07, wind: 12, segs: 90 },
    ];
    const p = presets[variant];
    this.ridgeCount = p.ridges;
    this.profileRows = p.rows;
    this.wavelength = w * p.wavelength;
    this.amplitude = h * p.amplitude;
    this.windSpeed = p.wind;
    this.segments = p.segs;

    // Create multiple horizontal profile lines at different y-positions
    const rowSpacing = h / (this.profileRows + 1);
    for (let row = 0; row < this.profileRows; row++) {
      const positions = new Float32Array((this.segments + 1) * 3);
      // Initialize all positions
      const baseY = y + rowSpacing * (row + 1);
      for (let s = 0; s <= this.segments; s++) {
        const sx = x + (s / this.segments) * w;
        positions[s * 3] = sx;
        positions[s * 3 + 1] = baseY;
        positions[s * 3 + 2] = 0;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

      const isPrimary = row === Math.floor(this.profileRows / 2);
      const mat = new THREE.LineBasicMaterial({
        color: isPrimary ? this.palette.primary : this.palette.secondary,
        transparent: true,
        opacity: 0,
      });
      const line = new THREE.Line(geo, mat);
      this.group.add(line);
      this.profileLines.push(line);
      this.profileMats.push(mat);
    }
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    const { x, y, w, h } = this.px;

    this.driftPhase += dt * this.windSpeed * this.speedMult;

    const rowSpacing = h / (this.profileRows + 1);

    for (let row = 0; row < this.profileRows; row++) {
      const attr = this.profileLines[row].geometry.getAttribute('position') as THREE.BufferAttribute;
      const baseY = y + rowSpacing * (row + 1);
      // Each row has slightly different phase offset for depth effect
      const rowPhase = row * 0.3 + this.rng.float(0, 0.1);
      // Amplitude varies per row (center row is tallest)
      const centerDist = Math.abs(row - this.profileRows / 2) / (this.profileRows / 2);
      const rowAmp = this.amplitude * (1 - centerDist * 0.4);

      for (let s = 0; s <= this.segments; s++) {
        const t = s / this.segments;
        const sx = x + t * w;

        // Main ripple wave
        const phase = (t * w / this.wavelength) + this.driftPhase + rowPhase;
        let yOff = Math.sin(phase * Math.PI * 2) * rowAmp;

        // Add secondary harmonics for realistic ridge shapes
        // Sharp crests, flat troughs
        yOff += Math.sin(phase * Math.PI * 4) * rowAmp * 0.25;
        yOff -= Math.abs(Math.sin(phase * Math.PI * 2)) * rowAmp * 0.15;

        // Slight random perturbation based on position (deterministic via sin)
        yOff += Math.sin(t * 47.3 + row * 13.7) * rowAmp * 0.08;

        attr.setXYZ(s, sx, baseY + yOff, 0);
      }
      attr.needsUpdate = true;

      // Row opacity: center rows brighter
      const rowBrightness = 1 - centerDist * 0.5;
      this.profileMats[row].opacity = opacity * rowBrightness * 0.8;
    }
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Wind gust: temporarily increase speed
      this.speedMult = 4;
      setTimeout(() => { this.speedMult = 1; }, 500);
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
