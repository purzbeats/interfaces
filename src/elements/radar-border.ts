import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';
import { hexCornersPixel } from '../layout/hex-grid';

/**
 * Radar border — concentric arc segments at corners that pulse outward, like
 * radar detection zones expanding from the corners. Four variants: all 4 corners,
 * alternating corners, single sweeping corner, pulsing quarter-circles.
 */
export class RadarBorderElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'radar-border',
    meta: {
      shape: 'rectangular',
      roles: ['scanner', 'decorative', 'border'],
      moods: ['tactical', 'ambient'],
      bandAffinity: 'bass',
      sizes: ['works-small', 'needs-medium', 'needs-large'],
    },
  };

  private variant: number = 0;
  private arcLines!: THREE.LineSegments;
  private arcVertCount: number = 0;
  private cornerPositions: { cx: number; cy: number; startAngle: number }[] = [];
  private pulsePhase: number = 0;
  private arcCount: number = 3; // concentric arcs per corner
  private segsPerArc: number = 12;
  private isHex: boolean = false;
  private hexCorners: THREE.Vector3[] | null = null;
  private speedBoost: number = 1;
  private activeCorner: number = 0; // for variant 2 (single sweep)
  private sweepTimer: number = 0;

  build(): void {
    this.variant = this.rng.int(0, 3);
    const { x, y, w, h } = this.px;
    const minDim = Math.min(w, h);

    const hexCell = this.region.hexCell;
    if (hexCell) {
      this.isHex = true;
      this.hexCorners = hexCornersPixel(hexCell, this.screenWidth, this.screenHeight);
      // Use hex vertices as corner positions
      for (let i = 0; i < 6; i++) {
        const c = this.hexCorners[i];
        const prev = this.hexCorners[(i + 5) % 6];
        const next = this.hexCorners[(i + 1) % 6];
        // Angle pointing inward (average of edges going away from vertex)
        const toP = Math.atan2(prev.y - c.y, prev.x - c.x);
        const toN = Math.atan2(next.y - c.y, next.x - c.x);
        // Start angle: midpoint between the two edge directions
        let mid = (toP + toN) / 2;
        // Make sure mid points inward
        const testX = c.x + Math.cos(mid);
        const testY = c.y + Math.sin(mid);
        const centerX = this.hexCorners.reduce((s, v) => s + v.x, 0) / 6;
        const centerY = this.hexCorners.reduce((s, v) => s + v.y, 0) / 6;
        if ((testX - centerX) * (testX - centerX) + (testY - centerY) * (testY - centerY) >
            (c.x - centerX) * (c.x - centerX) + (c.y - centerY) * (c.y - centerY)) {
          mid += Math.PI;
        }
        this.cornerPositions.push({ cx: c.x, cy: c.y, startAngle: mid - Math.PI * 0.25 });
      }
    } else {
      // Rectangular corners with quarter-circle arcs pointing inward
      this.cornerPositions = [
        { cx: x,     cy: y,     startAngle: 0 },               // top-left: arc goes down-right
        { cx: x + w, cy: y,     startAngle: Math.PI * 0.5 },   // top-right: arc goes down-left
        { cx: x + w, cy: y + h, startAngle: Math.PI },          // bottom-right: arc goes up-left
        { cx: x,     cy: y + h, startAngle: Math.PI * 1.5 },   // bottom-left: arc goes up-right
      ];
    }

    this.arcCount = 3;
    this.segsPerArc = Math.max(6, Math.floor(minDim * 0.04));
    const arcAngle = this.isHex ? Math.PI * 0.4 : Math.PI * 0.5;

    // Total segments: corners * arcs * segments * 2 (line pairs)
    const cornerCount = this.cornerPositions.length;
    const totalSegs = cornerCount * this.arcCount * this.segsPerArc;
    const verts = new Float32Array(totalSegs * 2 * 3); // 2 verts per segment, 3 components

    // Initialize to tile center to avoid lines-to-origin
    const tileCx = x + w * 0.5, tileCy = y + h * 0.5;
    for (let i = 0; i < verts.length; i += 3) {
      verts[i] = tileCx;
      verts[i + 1] = tileCy;
      verts[i + 2] = 0;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    this.arcVertCount = totalSegs * 2;

    this.arcLines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.arcLines);
  }

  private updateArcs(time: number, opacity: number): void {
    const { w, h } = this.px;
    const minDim = Math.min(w, h);
    const maxRadius = minDim * 0.12;
    const arcAngle = this.isHex ? Math.PI * 0.4 : Math.PI * 0.5;

    const pos = this.arcLines.geometry.getAttribute('position') as THREE.BufferAttribute;
    let idx = 0;

    for (let ci = 0; ci < this.cornerPositions.length; ci++) {
      const corner = this.cornerPositions[ci];

      // Determine if this corner is active based on variant
      let cornerActive = true;
      let cornerAlpha = 1;

      switch (this.variant) {
        case 0: // all corners
          cornerActive = true;
          break;
        case 1: // alternating corners
          cornerActive = (ci % 2 === 0) !== (Math.floor(time * 0.5) % 2 === 0);
          break;
        case 2: // single sweeping corner
          cornerActive = (ci === this.activeCorner);
          cornerAlpha = cornerActive ? 1 : 0.1;
          break;
        case 3: // pulsing quarter-circles (all active, phase-shifted)
          cornerActive = true;
          break;
      }

      for (let ai = 0; ai < this.arcCount; ai++) {
        // Pulsing radius: each arc ring expands outward over time
        let phase: number;
        if (this.variant === 3) {
          phase = (this.pulsePhase + ci * 0.3 + ai * 0.4) % 1;
        } else {
          phase = (this.pulsePhase + ai * 0.33) % 1;
        }

        const radius = maxRadius * (0.3 + phase * 0.7);
        const ringAlpha = cornerActive ? (1 - phase) * cornerAlpha : 0.05;

        for (let si = 0; si < this.segsPerArc; si++) {
          const a1 = corner.startAngle + (si / this.segsPerArc) * arcAngle;
          const a2 = corner.startAngle + ((si + 1) / this.segsPerArc) * arcAngle;

          if (cornerActive && ringAlpha > 0.02) {
            pos.setXYZ(idx, corner.cx + Math.cos(a1) * radius, corner.cy + Math.sin(a1) * radius, 0.5);
            pos.setXYZ(idx + 1, corner.cx + Math.cos(a2) * radius, corner.cy + Math.sin(a2) * radius, 0.5);
          } else {
            // Hide by collapsing to corner point
            pos.setXYZ(idx, corner.cx, corner.cy, 0.5);
            pos.setXYZ(idx + 1, corner.cx, corner.cy, 0.5);
          }
          idx += 2;
        }
      }
    }

    pos.needsUpdate = true;
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);

    const speed = 0.4 * this.speedBoost;
    this.pulsePhase = (this.pulsePhase + dt * speed) % 1;

    // Variant 2: rotate active corner
    if (this.variant === 2) {
      this.sweepTimer += dt * speed * 0.5;
      if (this.sweepTimer > 1) {
        this.sweepTimer = 0;
        this.activeCorner = (this.activeCorner + 1) % this.cornerPositions.length;
      }
    }

    this.updateArcs(time, opacity);

    (this.arcLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.7;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'activate') {
      this.pulsePhase = 0;
      this.activeCorner = 0;
      this.sweepTimer = 0;
      this.speedBoost = 1;
    }
    if (action === 'alert') {
      this.pulseTimer = 2.0;
      (this.arcLines.material as THREE.LineBasicMaterial).color.copy(this.palette.alert);
    }
    if (action === 'pulse') {
      this.speedBoost = 3.0;
      setTimeout(() => { this.speedBoost = 1; }, 500);
    }
    if (action === 'glitch') {
      this.pulsePhase = this.rng.float(0, 1);
      this.activeCorner = this.rng.int(0, this.cornerPositions.length - 1);
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) { this.speedBoost = 1; return; }
    this.speedBoost = 1 + level * 0.4;
  }
}
