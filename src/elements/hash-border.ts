import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import { hexCornersPixel, hexPerimeterPoint } from '../layout/hex-grid';

/**
 * Hash border — short diagonal hash marks at regular intervals along all edges,
 * like a security document border or engineering drawing. Marks subtly pulse
 * and shift. Four variants: diagonal slashes, alternating angles, double-row,
 * and rotating marks.
 */
export class HashBorderElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'hash-border',
    meta: {
      shape: 'rectangular',
      roles: ['structural', 'decorative', 'border'],
      moods: ['tactical', 'diagnostic'],
      bandAffinity: 'high',
      sizes: ['works-small', 'needs-medium', 'needs-large'],
    },
  };

  private hashLines!: THREE.LineSegments;
  private hashCount: number = 0;
  private variant: number = 0;
  private borderOutline!: THREE.LineSegments;
  private isHex: boolean = false;
  private hexCorners: THREE.Vector3[] | null = null;
  private perimeterLength: number = 0;
  private hashLength: number = 0;

  // Per-hash data for animation
  private hashTs: Float32Array = new Float32Array(0);     // position along perimeter (0..1)
  private hashAngles: Float32Array = new Float32Array(0);  // angle of each mark

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

    // Hash mark length scales with region size
    this.hashLength = Math.max(3, Math.min(w, h) * 0.04);

    // Density: one hash mark every ~8-12 pixels of perimeter
    const spacing = Math.max(6, Math.min(w, h) * 0.04);
    this.hashCount = Math.max(12, Math.floor(this.perimeterLength / spacing));

    // For variant 2 (double-row), double the count
    const totalMarks = this.variant === 2 ? this.hashCount * 2 : this.hashCount;

    this.hashTs = new Float32Array(totalMarks);
    this.hashAngles = new Float32Array(totalMarks);

    for (let i = 0; i < this.hashCount; i++) {
      const t = i / this.hashCount;
      this.hashTs[i] = t;

      switch (this.variant) {
        case 0: // uniform diagonal
          this.hashAngles[i] = Math.PI / 4;
          break;
        case 1: // alternating angles
          this.hashAngles[i] = (i % 2 === 0) ? Math.PI / 4 : -Math.PI / 4;
          break;
        case 2: // double-row (inner + outer)
          this.hashAngles[i] = Math.PI / 4;
          this.hashTs[this.hashCount + i] = t;
          this.hashAngles[this.hashCount + i] = -Math.PI / 4;
          break;
        case 3: // rotating marks (base angle varies along perimeter)
          this.hashAngles[i] = t * Math.PI * 2;
          break;
      }
    }

    // Dim static border
    let bv: Float32Array;
    if (this.isHex && this.hexCorners) {
      const hc = this.hexCorners;
      const verts: number[] = [];
      for (let i = 0; i < 6; i++) {
        verts.push(hc[i].x, hc[i].y, 0, hc[(i + 1) % 6].x, hc[(i + 1) % 6].y, 0);
      }
      bv = new Float32Array(verts);
    } else {
      bv = new Float32Array([
        x, y, 0, x + w, y, 0,
        x + w, y, 0, x + w, y + h, 0,
        x + w, y + h, 0, x, y + h, 0,
        x, y + h, 0, x, y, 0,
      ]);
    }
    const borderGeo = new THREE.BufferGeometry();
    borderGeo.setAttribute('position', new THREE.BufferAttribute(bv, 3));
    this.borderOutline = new THREE.LineSegments(borderGeo, new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.borderOutline);

    // Hash mark line segments (2 verts per mark)
    const hashPos = new Float32Array(totalMarks * 6); // 2 verts * 3 components
    const hashGeo = new THREE.BufferGeometry();
    hashGeo.setAttribute('position', new THREE.BufferAttribute(hashPos, 3));
    this.hashLines = new THREE.LineSegments(hashGeo, new THREE.LineBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.hashLines);

    // Initialize positions
    this.updateHashPositions(0);
  }

  private perimeterPoint(t: number): { px: number; py: number } {
    if (this.isHex && this.hexCorners) {
      return hexPerimeterPoint(this.hexCorners, t);
    }
    const { x, y, w, h } = this.px;
    t = ((t % 1) + 1) % 1;
    const dist = t * this.perimeterLength;
    if (dist <= w) return { px: x + dist, py: y };
    if (dist <= w + h) return { px: x + w, py: y + (dist - w) };
    if (dist <= 2 * w + h) return { px: x + w - (dist - w - h), py: y + h };
    return { px: x, py: y + h - (dist - 2 * w - h) };
  }

  private perimeterNormal(t: number): { nx: number; ny: number } {
    // Approximate normal by finite difference
    const dt = 0.001;
    const p1 = this.perimeterPoint(t - dt);
    const p2 = this.perimeterPoint(t + dt);
    const dx = p2.px - p1.px;
    const dy = p2.py - p1.py;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    // Normal is perpendicular to tangent, pointing inward
    return { nx: -dy / len, ny: dx / len };
  }

  private updateHashPositions(timeOffset: number): void {
    const posAttr = this.hashLines.geometry.getAttribute('position') as THREE.BufferAttribute;
    const half = this.hashLength * 0.5;
    const totalMarks = this.hashTs.length;

    for (let i = 0; i < totalMarks; i++) {
      const t = ((this.hashTs[i] + timeOffset) % 1 + 1) % 1;
      const pt = this.perimeterPoint(t);
      const norm = this.perimeterNormal(t);
      const angle = this.hashAngles[i];

      // Rotate the normal by the hash angle to get the mark direction
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const dirX = norm.nx * cos - norm.ny * sin;
      const dirY = norm.nx * sin + norm.ny * cos;

      posAttr.setXYZ(i * 2, pt.px - dirX * half, pt.py - dirY * half, 0.5);
      posAttr.setXYZ(i * 2 + 1, pt.px + dirX * half, pt.py + dirY * half, 0.5);
    }
    posAttr.needsUpdate = true;
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);

    // Slow drift of hash marks along perimeter
    const drift = time * 0.02;
    this.updateHashPositions(drift);

    // Subtle pulsing opacity
    const pulse = 0.7 + 0.3 * Math.sin(time * 2.5);
    (this.hashLines.material as THREE.LineBasicMaterial).opacity = opacity * pulse * 0.6;
    (this.borderOutline.material as THREE.LineBasicMaterial).opacity = opacity * 0.12;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'alert') {
      this.pulseTimer = 1.5;
      (this.hashLines.material as THREE.LineBasicMaterial).color.copy(this.palette.alert);
    }
    if (action === 'pulse') {
      (this.hashLines.material as THREE.LineBasicMaterial).color.copy(this.palette.secondary);
      setTimeout(() => {
        (this.hashLines.material as THREE.LineBasicMaterial).color.copy(this.palette.primary);
      }, 300);
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
  }
}
