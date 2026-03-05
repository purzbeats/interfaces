import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * De Casteljau algorithm animation. 4-6 control points with recursive
 * linear interpolation steps visible. Animated parameter t sweeps 0->1,
 * showing intermediate construction lines and the traced curve.
 */
export class BezierConstructElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'bezier-construct',
    meta: {
      shape: 'rectangular',
      roles: ['data-display', 'decorative'],
      moods: ['diagnostic', 'ambient'],
      bandAffinity: 'mid',
      sizes: ['needs-medium', 'needs-large'],
    },
  };

  private controlPoints: Array<{ x: number; y: number }> = [];
  private numPoints: number = 5;
  private tSpeed: number = 0.3;
  private tParam: number = 0;
  private traceCount: number = 0;
  private maxTrace: number = 200;

  // Geometry objects
  private controlLine!: THREE.Line;
  private controlDots!: THREE.Points;
  private interpLines: THREE.LineSegments[] = [];
  private interpDots: THREE.Points[] = [];
  private traceLine!: THREE.Line;
  private tracePositions!: Float32Array;
  private cursorDot!: THREE.Points;

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;
    const variant = this.rng.int(0, 3);
    const presets = [
      { numPoints: 4, tSpeed: 0.25, maxTrace: 200 },
      { numPoints: 5, tSpeed: 0.20, maxTrace: 300 },
      { numPoints: 6, tSpeed: 0.15, maxTrace: 400 },
      { numPoints: 4, tSpeed: 0.40, maxTrace: 150 },
    ];
    const p = presets[variant];
    this.numPoints = p.numPoints;
    this.tSpeed = p.tSpeed;
    this.maxTrace = p.maxTrace;

    // Generate control points within region
    const padX = w * 0.08;
    const padY = h * 0.08;
    for (let i = 0; i < this.numPoints; i++) {
      this.controlPoints.push({
        x: x + padX + this.rng.float(0, w - padX * 2),
        y: y + padY + this.rng.float(0, h - padY * 2),
      });
    }

    // Control polygon line
    const ctrlPos = new Float32Array(this.numPoints * 3);
    for (let i = 0; i < this.numPoints; i++) {
      ctrlPos[i * 3] = this.controlPoints[i].x;
      ctrlPos[i * 3 + 1] = this.controlPoints[i].y;
      ctrlPos[i * 3 + 2] = 0;
    }
    const ctrlGeo = new THREE.BufferGeometry();
    ctrlGeo.setAttribute('position', new THREE.BufferAttribute(ctrlPos, 3));
    this.controlLine = new THREE.Line(ctrlGeo, new THREE.LineBasicMaterial({
      color: this.palette.dim, transparent: true, opacity: 0,
    }));
    this.group.add(this.controlLine);

    // Control point dots
    const dotGeo = new THREE.BufferGeometry();
    dotGeo.setAttribute('position', new THREE.BufferAttribute(ctrlPos.slice(), 3));
    this.controlDots = new THREE.Points(dotGeo, new THREE.PointsMaterial({
      color: this.palette.secondary, size: Math.max(1, Math.min(w, h) * 0.016), transparent: true, opacity: 0, sizeAttenuation: false,
    }));
    this.group.add(this.controlDots);

    // Intermediate interpolation lines for each level
    for (let level = 0; level < this.numPoints - 1; level++) {
      const segCount = this.numPoints - 1 - level;
      const segPos = new Float32Array(segCount * 2 * 3);
      for (let s = 0; s < segCount; s++) {
        const cp = this.controlPoints[Math.min(s, this.numPoints - 1)];
        segPos[s * 6] = segPos[s * 6 + 3] = cp.x;
        segPos[s * 6 + 1] = segPos[s * 6 + 4] = cp.y;
      }
      const segGeo = new THREE.BufferGeometry();
      segGeo.setAttribute('position', new THREE.BufferAttribute(segPos, 3));
      const t = level / Math.max(this.numPoints - 2, 1);
      const col = new THREE.Color().copy(this.palette.dim).lerp(this.palette.primary, t);
      const line = new THREE.LineSegments(segGeo, new THREE.LineBasicMaterial({
        color: col, transparent: true, opacity: 0,
      }));
      this.group.add(line);
      this.interpLines.push(line);

      // Dots for interpolated points at this level
      const dotCount = this.numPoints - level;
      const dPos = new Float32Array(dotCount * 3);
      for (let d = 0; d < dotCount; d++) {
        const cp = this.controlPoints[Math.min(d, this.numPoints - 1)];
        dPos[d * 3] = cp.x;
        dPos[d * 3 + 1] = cp.y;
        dPos[d * 3 + 2] = 1;
      }
      const dGeo = new THREE.BufferGeometry();
      dGeo.setAttribute('position', new THREE.BufferAttribute(dPos, 3));
      const dots = new THREE.Points(dGeo, new THREE.PointsMaterial({
        color: col, size: Math.max(1, Math.min(w, h) * 0.01), transparent: true, opacity: 0, sizeAttenuation: false,
      }));
      this.group.add(dots);
      this.interpDots.push(dots);
    }

    // Traced Bezier curve
    this.tracePositions = new Float32Array(this.maxTrace * 3);
    const cp0 = this.controlPoints[0];
    for (let i = 0; i < this.maxTrace; i++) {
      this.tracePositions[i * 3] = cp0.x;
      this.tracePositions[i * 3 + 1] = cp0.y;
      this.tracePositions[i * 3 + 2] = 1;
    }
    const traceGeo = new THREE.BufferGeometry();
    traceGeo.setAttribute('position', new THREE.BufferAttribute(this.tracePositions, 3));
    traceGeo.setDrawRange(0, 0);
    this.traceLine = new THREE.Line(traceGeo, new THREE.LineBasicMaterial({
      color: this.palette.primary, transparent: true, opacity: 0,
    }));
    this.group.add(this.traceLine);

    // Cursor dot on the curve
    const cursorPos = new Float32Array(3);
    cursorPos[0] = cp0.x;
    cursorPos[1] = cp0.y;
    cursorPos[2] = 2;
    const cursorGeo = new THREE.BufferGeometry();
    cursorGeo.setAttribute('position', new THREE.BufferAttribute(cursorPos, 3));
    this.cursorDot = new THREE.Points(cursorGeo, new THREE.PointsMaterial({
      color: this.palette.primary, size: Math.max(1, Math.min(w, h) * 0.023), transparent: true, opacity: 0, sizeAttenuation: false,
    }));
    this.group.add(this.cursorDot);
  }

  /** De Casteljau: returns all intermediate points for a given t */
  private deCasteljau(t: number): number[][] {
    const levels: number[][] = [];
    // Level 0 = control points
    let current: number[] = [];
    for (const cp of this.controlPoints) {
      current.push(cp.x, cp.y);
    }
    levels.push(current);
    const n = this.controlPoints.length;
    for (let level = 1; level < n; level++) {
      const prev = levels[level - 1];
      const next: number[] = [];
      const count = n - level;
      for (let i = 0; i < count; i++) {
        const x0 = prev[i * 2], y0 = prev[i * 2 + 1];
        const x1 = prev[(i + 1) * 2], y1 = prev[(i + 1) * 2 + 1];
        next.push(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t);
      }
      levels.push(next);
    }
    return levels;
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);
    this.tParam += dt * this.tSpeed;
    if (this.tParam >= 1) {
      this.tParam = 0;
      this.traceCount = 0;
    }

    const t = this.tParam;
    const levels = this.deCasteljau(t);

    // Update interpolation lines and dots
    for (let level = 0; level < this.numPoints - 1; level++) {
      const pts = levels[level];
      const count = pts.length / 2;

      // Update dots
      const dotAttr = this.interpDots[level].geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < count; i++) {
        dotAttr.setXYZ(i, pts[i * 2], pts[i * 2 + 1], 1);
      }
      dotAttr.needsUpdate = true;
      (this.interpDots[level].material as THREE.PointsMaterial).opacity = opacity * 0.5;

      // Update line segments (pairs)
      if (level > 0) {
        const segAttr = this.interpLines[level - 1].geometry.getAttribute('position') as THREE.BufferAttribute;
        for (let i = 0; i < count - 1; i++) {
          segAttr.setXYZ(i * 2, pts[i * 2], pts[i * 2 + 1], 0);
          segAttr.setXYZ(i * 2 + 1, pts[(i + 1) * 2], pts[(i + 1) * 2 + 1], 0);
        }
        segAttr.needsUpdate = true;
        (this.interpLines[level - 1].material as THREE.LineBasicMaterial).opacity = opacity * 0.35;
      }
    }

    // Final point on curve
    const finalPt = levels[levels.length - 1];
    const fx = finalPt[0], fy = finalPt[1];

    // Update cursor
    const cursorAttr = this.cursorDot.geometry.getAttribute('position') as THREE.BufferAttribute;
    cursorAttr.setXYZ(0, fx, fy, 2);
    cursorAttr.needsUpdate = true;
    (this.cursorDot.material as THREE.PointsMaterial).opacity = opacity;

    // Append to trace
    if (this.traceCount < this.maxTrace) {
      this.tracePositions[this.traceCount * 3] = fx;
      this.tracePositions[this.traceCount * 3 + 1] = fy;
      this.tracePositions[this.traceCount * 3 + 2] = 1;
      this.traceCount++;
      this.traceLine.geometry.setDrawRange(0, this.traceCount);
      (this.traceLine.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    }

    // Material opacities
    (this.controlLine.material as THREE.LineBasicMaterial).opacity = opacity * 0.3;
    (this.controlDots.material as THREE.PointsMaterial).opacity = opacity * 0.6;
    (this.traceLine.material as THREE.LineBasicMaterial).opacity = opacity * 0.9;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Perturb control points
      for (const cp of this.controlPoints) {
        cp.x += this.rng.float(-8, 8);
        cp.y += this.rng.float(-8, 8);
      }
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) return;
    this.tSpeed = 0.2 + level * 0.08;
  }
}
