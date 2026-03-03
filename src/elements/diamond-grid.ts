import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Diamond grid — a grid of rhombus/diamond shapes that animate individually.
 * Some filled, some outline only. Four variants: uniform, alternating sizes,
 * ripple animation, and random sparkle.
 */
export class DiamondGridElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'diamond-grid',
    meta: {
      shape: 'rectangular',
      roles: ['decorative', 'structural'],
      moods: ['ambient', 'tactical'],
      bandAffinity: 'high',
      sizes: ['works-small', 'needs-medium'],
    },
  };

  private outlines: THREE.LineLoop[] = [];
  private fills: THREE.Mesh[] = [];
  private phases: number[] = [];
  private baseScales: number[] = [];
  private fillAlphas: number[] = [];
  private isFilled: boolean[] = [];
  private centerXs: number[] = [];
  private centerYs: number[] = [];

  private variant: number = 0;
  private sparkleTimers: number[] = [];
  private alertActive: boolean = false;

  build(): void {
    this.variant = this.rng.int(0, 3);
    const { x, y, w, h } = this.px;

    const clipPlanes = [
      new THREE.Plane(new THREE.Vector3(1, 0, 0), -x),
      new THREE.Plane(new THREE.Vector3(-1, 0, 0), x + w),
      new THREE.Plane(new THREE.Vector3(0, 1, 0), -y),
      new THREE.Plane(new THREE.Vector3(0, -1, 0), y + h),
    ];

    const presets = [
      { cols: 6, rows: 5, sizeMin: 0.85, sizeMax: 0.85, fillChance: 0.4, rotSpeed: 0.3 },   // uniform
      { cols: 5, rows: 4, sizeMin: 0.5, sizeMax: 1.0, fillChance: 0.5, rotSpeed: 0.2 },      // alternating
      { cols: 6, rows: 5, sizeMin: 0.8, sizeMax: 0.9, fillChance: 0.35, rotSpeed: 0.15 },    // ripple
      { cols: 7, rows: 6, sizeMin: 0.6, sizeMax: 1.0, fillChance: 0.3, rotSpeed: 0.4 },      // sparkle
    ];
    const p = presets[this.variant];

    const cellW = w / p.cols;
    const cellH = h / p.rows;
    const baseR = Math.min(cellW, cellH) * 0.42;

    for (let row = 0; row < p.rows; row++) {
      for (let col = 0; col < p.cols; col++) {
        const cx = x + (col + 0.5) * cellW;
        const cy = y + (row + 0.5) * cellH;

        // Scale varies by variant
        let scale: number;
        if (this.variant === 1) {
          // Alternating: checkerboard of large/small
          scale = ((row + col) % 2 === 0) ? 1.0 : 0.55;
        } else {
          scale = this.rng.float(p.sizeMin, p.sizeMax);
        }
        const r = baseR * scale;
        this.baseScales.push(scale);
        this.centerXs.push(cx);
        this.centerYs.push(cy);

        // Diamond vertices: top, right, bottom, left
        const verts = [
          cx, cy - r,
          cx + r, cy,
          cx, cy + r,
          cx - r, cy,
        ];

        // Outline (LineLoop)
        const outlineVerts = new Float32Array([
          verts[0], verts[1], 0.5,
          verts[2], verts[3], 0.5,
          verts[4], verts[5], 0.5,
          verts[6], verts[7], 0.5,
          verts[0], verts[1], 0.5, // close
        ]);
        const outlineGeo = new THREE.BufferGeometry();
        outlineGeo.setAttribute('position', new THREE.Float32BufferAttribute(outlineVerts, 3));
        const outline = new THREE.LineLoop(outlineGeo, new THREE.LineBasicMaterial({
          color: this.palette.primary,
          transparent: true,
          opacity: 0,
          clippingPlanes: clipPlanes,
        }));
        this.outlines.push(outline);
        this.group.add(outline);

        // Fill shape
        const shape = new THREE.Shape();
        shape.moveTo(cx, cy - r);
        shape.lineTo(cx + r, cy);
        shape.lineTo(cx, cy + r);
        shape.lineTo(cx - r, cy);
        shape.closePath();
        const fillGeo = new THREE.ShapeGeometry(shape);
        const filled = this.rng.chance(p.fillChance);
        this.isFilled.push(filled);
        const fillAlpha = filled ? this.rng.float(0.08, 0.3) : 0;
        this.fillAlphas.push(fillAlpha);

        const fillColor = this.rng.chance(0.2) ? this.palette.secondary : this.palette.primary;
        const fill = new THREE.Mesh(fillGeo, new THREE.MeshBasicMaterial({
          color: fillColor,
          transparent: true,
          opacity: 0,
          clippingPlanes: clipPlanes,
        }));
        fill.position.z = 0.2;
        this.fills.push(fill);
        this.group.add(fill);

        // Phase for animation — staggered per cell
        this.phases.push(this.rng.float(0, Math.PI * 2));
        this.sparkleTimers.push(0);
      }
    }
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    const count = this.outlines.length;
    const variant = this.variant;

    for (let i = 0; i < count; i++) {
      const cx = this.centerXs[i];
      const cy = this.centerYs[i];
      const phase = this.phases[i];
      const base = this.baseScales[i];

      let scaleAnim = base;
      let outlineAlpha = 0.6;
      let fillAlpha = this.fillAlphas[i];

      if (variant === 0) {
        // Uniform: all slowly pulse together with slight individual offset
        const pulse = 1 + Math.sin(time * 0.8 + phase * 0.3) * 0.06;
        scaleAnim = base * pulse;

      } else if (variant === 1) {
        // Alternating: large and small breathe out-of-phase
        const dir = ((i % 2) === 0) ? 1 : -1;
        const pulse = 1 + Math.sin(time * 0.6 + phase * 0.5) * dir * 0.08;
        scaleAnim = base * pulse;

      } else if (variant === 2) {
        // Ripple: wave emanates from center
        const { w, h, x, y } = this.px;
        const distX = (cx - (x + w / 2)) / w;
        const distY = (cy - (y + h / 2)) / h;
        const dist = Math.sqrt(distX * distX + distY * distY);
        const ripple = Math.sin(time * 2.5 - dist * 12) * 0.5 + 0.5;
        scaleAnim = base * (0.85 + ripple * 0.3);
        outlineAlpha = 0.3 + ripple * 0.7;
        fillAlpha = this.fillAlphas[i] * (0.5 + ripple * 0.8);

      } else {
        // Sparkle: random cells flash brightly then fade
        this.sparkleTimers[i] -= dt;
        if (this.sparkleTimers[i] <= 0) {
          this.sparkleTimers[i] = this.rng.float(0.5, 4.0);
          if (this.rng.chance(0.3)) {
            this.sparkleTimers[i] = 0.15 + this.rng.float(0, 0.3);
          }
        }
        const sparkle = Math.max(0, 1 - this.sparkleTimers[i] * 5);
        const normalPulse = 0.7 + Math.sin(time * 0.5 + phase) * 0.15;
        scaleAnim = base * (normalPulse + sparkle * 0.4);
        outlineAlpha = normalPulse * 0.5 + sparkle * 0.9;
        fillAlpha = this.fillAlphas[i] + sparkle * 0.6;
      }

      // Apply scale by rebuilding pivot-based transform
      const outline = this.outlines[i];
      outline.position.set(cx, cy, 0);
      outline.scale.set(scaleAnim / (this.baseScales[i] || 1), scaleAnim / (this.baseScales[i] || 1), 1);
      outline.position.set(0, 0, 0); // reset — we scale the geometry not the object

      // Actually scale via the mesh position (diamond is built around cx/cy already)
      // Use a subtle rotation for the rotating variant feel
      const rotAmt = variant === 0 ? Math.sin(time * 0.15 + phase) * 0.12
                   : variant === 1 ? Math.sin(time * 0.1 + phase * 0.7) * 0.2
                   : 0;
      outline.rotation.z = rotAmt;
      this.fills[i].rotation.z = rotAmt;

      // Opacity
      (outline.material as THREE.LineBasicMaterial).opacity = opacity * outlineAlpha;
      (this.fills[i].material as THREE.MeshBasicMaterial).opacity =
        this.isFilled[i] ? opacity * Math.min(1, fillAlpha) : 0;
    }
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'alert') {
      this.alertActive = true;
      this.pulseTimer = 2.0;
      for (let i = 0; i < this.outlines.length; i++) {
        if (this.rng.chance(0.5)) {
          (this.outlines[i].material as THREE.LineBasicMaterial).color.copy(this.palette.alert);
          (this.fills[i].material as THREE.MeshBasicMaterial).color.copy(this.palette.alert);
        }
      }
    }
    if (action === 'glitch') {
      for (let i = 0; i < this.sparkleTimers.length; i++) {
        this.sparkleTimers[i] = this.rng.float(0, 0.2);
      }
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) return;
    if (level >= 4) {
      // Mass sparkle trigger
      for (let i = 0; i < this.sparkleTimers.length; i++) {
        if (this.rng.chance(0.6)) {
          this.sparkleTimers[i] = 0;
        }
      }
    } else if (level >= 2) {
      for (let i = 0; i < this.sparkleTimers.length; i++) {
        if (this.rng.chance(0.25)) {
          this.sparkleTimers[i] = 0;
        }
      }
    }
  }
}
