import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Chaos game fractal generator. Points jump toward randomly selected vertices
 * at a specific ratio, producing Sierpinski triangles, pentagons, and other
 * IFS fractals. Points accumulate over time revealing the attractor.
 */
export class ChaosGameElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'chaos-game',
    meta: {
      shape: 'rectangular',
      roles: ['data-display', 'decorative'],
      moods: ['ambient', 'diagnostic'],
      bandAffinity: 'high',
      sizes: ['works-small', 'needs-medium', 'needs-large'],
    },
  };

  private pointsMesh!: THREE.Points;
  private vertexMesh!: THREE.Points;
  private borderLines!: THREE.LineSegments;

  private vertices: { x: number; y: number }[] = [];
  private numVertices: number = 3;
  private ratio: number = 0.5;
  private rule: number = 0; // 0=any, 1=no repeat, 2=no neighbor
  private curX: number = 0;
  private curY: number = 0;
  private lastVertex: number = -1;
  private pointCount: number = 0;
  private maxPoints: number = 20000;
  private addRate: number = 100;
  private intensityLevel: number = 0;

  build(): void {
    const variant = this.rng.int(0, 3);
    const presets = [
      { verts: 3, ratio: 0.5, rule: 0, maxPts: 15000, rate: 100 },   // Sierpinski triangle
      { verts: 5, ratio: 0.618, rule: 0, maxPts: 25000, rate: 150 }, // Pentagon golden ratio
      { verts: 4, ratio: 0.5, rule: 1, maxPts: 20000, rate: 120 },   // Square no-repeat
      { verts: 6, ratio: 0.667, rule: 2, maxPts: 30000, rate: 200 }, // Hexagon no-neighbor
    ];
    const p = presets[variant];

    this.numVertices = p.verts;
    this.ratio = p.ratio;
    this.rule = p.rule;
    this.maxPoints = p.maxPts;
    this.addRate = p.rate;
    this.pointCount = 0;
    this.lastVertex = -1;
    this.glitchAmount = 4;

    const { x, y, w, h } = this.px;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const radius = Math.min(w, h) * 0.42;

    // Compute vertex positions
    this.vertices = [];
    for (let i = 0; i < this.numVertices; i++) {
      const angle = (i / this.numVertices) * Math.PI * 2 - Math.PI / 2;
      this.vertices.push({
        x: cx + Math.cos(angle) * radius,
        y: cy + Math.sin(angle) * radius,
      });
    }

    // Starting point
    this.curX = cx;
    this.curY = cy;

    // Points mesh
    const positions = new Float32Array(this.maxPoints * 3);
    const colors = new Float32Array(this.maxPoints * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setDrawRange(0, 0);

    this.pointsMesh = new THREE.Points(geo, new THREE.PointsMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0,
      size: 1.2,
      sizeAttenuation: false,
    }));
    this.group.add(this.pointsMesh);

    // Vertex markers
    const vertPositions = new Float32Array(this.numVertices * 3);
    for (let i = 0; i < this.numVertices; i++) {
      vertPositions[i * 3] = this.vertices[i].x;
      vertPositions[i * 3 + 1] = this.vertices[i].y;
      vertPositions[i * 3 + 2] = 1;
    }
    const vertGeo = new THREE.BufferGeometry();
    vertGeo.setAttribute('position', new THREE.BufferAttribute(vertPositions, 3));
    this.vertexMesh = new THREE.Points(vertGeo, new THREE.PointsMaterial({
      color: this.palette.secondary,
      transparent: true,
      opacity: 0,
      size: 5,
      sizeAttenuation: false,
    }));
    this.group.add(this.vertexMesh);

    // Border
    const bv = new Float32Array([
      x, y, 0, x + w, y, 0,
      x + w, y, 0, x + w, y + h, 0,
      x + w, y + h, 0, x, y + h, 0,
      x, y + h, 0, x, y, 0,
    ]);
    const borderGeo = new THREE.BufferGeometry();
    borderGeo.setAttribute('position', new THREE.BufferAttribute(bv, 3));
    this.borderLines = new THREE.LineSegments(borderGeo, new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.borderLines);
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);

    const rate = this.addRate + this.intensityLevel * 50;
    const pos = this.pointsMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const col = this.pointsMesh.geometry.getAttribute('color') as THREE.BufferAttribute;

    for (let i = 0; i < rate && this.pointCount < this.maxPoints; i++) {
      // Pick a vertex according to rule
      let vi = this.rng.int(0, this.numVertices - 1);
      if (this.rule === 1) {
        // No same vertex twice
        while (vi === this.lastVertex) {
          vi = this.rng.int(0, this.numVertices - 1);
        }
      } else if (this.rule === 2) {
        // No adjacent vertex
        while (vi === this.lastVertex || vi === (this.lastVertex + 1) % this.numVertices || vi === (this.lastVertex - 1 + this.numVertices) % this.numVertices) {
          vi = this.rng.int(0, this.numVertices - 1);
          if (this.lastVertex === -1) break;
        }
      }
      this.lastVertex = vi;

      // Move toward vertex
      const v = this.vertices[vi];
      this.curX = this.curX + (v.x - this.curX) * this.ratio;
      this.curY = this.curY + (v.y - this.curY) * this.ratio;

      // Store point with vertex-based color
      const idx = this.pointCount;
      pos.setXYZ(idx, this.curX, this.curY, 0.2);

      // Color based on which vertex was chosen
      const t = vi / this.numVertices;
      const pr = this.palette.primary;
      const sr = this.palette.secondary;
      const dm = this.palette.dim;
      col.setXYZ(idx,
        pr.r * (1 - t) + sr.r * t,
        pr.g * (1 - t) + sr.g * t,
        pr.b * (1 - t) + sr.b * t,
      );

      this.pointCount++;
    }

    if (this.pointCount >= this.maxPoints) {
      // Reset
      this.pointCount = 0;
      this.curX = this.px.x + this.px.w / 2;
      this.curY = this.px.y + this.px.h / 2;
      this.lastVertex = -1;
    }

    pos.needsUpdate = true;
    col.needsUpdate = true;
    this.pointsMesh.geometry.setDrawRange(0, this.pointCount);

    (this.pointsMesh.material as THREE.PointsMaterial).opacity = opacity;
    (this.vertexMesh.material as THREE.PointsMaterial).opacity = opacity;
    (this.borderLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.2;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Randomize ratio temporarily
      this.ratio = this.rng.float(0.3, 0.7);
      setTimeout(() => { this.ratio = 0.5; }, 500);
    }
    if (action === 'pulse') {
      this.pointCount = 0;
      this.pointsMesh.geometry.setDrawRange(0, 0);
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    this.intensityLevel = level;
  }
}
