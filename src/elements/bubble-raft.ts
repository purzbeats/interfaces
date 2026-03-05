import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Circular bubbles packed together with Lennard-Jones-like spring forces.
 * Shows crystal-like packing with defects. Bubble centers as points,
 * circles rendered as line segments.
 */
export class BubbleRaftElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'bubble-raft',
    meta: { shape: 'rectangular', roles: ['data-display', 'decorative'], moods: ['ambient', 'diagnostic'], bandAffinity: 'bass', sizes: ['needs-medium', 'needs-large'] },
  };

  private bubbleCount = 0;
  private posX!: Float32Array;
  private posY!: Float32Array;
  private velX!: Float32Array;
  private velY!: Float32Array;
  private bubbleR = 0;
  private eqDist = 0;
  private stiffness = 0;
  private damping = 0.95;

  private centerPoints!: THREE.Points;
  private circleLines!: THREE.LineSegments;
  private borderLines!: THREE.LineSegments;
  private circSegs = 16;

  build(): void {
    this.glitchAmount = 4;
    const variant = this.rng.int(0, 3);
    const presets = [
      { count: 40, radius: 0.06, stiffness: 800, damping: 0.92 },
      { count: 80, radius: 0.045, stiffness: 1000, damping: 0.9 },
      { count: 20, radius: 0.08, stiffness: 600, damping: 0.95 },
      { count: 60, radius: 0.05, stiffness: 1200, damping: 0.88 },
    ];
    const p = presets[variant];

    const { x, y, w, h } = this.px;
    this.bubbleCount = p.count;
    this.bubbleR = Math.min(w, h) * p.radius;
    this.eqDist = this.bubbleR * 2.2;
    this.stiffness = p.stiffness;
    this.damping = p.damping;

    this.posX = new Float32Array(this.bubbleCount);
    this.posY = new Float32Array(this.bubbleCount);
    this.velX = new Float32Array(this.bubbleCount);
    this.velY = new Float32Array(this.bubbleCount);

    // Initialize on a hex grid with small random offsets (defects)
    const cols = Math.ceil(Math.sqrt(this.bubbleCount * (w / h)));
    const rows = Math.ceil(this.bubbleCount / cols);
    const spacingX = (w - this.bubbleR * 2) / Math.max(1, cols - 1);
    const spacingY = (h - this.bubbleR * 2) / Math.max(1, rows - 1);
    for (let i = 0; i < this.bubbleCount; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const offsetX = (row % 2) * spacingX * 0.5;
      this.posX[i] = this.bubbleR + col * spacingX + offsetX + this.rng.float(-3, 3);
      this.posY[i] = this.bubbleR + row * spacingY + this.rng.float(-3, 3);
      this.posX[i] = Math.max(this.bubbleR, Math.min(w - this.bubbleR, this.posX[i]));
      this.posY[i] = Math.max(this.bubbleR, Math.min(h - this.bubbleR, this.posY[i]));
    }

    // Center points
    const centerPositions = new Float32Array(this.bubbleCount * 3);
    const centerGeo = new THREE.BufferGeometry();
    centerGeo.setAttribute('position', new THREE.BufferAttribute(centerPositions, 3));
    this.centerPoints = new THREE.Points(centerGeo, new THREE.PointsMaterial({
      color: this.palette.primary, transparent: true, opacity: 0,
      size: 2, sizeAttenuation: false,
    }));
    this.group.add(this.centerPoints);

    // Circle outlines: each bubble = circSegs line segments = circSegs*2 vertices
    const totalSegs = this.bubbleCount * this.circSegs;
    const circPositions = new Float32Array(totalSegs * 2 * 3);
    const circGeo = new THREE.BufferGeometry();
    circGeo.setAttribute('position', new THREE.BufferAttribute(circPositions, 3));
    this.circleLines = new THREE.LineSegments(circGeo, new THREE.LineBasicMaterial({
      color: this.palette.secondary, transparent: true, opacity: 0,
    }));
    this.group.add(this.circleLines);

    // Border
    const bv = [x, y, 0, x + w, y, 0, x + w, y, 0, x + w, y + h, 0,
      x + w, y + h, 0, x, y + h, 0, x, y + h, 0, x, y, 0];
    const borderGeo = new THREE.BufferGeometry();
    borderGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(bv), 3));
    this.borderLines = new THREE.LineSegments(borderGeo, new THREE.LineBasicMaterial({
      color: this.palette.dim, transparent: true, opacity: 0,
    }));
    this.group.add(this.borderLines);
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);
    const { x, y, w, h } = this.px;
    const cdt = Math.min(dt, 0.016);
    const n = this.bubbleCount;

    // Lennard-Jones-like forces between nearby pairs
    for (let i = 0; i < n; i++) {
      let fx = 0, fy = 0;
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const dx = this.posX[j] - this.posX[i];
        const dy = this.posY[j] - this.posY[i];
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < this.eqDist * 3 && dist > 0.1) {
          // Spring force: repel if too close, attract if in range
          const ratio = this.eqDist / dist;
          // Simplified LJ: F = stiffness * (ratio^6 - ratio^3) / dist
          const r3 = ratio * ratio * ratio;
          const r6 = r3 * r3;
          const force = this.stiffness * (r6 - r3) * cdt / dist;
          fx += (dx / dist) * force;
          fy += (dy / dist) * force;
        }
      }
      this.velX[i] += fx * cdt;
      this.velY[i] += fy * cdt;
      this.velX[i] *= this.damping;
      this.velY[i] *= this.damping;
    }

    // Integrate positions
    for (let i = 0; i < n; i++) {
      this.posX[i] += this.velX[i] * cdt;
      this.posY[i] += this.velY[i] * cdt;

      // Wall bounce
      const r = this.bubbleR;
      if (this.posX[i] < r) { this.posX[i] = r; this.velX[i] = Math.abs(this.velX[i]) * 0.5; }
      if (this.posX[i] > w - r) { this.posX[i] = w - r; this.velX[i] = -Math.abs(this.velX[i]) * 0.5; }
      if (this.posY[i] < r) { this.posY[i] = r; this.velY[i] = Math.abs(this.velY[i]) * 0.5; }
      if (this.posY[i] > h - r) { this.posY[i] = h - r; this.velY[i] = -Math.abs(this.velY[i]) * 0.5; }
    }

    // Update center points
    const centerPos = this.centerPoints.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < n; i++) {
      centerPos.setXYZ(i, x + this.posX[i], y + this.posY[i], 0.5);
    }
    centerPos.needsUpdate = true;

    // Update circle line segments
    const circPos = this.circleLines.geometry.getAttribute('position') as THREE.BufferAttribute;
    let vi = 0;
    for (let i = 0; i < n; i++) {
      const cx = x + this.posX[i];
      const cy2 = y + this.posY[i];
      for (let s = 0; s < this.circSegs; s++) {
        const a0 = (s / this.circSegs) * Math.PI * 2;
        const a1 = ((s + 1) / this.circSegs) * Math.PI * 2;
        circPos.setXYZ(vi++, cx + Math.cos(a0) * this.bubbleR, cy2 + Math.sin(a0) * this.bubbleR, 0);
        circPos.setXYZ(vi++, cx + Math.cos(a1) * this.bubbleR, cy2 + Math.sin(a1) * this.bubbleR, 0);
      }
    }
    circPos.needsUpdate = true;

    (this.centerPoints.material as THREE.PointsMaterial).opacity = opacity;
    (this.circleLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.5;
    (this.borderLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.25;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Shake all bubbles
      for (let i = 0; i < this.bubbleCount; i++) {
        this.velX[i] += this.rng.float(-100, 100);
        this.velY[i] += this.rng.float(-100, 100);
      }
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) { this.stiffness = 800; return; }
    this.stiffness = 800 + level * 100;
    // Jolt bubbles
    for (let i = 0; i < this.bubbleCount; i++) {
      this.velX[i] += this.rng.float(-20, 20) * level;
      this.velY[i] += this.rng.float(-20, 20) * level;
    }
  }
}
