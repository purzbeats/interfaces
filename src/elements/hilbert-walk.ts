import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Animated Hilbert curve space-filling walk.
 * A luminous point traces the Hilbert curve path, progressively
 * filling the entire region — data locality made visible.
 */
export class HilbertWalkElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'hilbert-walk',
    meta: { shape: 'rectangular', roles: ['data-display', 'decorative'], moods: ['diagnostic', 'ambient'], bandAffinity: 'mid', sizes: ['needs-medium', 'needs-large'] },
  };

  private order = 5;
  private pathX!: Float32Array;
  private pathY!: Float32Array;
  private totalPoints = 0;
  private drawProgress = 0;
  private drawSpeed = 100;
  private pathMesh!: THREE.Line;
  private pathMat!: THREE.LineBasicMaterial;
  private dotMesh!: THREE.Points;

  build(): void {
    const variant = this.rng.int(0, 3);
    const presets = [
      { order: 5, speed: 100 },
      { order: 6, speed: 250 },
      { order: 4, speed: 40 },
      { order: 5, speed: 200 },
    ];
    const p = presets[variant];
    this.glitchAmount = 4;
    this.order = p.order;
    this.drawSpeed = p.speed;

    const { x, y, w, h } = this.px;
    const n = 1 << this.order;
    this.totalPoints = n * n;
    this.pathX = new Float32Array(this.totalPoints);
    this.pathY = new Float32Array(this.totalPoints);

    const cellW = w / n;
    const cellH = h / n;

    for (let i = 0; i < this.totalPoints; i++) {
      const [hx, hy] = this.d2xy(n, i);
      this.pathX[i] = x + (hx + 0.5) * cellW;
      this.pathY[i] = y + (hy + 0.5) * cellH;
    }

    const pts = new Float32Array(this.totalPoints * 3);
    for (let i = 0; i < this.totalPoints; i++) {
      pts[i * 3] = this.pathX[i];
      pts[i * 3 + 1] = this.pathY[i];
      pts[i * 3 + 2] = 0;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pts, 3));
    geo.setDrawRange(0, 0);
    this.pathMat = new THREE.LineBasicMaterial({ color: this.palette.primary, transparent: true, opacity: 0 });
    this.pathMesh = new THREE.Line(geo, this.pathMat);
    this.group.add(this.pathMesh);

    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3));
    this.dotMesh = new THREE.Points(dg, new THREE.PointsMaterial({
      color: this.palette.secondary, transparent: true, opacity: 0, size: 4, sizeAttenuation: false,
    }));
    this.group.add(this.dotMesh);
  }

  private d2xy(n: number, d: number): [number, number] {
    let rx: number, ry: number, s: number, t = d;
    let x2 = 0, y2 = 0;
    for (s = 1; s < n; s *= 2) {
      rx = (t & 2) > 0 ? 1 : 0;
      ry = ((t & 1) ^ rx) > 0 ? 0 : 1;
      if (ry === 0) {
        if (rx === 1) { x2 = s - 1 - x2; y2 = s - 1 - y2; }
        const tmp = x2; x2 = y2; y2 = tmp;
      }
      x2 += s * rx;
      y2 += s * ry;
      t = Math.floor(t / 4);
    }
    return [x2, y2];
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);
    this.drawProgress += this.drawSpeed * dt;
    const count = Math.min(this.totalPoints, Math.floor(this.drawProgress));
    this.pathMesh.geometry.setDrawRange(0, count);

    if (count > 0 && count <= this.totalPoints) {
      const idx = Math.min(count - 1, this.totalPoints - 1);
      const dp = this.dotMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
      dp.setXYZ(0, this.pathX[idx], this.pathY[idx], 1);
      dp.needsUpdate = true;
    }

    if (count >= this.totalPoints) {
      this.drawProgress = 0;
    }

    this.pathMat.opacity = opacity * 0.7;
    (this.dotMesh.material as THREE.PointsMaterial).opacity = opacity;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') this.drawProgress = 0;
    if (action === 'alert') this.drawSpeed *= 3;
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level >= 3) this.drawSpeed = 500;
  }
}
