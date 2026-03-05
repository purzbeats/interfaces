import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

interface Triangle {
  a: number;
  b: number;
  c: number;
}

/**
 * Delaunay triangulation of random points via incremental insertion.
 * Shows triangles forming as points are added one by one.
 * LineSegments for triangle edges, Points for vertices.
 */
export class DelaunayMeshElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'delaunay-mesh',
    meta: {
      shape: 'rectangular',
      roles: ['data-display', 'decorative'],
      moods: ['ambient', 'tactical'],
      bandAffinity: 'high',
      sizes: ['needs-medium', 'needs-large'],
    } satisfies ElementMeta,
  };

  private pointsMesh!: THREE.Points;
  private edgeLines!: THREE.LineSegments;

  private pts: { x: number; y: number }[] = [];
  private triangles: Triangle[] = [];
  private insertIdx: number = 0;
  private totalPts: number = 0;
  private superTriPts: number = 3; // first 3 are super-triangle
  private insertDone: boolean = false;

  private stepTimer: number = 0;
  private stepInterval: number = 0.15;
  private resetTimer: number = 0;
  private resetInterval: number = 8;
  private maxEdgeVerts: number = 0;

  build(): void {
    this.glitchAmount = 4;
    const variant = this.rng.int(0, 3);

    const presets = [
      { points: 25, speed: 0.15, resetTime: 8 },
      { points: 50, speed: 0.08, resetTime: 6 },
      { points: 12, speed: 0.3,  resetTime: 10 },
      { points: 35, speed: 0.1,  resetTime: 7 },
    ];
    const p = presets[variant];

    this.totalPts = p.points;
    this.stepInterval = p.speed;
    this.resetInterval = p.resetTime;
    this.maxEdgeVerts = (this.totalPts * 6 + 20) * 2; // generous upper bound

    this.initPoints();
    this.buildGeometry();
  }

  private initPoints(): void {
    const { x, y, w, h } = this.px;
    const pad = Math.min(w, h) * 0.05;
    this.pts = [];
    this.triangles = [];
    this.insertIdx = 0;
    this.insertDone = false;
    this.resetTimer = 0;

    // Super-triangle encompassing the region
    const margin = Math.max(w, h) * 2;
    this.pts.push({ x: x + w / 2,          y: y - margin });
    this.pts.push({ x: x - margin,          y: y + h + margin });
    this.pts.push({ x: x + w + margin,      y: y + h + margin });
    this.triangles.push({ a: 0, b: 1, c: 2 });

    // Data points to insert
    for (let i = 0; i < this.totalPts; i++) {
      this.pts.push({
        x: x + pad + this.rng.float(0, w - pad * 2),
        y: y + pad + this.rng.float(0, h - pad * 2),
      });
    }
  }

  private circumContains(tri: Triangle, px: number, py: number): boolean {
    const ax = this.pts[tri.a].x, ay = this.pts[tri.a].y;
    const bx = this.pts[tri.b].x, by = this.pts[tri.b].y;
    const cx = this.pts[tri.c].x, cy = this.pts[tri.c].y;

    const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
    if (Math.abs(d) < 1e-10) return false;

    const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d;
    const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d;
    const r2 = (ax - ux) * (ax - ux) + (ay - uy) * (ay - uy);
    return (px - ux) * (px - ux) + (py - uy) * (py - uy) <= r2;
  }

  private insertPoint(pi: number): void {
    const px = this.pts[pi].x;
    const py = this.pts[pi].y;

    const bad: Triangle[] = [];
    const kept: Triangle[] = [];

    for (const tri of this.triangles) {
      if (this.circumContains(tri, px, py)) {
        bad.push(tri);
      } else {
        kept.push(tri);
      }
    }

    // Find boundary polygon edges
    const edges: [number, number][] = [];
    for (const tri of bad) {
      const triEdges: [number, number][] = [
        [tri.a, tri.b], [tri.b, tri.c], [tri.c, tri.a],
      ];
      for (const [ea, eb] of triEdges) {
        const shared = bad.some(
          (other) =>
            other !== tri &&
            ((other.a === ea || other.b === ea || other.c === ea) &&
             (other.a === eb || other.b === eb || other.c === eb)),
        );
        if (!shared) edges.push([ea, eb]);
      }
    }

    this.triangles = kept;
    for (const [ea, eb] of edges) {
      this.triangles.push({ a: ea, b: eb, c: pi });
    }
  }

  private removeSuperTriangle(): void {
    this.triangles = this.triangles.filter(
      (t) => t.a >= this.superTriPts && t.b >= this.superTriPts && t.c >= this.superTriPts,
    );
  }

  private buildGeometry(): void {
    const { w, h } = this.px;

    // Points (only data points, skip super-triangle)
    const posArr = new Float32Array(this.totalPts * 3);
    posArr.fill(0);
    const ptGeo = new THREE.BufferGeometry();
    ptGeo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
    ptGeo.setDrawRange(0, 0);
    this.pointsMesh = new THREE.Points(ptGeo, new THREE.PointsMaterial({
      color: this.palette.secondary,
      size: Math.max(3, Math.min(w, h) * 0.01),
      transparent: true,
      opacity: 0,
      sizeAttenuation: false,
    }));
    this.group.add(this.pointsMesh);

    // Edge lines
    const edgeVerts = new Float32Array(this.maxEdgeVerts * 3);
    edgeVerts.fill(0);
    const edgeGeo = new THREE.BufferGeometry();
    edgeGeo.setAttribute('position', new THREE.BufferAttribute(edgeVerts, 3));
    edgeGeo.setDrawRange(0, 0);
    this.edgeLines = new THREE.LineSegments(edgeGeo, new THREE.LineBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.edgeLines);
  }

  private updateGeometry(): void {
    // Update points
    const posAttr = this.pointsMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const shown = Math.min(this.insertIdx, this.totalPts);
    for (let i = 0; i < shown; i++) {
      const pi = i + this.superTriPts;
      posAttr.setXYZ(i, this.pts[pi].x, this.pts[pi].y, 1);
    }
    posAttr.needsUpdate = true;
    this.pointsMesh.geometry.setDrawRange(0, shown);

    // Update edges — skip triangles involving super-triangle vertices for display
    const edgeAttr = this.edgeLines.geometry.getAttribute('position') as THREE.BufferAttribute;
    let vi = 0;
    for (const tri of this.triangles) {
      const usesSuper = tri.a < this.superTriPts || tri.b < this.superTriPts || tri.c < this.superTriPts;
      if (usesSuper) continue;
      const pairs: [number, number][] = [[tri.a, tri.b], [tri.b, tri.c], [tri.c, tri.a]];
      for (const [a, b] of pairs) {
        if (vi + 2 > this.maxEdgeVerts) break;
        edgeAttr.setXYZ(vi++, this.pts[a].x, this.pts[a].y, 0);
        edgeAttr.setXYZ(vi++, this.pts[b].x, this.pts[b].y, 0);
      }
    }
    edgeAttr.needsUpdate = true;
    this.edgeLines.geometry.setDrawRange(0, vi);
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);

    if (this.insertDone) {
      this.resetTimer += dt;
      if (this.resetTimer >= this.resetInterval) {
        this.initPoints();
      }
    } else {
      this.stepTimer += dt;
      while (this.stepTimer >= this.stepInterval && !this.insertDone) {
        this.stepTimer -= this.stepInterval;
        const pi = this.superTriPts + this.insertIdx;
        if (pi < this.pts.length) {
          this.insertPoint(pi);
          this.insertIdx++;
        }
        if (this.insertIdx >= this.totalPts) {
          this.removeSuperTriangle();
          this.insertDone = true;
        }
      }
    }

    this.updateGeometry();

    (this.pointsMesh.material as THREE.PointsMaterial).opacity = opacity * 0.8;
    (this.edgeLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.6;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      this.initPoints();
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) {
      this.stepInterval = 0.15;
      return;
    }
    this.stepInterval = Math.max(0.02, 0.15 - level * 0.025);
    if (level >= 5) {
      this.initPoints();
    }
  }
}
