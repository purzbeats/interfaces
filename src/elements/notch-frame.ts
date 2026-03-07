import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';
import { hexCornersPixel, hexPerimeterPoint } from '../layout/hex-grid';

/**
 * Notch frame — ruler-style notches along all edges with alternating depths.
 * Like a measurement ruler border. Four variants: uniform notches, alternating
 * long/short, notches with connecting baseline, notches that grow from corners.
 */
export class NotchFrameElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'notch-frame',
    meta: {
      shape: 'rectangular',
      roles: ['structural', 'decorative', 'border'],
      moods: ['tactical', 'diagnostic'],
      bandAffinity: 'mid',
      sizes: ['works-small', 'needs-medium', 'needs-large'],
    },
  };

  private variant: number = 0;
  private notchLines!: THREE.LineSegments;
  private baselineLines!: THREE.LineSegments;
  private notchCount: number = 0;
  private isHex: boolean = false;
  private hexCorners: THREE.Vector3[] | null = null;
  private perimeterLength: number = 0;
  private speedBoost: number = 1;
  private growProgress: number = 0; // for variant 3 animation

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

    // Notch spacing proportional to tile size
    const minDim = Math.min(w, h);
    const spacing = Math.max(3, minDim * 0.04);
    this.notchCount = Math.max(8, Math.floor(this.perimeterLength / spacing));

    const majorDepth = minDim * 0.04;
    const minorDepth = minDim * 0.015;

    // Build notch line segments
    const verts: number[] = [];

    for (let i = 0; i < this.notchCount; i++) {
      const t = i / this.notchCount;
      const isMajor = (i % 5 === 0);

      let depth: number;
      switch (this.variant) {
        case 0: // uniform
          depth = majorDepth * 0.6;
          break;
        case 1: // alternating long/short
          depth = isMajor ? majorDepth : minorDepth;
          break;
        case 2: // with connecting baseline (notches same as variant 1)
          depth = isMajor ? majorDepth : minorDepth;
          break;
        case 3: { // grow from corners outward
          const cornerDist = Math.min(t, 1 - t, Math.abs(t - 0.25), Math.abs(t - 0.5), Math.abs(t - 0.75));
          const cornerFactor = Math.max(0, 1 - cornerDist * 8);
          depth = majorDepth * (0.3 + 0.7 * cornerFactor);
          break;
        }
        default:
          depth = majorDepth * 0.5;
      }

      const pt = this.perimeterPoint(t);
      const normal = this.perimeterNormal(t);

      verts.push(
        pt.px, pt.py, 0,
        pt.px + normal.nx * depth, pt.py + normal.ny * depth, 0,
      );
    }

    const notchGeo = new THREE.BufferGeometry();
    notchGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3));
    this.notchLines = new THREE.LineSegments(notchGeo, new THREE.LineBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.notchLines);

    // Variant 2: add connecting baseline along perimeter
    if (this.variant === 2) {
      const baseVerts: number[] = [];
      const baseSteps = this.notchCount * 2;
      for (let i = 0; i < baseSteps; i++) {
        const t1 = i / baseSteps;
        const t2 = (i + 1) / baseSteps;
        const p1 = this.perimeterPoint(t1);
        const p2 = this.perimeterPoint(t2);
        baseVerts.push(p1.px, p1.py, 0, p2.px, p2.py, 0);
      }
      const baseGeo = new THREE.BufferGeometry();
      baseGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(baseVerts), 3));
      this.baselineLines = new THREE.LineSegments(baseGeo, new THREE.LineBasicMaterial({
        color: this.palette.dim,
        transparent: true,
        opacity: 0,
      }));
      this.group.add(this.baselineLines);
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

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);

    // Variant 3: animate grow progress
    if (this.variant === 3) {
      this.growProgress = Math.min(1, this.growProgress + dt * 0.5 * this.speedBoost);
    }

    (this.notchLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.7;

    if (this.variant === 2 && this.baselineLines) {
      (this.baselineLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.3;
    }
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'activate') {
      this.growProgress = 0;
      this.speedBoost = 1;
    }
    if (action === 'alert') {
      this.pulseTimer = 2.0;
      (this.notchLines.material as THREE.LineBasicMaterial).color.copy(this.palette.alert);
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    this.speedBoost = level === 0 ? 1 : 1 + level * 0.3;
  }
}
