import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import { hexCornersPixel, hexPerimeterPoint } from '../layout/hex-grid';

/**
 * Scan border — a bright point sweeps clockwise around the perimeter,
 * leaving a fading trail. Like a radar sweep but confined to the border.
 * Four variants: single sweep, double opposing, pulsing trail, stutter-step.
 */
export class ScanBorderElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'scan-border',
    meta: {
      shape: 'rectangular',
      roles: ['structural', 'decorative', 'border'],
      moods: ['tactical', 'diagnostic'],
      bandAffinity: 'mid',
      sizes: ['works-small', 'needs-medium', 'needs-large'],
    },
  };

  private trailPoints!: THREE.Points;
  private trailCount: number = 0;
  private sweepT: number = 0;
  private sweepSpeed: number = 0;
  private variant: number = 0;

  private trailPoints2: THREE.Points | null = null;
  private sweepT2: number = 0;

  private borderOutline!: THREE.LineSegments;
  private isHex: boolean = false;
  private hexCorners: THREE.Vector3[] | null = null;
  private perimeterLength: number = 0;

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

    const presets = [
      { speed: 0.35, trail: 60, dotSize: 3.0 },   // single sweep
      { speed: 0.25, trail: 40, dotSize: 2.5 },   // double opposing
      { speed: 0.30, trail: 50, dotSize: 2.8 },   // pulsing trail
      { speed: 0.40, trail: 35, dotSize: 3.2 },   // stutter-step
    ];
    const p = presets[this.variant];
    this.sweepSpeed = p.speed + this.rng.float(-0.05, 0.05);
    this.trailCount = p.trail;

    // Dim static border outline
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

    // Trail points
    const cx = x + w / 2, cy = y + h / 2;
    const pos = new Float32Array(this.trailCount * 3);
    for (let i = 0; i < this.trailCount; i++) {
      pos[i * 3] = cx;
      pos[i * 3 + 1] = cy;
      pos[i * 3 + 2] = 0.5;
    }
    const colors = new Float32Array(this.trailCount * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.trailPoints = new THREE.Points(geo, new THREE.PointsMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0,
      size: Math.max(2, Math.min(w, h) * 0.012),
      sizeAttenuation: false,
    }));
    this.group.add(this.trailPoints);

    // Double opposing (variant 1)
    if (this.variant === 1) {
      this.sweepT2 = 0.5;
      const pos2 = new Float32Array(this.trailCount * 3);
      for (let i = 0; i < this.trailCount; i++) {
        pos2[i * 3] = cx;
        pos2[i * 3 + 1] = cy;
        pos2[i * 3 + 2] = 0.5;
      }
      const colors2 = new Float32Array(this.trailCount * 3);
      const geo2 = new THREE.BufferGeometry();
      geo2.setAttribute('position', new THREE.BufferAttribute(pos2, 3));
      geo2.setAttribute('color', new THREE.BufferAttribute(colors2, 3));
      this.trailPoints2 = new THREE.Points(geo2, new THREE.PointsMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0,
        size: Math.max(2, Math.min(w, h) * 0.01),
        sizeAttenuation: false,
      }));
      this.group.add(this.trailPoints2);
    }
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

  private updateTrail(points: THREE.Points, headT: number, opacity: number): void {
    const posAttr = points.geometry.getAttribute('position') as THREE.BufferAttribute;
    const colAttr = points.geometry.getAttribute('color') as THREE.BufferAttribute;
    const pr = this.palette.primary;
    const sr = this.palette.secondary;

    const trailLen = 0.15; // fraction of perimeter the trail covers

    for (let i = 0; i < this.trailCount; i++) {
      const frac = i / (this.trailCount - 1); // 0 = head, 1 = tail
      const t = ((headT - frac * trailLen) % 1 + 1) % 1;
      const pt = this.perimeterPoint(t);
      posAttr.setXYZ(i, pt.px, pt.py, 0.5);

      // Fade from primary (head) to secondary (tail), decreasing brightness
      const brightness = (1 - frac);
      const r = pr.r * (1 - frac) + sr.r * frac;
      const g = pr.g * (1 - frac) + sr.g * frac;
      const b = pr.b * (1 - frac) + sr.b * frac;
      colAttr.setXYZ(i, r * brightness, g * brightness, b * brightness);
    }
    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
    (points.material as THREE.PointsMaterial).opacity = opacity;
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);

    let speed = this.sweepSpeed;
    // Variant 3: stutter-step — periodic speed bursts
    if (this.variant === 3) {
      const phase = (time * 2) % 1;
      speed = phase < 0.3 ? this.sweepSpeed * 3 : this.sweepSpeed * 0.5;
    }

    this.sweepT = (this.sweepT + dt * speed) % 1;
    this.updateTrail(this.trailPoints, this.sweepT, opacity);

    // Variant 2: pulsing trail opacity
    let trailOpacity = opacity;
    if (this.variant === 2) {
      trailOpacity = opacity * (0.6 + 0.4 * Math.sin(time * 4));
    }
    (this.trailPoints.material as THREE.PointsMaterial).opacity = trailOpacity;

    if (this.trailPoints2) {
      this.sweepT2 = (this.sweepT2 + dt * speed) % 1;
      this.updateTrail(this.trailPoints2, this.sweepT2, opacity * 0.7);
    }

    (this.borderOutline.material as THREE.LineBasicMaterial).opacity = opacity * 0.15;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'pulse') {
      this.sweepSpeed *= 3;
      setTimeout(() => { this.sweepSpeed /= 3; }, 400);
    }
    if (action === 'glitch') {
      this.sweepT = this.rng.float(0, 1);
      if (this.trailPoints2) this.sweepT2 = this.rng.float(0, 1);
    }
    if (action === 'alert') {
      this.pulseTimer = 1.5;
      (this.trailPoints.material as THREE.PointsMaterial).color.copy(this.palette.alert);
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) return;
    this.sweepSpeed = (0.35 + level * 0.15);
  }
}
