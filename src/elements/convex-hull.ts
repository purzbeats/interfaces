import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Convex hull construction animation (Graham scan).
 * Random points, sort by angle, walk perimeter checking left/right turns.
 * Points + Line geometry.
 */
export class ConvexHullElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'convex-hull',
    meta: {
      shape: 'rectangular',
      roles: ['data-display', 'decorative'],
      moods: ['diagnostic', 'ambient'],
      bandAffinity: 'mid',
      sizes: ['needs-medium', 'needs-large'],
    } satisfies ElementMeta,
  };

  private pointsMesh!: THREE.Points;
  private hullLines!: THREE.LineSegments;
  private scanLines!: THREE.LineSegments;

  private pts: { x: number; y: number }[] = [];
  private sorted: number[] = [];
  private stack: number[] = [];
  private scanIdx: number = 0;
  private scanDone: boolean = false;
  private stepTimer: number = 0;
  private stepInterval: number = 0.12;
  private resetTimer: number = 0;
  private resetInterval: number = 6;
  private pointCount: number = 30;
  private maxHullSegs: number = 0;
  private maxScanSegs: number = 4;

  build(): void {
    this.glitchAmount = 4;
    const variant = this.rng.int(0, 3);

    const presets = [
      { points: 30, speed: 0.12, resetTime: 6 },
      { points: 60, speed: 0.06, resetTime: 5 },
      { points: 15, speed: 0.25, resetTime: 8 },
      { points: 45, speed: 0.08, resetTime: 5 },
    ];
    const p = presets[variant];

    this.pointCount = p.points;
    this.stepInterval = p.speed;
    this.resetInterval = p.resetTime;

    this.generatePoints();
    this.buildGeometry();
  }

  private generatePoints(): void {
    const { x, y, w, h } = this.px;
    const pad = Math.min(w, h) * 0.1;
    this.pts = [];
    for (let i = 0; i < this.pointCount; i++) {
      this.pts.push({
        x: x + pad + this.rng.float(0, w - pad * 2),
        y: y + pad + this.rng.float(0, h - pad * 2),
      });
    }

    // Graham scan: find lowest-y point (leftmost tiebreak)
    let lowest = 0;
    for (let i = 1; i < this.pts.length; i++) {
      if (this.pts[i].y < this.pts[lowest].y ||
          (this.pts[i].y === this.pts[lowest].y && this.pts[i].x < this.pts[lowest].x)) {
        lowest = i;
      }
    }
    // Swap to front
    const tmp = this.pts[0];
    this.pts[0] = this.pts[lowest];
    this.pts[lowest] = tmp;

    const anchor = this.pts[0];
    const indices = [];
    for (let i = 1; i < this.pts.length; i++) indices.push(i);

    indices.sort((a, b) => {
      const angA = Math.atan2(this.pts[a].y - anchor.y, this.pts[a].x - anchor.x);
      const angB = Math.atan2(this.pts[b].y - anchor.y, this.pts[b].x - anchor.x);
      if (angA !== angB) return angA - angB;
      const dA = (this.pts[a].x - anchor.x) ** 2 + (this.pts[a].y - anchor.y) ** 2;
      const dB = (this.pts[b].x - anchor.x) ** 2 + (this.pts[b].y - anchor.y) ** 2;
      return dA - dB;
    });

    this.sorted = [0, ...indices];
    this.stack = [this.sorted[0], this.sorted[1]];
    this.scanIdx = 2;
    this.scanDone = false;
    this.resetTimer = 0;
    this.maxHullSegs = this.pointCount + 2;
  }

  private cross(o: number, a: number, b: number): number {
    return (this.pts[a].x - this.pts[o].x) * (this.pts[b].y - this.pts[o].y) -
           (this.pts[a].y - this.pts[o].y) * (this.pts[b].x - this.pts[o].x);
  }

  private stepScan(): void {
    if (this.scanDone || this.scanIdx >= this.sorted.length) {
      this.scanDone = true;
      return;
    }
    const pi = this.sorted[this.scanIdx];
    while (this.stack.length > 1 &&
           this.cross(this.stack[this.stack.length - 2], this.stack[this.stack.length - 1], pi) <= 0) {
      this.stack.pop();
    }
    this.stack.push(pi);
    this.scanIdx++;
    if (this.scanIdx >= this.sorted.length) {
      this.scanDone = true;
    }
  }

  private buildGeometry(): void {
    const { w, h } = this.px;
    // Points
    const posArr = new Float32Array(this.pointCount * 3);
    for (let i = 0; i < this.pointCount; i++) {
      posArr[i * 3] = this.pts[i].x;
      posArr[i * 3 + 1] = this.pts[i].y;
      posArr[i * 3 + 2] = 0;
    }
    const ptGeo = new THREE.BufferGeometry();
    ptGeo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
    this.pointsMesh = new THREE.Points(ptGeo, new THREE.PointsMaterial({
      color: this.palette.dim,
      size: Math.max(3, Math.min(w, h) * 0.012),
      transparent: true,
      opacity: 0,
      sizeAttenuation: false,
    }));
    this.group.add(this.pointsMesh);

    // Hull line segments (dynamic)
    const hullVerts = new Float32Array(this.maxHullSegs * 6);
    hullVerts.fill(0);
    const hullGeo = new THREE.BufferGeometry();
    hullGeo.setAttribute('position', new THREE.BufferAttribute(hullVerts, 3));
    hullGeo.setDrawRange(0, 0);
    this.hullLines = new THREE.LineSegments(hullGeo, new THREE.LineBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.hullLines);

    // Scan indicator segments
    const scanVerts = new Float32Array(this.maxScanSegs * 6);
    scanVerts.fill(0);
    const scanGeo = new THREE.BufferGeometry();
    scanGeo.setAttribute('position', new THREE.BufferAttribute(scanVerts, 3));
    scanGeo.setDrawRange(0, 0);
    this.scanLines = new THREE.LineSegments(scanGeo, new THREE.LineBasicMaterial({
      color: this.palette.secondary,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.scanLines);
  }

  private updateHullGeometry(): void {
    const pos = this.hullLines.geometry.getAttribute('position') as THREE.BufferAttribute;
    const len = this.stack.length;
    let vi = 0;
    for (let i = 0; i < len; i++) {
      const a = this.stack[i];
      const b = this.stack[(i + 1) % len];
      pos.setXYZ(vi++, this.pts[a].x, this.pts[a].y, 1);
      pos.setXYZ(vi++, this.pts[b].x, this.pts[b].y, 1);
    }
    pos.needsUpdate = true;
    this.hullLines.geometry.setDrawRange(0, vi);

    // Scan indicator: line from top of stack to current candidate
    const scanPos = this.scanLines.geometry.getAttribute('position') as THREE.BufferAttribute;
    if (!this.scanDone && this.scanIdx < this.sorted.length && this.stack.length > 0) {
      const top = this.stack[this.stack.length - 1];
      const cand = this.sorted[this.scanIdx];
      scanPos.setXYZ(0, this.pts[top].x, this.pts[top].y, 2);
      scanPos.setXYZ(1, this.pts[cand].x, this.pts[cand].y, 2);
      scanPos.needsUpdate = true;
      this.scanLines.geometry.setDrawRange(0, 2);
    } else {
      this.scanLines.geometry.setDrawRange(0, 0);
    }
  }

  private resetScan(): void {
    this.generatePoints();
    // Rebuild point positions
    const posArr = this.pointsMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < this.pointCount; i++) {
      posArr.setXYZ(i, this.pts[i].x, this.pts[i].y, 0);
    }
    posArr.needsUpdate = true;
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);

    if (this.scanDone) {
      this.resetTimer += dt;
      if (this.resetTimer >= this.resetInterval) {
        this.resetScan();
      }
    } else {
      this.stepTimer += dt;
      while (this.stepTimer >= this.stepInterval && !this.scanDone) {
        this.stepTimer -= this.stepInterval;
        this.stepScan();
      }
    }

    this.updateHullGeometry();

    (this.pointsMesh.material as THREE.PointsMaterial).opacity = opacity * 0.7;
    (this.hullLines.material as THREE.LineBasicMaterial).opacity = opacity;
    (this.scanLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.9;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      this.resetScan();
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) {
      this.stepInterval = 0.12;
      return;
    }
    this.stepInterval = Math.max(0.02, 0.12 - level * 0.02);
    if (level >= 4) {
      this.resetScan();
    }
  }
}
