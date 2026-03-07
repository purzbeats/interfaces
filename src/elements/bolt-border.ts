import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';
import { hexCornersPixel, hexPerimeterPoint } from '../layout/hex-grid';

/**
 * Bolt border — small decorative bolt/rivet dots at regular intervals with thin
 * connecting lines between them, like a riveted metal panel.
 * Uses Points for bolts and LineSegments for connectors.
 */
export class BoltBorderElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'bolt-border',
    meta: {
      shape: 'rectangular',
      roles: ['decorative', 'structural', 'border'],
      moods: ['tactical', 'ambient'],
      bandAffinity: 'high',
      sizes: ['works-small', 'needs-medium'],
    } satisfies ElementMeta,
  };

  private variant = 0;
  private bolts!: THREE.Points;
  private connectors!: THREE.LineSegments;
  private boltCount = 0;
  private boltPhases: number[] = [];
  private breatheSpeed = 0;

  build(): void {
    this.variant = this.rng.int(0, 3);
    this.breatheSpeed = this.rng.float(0.3, 0.8);

    const { x, y, w, h } = this.px;
    const minDim = Math.min(w, h);

    const hexCell = this.region.hexCell;
    const isHex = !!hexCell;
    const hexCorners = hexCell
      ? hexCornersPixel(hexCell, this.screenWidth, this.screenHeight)
      : null;

    // Compute perimeter length
    let perimLength: number;
    if (hexCorners) {
      perimLength = 0;
      for (let i = 0; i < 6; i++) {
        const a = hexCorners[i], b = hexCorners[(i + 1) % 6];
        perimLength += Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
      }
    } else {
      perimLength = 2 * (w + h);
    }

    // Generate bolt positions based on variant
    const boltTs: number[] = [];
    const boltSizes: number[] = [];
    const baseSpacing = Math.max(1, minDim * 0.06);
    const baseBoltCount = Math.max(8, Math.floor(perimLength / baseSpacing));
    const defaultSize = Math.max(2, minDim * 0.01);

    switch (this.variant) {
      case 0: {
        // Uniform spacing
        for (let i = 0; i < baseBoltCount; i++) {
          boltTs.push(i / baseBoltCount);
          boltSizes.push(defaultSize);
        }
        break;
      }
      case 1: {
        // Clustered pairs — two bolts close together, gap, repeat
        const pairCount = Math.max(4, Math.floor(baseBoltCount / 3));
        const pairGap = 0.008;
        for (let i = 0; i < pairCount; i++) {
          const t = i / pairCount;
          boltTs.push(t);
          boltTs.push(((t + pairGap) % 1));
          boltSizes.push(defaultSize, defaultSize * 0.7);
        }
        break;
      }
      case 2: {
        // Corner-heavy — more bolts near corners/vertices
        if (isHex && hexCorners) {
          // Place extra bolts near each hex vertex
          for (let v = 0; v < 6; v++) {
            const vt = v / 6;
            for (let j = -2; j <= 2; j++) {
              boltTs.push(((vt + j * 0.012) % 1 + 1) % 1);
              boltSizes.push(j === 0 ? defaultSize * 1.5 : defaultSize * 0.8);
            }
            // Sparse mid-edge
            boltTs.push(((vt + 1 / 12) % 1));
            boltSizes.push(defaultSize * 0.6);
          }
        } else {
          // Rect: cluster near corners
          const cornerTs = [0, w / perimLength, (w + h) / perimLength, (2 * w + h) / perimLength];
          for (const ct of cornerTs) {
            for (let j = -2; j <= 2; j++) {
              boltTs.push(((ct + j * 0.01) % 1 + 1) % 1);
              boltSizes.push(j === 0 ? defaultSize * 1.5 : defaultSize * 0.8);
            }
          }
          // Sparse mid-edges
          const midCount = Math.max(2, Math.floor(baseBoltCount / 6));
          for (let i = 0; i < midCount; i++) {
            boltTs.push(this.rng.float(0, 1));
            boltSizes.push(defaultSize * 0.6);
          }
        }
        break;
      }
      case 3: {
        // Alternating sizes
        for (let i = 0; i < baseBoltCount; i++) {
          boltTs.push(i / baseBoltCount);
          boltSizes.push(i % 2 === 0 ? defaultSize * 1.2 : defaultSize * 0.6);
        }
        break;
      }
    }

    this.boltCount = boltTs.length;

    // Convert t values to positions
    const boltPositions = new Float32Array(this.boltCount * 3);
    const connVerts: number[] = [];
    const prevPt = { px: 0, py: 0 };

    for (let i = 0; i < this.boltCount; i++) {
      const t = boltTs[i];
      let pt: { px: number; py: number };
      if (isHex && hexCorners) {
        pt = hexPerimeterPoint(hexCorners, t);
      } else {
        pt = this.rectPerimeterPoint(t, x, y, w, h, perimLength);
      }
      boltPositions[i * 3] = pt.px;
      boltPositions[i * 3 + 1] = pt.py;
      boltPositions[i * 3 + 2] = 0;

      // Connector line from previous bolt
      if (i > 0) {
        connVerts.push(prevPt.px, prevPt.py, 0, pt.px, pt.py, 0);
      }
      prevPt.px = pt.px;
      prevPt.py = pt.py;

      this.boltPhases.push(this.rng.float(0, Math.PI * 2));
    }

    // Close the loop
    if (this.boltCount > 1) {
      connVerts.push(
        prevPt.px, prevPt.py, 0,
        boltPositions[0], boltPositions[1], 0,
      );
    }

    // Points for bolts
    const boltGeo = new THREE.BufferGeometry();
    boltGeo.setAttribute('position', new THREE.BufferAttribute(boltPositions, 3));
    this.bolts = new THREE.Points(boltGeo, new THREE.PointsMaterial({
      color: this.palette.primary,
      size: Math.max(2, minDim * 0.012),
      transparent: true,
      opacity: 0,
      sizeAttenuation: false,
    }));
    this.group.add(this.bolts);

    // LineSegments for connectors
    const connGeo = new THREE.BufferGeometry();
    connGeo.setAttribute('position', new THREE.Float32BufferAttribute(connVerts, 3));
    this.connectors = new THREE.LineSegments(connGeo, new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.connectors);
  }

  private rectPerimeterPoint(
    t: number, x: number, y: number, w: number, h: number, perimLen: number,
  ): { px: number; py: number } {
    t = ((t % 1) + 1) % 1;
    const dist = t * perimLen;
    if (dist <= w) return { px: x + dist, py: y };
    if (dist <= w + h) return { px: x + w, py: y + (dist - w) };
    if (dist <= 2 * w + h) return { px: x + w - (dist - w - h), py: y + h };
    return { px: x, py: y + h - (dist - 2 * w - h) };
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    const breathe = 0.5 + 0.5 * Math.sin(time * this.breatheSpeed);

    const boltMat = this.bolts.material as THREE.PointsMaterial;
    boltMat.opacity = opacity * (0.15 + 0.08 * breathe);

    const connMat = this.connectors.material as THREE.LineBasicMaterial;
    connMat.opacity = opacity * (0.06 + 0.04 * breathe);
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'alert') {
      (this.bolts.material as THREE.PointsMaterial).color.copy(this.palette.alert);
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
  }
}
