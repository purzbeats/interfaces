import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Scope border — oscilloscope-style graduated measurement brackets at the edges
 * with fine division marks. Like the graticule markings on an oscilloscope screen.
 * Variants: full perimeter, corner L-brackets, top+bottom bars, side rulers.
 */
export class ScopeBorderElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'scope-border',
    meta: {
      shape: 'rectangular',
      roles: ['decorative', 'structural', 'border'],
      moods: ['diagnostic', 'tactical'],
      bandAffinity: 'high',
      sizes: ['works-small', 'needs-medium'],
    } satisfies ElementMeta,
  };

  private variant = 0;
  private majorLines!: THREE.LineSegments;
  private minorLines!: THREE.LineSegments;
  private accentDots: THREE.Points | null = null;
  private breatheSpeed = 0;

  build(): void {
    this.variant = this.rng.int(0, 3);
    this.breatheSpeed = this.rng.float(0.3, 0.7);

    const { x, y, w, h } = this.px;
    const minDim = Math.min(w, h);

    // Tick dimensions proportional to tile
    const majorLen = minDim * 0.04;
    const minorLen = minDim * 0.02;
    const majorSpacing = Math.max(1, minDim * 0.08);
    const minorPerMajor = 4;
    const minorSpacing = majorSpacing / minorPerMajor;

    const majorVerts: number[] = [];
    const minorVerts: number[] = [];
    const dotPositions: number[] = [];

    switch (this.variant) {
      case 0: // Full perimeter graticule
        this.buildEdgeTicks(x, y, w, h, majorLen, minorLen, majorSpacing, minorSpacing, majorVerts, minorVerts, dotPositions, 'all');
        break;
      case 1: // Corner L-brackets with divisions
        this.buildCornerBrackets(x, y, w, h, majorLen, minorLen, majorSpacing, minorSpacing, majorVerts, minorVerts, dotPositions);
        break;
      case 2: // Top + bottom bars
        this.buildEdgeTicks(x, y, w, h, majorLen, minorLen, majorSpacing, minorSpacing, majorVerts, minorVerts, dotPositions, 'topbottom');
        break;
      case 3: // Side rulers
        this.buildEdgeTicks(x, y, w, h, majorLen, minorLen, majorSpacing, minorSpacing, majorVerts, minorVerts, dotPositions, 'sides');
        break;
    }

    // Major tick lines
    const majorGeo = new THREE.BufferGeometry();
    majorGeo.setAttribute('position', new THREE.Float32BufferAttribute(majorVerts, 3));
    this.majorLines = new THREE.LineSegments(majorGeo, new THREE.LineBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.majorLines);

    // Minor tick lines
    const minorGeo = new THREE.BufferGeometry();
    minorGeo.setAttribute('position', new THREE.Float32BufferAttribute(minorVerts, 3));
    this.minorLines = new THREE.LineSegments(minorGeo, new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.minorLines);

    // Accent dots at major divisions
    if (dotPositions.length > 0) {
      const dotGeo = new THREE.BufferGeometry();
      dotGeo.setAttribute('position', new THREE.Float32BufferAttribute(dotPositions, 3));
      this.accentDots = new THREE.Points(dotGeo, new THREE.PointsMaterial({
        color: this.palette.secondary,
        size: Math.max(2, minDim * 0.008),
        transparent: true,
        opacity: 0,
        sizeAttenuation: false,
      }));
      this.group.add(this.accentDots);
    }
  }

  private buildEdgeTicks(
    x: number, y: number, w: number, h: number,
    majorLen: number, minorLen: number,
    majorSpacing: number, minorSpacing: number,
    majorVerts: number[], minorVerts: number[], dotPositions: number[],
    edges: 'all' | 'topbottom' | 'sides',
  ): void {
    const doTop = edges === 'all' || edges === 'topbottom';
    const doBottom = edges === 'all' || edges === 'topbottom';
    const doLeft = edges === 'all' || edges === 'sides';
    const doRight = edges === 'all' || edges === 'sides';

    // Top edge
    if (doTop) {
      for (let dx = 0; dx <= w; dx += minorSpacing) {
        const isMajor = Math.abs(dx % majorSpacing) < minorSpacing * 0.5;
        const len = isMajor ? majorLen : minorLen;
        const verts = isMajor ? majorVerts : minorVerts;
        verts.push(x + dx, y, 0, x + dx, y + len, 0);
        if (isMajor) dotPositions.push(x + dx, y, 0);
      }
    }

    // Bottom edge
    if (doBottom) {
      for (let dx = 0; dx <= w; dx += minorSpacing) {
        const isMajor = Math.abs(dx % majorSpacing) < minorSpacing * 0.5;
        const len = isMajor ? majorLen : minorLen;
        const verts = isMajor ? majorVerts : minorVerts;
        verts.push(x + dx, y + h, 0, x + dx, y + h - len, 0);
        if (isMajor) dotPositions.push(x + dx, y + h, 0);
      }
    }

    // Left edge
    if (doLeft) {
      for (let dy = 0; dy <= h; dy += minorSpacing) {
        const isMajor = Math.abs(dy % majorSpacing) < minorSpacing * 0.5;
        const len = isMajor ? majorLen : minorLen;
        const verts = isMajor ? majorVerts : minorVerts;
        verts.push(x, y + dy, 0, x + len, y + dy, 0);
        if (isMajor) dotPositions.push(x, y + dy, 0);
      }
    }

    // Right edge
    if (doRight) {
      for (let dy = 0; dy <= h; dy += minorSpacing) {
        const isMajor = Math.abs(dy % majorSpacing) < minorSpacing * 0.5;
        const len = isMajor ? majorLen : minorLen;
        const verts = isMajor ? majorVerts : minorVerts;
        verts.push(x + w, y + dy, 0, x + w - len, y + dy, 0);
        if (isMajor) dotPositions.push(x + w, y + dy, 0);
      }
    }
  }

  private buildCornerBrackets(
    x: number, y: number, w: number, h: number,
    majorLen: number, minorLen: number,
    majorSpacing: number, minorSpacing: number,
    majorVerts: number[], minorVerts: number[], dotPositions: number[],
  ): void {
    // Bracket arm length proportional to tile
    const armLen = Math.min(w, h) * 0.25;

    // 4 corners: TL, TR, BR, BL
    const corners = [
      { cx: x, cy: y, dirX: 1, dirY: 1 },
      { cx: x + w, cy: y, dirX: -1, dirY: 1 },
      { cx: x + w, cy: y + h, dirX: -1, dirY: -1 },
      { cx: x, cy: y + h, dirX: 1, dirY: -1 },
    ];

    for (const c of corners) {
      // Corner dot
      dotPositions.push(c.cx, c.cy, 0);

      // Horizontal arm with ticks
      majorVerts.push(c.cx, c.cy, 0, c.cx + c.dirX * armLen, c.cy, 0);
      for (let d = 0; d <= armLen; d += minorSpacing) {
        const isMajor = Math.abs(d % majorSpacing) < minorSpacing * 0.5;
        const len = isMajor ? majorLen : minorLen;
        const verts = isMajor ? majorVerts : minorVerts;
        verts.push(
          c.cx + c.dirX * d, c.cy, 0,
          c.cx + c.dirX * d, c.cy + c.dirY * len, 0,
        );
      }

      // Vertical arm with ticks
      majorVerts.push(c.cx, c.cy, 0, c.cx, c.cy + c.dirY * armLen, 0);
      for (let d = minorSpacing; d <= armLen; d += minorSpacing) {
        const isMajor = Math.abs(d % majorSpacing) < minorSpacing * 0.5;
        const len = isMajor ? majorLen : minorLen;
        const verts = isMajor ? majorVerts : minorVerts;
        verts.push(
          c.cx, c.cy + c.dirY * d, 0,
          c.cx + c.dirX * len, c.cy + c.dirY * d, 0,
        );
      }
    }
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    const breathe = 0.5 + 0.5 * Math.sin(time * this.breatheSpeed);

    const majorMat = this.majorLines.material as THREE.LineBasicMaterial;
    majorMat.opacity = opacity * (0.12 + 0.06 * breathe);

    const minorMat = this.minorLines.material as THREE.LineBasicMaterial;
    minorMat.opacity = opacity * (0.06 + 0.03 * breathe);

    if (this.accentDots) {
      const dotMat = this.accentDots.material as THREE.PointsMaterial;
      dotMat.opacity = opacity * (0.18 + 0.08 * breathe);
    }
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'alert') {
      (this.majorLines.material as THREE.LineBasicMaterial).color.copy(this.palette.alert);
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
  }
}
