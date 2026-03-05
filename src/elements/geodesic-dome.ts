import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Geodesic dome wireframe. Subdivided icosahedron projected to a sphere.
 * Slowly rotating. Multiple subdivision levels as presets.
 */
export class GeodesicDomeElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'geodesic-dome',
    meta: { shape: 'radial', roles: ['structural', 'decorative'], moods: ['ambient', 'tactical'], bandAffinity: 'bass', sizes: ['needs-medium', 'needs-large'] },
  };

  private line!: THREE.LineSegments;
  private lineMat!: THREE.LineBasicMaterial;
  private wirePositions!: Float32Array;
  private numVerts: number = 0;
  private cx: number = 0;
  private cy: number = 0;
  private radius: number = 0;
  private rotSpeedX: number = 0;
  private rotSpeedY: number = 0;
  private basePositions: number[][] = [];

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;
    this.cx = x + w / 2;
    this.cy = y + h / 2;
    this.radius = Math.min(w, h) * 0.4;

    const variant = this.rng.int(0, 3);
    const presets = [
      { subdivisions: 1, speedX: 0.2, speedY: 0.15 },
      { subdivisions: 2, speedX: 0.15, speedY: 0.1 },
      { subdivisions: 3, speedX: 0.1, speedY: 0.08 },
      { subdivisions: 2, speedX: 0.25, speedY: 0.2 },
    ];
    const pr = presets[variant];
    this.rotSpeedX = pr.speedX;
    this.rotSpeedY = pr.speedY;

    // Generate icosahedron vertices and faces
    const phi = (1 + Math.sqrt(5)) / 2;
    const icoVerts: number[][] = [
      [-1, phi, 0], [1, phi, 0], [-1, -phi, 0], [1, -phi, 0],
      [0, -1, phi], [0, 1, phi], [0, -1, -phi], [0, 1, -phi],
      [phi, 0, -1], [phi, 0, 1], [-phi, 0, -1], [-phi, 0, 1],
    ];
    // Normalize to unit sphere
    for (const v of icoVerts) {
      const len = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
      v[0] /= len; v[1] /= len; v[2] /= len;
    }
    let faces = [
      [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
      [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
      [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
      [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
    ];

    let verts = icoVerts.slice();
    // Subdivide
    for (let s = 0; s < pr.subdivisions; s++) {
      const newFaces: number[][] = [];
      const midCache: Record<string, number> = {};
      const getMid = (a: number, b: number): number => {
        const key = Math.min(a, b) + '_' + Math.max(a, b);
        if (midCache[key] !== undefined) return midCache[key];
        const va = verts[a], vb = verts[b];
        const mx = (va[0] + vb[0]) / 2;
        const my = (va[1] + vb[1]) / 2;
        const mz = (va[2] + vb[2]) / 2;
        const len = Math.sqrt(mx * mx + my * my + mz * mz);
        verts.push([mx / len, my / len, mz / len]);
        midCache[key] = verts.length - 1;
        return verts.length - 1;
      };
      for (const [a, b, c] of faces) {
        const ab = getMid(a, b);
        const bc = getMid(b, c);
        const ca = getMid(c, a);
        newFaces.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
      }
      faces = newFaces;
    }

    this.basePositions = verts;

    // Build edge set
    const edgeSet = new Set<string>();
    for (const [a, b, c] of faces) {
      const addEdge = (i: number, j: number) => {
        const key = Math.min(i, j) + '_' + Math.max(i, j);
        edgeSet.add(key);
      };
      addEdge(a, b); addEdge(b, c); addEdge(c, a);
    }

    const edges = Array.from(edgeSet).map(k => k.split('_').map(Number));
    this.numVerts = edges.length * 2;
    this.wirePositions = new Float32Array(this.numVerts * 3);

    // Store edge indices for update
    this._edges = edges;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.wirePositions, 3));
    this.lineMat = new THREE.LineBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
    });
    this.line = new THREE.LineSegments(geo, this.lineMat);
    this.group.add(this.line);
  }

  private _edges: number[][] = [];

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    const ax = time * this.rotSpeedX;
    const ay = time * this.rotSpeedY;
    const cosX = Math.cos(ax), sinX = Math.sin(ax);
    const cosY = Math.cos(ay), sinY = Math.sin(ay);
    const R = this.radius;

    const project = (v: number[]): [number, number] => {
      // Rotate around X then Y
      let x0 = v[0], y0 = v[1], z0 = v[2];
      const y1 = y0 * cosX - z0 * sinX;
      const z1 = y0 * sinX + z0 * cosX;
      const x2 = x0 * cosY + z1 * sinY;
      const z2 = -x0 * sinY + z1 * cosY;
      const perspective = 1 / (1 - z2 * 0.3);
      return [this.cx + x2 * R * perspective, this.cy + y1 * R * perspective];
    };

    let idx = 0;
    for (const [a, b] of this._edges) {
      const [ax2, ay2] = project(this.basePositions[a]);
      const [bx, by] = project(this.basePositions[b]);
      this.wirePositions[idx++] = ax2;
      this.wirePositions[idx++] = ay2;
      this.wirePositions[idx++] = 0;
      this.wirePositions[idx++] = bx;
      this.wirePositions[idx++] = by;
      this.wirePositions[idx++] = 0;
    }

    (this.line.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    this.lineMat.opacity = opacity * 0.7;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') this.glitchTimer = 0.5;
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level >= 3) {
      this.rotSpeedX *= 1.3;
      this.rotSpeedY *= 1.3;
    }
  }
}
