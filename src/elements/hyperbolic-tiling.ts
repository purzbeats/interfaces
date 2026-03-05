import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Poincare disk model of hyperbolic tiling. Regular polygons in
 * hyperbolic space rendered in the unit disk.
 */
export class HyperbolicTilingElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'hyperbolic-tiling',
    meta: { shape: 'radial', roles: ['decorative', 'data-display'], moods: ['ambient'], bandAffinity: 'mid', sizes: ['needs-medium', 'needs-large'] },
  };

  private linesMesh!: THREE.LineSegments;
  private diskLine!: THREE.Line;
  private cx = 0;
  private cy = 0;
  private radius = 0;
  private p = 0;  // polygon sides
  private q = 0;  // polygons meeting at vertex
  private rotAngle = 0;
  private rotSpeed = 0;
  private edgeVerts: number[] = [];
  private edgeDists: number[] = []; // distance from center for each edge segment pair
  private sortedIndices!: Uint16Array; // edges sorted by distance
  private totalEdgeSegments = 0;
  private revealPhase = 0;
  private revealSpeed = 0.3;
  private cycleDuration = 8; // seconds for full in-out cycle

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;
    this.cx = x + w / 2;
    this.cy = y + h / 2;
    this.radius = Math.min(w, h) * 0.44;

    const variant = this.rng.int(0, 3);
    // {p,q} hyperbolic tilings where 1/p + 1/q < 1/2
    const presets = [
      { p: 5, q: 4, depth: 4, rotSpd: 0.05, revSpd: 0.25 },
      { p: 7, q: 3, depth: 4, rotSpd: 0.03, revSpd: 0.20 },
      { p: 4, q: 5, depth: 4, rotSpd: 0.07, revSpd: 0.30 },
      { p: 3, q: 8, depth: 5, rotSpd: 0.04, revSpd: 0.22 },
    ];
    const pr = presets[variant];
    this.p = pr.p;
    this.q = pr.q;
    this.rotSpeed = pr.rotSpd;
    this.revealSpeed = pr.revSpd;

    // Generate tiling edges
    this.edgeVerts = [];
    this.generateTiling(pr.depth);

    // Disk outline (local coords centered at origin)
    const segs = 96;
    const diskPos = new Float32Array((segs + 1) * 3);
    for (let i = 0; i <= segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      diskPos[i * 3] = Math.cos(a) * this.radius;
      diskPos[i * 3 + 1] = Math.sin(a) * this.radius;
    }
    const diskGeo = new THREE.BufferGeometry();
    diskGeo.setAttribute('position', new THREE.BufferAttribute(diskPos, 3));
    this.diskLine = new THREE.Line(diskGeo, new THREE.LineBasicMaterial({
      color: this.palette.dim, transparent: true, opacity: 0,
    }));
    this.diskLine.position.set(this.cx, this.cy, 0);
    this.group.add(this.diskLine);

    // Sort edge segments by distance from center (nearest first)
    this.totalEdgeSegments = this.edgeDists.length;
    this.sortedIndices = new Uint16Array(this.totalEdgeSegments);
    for (let i = 0; i < this.totalEdgeSegments; i++) this.sortedIndices[i] = i;
    this.sortedIndices.sort((a, b) => this.edgeDists[a] - this.edgeDists[b]);

    // Build reordered position + color buffers sorted by distance
    const linePos = new Float32Array(this.totalEdgeSegments * 6); // 2 verts × 3 coords per segment
    const lineCol = new Float32Array(this.totalEdgeSegments * 6); // 2 verts × 3 rgb per segment
    const pri = this.palette.primary;
    const sec = this.palette.secondary;
    const dim = this.palette.dim;
    const maxDist = this.edgeDists.length > 0 ? Math.max(...this.edgeDists) : 1;

    for (let i = 0; i < this.totalEdgeSegments; i++) {
      const srcIdx = this.sortedIndices[i];
      const srcOff = srcIdx * 6; // 2 verts × 3 coords in original edgeVerts
      const dstOff = i * 6;
      // Copy positions
      for (let j = 0; j < 6; j++) linePos[dstOff + j] = this.edgeVerts[srcOff + j];
      // Color: lerp primary→secondary→dim by normalized distance
      const t = this.edgeDists[srcIdx] / maxDist;
      let r: number, g: number, b: number;
      if (t < 0.5) {
        const f = t * 2;
        r = pri.r + (sec.r - pri.r) * f;
        g = pri.g + (sec.g - pri.g) * f;
        b = pri.b + (sec.b - pri.b) * f;
      } else {
        const f = (t - 0.5) * 2;
        r = sec.r + (dim.r - sec.r) * f;
        g = sec.g + (dim.g - sec.g) * f;
        b = sec.b + (dim.b - sec.b) * f;
      }
      lineCol[dstOff] = r; lineCol[dstOff + 1] = g; lineCol[dstOff + 2] = b;
      lineCol[dstOff + 3] = r; lineCol[dstOff + 4] = g; lineCol[dstOff + 5] = b;
    }

    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.BufferAttribute(linePos, 3));
    lineGeo.setAttribute('color', new THREE.BufferAttribute(lineCol, 3));
    lineGeo.setDrawRange(0, 0);
    this.linesMesh = new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0,
    }));
    this.linesMesh.position.set(this.cx, this.cy, 0);
    this.group.add(this.linesMesh);
  }

  private generateTiling(maxDepth: number): void {
    // Generate a central {p,q} polygon and recursively reflect
    const p = this.p;
    // Hyperbolic edge length for regular {p,q}: cosh(s) = cos(pi/q) / sin(pi/p)
    const cosS = Math.cos(Math.PI / this.q) / Math.sin(Math.PI / p);
    // Poincare disk radius for vertices: r = tanh(s/2) where cosh(s)=cosS
    const s = Math.acosh(Math.max(1, cosS));
    const diskR = Math.tanh(s / 2);

    // Generate vertices of central polygon
    type Pt = [number, number];
    const centerVerts: Pt[] = [];
    for (let i = 0; i < p; i++) {
      const angle = (i / p) * Math.PI * 2;
      centerVerts.push([diskR * Math.cos(angle), diskR * Math.sin(angle)]);
    }

    // Draw polygon edges as geodesics (circular arcs in the Poincare disk)
    const visited = new Set<string>();
    const queue: { verts: Pt[]; depth: number }[] = [{ verts: centerVerts, depth: 0 }];

    while (queue.length > 0) {
      const item = queue.shift()!;
      const key = item.verts.map(v => `${v[0].toFixed(3)},${v[1].toFixed(3)}`).sort().join('|');
      if (visited.has(key)) continue;
      visited.add(key);

      // Draw edges
      for (let i = 0; i < item.verts.length; i++) {
        const a = item.verts[i];
        const b = item.verts[(i + 1) % item.verts.length];
        // Approximate geodesic with line segments
        const steps = 8;
        for (let s = 0; s < steps; s++) {
          const t0 = s / steps;
          const t1 = (s + 1) / steps;
          const p0 = this.geodesicPoint(a, b, t0);
          const p1 = this.geodesicPoint(a, b, t1);
          this.edgeVerts.push(
            p0[0] * this.radius, p0[1] * this.radius, 0,
            p1[0] * this.radius, p1[1] * this.radius, 0,
          );
          // Store normalized distance from center for this segment
          const mx = (p0[0] + p1[0]) / 2;
          const my = (p0[1] + p1[1]) / 2;
          this.edgeDists.push(Math.sqrt(mx * mx + my * my));
        }
      }

      if (item.depth < maxDepth && visited.size < 500) {
        // Reflect across each edge to generate neighbors
        for (let i = 0; i < item.verts.length; i++) {
          const a = item.verts[i];
          const b = item.verts[(i + 1) % item.verts.length];
          const reflected = item.verts.map(v => this.hypReflect(v, a, b));
          // Check if reflected polygon is within the disk
          const maxR = Math.max(...reflected.map(v => v[0] * v[0] + v[1] * v[1]));
          if (maxR < 0.98) {
            queue.push({ verts: reflected, depth: item.depth + 1 });
          }
        }
      }
    }
  }

  private geodesicPoint(a: [number, number], b: [number, number], t: number): [number, number] {
    // Simple linear interpolation in disk coords (approximate for small arcs)
    // For a proper geodesic we'd compute the circular arc, but linear is visually close for small tiles
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  }

  private hypReflect(pt: [number, number], a: [number, number], b: [number, number]): [number, number] {
    // Reflect point across the geodesic through a and b in the Poincare disk
    // Approximate: reflect across the Euclidean line through a,b, then invert
    const mx = (a[0] + b[0]) / 2;
    const my = (a[1] + b[1]) / 2;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    if (len2 < 1e-10) return pt;
    const t = ((pt[0] - a[0]) * dx + (pt[1] - a[1]) * dy) / len2;
    const projX = a[0] + t * dx;
    const projY = a[1] + t * dy;
    return [2 * projX - pt[0], 2 * projY - pt[1]];
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);

    // Slowly rotate the entire tiling
    this.rotAngle += this.rotSpeed * dt;
    this.linesMesh.rotation.z = this.rotAngle;

    // Animate reveal: smoothly grow out from center then dissolve back
    // cycle: 0→1 = grow in, hold, 1→2 = dissolve out, hold
    this.revealPhase = (time * this.revealSpeed) % 2;
    let reveal: number;
    if (this.revealPhase < 0.8) {
      // Grow in: ease out (fast start, slow finish)
      const t = this.revealPhase / 0.8;
      reveal = 1 - (1 - t) * (1 - t);
    } else if (this.revealPhase < 1.0) {
      // Hold fully visible
      reveal = 1;
    } else if (this.revealPhase < 1.8) {
      // Dissolve out: ease in (slow start, fast finish)
      const t = (this.revealPhase - 1.0) / 0.8;
      reveal = 1 - t * t;
    } else {
      // Hold empty
      reveal = 0;
    }

    // Map reveal to draw range (edges sorted by distance, so this reveals from center)
    const totalVerts = this.totalEdgeSegments * 2;
    const drawVerts = Math.floor(reveal * totalVerts);
    this.linesMesh.geometry.setDrawRange(0, drawVerts);

    (this.linesMesh.material as THREE.LineBasicMaterial).opacity = opacity * 0.7;
    (this.diskLine.material as THREE.LineBasicMaterial).opacity = opacity * 0.2;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      this.rotSpeed = this.rng.float(-0.3, 0.3);
      this.revealSpeed = this.rng.float(0.4, 0.8);
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) {
      this.rotSpeed = 0.05;
      this.revealSpeed = 0.25;
      return;
    }
    this.rotSpeed = 0.05 * (1 + level * 0.5);
    this.revealSpeed = 0.25 + level * 0.08;
  }
}
