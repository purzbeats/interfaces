import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Nested orbital rings with phase-locked satellites.
 * Multiple tilted orbits with varying speeds create a mechanical orrery effect.
 */
export class OrbitRingsElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'orbit-rings',
    meta: { shape: 'radial', roles: ['decorative', 'gauge'], moods: ['ambient', 'tactical'], bandAffinity: 'mid', sizes: ['needs-medium', 'needs-large'] },
  };

  private ringCount = 0;
  private ringRadii!: Float32Array;
  private ringSpeeds!: Float32Array;
  private ringPhases!: Float32Array;
  private satCount!: Int32Array;

  private ringMeshes: THREE.Line[] = [];
  private ringMats: THREE.LineBasicMaterial[] = [];
  private satMesh!: THREE.Points;
  private satPositions!: Float32Array;
  private totalSats = 0;
  private centerDot!: THREE.Points;

  private cx = 0;
  private cy = 0;

  build(): void {
    const variant = this.rng.int(0, 3);
    const presets = [
      { rings: 5, satsPerRing: 3 },
      { rings: 8, satsPerRing: 2 },
      { rings: 3, satsPerRing: 5 },
      { rings: 6, satsPerRing: 4 },
    ];
    const p = presets[variant];
    this.glitchAmount = 4;

    const { x, y, w, h } = this.px;
    this.cx = x + w / 2;
    this.cy = y + h / 2;
    const maxR = Math.min(w, h) * 0.42;

    this.ringCount = p.rings;
    this.ringRadii = new Float32Array(this.ringCount);
    this.ringSpeeds = new Float32Array(this.ringCount);
    this.ringPhases = new Float32Array(this.ringCount);
    this.satCount = new Int32Array(this.ringCount);

    for (let i = 0; i < this.ringCount; i++) {
      this.ringRadii[i] = maxR * ((i + 1) / this.ringCount) * this.rng.float(0.85, 1.0);
      this.ringSpeeds[i] = this.rng.float(0.3, 1.5) * (this.rng.chance(0.3) ? -1 : 1);
      this.ringPhases[i] = this.rng.float(0, Math.PI * 2);
      this.satCount[i] = p.satsPerRing + this.rng.int(-1, 1);
      if (this.satCount[i] < 1) this.satCount[i] = 1;
      this.totalSats += this.satCount[i];

      // Ring circle
      const segs = 64;
      const pts = new Float32Array((segs + 1) * 3);
      for (let s = 0; s <= segs; s++) {
        const a = (s / segs) * Math.PI * 2;
        pts[s * 3] = this.cx + Math.cos(a) * this.ringRadii[i];
        pts[s * 3 + 1] = this.cy + Math.sin(a) * this.ringRadii[i];
        pts[s * 3 + 2] = 0;
      }
      const rg = new THREE.BufferGeometry();
      rg.setAttribute('position', new THREE.BufferAttribute(pts, 3));
      const mat = new THREE.LineBasicMaterial({ color: i % 2 === 0 ? this.palette.dim : this.palette.primary, transparent: true, opacity: 0 });
      const line = new THREE.Line(rg, mat);
      this.ringMeshes.push(line);
      this.ringMats.push(mat);
      this.group.add(line);
    }

    // Satellites
    this.satPositions = new Float32Array(this.totalSats * 3);
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(this.satPositions, 3));
    this.satMesh = new THREE.Points(sg, new THREE.PointsMaterial({
      color: this.palette.secondary, transparent: true, opacity: 0, size: 3, sizeAttenuation: false,
    }));
    this.group.add(this.satMesh);

    // Center
    const cg = new THREE.BufferGeometry();
    cg.setAttribute('position', new THREE.BufferAttribute(new Float32Array([this.cx, this.cy, 1]), 3));
    this.centerDot = new THREE.Points(cg, new THREE.PointsMaterial({
      color: this.palette.secondary, transparent: true, opacity: 0, size: 5, sizeAttenuation: false,
    }));
    this.group.add(this.centerDot);
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);

    let si = 0;
    for (let i = 0; i < this.ringCount; i++) {
      const base = time * this.ringSpeeds[i] + this.ringPhases[i];
      for (let s = 0; s < this.satCount[i]; s++) {
        const a = base + (s / this.satCount[i]) * Math.PI * 2;
        this.satPositions[si * 3] = this.cx + Math.cos(a) * this.ringRadii[i];
        this.satPositions[si * 3 + 1] = this.cy + Math.sin(a) * this.ringRadii[i];
        this.satPositions[si * 3 + 2] = 1;
        si++;
      }
      this.ringMats[i].opacity = opacity * (i % 2 === 0 ? 0.15 : 0.3);
    }
    (this.satMesh.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.satMesh.material as THREE.PointsMaterial).opacity = opacity;
    (this.centerDot.material as THREE.PointsMaterial).opacity = opacity * 0.8;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      for (let i = 0; i < this.ringCount; i++) this.ringSpeeds[i] *= -1;
    }
    if (action === 'alert') {
      for (let i = 0; i < this.ringCount; i++) this.ringSpeeds[i] *= 3;
      setTimeout(() => {
        for (let i = 0; i < this.ringCount; i++) this.ringSpeeds[i] /= 3;
      }, 1500);
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level >= 3) {
      for (let i = 0; i < this.ringCount; i++) this.ringSpeeds[i] *= 1.5;
    }
  }
}
