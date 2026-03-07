import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';

/**
 * Cross reticle — thin crosshair lines through the center of the region
 * with tick marks along each arm. Classic targeting/measurement overlay.
 * Four variants: simple cross, cross with gap, diagonal X, double cross.
 */
export class CrossReticleElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'cross-reticle',
    meta: {
      shape: 'rectangular',
      roles: ['scanner', 'decorative', 'border'],
      moods: ['tactical', 'diagnostic'],
      bandAffinity: 'mid',
      sizes: ['works-small', 'needs-medium', 'needs-large'],
    },
  };

  private crossLines!: THREE.LineSegments;
  private tickLines!: THREE.LineSegments;
  private centerDot!: THREE.Points;
  private variant: number = 0;
  private pulsePhase: number = 0;
  private breatheSpeed: number = 0;

  build(): void {
    this.variant = this.rng.int(0, 3);
    this.breatheSpeed = this.rng.float(1.5, 3.0);
    const { x, y, w, h } = this.px;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const halfW = w / 2;
    const halfH = h / 2;

    const crossVerts: number[] = [];
    const tickVerts: number[] = [];

    switch (this.variant) {
      case 0: {
        // Simple full cross
        crossVerts.push(
          x, cy, 0.5, x + w, cy, 0.5,  // horizontal
          cx, y, 0.5, cx, y + h, 0.5,   // vertical
        );
        this.buildTicks(tickVerts, cx, cy, halfW, halfH, false);
        break;
      }
      case 1: {
        // Cross with center gap
        const gapW = w * 0.08;
        const gapH = h * 0.08;
        crossVerts.push(
          x, cy, 0.5, cx - gapW, cy, 0.5,           // left arm
          cx + gapW, cy, 0.5, x + w, cy, 0.5,       // right arm
          cx, y, 0.5, cx, cy - gapH, 0.5,           // bottom arm
          cx, cy + gapH, 0.5, cx, y + h, 0.5,       // top arm
        );
        // Small diamond at center gap
        crossVerts.push(
          cx - gapW, cy, 0.5, cx, cy - gapH, 0.5,
          cx, cy - gapH, 0.5, cx + gapW, cy, 0.5,
          cx + gapW, cy, 0.5, cx, cy + gapH, 0.5,
          cx, cy + gapH, 0.5, cx - gapW, cy, 0.5,
        );
        this.buildTicks(tickVerts, cx, cy, halfW, halfH, false);
        break;
      }
      case 2: {
        // Diagonal X
        crossVerts.push(
          x, y, 0.5, x + w, y + h, 0.5,   // bottom-left to top-right
          x + w, y, 0.5, x, y + h, 0.5,   // bottom-right to top-left
        );
        // Tick marks along diagonals
        const diagLen = Math.sqrt(w * w + h * h) / 2;
        this.buildDiagonalTicks(tickVerts, cx, cy, w, h, diagLen);
        break;
      }
      case 3: {
        // Double cross (regular + 45-degree rotated)
        // Main cross
        crossVerts.push(
          x, cy, 0.5, x + w, cy, 0.5,
          cx, y, 0.5, cx, y + h, 0.5,
        );
        // Shorter diagonal cross
        const dLen = Math.min(halfW, halfH) * 0.6;
        const cos45 = Math.cos(Math.PI / 4) * dLen;
        const sin45 = Math.sin(Math.PI / 4) * dLen;
        crossVerts.push(
          cx - cos45, cy - sin45, 0.5, cx + cos45, cy + sin45, 0.5,
          cx + cos45, cy - sin45, 0.5, cx - cos45, cy + sin45, 0.5,
        );
        this.buildTicks(tickVerts, cx, cy, halfW, halfH, false);
        break;
      }
    }

    // Cross lines
    const crossGeo = new THREE.BufferGeometry();
    crossGeo.setAttribute('position', new THREE.Float32BufferAttribute(crossVerts, 3));
    this.crossLines = new THREE.LineSegments(crossGeo, new THREE.LineBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.crossLines);

    // Tick marks
    if (tickVerts.length > 0) {
      const tickGeo = new THREE.BufferGeometry();
      tickGeo.setAttribute('position', new THREE.Float32BufferAttribute(tickVerts, 3));
      this.tickLines = new THREE.LineSegments(tickGeo, new THREE.LineBasicMaterial({
        color: this.palette.secondary,
        transparent: true,
        opacity: 0,
      }));
      this.group.add(this.tickLines);
    }

    // Center dot
    const dotPos = new Float32Array([cx, cy, 1]);
    const dotGeo = new THREE.BufferGeometry();
    dotGeo.setAttribute('position', new THREE.BufferAttribute(dotPos, 3));
    this.centerDot = new THREE.Points(dotGeo, new THREE.PointsMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
      size: Math.max(3, Math.min(w, h) * 0.02),
      sizeAttenuation: false,
    }));
    this.group.add(this.centerDot);
  }

  private buildTicks(
    verts: number[], cx: number, cy: number,
    halfW: number, halfH: number, _skipCenter: boolean,
  ): void {
    const tickLen = Math.max(2, Math.min(halfW, halfH) * 0.04);
    // Ticks along horizontal arm
    const hTickCount = Math.max(4, Math.floor(halfW / (Math.min(halfW, halfH) * 0.08)));
    for (let i = 1; i <= hTickCount; i++) {
      const frac = i / (hTickCount + 1);
      const major = i % 4 === 0;
      const tl = major ? tickLen * 2 : tickLen;
      // Right arm
      const rx = cx + halfW * frac;
      verts.push(rx, cy - tl, 0.5, rx, cy + tl, 0.5);
      // Left arm
      const lx = cx - halfW * frac;
      verts.push(lx, cy - tl, 0.5, lx, cy + tl, 0.5);
    }
    // Ticks along vertical arm
    const vTickCount = Math.max(4, Math.floor(halfH / (Math.min(halfW, halfH) * 0.08)));
    for (let i = 1; i <= vTickCount; i++) {
      const frac = i / (vTickCount + 1);
      const major = i % 4 === 0;
      const tl = major ? tickLen * 2 : tickLen;
      // Top arm
      const ty = cy + halfH * frac;
      verts.push(cx - tl, ty, 0.5, cx + tl, ty, 0.5);
      // Bottom arm
      const by = cy - halfH * frac;
      verts.push(cx - tl, by, 0.5, cx + tl, by, 0.5);
    }
  }

  private buildDiagonalTicks(
    verts: number[], cx: number, cy: number,
    w: number, h: number, diagLen: number,
  ): void {
    const tickLen = Math.max(2, Math.min(w, h) * 0.03);
    const tickCount = Math.max(3, Math.floor(diagLen / (Math.min(w, h) * 0.1)));

    for (let d = 0; d < 4; d++) {
      // 4 diagonal directions
      const angle = (d * Math.PI / 2) + Math.PI / 4;
      const dirX = Math.cos(angle);
      const dirY = Math.sin(angle);
      // Perpendicular direction for tick marks
      const perpX = -dirY;
      const perpY = dirX;

      for (let i = 1; i <= tickCount; i++) {
        const frac = i / (tickCount + 1);
        const dist = Math.min(w, h) * 0.5 * frac;
        const px = cx + dirX * dist;
        const py = cy + dirY * dist;
        verts.push(
          px - perpX * tickLen, py - perpY * tickLen, 0.5,
          px + perpX * tickLen, py + perpY * tickLen, 0.5,
        );
      }
    }
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    this.pulsePhase += dt;

    // Cross lines: subtle breathing
    const crossAlpha = 0.5 + 0.2 * Math.sin(time * this.breatheSpeed);
    (this.crossLines.material as THREE.LineBasicMaterial).opacity = opacity * crossAlpha;

    // Tick marks: slightly dimmer, offset breathing
    if (this.tickLines) {
      const tickAlpha = 0.3 + 0.15 * Math.sin(time * this.breatheSpeed + 1.0);
      (this.tickLines.material as THREE.LineBasicMaterial).opacity = opacity * tickAlpha;
    }

    // Center dot: pulsing
    const dotAlpha = 0.6 + 0.4 * Math.sin(time * 4);
    (this.centerDot.material as THREE.PointsMaterial).opacity = opacity * dotAlpha;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'alert') {
      this.pulseTimer = 1.5;
      (this.crossLines.material as THREE.LineBasicMaterial).color.copy(this.palette.alert);
      (this.centerDot.material as THREE.PointsMaterial).color.copy(this.palette.alert);
    }
    if (action === 'pulse') {
      (this.crossLines.material as THREE.LineBasicMaterial).color.copy(this.palette.secondary);
      setTimeout(() => {
        (this.crossLines.material as THREE.LineBasicMaterial).color.copy(this.palette.primary);
      }, 300);
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) return;
    this.breatheSpeed = 2.0 + level * 0.8;
  }
}
