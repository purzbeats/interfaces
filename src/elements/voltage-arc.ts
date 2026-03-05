import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Subtle electrical arc between two electrodes.
 * A single jagged line regenerated a few times per second, with gentle flicker.
 */
export class VoltageArcElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'voltage-arc',
    meta: { shape: 'linear', roles: ['decorative', 'data-display'], moods: ['ambient', 'diagnostic'], bandAffinity: 'sub', sizes: ['works-small', 'needs-medium'] },
  };
  private arcLines!: THREE.LineSegments;
  private electrodeLines!: THREE.LineSegments;
  private arcSegments: number = 0;
  private regenAccum: number = 0;
  private regenRate: number = 0;
  private arcSeed: number = 0;
  private _spread: number = 0;

  build(): void {
    const variant = this.rng.int(0, 3);
    const presets = [
      { segMin: 8, segMax: 14, regenMin: 6, regenMax: 12, spread: 0.15 },
      { segMin: 18, segMax: 30, regenMin: 15, regenMax: 30, spread: 0.25 },
      { segMin: 4, segMax: 7, regenMin: 3, regenMax: 6, spread: 0.08 },
      { segMin: 10, segMax: 20, regenMin: 25, regenMax: 50, spread: 0.35 },
    ];
    const p = presets[variant];

    this.glitchAmount = 5;
    const { x, y, w, h } = this.px;
    this.arcSegments = this.rng.int(p.segMin, p.segMax);
    this.regenRate = this.rng.float(p.regenMin, p.regenMax);
    this._spread = p.spread + this.rng.float(-0.02, 0.02);

    // Electrode end-caps
    const eVerts = new Float32Array([
      x + w * 0.08, y + h * 0.35, 0, x + w * 0.08, y + h * 0.65, 0,
      x + w * 0.92, y + h * 0.35, 0, x + w * 0.92, y + h * 0.65, 0,
    ]);
    const eGeo = new THREE.BufferGeometry();
    eGeo.setAttribute('position', new THREE.Float32BufferAttribute(eVerts, 3));
    this.electrodeLines = new THREE.LineSegments(eGeo, new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.electrodeLines);

    // Single arc path (just main line, no branches)
    const maxVerts = this.arcSegments * 2 * 3;
    const arcGeo = new THREE.BufferGeometry();
    arcGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(maxVerts), 3));
    arcGeo.setDrawRange(0, 0);
    this.arcLines = new THREE.LineSegments(arcGeo, new THREE.LineBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.arcLines);

    this.arcSeed = this.rng.float(0, 1000);
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    const { x, y, w, h } = this.px;

    (this.electrodeLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.5;

    // Regenerate arc at fixed rate (not every frame)
    this.regenAccum += dt;
    if (this.regenAccum >= 1 / this.regenRate) {
      this.regenAccum = 0;
      this.arcSeed = time * 100; // new seed each regen

      const pos = this.arcLines.geometry.getAttribute('position') as THREE.BufferAttribute;
      const cy = y + h / 2;
      const startX = x + w * 0.08;
      const endX = x + w * 0.92;
      const spread = h * this._spread;
      let vi = 0;

      // Single main arc — clean jagged path
      let prevX = startX;
      let prevY = cy;
      for (let i = 1; i <= this.arcSegments; i++) {
        const t = i / this.arcSegments;
        const px = startX + (endX - startX) * t;
        const envelope = Math.sin(t * Math.PI); // taper at ends
        const noise = Math.sin(t * 37 + this.arcSeed) * Math.cos(t * 19 + this.arcSeed * 0.7)
          + Math.sin(t * 71 + this.arcSeed * 1.3) * 0.4;
        const py = cy + noise * spread * envelope;

        pos.setXYZ(vi++, prevX, prevY, 1);
        pos.setXYZ(vi++, px, py, 1);
        prevX = px;
        prevY = py;
      }

      pos.needsUpdate = true;
      this.arcLines.geometry.setDrawRange(0, vi);
    }

    const arcMat = this.arcLines.material as THREE.LineBasicMaterial;
    // Gentle flicker
    const flicker = 0.75 + Math.sin(time * 17) * 0.15 + Math.sin(time * 31) * 0.1;
    arcMat.opacity = opacity * 0.7 * flicker;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      this.regenRate = this.rng.float(20, 40); // crackle faster briefly
    }
    if (action === 'alert') {
      (this.arcLines.material as THREE.LineBasicMaterial).color.copy(this.palette.alert);
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) return;
    if (level >= 5) {
      (this.arcLines.material as THREE.LineBasicMaterial).color.copy(this.palette.alert);
    }
  }
}
