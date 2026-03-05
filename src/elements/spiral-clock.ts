import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Logarithmic spiral clock with nested time rings.
 * Multiple concentric spiral arms rotate at different speeds representing
 * different time scales — a hypnotic temporal display.
 */
export class SpiralClockElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'spiral-clock',
    meta: { shape: 'radial', roles: ['gauge', 'decorative'], moods: ['ambient', 'diagnostic'], bandAffinity: 'mid', sizes: ['works-small', 'needs-medium', 'needs-large'] },
  };

  private spiralCount = 0;
  private spiralMeshes: THREE.Line[] = [];
  private spiralMats: THREE.LineBasicMaterial[] = [];
  private spiralSpeeds: number[] = [];
  private pointsPerSpiral = 100;
  private tickMesh!: THREE.LineSegments;
  private tickMat!: THREE.LineBasicMaterial;
  private cx = 0;
  private cy = 0;
  private maxR = 0;

  build(): void {
    const variant = this.rng.int(0, 3);
    const presets = [
      { spirals: 3, points: 100, ticks: 12 },
      { spirals: 5, points: 150, ticks: 24 },
      { spirals: 2, points: 80, ticks: 8 },
      { spirals: 4, points: 120, ticks: 16 },
    ];
    const p = presets[variant];
    this.glitchAmount = 4;

    const { x, y, w, h } = this.px;
    this.cx = x + w / 2;
    this.cy = y + h / 2;
    this.maxR = Math.min(w, h) * 0.42;
    this.spiralCount = p.spirals;
    this.pointsPerSpiral = p.points;

    const colors = [this.palette.primary, this.palette.secondary, this.palette.dim,
      this.palette.primary.clone().lerp(this.palette.secondary, 0.5),
      this.palette.dim.clone().lerp(this.palette.primary, 0.3)];

    for (let s = 0; s < this.spiralCount; s++) {
      const pts = new Float32Array(this.pointsPerSpiral * 3);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pts, 3));
      const mat = new THREE.LineBasicMaterial({ color: colors[s % colors.length], transparent: true, opacity: 0 });
      this.spiralMeshes.push(new THREE.Line(geo, mat));
      this.spiralMats.push(mat);
      this.spiralSpeeds.push((s + 1) * 0.3 * (s % 2 === 0 ? 1 : -1));
      this.group.add(this.spiralMeshes[s]);
    }

    // Tick marks
    const tickVerts: number[] = [];
    for (let t = 0; t < p.ticks; t++) {
      const a = (t / p.ticks) * Math.PI * 2;
      const r1 = this.maxR * 0.92;
      const r2 = this.maxR * 0.98;
      tickVerts.push(
        this.cx + Math.cos(a) * r1, this.cy + Math.sin(a) * r1, 0,
        this.cx + Math.cos(a) * r2, this.cy + Math.sin(a) * r2, 0
      );
    }
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(tickVerts), 3));
    this.tickMat = new THREE.LineBasicMaterial({ color: this.palette.dim, transparent: true, opacity: 0 });
    this.tickMesh = new THREE.LineSegments(tg, this.tickMat);
    this.group.add(this.tickMesh);
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);

    for (let s = 0; s < this.spiralCount; s++) {
      const pos = this.spiralMeshes[s].geometry.getAttribute('position') as THREE.BufferAttribute;
      const baseAngle = time * this.spiralSpeeds[s];
      const growth = 0.12; // logarithmic growth rate

      for (let i = 0; i < this.pointsPerSpiral; i++) {
        const t = i / (this.pointsPerSpiral - 1);
        const angle = baseAngle + t * Math.PI * 4; // 2 full rotations
        const r = this.maxR * (0.05 + t * 0.9) * (0.8 + 0.2 * Math.sin(t * 6 + s));
        pos.setXYZ(i, this.cx + Math.cos(angle) * r, this.cy + Math.sin(angle) * r, 0);
      }
      pos.needsUpdate = true;
      this.spiralMats[s].opacity = opacity * (s === 0 ? 0.7 : 0.4);
    }

    this.tickMat.opacity = opacity * 0.2;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      for (let i = 0; i < this.spiralCount; i++) this.spiralSpeeds[i] *= -1;
    }
    if (action === 'alert') {
      for (let i = 0; i < this.spiralCount; i++) this.spiralSpeeds[i] *= 5;
      setTimeout(() => {
        for (let i = 0; i < this.spiralCount; i++) this.spiralSpeeds[i] /= 5;
      }, 1000);
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level >= 3) {
      for (let i = 0; i < this.spiralCount; i++) this.spiralSpeeds[i] *= 2;
    }
  }
}
