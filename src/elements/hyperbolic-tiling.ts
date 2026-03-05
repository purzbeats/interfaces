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

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;
    this.cx = x + w / 2;
    this.cy = y + h / 2;
    this.radius = Math.min(w, h) * 0.44;

    const variant = this.rng.int(0, 3);
    // {p,q} hyperbolic tilings where 1/p + 1/q < 1/2
    const presets = [
      { p: 5, q: 4, depth: 4, rotSpd: 0.05 },
      { p: 7, q: 3, depth: 4, rotSpd: 0.03 },
      { p: 4, q: 5, depth: 4, rotSpd: 0.07 },
      { p: 3, q: 8, depth: 5, rotSpd: 0.04 },
    ];
    const pr = presets[variant];
    this.p = pr.p;
    this.q = pr.q;
    this.rotSpeed = pr.rotSpd;

    // Generate tiling edges
    this.edgeVerts = [];
    this.generateTiling(pr.depth);

    // Disk outline
    const segs = 96;
    const diskPos = new Float32Array((segs + 1) * 3);
    for (let i = 0; i <= segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      diskPos[i * 3] = this.cx + Math.cos(a) * this.radius;
      diskPos[i * 3 + 1] = this.cy + Math.sin(a) * this.radius;
    }
    const diskGeo = new THREE.BufferGeometry();
    diskGeo.setAttribute('position', new THREE.BufferAttribute(diskPos, 3));
    this.diskLine = new THREE.Line(diskGeo, new THREE.LineBasicMaterial({
      color: this.palette.dim, transparent: true, opacity: 0,
    }));
    this.group.add(this.diskLine);

    // Tiling edges
    const linePos = new Float32Array(this.edgeVerts.length);
    for (let i = 0; i < this.edgeVerts.length; i++) linePos[i] = this.edgeVerts[i];
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.BufferAttribute(linePos, 3));
    this.linesMesh = new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({
      color: this.palette.primary, transparent: true, opacity: 0,
    }));
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
            this.cx + p0[0] * this.radius, this.cy + p0[1] * this.radius, 0,
            this.cx + p1[0] * this.radius, this.cy + p1[1] * this.radius, 0,
          );
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
    // Rotate around center
    this.linesMesh.position.set(this.cx, this.cy, 0);
    this.linesMesh.geometry.translate(-this.cx, -this.cy, 0);
    // Reset translation to avoid accumulation — just use group rotation
    this.linesMesh.geometry.translate(this.cx, this.cy, 0);

    (this.linesMesh.material as THREE.LineBasicMaterial).opacity = opacity * 0.6;
    (this.diskLine.material as THREE.LineBasicMaterial).opacity = opacity * 0.15;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      this.rotSpeed = this.rng.float(-0.3, 0.3);
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level >= 2) {
      this.rotSpeed = 0.05 * (1 + level * 0.5);
    }
  }
}
