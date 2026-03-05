import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Spiral galaxy simulation with density wave theory.
 * Stars follow elliptical orbits that pile up in spiral arms,
 * with dust lanes and core bulge — deep space telescope display.
 */
export class GalaxySpiralElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'galaxy-spiral',
    meta: { shape: 'radial', roles: ['decorative', 'data-display'], moods: ['ambient', 'diagnostic'], bandAffinity: 'bass', sizes: ['needs-medium', 'needs-large'] },
  };

  private starCount = 0;
  private starR!: Float32Array;    // orbital radius
  private starAngle!: Float32Array; // current angle
  private starSpeed!: Float32Array;
  private starBright!: Float32Array;

  private starMesh!: THREE.Points;
  private starColors!: Float32Array;
  private coreMesh!: THREE.Points;
  private cx = 0;
  private cy = 0;
  private armTightness = 0.3;
  private armCount = 2;

  build(): void {
    const variant = this.rng.int(0, 3);
    const presets = [
      { stars: 3000, arms: 2, tight: 0.3, size: 1.2 },
      { stars: 6000, arms: 4, tight: 0.4, size: 1.0 },
      { stars: 1500, arms: 2, tight: 0.2, size: 1.8 },
      { stars: 4000, arms: 3, tight: 0.35, size: 1.1 },
    ];
    const p = presets[variant];
    this.glitchAmount = 4;

    const { x, y, w, h } = this.px;
    this.cx = x + w / 2;
    this.cy = y + h / 2;
    this.armTightness = p.tight;
    this.armCount = p.arms;
    this.starCount = p.stars;
    const maxR = Math.min(w, h) * 0.42;

    this.starR = new Float32Array(this.starCount);
    this.starAngle = new Float32Array(this.starCount);
    this.starSpeed = new Float32Array(this.starCount);
    this.starBright = new Float32Array(this.starCount);

    for (let i = 0; i < this.starCount; i++) {
      this.starR[i] = this.rng.float(5, maxR);
      // Bias angle to cluster in spiral arms
      const armIdx = this.rng.int(0, this.armCount - 1);
      const armBase = (armIdx / this.armCount) * Math.PI * 2;
      const spiralAngle = armBase + this.starR[i] * this.armTightness;
      this.starAngle[i] = spiralAngle + this.rng.float(-0.5, 0.5); // scatter
      this.starSpeed[i] = (0.3 + 0.7 / Math.sqrt(this.starR[i] / maxR + 0.1)) * this.rng.float(0.8, 1.2);
      this.starBright[i] = this.rng.float(0.3, 1.0);
    }

    // Star points with colors
    const positions = new Float32Array(this.starCount * 3);
    this.starColors = new Float32Array(this.starCount * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.starColors, 3));
    this.starMesh = new THREE.Points(geo, new THREE.PointsMaterial({
      vertexColors: true, transparent: true, opacity: 0, size: p.size, sizeAttenuation: false,
    }));
    this.group.add(this.starMesh);

    // Bright core
    const corePos = new Float32Array([this.cx, this.cy, 1]);
    const cg = new THREE.BufferGeometry();
    cg.setAttribute('position', new THREE.BufferAttribute(corePos, 3));
    this.coreMesh = new THREE.Points(cg, new THREE.PointsMaterial({
      color: this.palette.secondary, transparent: true, opacity: 0, size: Math.max(1, Math.min(w, h) * 0.02), sizeAttenuation: false,
    }));
    this.group.add(this.coreMesh);
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);

    const pos = this.starMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const col = this.starMesh.geometry.getAttribute('color') as THREE.BufferAttribute;
    const pr = this.palette.primary.r, pg2 = this.palette.primary.g, pb = this.palette.primary.b;
    const sr = this.palette.secondary.r, sg = this.palette.secondary.g, sb = this.palette.secondary.b;
    const dr = this.palette.dim.r, dg = this.palette.dim.g, db = this.palette.dim.b;
    const maxR = Math.min(this.px.w, this.px.h) * 0.42;

    for (let i = 0; i < this.starCount; i++) {
      this.starAngle[i] += this.starSpeed[i] * dt * 0.1;
      const a = this.starAngle[i];
      const r = this.starR[i];

      pos.setXYZ(i, this.cx + Math.cos(a) * r, this.cy + Math.sin(a) * r, 0);

      // Color: dim outer, bright inner, secondary near core
      const rFrac = r / maxR;
      const b = this.starBright[i] * (1 - rFrac * 0.5);
      if (rFrac < 0.2) {
        col.setXYZ(i, sr * b, sg * b, sb * b);
      } else if (rFrac < 0.6) {
        col.setXYZ(i, pr * b, pg2 * b, pb * b);
      } else {
        col.setXYZ(i, dr * b, dg * b, db * b);
      }
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;

    (this.starMesh.material as THREE.PointsMaterial).opacity = opacity;
    (this.coreMesh.material as THREE.PointsMaterial).opacity = opacity * 0.9;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      for (let i = 0; i < this.starCount; i++) this.starSpeed[i] *= -1;
    }
    if (action === 'alert') {
      for (let i = 0; i < this.starCount; i++) this.starSpeed[i] *= 5;
      setTimeout(() => {
        for (let i = 0; i < this.starCount; i++) this.starSpeed[i] /= 5;
      }, 1000);
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level >= 3) {
      for (let i = 0; i < this.starCount; i++) this.starSpeed[i] *= 1.5;
    }
  }
}
