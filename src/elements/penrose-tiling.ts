import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Penrose tiling (P3 rhombus). Aperiodic tiling with 5-fold symmetry.
 * Subdivision algorithm for generation.
 */
export class PenroseTilingElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'penrose-tiling',
    meta: { shape: 'rectangular', roles: ['decorative', 'structural'], moods: ['ambient', 'diagnostic'], bandAffinity: 'high', sizes: ['needs-medium', 'needs-large'] },
  };

  private linesMesh!: THREE.LineSegments;
  private rotAngle = 0;
  private rotSpeed = 0;
  private cx = 0;
  private cy = 0;
  private highlightPhase = 0;
  private thinMat!: THREE.LineBasicMaterial;
  private thickMat!: THREE.LineBasicMaterial;

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;
    this.cx = x + w / 2;
    this.cy = y + h / 2;

    const variant = this.rng.int(0, 3);
    const presets = [
      { subdivisions: 5, rotSpd: 0.02 },
      { subdivisions: 6, rotSpd: 0.01 },
      { subdivisions: 4, rotSpd: 0.04 },
      { subdivisions: 5, rotSpd: 0.03 },
    ];
    const p = presets[variant];
    this.rotSpeed = p.rotSpd;

    // Generate Penrose tiling using Robinson triangle decomposition
    const radius = Math.min(w, h) * 0.48;
    type Tri = { type: 0 | 1; a: [number, number]; b: [number, number]; c: [number, number] };
    const phi = (1 + Math.sqrt(5)) / 2;

    // Start with 10 triangles forming a decagon
    let triangles: Tri[] = [];
    for (let i = 0; i < 10; i++) {
      const a1 = (2 * i - 1) * Math.PI / 10;
      const a2 = (2 * i + 1) * Math.PI / 10;
      const b: [number, number] = [Math.cos(a1) * radius, Math.sin(a1) * radius];
      const c: [number, number] = [Math.cos(a2) * radius, Math.sin(a2) * radius];
      if (i % 2 === 0) {
        triangles.push({ type: 0, a: [0, 0], b, c });
      } else {
        triangles.push({ type: 0, a: [0, 0], b: c, c: b });
      }
    }

    // Subdivide
    for (let s = 0; s < p.subdivisions; s++) {
      const next: Tri[] = [];
      for (const t of triangles) {
        if (t.type === 0) {
          // Acute isosceles (type 0) -> split
          const p1: [number, number] = [
            t.a[0] + (t.b[0] - t.a[0]) / phi,
            t.a[1] + (t.b[1] - t.a[1]) / phi,
          ];
          next.push({ type: 0, a: t.c, b: p1, c: t.b });
          next.push({ type: 1, a: p1, b: t.c, c: t.a });
        } else {
          // Obtuse isosceles (type 1) -> split
          const q1: [number, number] = [
            t.b[0] + (t.a[0] - t.b[0]) / phi,
            t.b[1] + (t.a[1] - t.b[1]) / phi,
          ];
          const r1: [number, number] = [
            t.b[0] + (t.c[0] - t.b[0]) / phi,
            t.b[1] + (t.c[1] - t.b[1]) / phi,
          ];
          next.push({ type: 1, a: r1, b: t.c, c: t.a });
          next.push({ type: 0, a: q1, b: r1, c: t.b });
          next.push({ type: 1, a: r1, b: q1, c: t.a });
        }
      }
      triangles = next;
    }

    // Collect edges (deduplicated)
    const edgeSet = new Set<string>();
    const verts: number[] = [];
    const addEdge = (a: [number, number], b: [number, number]) => {
      const key = [
        `${Math.round(a[0] * 10)},${Math.round(a[1] * 10)}`,
        `${Math.round(b[0] * 10)},${Math.round(b[1] * 10)}`,
      ].sort().join('-');
      if (edgeSet.has(key)) return;
      edgeSet.add(key);
      verts.push(this.cx + a[0], this.cy + a[1], 0);
      verts.push(this.cx + b[0], this.cy + b[1], 0);
    };
    for (const t of triangles) {
      addEdge(t.a, t.b);
      addEdge(t.b, t.c);
      addEdge(t.c, t.a);
    }

    const linePos = new Float32Array(verts);
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.BufferAttribute(linePos, 3));
    this.thinMat = new THREE.LineBasicMaterial({
      color: this.palette.primary, transparent: true, opacity: 0,
    });
    this.linesMesh = new THREE.LineSegments(lineGeo, this.thinMat);
    this.group.add(this.linesMesh);
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    this.highlightPhase = time;

    this.thinMat.opacity = opacity * 0.55;

    // Gentle color pulse
    const pulse = 0.4 + 0.15 * Math.sin(time * 0.8);
    this.thinMat.opacity = opacity * pulse;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      this.rotSpeed = this.rng.float(-0.2, 0.2);
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
  }
}
