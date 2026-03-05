import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Ford circles — for each fraction p/q in lowest terms, draw a circle
 * of radius 1/(2q^2) tangent to the x-axis at p/q. Tangent circles
 * reveal Farey sequence structure. Rendered as LineSegments circle outlines.
 */
export class FordCirclesElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'ford-circles',
    meta: {
      shape: 'rectangular',
      roles: ['data-display', 'decorative'],
      moods: ['diagnostic', 'ambient'],
      bandAffinity: 'sub',
      sizes: ['needs-medium', 'needs-large'],
    },
  };

  private circles!: THREE.LineSegments;
  private circlesMat!: THREE.LineBasicMaterial;
  private axisMat!: THREE.LineBasicMaterial;
  private maxQ = 20;
  private circleRes = 32;
  private animTimer = 0;
  private currentMaxQ = 2;
  private levelDuration = 2.0;
  private ascending = true;
  private panSpeed = 0.05;
  private viewCenter = 0.5;
  private viewWidth = 1.2;

  build(): void {
    this.glitchAmount = 4;
    const variant = this.rng.int(0, 4);
    const presets = [
      { maxQ: 20, circleRes: 32, levelDuration: 2.0, panSpeed: 0.05, viewWidth: 1.2 },
      { maxQ: 30, circleRes: 48, levelDuration: 3.0, panSpeed: 0.03, viewWidth: 1.0 },
      { maxQ: 15, circleRes: 24, levelDuration: 1.5, panSpeed: 0.08, viewWidth: 1.5 },
      { maxQ: 25, circleRes: 40, levelDuration: 2.5, panSpeed: 0.04, viewWidth: 0.8 },
    ];
    const p = presets[variant];
    this.maxQ = p.maxQ;
    this.circleRes = p.circleRes;
    this.levelDuration = p.levelDuration;
    this.panSpeed = p.panSpeed;
    this.viewWidth = p.viewWidth;

    // Estimate max circle count: sum of euler totient up to maxQ
    const maxCircles = this.maxQ * this.maxQ;
    const vertsPerCircle = this.circleRes * 2; // LineSegments pairs
    const totalVerts = maxCircles * vertsPerCircle + 4; // +4 for axis line
    const positions = new Float32Array(totalVerts * 3);
    const { x, y, w, h } = this.px;
    // Fill with region center
    for (let i = 0; i < totalVerts; i++) {
      positions[i * 3] = x + w / 2;
      positions[i * 3 + 1] = y + h / 2;
      positions[i * 3 + 2] = 0;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setDrawRange(0, 0);
    this.circlesMat = new THREE.LineBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
    });
    this.circles = new THREE.LineSegments(geo, this.circlesMat);
    this.group.add(this.circles);

    // Axis line
    const axisVerts = new Float32Array([
      x, y + h - 2, 0,
      x + w, y + h - 2, 0,
    ]);
    const axisGeo = new THREE.BufferGeometry();
    axisGeo.setAttribute('position', new THREE.BufferAttribute(axisVerts, 3));
    this.axisMat = new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    });
    this.group.add(new THREE.LineSegments(axisGeo, this.axisMat));
  }

  /** GCD for coprime check */
  private gcd(a: number, b: number): number {
    while (b) { const t = b; b = a % t; a = t; }
    return a;
  }

  /** Generate Ford circles and write to buffer */
  private generateCircles(maxQ: number, time: number): number {
    const { x, y, w, h } = this.px;
    const pos = this.circles.geometry.getAttribute('position') as THREE.BufferAttribute;
    let vi = 0;

    // Viewport mapping: fractions in [viewCenter - viewWidth/2, viewCenter + viewWidth/2]
    const pan = Math.sin(time * this.panSpeed) * 0.3;
    const left = this.viewCenter + pan - this.viewWidth / 2;
    const right = this.viewCenter + pan + this.viewWidth / 2;

    const mapX = (frac: number): number => {
      return x + ((frac - left) / (right - left)) * w;
    };

    // Scale radius to screen — largest circle (q=1, radius=0.5) must fit in region height
    const scaleR = Math.max(1, h - 4);

    const maxVerts = pos.count;

    for (let q = 1; q <= maxQ; q++) {
      for (let p = 0; p <= q; p++) {
        if (this.gcd(p, q) !== 1) continue;

        const frac = p / q;
        if (frac < left - 0.1 || frac > right + 0.1) continue;

        const radius = 1 / (2 * q * q);
        const screenX = mapX(frac);
        const screenR = radius * scaleR;

        // Skip tiny circles
        if (screenR < 0.5) continue;

        const cy = y + h - 2 - screenR;

        // Skip circles entirely outside tile bounds
        if (screenX + screenR < x || screenX - screenR > x + w ||
            cy + screenR < y || cy - screenR > y + h) continue;

        // Draw circle as line segments, clamping vertices to tile bounds
        for (let s = 0; s < this.circleRes; s++) {
          if (vi + 2 > maxVerts) break;
          const a1 = (s / this.circleRes) * Math.PI * 2;
          const a2 = ((s + 1) / this.circleRes) * Math.PI * 2;
          const vx1 = Math.max(x, Math.min(x + w, screenX + Math.cos(a1) * screenR));
          const vy1 = Math.max(y, Math.min(y + h, cy + Math.sin(a1) * screenR));
          const vx2 = Math.max(x, Math.min(x + w, screenX + Math.cos(a2) * screenR));
          const vy2 = Math.max(y, Math.min(y + h, cy + Math.sin(a2) * screenR));
          pos.setXYZ(vi++, vx1, vy1, 0);
          pos.setXYZ(vi++, vx2, vy2, 0);
        }
      }
    }

    pos.needsUpdate = true;
    return vi;
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);

    this.animTimer += dt;
    if (this.animTimer >= this.levelDuration) {
      this.animTimer = 0;
      if (this.ascending) {
        this.currentMaxQ++;
        if (this.currentMaxQ >= this.maxQ) this.ascending = false;
      } else {
        this.currentMaxQ--;
        if (this.currentMaxQ <= 2) this.ascending = true;
      }
    }

    const vertCount = this.generateCircles(this.currentMaxQ, time);
    this.circles.geometry.setDrawRange(0, vertCount);

    // Color circles by size: smaller q = brighter
    const colorLerp = Math.sin(time * 0.3) * 0.1;
    const col = new THREE.Color().copy(this.palette.primary);
    col.lerp(this.palette.secondary, 0.3 + colorLerp);
    this.circlesMat.color.copy(col);
    this.circlesMat.opacity = opacity * 0.7;
    this.axisMat.opacity = opacity * 0.4;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      this.currentMaxQ = this.rng.int(2, this.maxQ);
      this.viewCenter = this.rng.float(0.2, 0.8);
      this.animTimer = 0;
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level >= 2) {
      this.panSpeed = 0.05 + level * 0.02;
    }
    if (level === 0) {
      this.panSpeed = 0.05;
    }
  }
}
