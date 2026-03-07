import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';
import { hexCornersPixel, hexPerimeterPoint } from '../layout/hex-grid';

/**
 * Stitch border — dashed line with perpendicular cross-stitches at regular
 * intervals, like a sewing pattern or technical drawing border. Four variants:
 * single stitch, cross-stitch (X pattern), ladder stitch, running stitch with dots.
 */
export class StitchBorderElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'stitch-border',
    meta: {
      shape: 'rectangular',
      roles: ['structural', 'decorative', 'border'],
      moods: ['ambient', 'diagnostic'],
      bandAffinity: 'mid',
      sizes: ['works-small', 'needs-medium', 'needs-large'],
    },
  };

  private variant: number = 0;
  private stitchLines!: THREE.LineSegments;
  private stitchDots: THREE.Points | null = null;
  private stitchCount: number = 0;
  private isHex: boolean = false;
  private hexCorners: THREE.Vector3[] | null = null;
  private perimeterLength: number = 0;
  private speedBoost: number = 1;
  private animPhase: number = 0;

  build(): void {
    this.variant = this.rng.int(0, 3);
    const { x, y, w, h } = this.px;

    const hexCell = this.region.hexCell;
    if (hexCell) {
      this.isHex = true;
      this.hexCorners = hexCornersPixel(hexCell, this.screenWidth, this.screenHeight);
      let perim = 0;
      for (let i = 0; i < 6; i++) {
        const c1 = this.hexCorners[i], c2 = this.hexCorners[(i + 1) % 6];
        perim += Math.sqrt((c2.x - c1.x) ** 2 + (c2.y - c1.y) ** 2);
      }
      this.perimeterLength = perim;
    } else {
      this.perimeterLength = 2 * (w + h);
    }

    const minDim = Math.min(w, h);
    const spacing = Math.max(4, minDim * 0.06);
    this.stitchCount = Math.max(8, Math.floor(this.perimeterLength / spacing));

    const stitchDepth = minDim * 0.025;
    const dashHalfLen = minDim * 0.015;

    const verts: number[] = [];
    const dotVerts: number[] = [];

    for (let i = 0; i < this.stitchCount; i++) {
      const t = i / this.stitchCount;
      const tNext = (i + 0.5) / this.stitchCount;
      const pt = this.perimeterPoint(t);
      const ptNext = this.perimeterPoint(tNext);
      const normal = this.perimeterNormal(t);

      switch (this.variant) {
        case 0: { // single stitch: perpendicular lines at intervals
          // Dash segment along perimeter
          verts.push(pt.px, pt.py, 0, ptNext.px, ptNext.py, 0);
          // Perpendicular stitch
          verts.push(
            pt.px - normal.nx * stitchDepth, pt.py - normal.ny * stitchDepth, 0,
            pt.px + normal.nx * stitchDepth, pt.py + normal.ny * stitchDepth, 0,
          );
          break;
        }
        case 1: { // cross-stitch (X pattern)
          // Dash segment
          verts.push(pt.px, pt.py, 0, ptNext.px, ptNext.py, 0);
          // Tangent direction
          const tdx = ptNext.px - pt.px;
          const tdy = ptNext.py - pt.py;
          const tlen = Math.sqrt(tdx * tdx + tdy * tdy) || 1;
          const tx = (tdx / tlen) * dashHalfLen;
          const ty = (tdy / tlen) * dashHalfLen;
          // X cross at stitch point
          verts.push(
            pt.px - tx - normal.nx * stitchDepth, pt.py - ty - normal.ny * stitchDepth, 0,
            pt.px + tx + normal.nx * stitchDepth, pt.py + ty + normal.ny * stitchDepth, 0,
          );
          verts.push(
            pt.px + tx - normal.nx * stitchDepth, pt.py + ty - normal.ny * stitchDepth, 0,
            pt.px - tx + normal.nx * stitchDepth, pt.py - ty + normal.ny * stitchDepth, 0,
          );
          break;
        }
        case 2: { // ladder stitch: two parallel lines with rungs
          const offset = stitchDepth * 0.8;
          const ptNextLadder = this.perimeterPoint(tNext);
          const normalNext = this.perimeterNormal(tNext);
          // Outer rail
          verts.push(
            pt.px + normal.nx * offset, pt.py + normal.ny * offset, 0,
            ptNextLadder.px + normalNext.nx * offset, ptNextLadder.py + normalNext.ny * offset, 0,
          );
          // Inner rail
          verts.push(
            pt.px - normal.nx * offset, pt.py - normal.ny * offset, 0,
            ptNextLadder.px - normalNext.nx * offset, ptNextLadder.py - normalNext.ny * offset, 0,
          );
          // Rung
          verts.push(
            pt.px - normal.nx * offset, pt.py - normal.ny * offset, 0,
            pt.px + normal.nx * offset, pt.py + normal.ny * offset, 0,
          );
          break;
        }
        case 3: { // running stitch with dots
          // Alternating: stitch segment then gap with dot
          if (i % 2 === 0) {
            verts.push(pt.px, pt.py, 0, ptNext.px, ptNext.py, 0);
          } else {
            const mid = this.perimeterPoint((t + tNext) * 0.5);
            dotVerts.push(mid.px, mid.py, 0.1);
          }
          break;
        }
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3));
    this.stitchLines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.stitchLines);

    // Dots for variant 3
    if (this.variant === 3 && dotVerts.length > 0) {
      const dotGeo = new THREE.BufferGeometry();
      dotGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(dotVerts), 3));
      const dotSize = Math.max(2, minDim * 0.012);
      this.stitchDots = new THREE.Points(dotGeo, new THREE.PointsMaterial({
        color: this.palette.secondary,
        transparent: true,
        opacity: 0,
        size: dotSize,
        sizeAttenuation: false,
      }));
      this.group.add(this.stitchDots);
    }
  }

  private perimeterPoint(t: number): { px: number; py: number } {
    if (this.isHex && this.hexCorners) {
      return hexPerimeterPoint(this.hexCorners, t);
    }
    const { x, y, w, h } = this.px;
    const perim = this.perimeterLength;
    t = ((t % 1) + 1) % 1;
    const dist = t * perim;
    if (dist <= w) return { px: x + dist, py: y };
    if (dist <= w + h) return { px: x + w, py: y + (dist - w) };
    if (dist <= 2 * w + h) return { px: x + w - (dist - w - h), py: y + h };
    return { px: x, py: y + h - (dist - 2 * w - h) };
  }

  private perimeterNormal(t: number): { nx: number; ny: number } {
    if (this.isHex && this.hexCorners) {
      const edgeIndex = Math.floor(((t % 1 + 1) % 1) * 6) % 6;
      const c1 = this.hexCorners[edgeIndex];
      const c2 = this.hexCorners[(edgeIndex + 1) % 6];
      const dx = c2.x - c1.x, dy = c2.y - c1.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      return { nx: -dy / len, ny: dx / len };
    }
    const { w, h } = this.px;
    const perim = this.perimeterLength;
    t = ((t % 1) + 1) % 1;
    const dist = t * perim;
    if (dist <= w) return { nx: 0, ny: -1 };
    if (dist <= w + h) return { nx: 1, ny: 0 };
    if (dist <= 2 * w + h) return { nx: 0, ny: 1 };
    return { nx: -1, ny: 0 };
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);

    this.animPhase += dt * 0.5 * this.speedBoost;
    // Subtle brightness pulsing
    const brightness = 0.5 + Math.sin(this.animPhase * 2) * 0.15;

    (this.stitchLines.material as THREE.LineBasicMaterial).opacity = opacity * brightness;

    if (this.stitchDots) {
      const dotBrightness = 0.6 + Math.sin(this.animPhase * 3 + 1) * 0.2;
      (this.stitchDots.material as THREE.PointsMaterial).opacity = opacity * dotBrightness;
    }
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'activate') {
      this.animPhase = 0;
      this.speedBoost = 1;
    }
    if (action === 'alert') {
      this.pulseTimer = 2.0;
      (this.stitchLines.material as THREE.LineBasicMaterial).color.copy(this.palette.alert);
      if (this.stitchDots) {
        (this.stitchDots.material as THREE.PointsMaterial).color.copy(this.palette.alert);
      }
    }
    if (action === 'pulse') {
      this.speedBoost = 3.0;
      setTimeout(() => { this.speedBoost = 1; }, 500);
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    this.speedBoost = level === 0 ? 1 : 1 + level * 0.3;
  }
}
