import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Koch snowflake fractal that builds iteration by iteration. Each level
 * subdivides edges into the classic pattern. The fractal builds up over
 * time and then resets, with optional rotation.
 */
export class KochSnowflakeElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'koch-snowflake',
    meta: {
      shape: 'radial',
      roles: ['decorative'],
      moods: ['ambient'],
      sizes: ['needs-medium', 'needs-large'],
    } satisfies ElementMeta,
  };

  private lines: THREE.Line[] = [];
  private lineMats: THREE.LineBasicMaterial[] = [];
  private borderLines!: THREE.LineSegments;
  private borderMat!: THREE.LineBasicMaterial;

  private cx: number = 0;
  private cy: number = 0;
  private radius: number = 0;
  private maxIterations: number = 0;
  private currentIteration: number = 0;
  private buildTime: number = 0;
  private iterationDuration: number = 0;
  private rotSpeed: number = 0;
  private pauseDuration: number = 0;
  private timer: number = 0;
  private phase: 'building' | 'pausing' = 'building';
  private intensityLevel: number = 0;

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;
    this.cx = x + w / 2;
    this.cy = y + h / 2;
    this.radius = Math.min(w, h) * 0.4;

    const variant = this.rng.int(0, 3);
    const presets = [
      { maxIter: 5, iterDur: 1.5, rot: 0.1, pause: 2.0 },
      { maxIter: 6, iterDur: 1.0, rot: 0.05, pause: 3.0 },
      { maxIter: 4, iterDur: 2.0, rot: 0.2, pause: 1.5 },
      { maxIter: 5, iterDur: 1.2, rot: -0.08, pause: 2.5 },
    ];
    const p = presets[variant];
    this.maxIterations = p.maxIter;
    this.iterationDuration = p.iterDur;
    this.rotSpeed = p.rot;
    this.pauseDuration = p.pause;

    // Pre-create line objects for each iteration level
    for (let i = 0; i <= this.maxIterations; i++) {
      const maxPts = 3 * Math.pow(4, i) + 1;
      const positions = new Float32Array(maxPts * 3);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geo.setDrawRange(0, 0);
      const color = new THREE.Color().copy(this.palette.dim).lerp(
        this.palette.primary, i / this.maxIterations,
      );
      const mat = new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity: 0,
      });
      const line = new THREE.Line(geo, mat);
      this.group.add(line);
      this.lines.push(line);
      this.lineMats.push(mat);
    }

    // Border
    const bv = new Float32Array([
      x, y, 0, x + w, y, 0, x + w, y, 0, x + w, y + h, 0,
      x + w, y + h, 0, x, y + h, 0, x, y + h, 0, x, y, 0,
    ]);
    const bGeo = new THREE.BufferGeometry();
    bGeo.setAttribute('position', new THREE.BufferAttribute(bv, 3));
    this.borderMat = new THREE.LineBasicMaterial({
      color: this.palette.dim, transparent: true, opacity: 0,
    });
    this.borderLines = new THREE.LineSegments(bGeo, this.borderMat);
    this.group.add(this.borderLines);

    // Build initial triangle
    this.rebuildLevel(0, 0);
  }

  private kochSubdivide(points: { x: number; y: number }[]): { x: number; y: number }[] {
    const result: { x: number; y: number }[] = [];
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      // One-third points
      const p1 = { x: a.x + dx / 3, y: a.y + dy / 3 };
      const p2 = { x: a.x + dx * 2 / 3, y: a.y + dy * 2 / 3 };
      // Peak of equilateral triangle
      const cos60 = Math.cos(-Math.PI / 3);
      const sin60 = Math.sin(-Math.PI / 3);
      const pdx = dx / 3;
      const pdy = dy / 3;
      const peak = {
        x: p1.x + pdx * cos60 - pdy * sin60,
        y: p1.y + pdx * sin60 + pdy * cos60,
      };
      result.push(a, p1, peak, p2);
    }
    result.push(points[points.length - 1]);
    return result;
  }

  private rebuildLevel(level: number, rotation: number): void {
    // Start with equilateral triangle
    let points: { x: number; y: number }[] = [];
    for (let i = 0; i <= 3; i++) {
      const angle = (i / 3) * Math.PI * 2 - Math.PI / 2 + rotation;
      points.push({
        x: this.cx + Math.cos(angle) * this.radius,
        y: this.cy + Math.sin(angle) * this.radius,
      });
    }

    // Subdivide up to level
    for (let iter = 0; iter < level; iter++) {
      points = this.kochSubdivide(points);
    }

    // Write to geometry
    const pos = this.lines[level].geometry.getAttribute('position') as THREE.BufferAttribute;
    const count = Math.min(points.length, pos.count);
    for (let i = 0; i < count; i++) {
      pos.setXYZ(i, points[i].x, points[i].y, 0);
    }
    pos.needsUpdate = true;
    this.lines[level].geometry.setDrawRange(0, count);
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    this.timer += dt;
    const rotation = time * this.rotSpeed;

    if (this.phase === 'building') {
      const targetIter = Math.min(
        Math.floor(this.timer / this.iterationDuration),
        this.maxIterations,
      );

      if (targetIter > this.currentIteration) {
        this.currentIteration = targetIter;
        this.rebuildLevel(this.currentIteration, rotation);
      }

      if (this.currentIteration >= this.maxIterations) {
        this.phase = 'pausing';
        this.timer = 0;
      }
    } else {
      if (this.timer >= this.pauseDuration) {
        this.phase = 'building';
        this.timer = 0;
        this.currentIteration = 0;
        this.rebuildLevel(0, rotation);
      }
    }

    // Rebuild current level with rotation
    this.rebuildLevel(this.currentIteration, rotation);

    // Show only current iteration level
    for (let i = 0; i <= this.maxIterations; i++) {
      if (i === this.currentIteration) {
        this.lineMats[i].opacity = opacity * 0.8;
      } else if (i === this.currentIteration - 1 && this.phase === 'building') {
        // Fade out previous level
        const progress = (this.timer % this.iterationDuration) / this.iterationDuration;
        this.lineMats[i].opacity = opacity * 0.3 * (1 - progress);
      } else {
        this.lineMats[i].opacity = 0;
      }
    }

    this.borderMat.opacity = opacity * 0.2;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      this.currentIteration = this.maxIterations;
      this.rebuildLevel(this.currentIteration, 0);
      this.phase = 'pausing';
      this.timer = 0;
    }
    if (action === 'pulse') {
      this.rotSpeed *= -1;
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    this.intensityLevel = level;
    if (level === 0) return;
    this.iterationDuration = Math.max(0.3, 1.5 - level * 0.2);
  }
}
