import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Soap foam / froth simulation. Bubbles as Voronoi cells with edges.
 * Sites rearrange over time via Lloyd's relaxation.
 * LineSegments cell edges rendered from Voronoi approximation.
 */
export class FoamRelaxElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'foam-relax',
    meta: {
      shape: 'rectangular',
      roles: ['decorative', 'data-display'],
      moods: ['ambient'],
      bandAffinity: 'bass',
      sizes: ['needs-medium', 'needs-large'],
    } satisfies ElementMeta,
  };

  private lineMesh!: THREE.LineSegments;
  private borderMesh!: THREE.LineSegments;
  private maxVertices: number = 0;

  // Voronoi sites
  private siteCount: number = 0;
  private siteX!: Float32Array;
  private siteY!: Float32Array;

  // Relaxation
  private relaxTimer: number = 0;
  private relaxInterval: number = 0;
  private relaxStrength: number = 0;

  // Grid-based Voronoi approximation
  private gridW: number = 0;
  private gridH: number = 0;
  private cellOwner!: Int16Array;

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;
    const variant = this.rng.int(0, 3);

    const presets = [
      { sites: 20, relaxInt: 0.1, relaxStr: 0.15, gridScale: 2 },
      { sites: 40, relaxInt: 0.08, relaxStr: 0.1,  gridScale: 2 },
      { sites: 12, relaxInt: 0.15, relaxStr: 0.2,  gridScale: 3 },
      { sites: 30, relaxInt: 0.05, relaxStr: 0.08, gridScale: 2 },
    ];
    const p = presets[variant];

    this.siteCount = p.sites + this.rng.int(-2, 2);
    this.relaxInterval = p.relaxInt;
    this.relaxStrength = p.relaxStr;

    this.gridW = Math.max(16, Math.floor(w / p.gridScale));
    this.gridH = Math.max(16, Math.floor(h / p.gridScale));
    this.cellOwner = new Int16Array(this.gridW * this.gridH);

    this.siteX = new Float32Array(this.siteCount);
    this.siteY = new Float32Array(this.siteCount);

    for (let i = 0; i < this.siteCount; i++) {
      this.siteX[i] = x + this.rng.float(w * 0.05, w * 0.95);
      this.siteY[i] = y + this.rng.float(h * 0.05, h * 0.95);
    }

    // Estimate max edges: each grid cell boundary can produce an edge
    // Worst case: every adjacent pair differs => gridW*gridH * 2 edges
    this.maxVertices = this.gridW * this.gridH * 4;
    const positions = new Float32Array(this.maxVertices * 3);
    const colors = new Float32Array(this.maxVertices * 3);
    for (let i = 0; i < this.maxVertices * 3; i++) {
      positions[i] = 0;
      colors[i] = 0;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setDrawRange(0, 0);

    this.lineMesh = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.lineMesh);

    // Border
    const bv = new Float32Array([
      x, y, 0, x + w, y, 0,
      x + w, y, 0, x + w, y + h, 0,
      x + w, y + h, 0, x, y + h, 0,
      x, y + h, 0, x, y, 0,
    ]);
    const borderGeo = new THREE.BufferGeometry();
    borderGeo.setAttribute('position', new THREE.BufferAttribute(bv, 3));
    this.borderMesh = new THREE.LineSegments(borderGeo, new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.borderMesh);
  }

  private computeVoronoi(): void {
    const { x, y, w, h } = this.px;
    const cellW = w / this.gridW;
    const cellH = h / this.gridH;

    // Assign each grid cell to nearest site
    for (let gy = 0; gy < this.gridH; gy++) {
      for (let gx = 0; gx < this.gridW; gx++) {
        const px = x + (gx + 0.5) * cellW;
        const py = y + (gy + 0.5) * cellH;
        let bestDist = Infinity;
        let bestSite = 0;

        for (let s = 0; s < this.siteCount; s++) {
          const dx = px - this.siteX[s];
          const dy = py - this.siteY[s];
          const d = dx * dx + dy * dy;
          if (d < bestDist) {
            bestDist = d;
            bestSite = s;
          }
        }
        this.cellOwner[gy * this.gridW + gx] = bestSite;
      }
    }
  }

  private lloydRelax(): void {
    const { x, y, w, h } = this.px;
    const cellW = w / this.gridW;
    const cellH = h / this.gridH;

    // Compute centroids
    const sumX = new Float32Array(this.siteCount);
    const sumY = new Float32Array(this.siteCount);
    const count = new Float32Array(this.siteCount);

    for (let gy = 0; gy < this.gridH; gy++) {
      for (let gx = 0; gx < this.gridW; gx++) {
        const owner = this.cellOwner[gy * this.gridW + gx];
        const px = x + (gx + 0.5) * cellW;
        const py = y + (gy + 0.5) * cellH;
        sumX[owner] += px;
        sumY[owner] += py;
        count[owner]++;
      }
    }

    for (let s = 0; s < this.siteCount; s++) {
      if (count[s] > 0) {
        const targetX = sumX[s] / count[s];
        const targetY = sumY[s] / count[s];
        this.siteX[s] += (targetX - this.siteX[s]) * this.relaxStrength;
        this.siteY[s] += (targetY - this.siteY[s]) * this.relaxStrength;

        // Clamp to bounds
        this.siteX[s] = Math.max(x + 2, Math.min(x + w - 2, this.siteX[s]));
        this.siteY[s] = Math.max(y + 2, Math.min(y + h - 2, this.siteY[s]));
      }
    }
  }

  private renderEdges(): number {
    const { x, y, w, h } = this.px;
    const cellW = w / this.gridW;
    const cellH = h / this.gridH;

    const posAttr = this.lineMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const colAttr = this.lineMesh.geometry.getAttribute('color') as THREE.BufferAttribute;
    const pos = posAttr.array as Float32Array;
    const col = colAttr.array as Float32Array;

    const pr = this.palette.primary;
    const dm = this.palette.dim;
    let vi = 0;

    // Find edges: where adjacent grid cells have different owners
    for (let gy = 0; gy < this.gridH; gy++) {
      for (let gx = 0; gx < this.gridW; gx++) {
        const idx = gy * this.gridW + gx;
        const owner = this.cellOwner[idx];

        // Right neighbor
        if (gx + 1 < this.gridW && vi + 1 < this.maxVertices) {
          const rOwner = this.cellOwner[idx + 1];
          if (owner !== rOwner) {
            const edgeX = x + (gx + 1) * cellW;
            const edgeY = y + gy * cellH;

            pos[vi * 3] = edgeX;
            pos[vi * 3 + 1] = edgeY;
            pos[vi * 3 + 2] = 0;
            pos[(vi + 1) * 3] = edgeX;
            pos[(vi + 1) * 3 + 1] = edgeY + cellH;
            pos[(vi + 1) * 3 + 2] = 0;

            col[vi * 3] = pr.r;
            col[vi * 3 + 1] = pr.g;
            col[vi * 3 + 2] = pr.b;
            col[(vi + 1) * 3] = dm.r;
            col[(vi + 1) * 3 + 1] = dm.g;
            col[(vi + 1) * 3 + 2] = dm.b;

            vi += 2;
          }
        }

        // Bottom neighbor
        if (gy + 1 < this.gridH && vi + 1 < this.maxVertices) {
          const bOwner = this.cellOwner[(gy + 1) * this.gridW + gx];
          if (owner !== bOwner) {
            const edgeX = x + gx * cellW;
            const edgeY = y + (gy + 1) * cellH;

            pos[vi * 3] = edgeX;
            pos[vi * 3 + 1] = edgeY;
            pos[vi * 3 + 2] = 0;
            pos[(vi + 1) * 3] = edgeX + cellW;
            pos[(vi + 1) * 3 + 1] = edgeY;
            pos[(vi + 1) * 3 + 2] = 0;

            col[vi * 3] = pr.r;
            col[vi * 3 + 1] = pr.g;
            col[vi * 3 + 2] = pr.b;
            col[(vi + 1) * 3] = dm.r;
            col[(vi + 1) * 3 + 1] = dm.g;
            col[(vi + 1) * 3 + 2] = dm.b;

            vi += 2;
          }
        }
      }
    }

    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
    return vi;
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);

    this.relaxTimer += dt;
    if (this.relaxTimer >= this.relaxInterval) {
      this.relaxTimer -= this.relaxInterval;
      this.computeVoronoi();
      this.lloydRelax();
    }

    this.computeVoronoi();
    const vi = this.renderEdges();
    this.lineMesh.geometry.setDrawRange(0, vi);

    (this.lineMesh.material as THREE.LineBasicMaterial).opacity = opacity;
    (this.borderMesh.material as THREE.LineBasicMaterial).opacity = opacity * 0.3;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Pop some bubbles: remove random sites and replace
      const { x, y, w, h } = this.px;
      const popCount = Math.max(1, Math.floor(this.siteCount * 0.2));
      for (let i = 0; i < popCount; i++) {
        const idx = this.rng.int(0, this.siteCount - 1);
        this.siteX[idx] = x + this.rng.float(w * 0.1, w * 0.9);
        this.siteY[idx] = y + this.rng.float(h * 0.1, h * 0.9);
      }
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) {
      this.relaxStrength = 0.15;
      this.relaxInterval = 0.1;
      return;
    }
    this.relaxStrength = 0.15 + level * 0.05;
    this.relaxInterval = Math.max(0.02, 0.1 - level * 0.015);
    if (level >= 5) {
      // Jolt all sites
      const { x, y, w, h } = this.px;
      for (let s = 0; s < this.siteCount; s++) {
        this.siteX[s] += this.rng.float(-w * 0.1, w * 0.1);
        this.siteY[s] += this.rng.float(-h * 0.1, h * 0.1);
        this.siteX[s] = Math.max(x + 2, Math.min(x + w - 2, this.siteX[s]));
        this.siteY[s] = Math.max(y + 2, Math.min(y + h - 2, this.siteY[s]));
      }
    }
  }
}
