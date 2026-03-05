import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Animated dragon curve fractal unfolding.
 * The Heighway dragon builds iteratively, each generation doubling
 * the segment count with alternating folds — fractal origami on screen.
 */
export class DragonCurveElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'dragon-curve',
    meta: { shape: 'rectangular', roles: ['decorative', 'data-display'], moods: ['ambient', 'diagnostic'], bandAffinity: 'mid', sizes: ['needs-medium', 'needs-large'] },
  };

  private maxIter = 14;
  private currentIter = 0;
  private directions: number[] = [];
  private lineMesh!: THREE.Line;
  private lineMat!: THREE.LineBasicMaterial;
  private linePositions!: Float32Array;
  private growTimer = 0;
  private growInterval = 1.5;
  private cx = 0; private cy = 0;
  private segLen = 0;
  private rotation = 0;

  build(): void {
    const variant = this.rng.int(0, 3);
    const presets = [
      { maxIter: 14, interval: 1.5 },
      { maxIter: 16, interval: 1.0 },
      { maxIter: 12, interval: 2.0 },
      { maxIter: 15, interval: 0.8 },
    ];
    const p = presets[variant];
    this.glitchAmount = 4;
    this.maxIter = p.maxIter;
    this.growInterval = p.interval;

    const { x, y, w, h } = this.px;
    this.cx = x + w / 2;
    this.cy = y + h / 2;
    const maxPts = (1 << this.maxIter) + 1;
    this.segLen = Math.min(w, h) / Math.sqrt(1 << (this.maxIter / 2 + 1));
    this.rotation = this.rng.float(0, Math.PI * 2);

    this.linePositions = new Float32Array(maxPts * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.linePositions, 3));
    geo.setDrawRange(0, 0);
    this.lineMat = new THREE.LineBasicMaterial({ color: this.palette.primary, transparent: true, opacity: 0 });
    this.lineMesh = new THREE.Line(geo, this.lineMat);
    this.group.add(this.lineMesh);

    this.directions = [1]; // start with one right turn
    this.currentIter = 1;
    this.rebuildPath();
  }

  private iterate(): void {
    if (this.currentIter >= this.maxIter) {
      this.currentIter = 1;
      this.directions = [1];
      this.segLen *= 1.3;
      this.rebuildPath();
      return;
    }
    // Dragon curve iteration: reverse, flip, append
    const newDirs = [...this.directions, 1];
    for (let i = this.directions.length - 1; i >= 0; i--) {
      newDirs.push(-this.directions[i]);
    }
    this.directions = newDirs;
    this.currentIter++;
    // Shrink segments
    this.segLen *= 0.707;
    this.rebuildPath();
  }

  private rebuildPath(): void {
    const { x, y, w, h } = this.px;
    let px = 0, py = 0;
    let angle = this.rotation;
    let minX = 0, maxX = 0, minY = 0, maxY = 0;

    // First pass: compute bounds
    const pts: Array<[number, number]> = [[0, 0]];
    for (const d of this.directions) {
      angle += d * Math.PI / 2;
      px += Math.cos(angle) * this.segLen;
      py += Math.sin(angle) * this.segLen;
      pts.push([px, py]);
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
    }

    // Center and scale
    const bw = maxX - minX || 1;
    const bh = maxY - minY || 1;
    const scale = Math.min(w * 0.85 / bw, h * 0.85 / bh);
    const offX = this.cx - (minX + maxX) / 2 * scale;
    const offY = this.cy - (minY + maxY) / 2 * scale;

    for (let i = 0; i < pts.length; i++) {
      this.linePositions[i * 3] = pts[i][0] * scale + offX;
      this.linePositions[i * 3 + 1] = pts[i][1] * scale + offY;
      this.linePositions[i * 3 + 2] = 0;
    }
    (this.lineMesh.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    this.lineMesh.geometry.setDrawRange(0, pts.length);
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);
    this.growTimer += dt;
    if (this.growTimer >= this.growInterval) {
      this.growTimer = 0;
      this.iterate();
    }
    this.lineMat.opacity = opacity * 0.8;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') { this.rotation += Math.PI / 4; this.rebuildPath(); }
    if (action === 'alert') { this.iterate(); this.iterate(); }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level >= 3) this.growInterval = 0.5;
  }
}
