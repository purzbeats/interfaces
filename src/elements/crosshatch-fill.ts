import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Crosshatch fill — animated diagonal line sets that drift and breathe across
 * the region. Variants include single-direction, cross-hatch, triple-hatch,
 * and variable-density patterns.
 */
export class CrosshatchFillElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'crosshatch-fill',
    meta: {
      shape: 'rectangular',
      roles: ['decorative', 'structural'],
      moods: ['ambient', 'tactical'],
      bandAffinity: 'mid',
      sizes: ['works-small', 'needs-medium', 'needs-large'],
    },
  };

  private hatchSets: Array<{
    lines: THREE.LineSegments;
    angle: number;
    driftSpeed: number;
    driftOffset: number;
    driftRange: number;
    baseOpacity: number;
  }> = [];

  private borderLines!: THREE.LineSegments;
  private variant: number = 0;
  private spacing: number = 0;
  private breatheSpeed: number = 0;
  private rotateSpeed: number = 0;
  private rotating: boolean = false;

  build(): void {
    this.variant = this.rng.int(0, 3);
    const { x, y, w, h } = this.px;

    const presets = [
      // Variant 0: Single diagonal direction, slow drift
      { angles: [Math.PI / 4], spacingRange: [10, 20] as const, driftSpeed: 0.3, driftRange: 1.0, breatheSpeed: 0.6, rotate: false, opacities: [0.7] },
      // Variant 1: Cross-hatch (two directions), moderate drift
      { angles: [Math.PI / 4, -Math.PI / 4], spacingRange: [12, 22] as const, driftSpeed: 0.5, driftRange: 0.7, breatheSpeed: 0.9, rotate: false, opacities: [0.6, 0.5] },
      // Variant 2: Triple-hatch (three directions), fast drift
      { angles: [Math.PI / 6, Math.PI / 2, -Math.PI / 6], spacingRange: [14, 28] as const, driftSpeed: 0.8, driftRange: 0.5, breatheSpeed: 1.2, rotate: false, opacities: [0.55, 0.45, 0.5] },
      // Variant 3: Slowly rotating single hatch, varying density
      { angles: [0], spacingRange: [8, 18] as const, driftSpeed: 0.2, driftRange: 1.2, breatheSpeed: 0.4, rotate: true, opacities: [0.75] },
    ];

    const p = presets[this.variant];
    this.spacing = this.rng.float(p.spacingRange[0], p.spacingRange[1]);
    this.breatheSpeed = p.breatheSpeed + this.rng.float(-0.1, 0.1);
    this.rotateSpeed = this.rng.float(0.08, 0.18);
    this.rotating = p.rotate;

    const clipPlanes = [
      new THREE.Plane(new THREE.Vector3(1, 0, 0), -x),       // left
      new THREE.Plane(new THREE.Vector3(-1, 0, 0), x + w),   // right
      new THREE.Plane(new THREE.Vector3(0, 1, 0), -y),       // bottom
      new THREE.Plane(new THREE.Vector3(0, -1, 0), y + h),   // top
    ];

    // Build each hatch set
    for (let si = 0; si < p.angles.length; si++) {
      const angle = p.angles[si] + this.rng.float(-0.05, 0.05);
      const baseOpacity = p.opacities[si];
      const driftSpeed = p.driftSpeed + this.rng.float(-0.1, 0.1);
      const driftOffset = this.rng.float(0, Math.PI * 2);

      const geo = new THREE.BufferGeometry();
      const verts = this.buildHatchVerts(x, y, w, h, angle, this.spacing, 0);
      geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));

      const mat = new THREE.LineBasicMaterial({
        color: si === 0 ? this.palette.primary : this.palette.secondary,
        transparent: true,
        opacity: 0,
        clippingPlanes: clipPlanes,
      });
      const lines = new THREE.LineSegments(geo, mat);
      this.group.add(lines);

      this.hatchSets.push({
        lines,
        angle,
        driftSpeed,
        driftOffset,
        driftRange: p.driftRange,
        baseOpacity,
      });
    }

    // Dim border outline
    const bv = new Float32Array([
      x, y, 0, x + w, y, 0,
      x + w, y, 0, x + w, y + h, 0,
      x + w, y + h, 0, x, y + h, 0,
      x, y + h, 0, x, y, 0,
    ]);
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.BufferAttribute(bv, 3));
    this.borderLines = new THREE.LineSegments(bg, new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
      clippingPlanes: clipPlanes,
    }));
    this.group.add(this.borderLines);
  }

  /** Build hatch line vertices for a given angle, spacing, and drift offset (in spacing units). */
  private buildHatchVerts(
    x: number, y: number, w: number, h: number,
    angle: number, spacing: number, drift: number
  ): number[] {
    const verts: number[] = [];
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const diag = Math.sqrt(w * w + h * h);
    const cx = x + w / 2;
    const cy = y + h / 2;

    // Number of lines to cover the diagonal
    const count = Math.ceil(diag / spacing) + 2;
    const start = -count / 2;

    for (let i = Math.floor(start); i <= -start; i++) {
      const offset = (i + drift) * spacing;
      // Perpendicular to the angle
      const px = cx + (-sin) * offset;
      const py = cy + cos * offset;

      // Extend the line across the full diagonal
      const halfLen = diag;
      const x1 = px + cos * (-halfLen);
      const y1 = py + sin * (-halfLen);
      const x2 = px + cos * halfLen;
      const y2 = py + sin * halfLen;

      // Clip to region bounds (simple clipping by extending and accepting segment)
      // We'll let the GPU clip naturally since we just need coverage
      verts.push(x1, y1, 0, x2, y2, 0);
    }
    return verts;
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    const { x, y, w, h } = this.px;

    for (let si = 0; si < this.hatchSets.length; si++) {
      const set = this.hatchSets[si];
      const mat = set.lines.material as THREE.LineBasicMaterial;

      // Compute drift
      const drift = Math.sin(time * set.driftSpeed + set.driftOffset) * set.driftRange;

      // Update angle if rotating
      const angle = this.rotating
        ? set.angle + time * this.rotateSpeed
        : set.angle;

      // Rebuild geometry with new drift and angle
      const newVerts = this.buildHatchVerts(x, y, w, h, angle, this.spacing, drift);
      const posAttr = set.lines.geometry.getAttribute('position') as THREE.BufferAttribute;

      // Check if vertex count changed (shouldn't normally, but be safe)
      if (posAttr.count * 3 !== newVerts.length) {
        set.lines.geometry.setAttribute(
          'position', new THREE.Float32BufferAttribute(newVerts, 3)
        );
      } else {
        posAttr.set(newVerts);
        posAttr.needsUpdate = true;
      }

      // Breathe opacity
      const breathe = 0.5 + 0.5 * Math.sin(time * this.breatheSpeed + si * Math.PI / 2);
      const variantModulation = this.variant === 2
        ? 0.5 + 0.5 * Math.sin(time * this.breatheSpeed * 0.7 + si * 2.1)
        : 1;

      mat.opacity = opacity * set.baseOpacity * (0.6 + 0.4 * breathe) * variantModulation;
    }

    // Border
    (this.borderLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.35;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'pulse') {
      for (const set of this.hatchSets) {
        (set.lines.material as THREE.LineBasicMaterial).color.copy(this.palette.secondary);
      }
      setTimeout(() => {
        for (let si = 0; si < this.hatchSets.length; si++) {
          (this.hatchSets[si].lines.material as THREE.LineBasicMaterial).color.copy(
            si === 0 ? this.palette.primary : this.palette.secondary
          );
        }
      }, 400);
    }
    if (action === 'alert') {
      for (const set of this.hatchSets) {
        (set.lines.material as THREE.LineBasicMaterial).color.copy(this.palette.alert);
      }
    }
    if (action === 'glitch') {
      for (const set of this.hatchSets) {
        set.driftOffset += this.rng.float(Math.PI, Math.PI * 2);
      }
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) return;
    // Increase drift speed temporarily by nudging offsets
    for (const set of this.hatchSets) {
      set.driftOffset += level * 0.3;
    }
  }
}
