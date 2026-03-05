import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

interface HexCell {
  cx: number;
  cy: number;
  ring: number;    // distance from center in hex rings
  builtAt: number; // growth step when this cell appears (-1 = not built)
}

/**
 * Honeycomb progressive construction. Hexagonal cells drawn one by one
 * in a growth pattern. Each cell is a hexagon outline. LineSegments geometry.
 * Cells fill inward from edges.
 */
export class HoneycombBuildElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'honeycomb-build',
    meta: {
      shape: 'rectangular',
      roles: ['structural', 'decorative'],
      moods: ['ambient', 'diagnostic'],
      bandAffinity: 'mid',
      sizes: ['works-small', 'needs-medium', 'needs-large'],
    } satisfies ElementMeta,
  };

  private lineMesh!: THREE.LineSegments;
  private cells: HexCell[] = [];
  private buildOrder: number[] = [];
  private maxVertices: number = 0;
  private cellRadius: number = 0;

  // Growth state
  private buildStep: number = 0;
  private buildTimer: number = 0;
  private buildInterval: number = 0;
  private cellsPerStep: number = 0;
  private phase: 'building' | 'display' | 'fading' = 'building';
  private displayTimer: number = 0;
  private fadeTimer: number = 0;

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;
    const variant = this.rng.int(0, 3);

    const presets = [
      { rings: 5,  cellR: 0, interval: 0.08, perStep: 1, inward: true },
      { rings: 8,  cellR: 0, interval: 0.04, perStep: 2, inward: true },
      { rings: 3,  cellR: 0, interval: 0.12, perStep: 1, inward: false },
      { rings: 6,  cellR: 0, interval: 0.03, perStep: 3, inward: true },
    ];
    const p = presets[variant];

    const maxRings = p.rings;
    // Auto-size cell radius to fit region
    this.cellRadius = Math.min(w, h) / (maxRings * 2 + 2) * 0.55;
    if (this.cellRadius < 3) this.cellRadius = 3;

    this.buildInterval = p.interval;
    this.cellsPerStep = p.perStep;

    const cx = x + w / 2;
    const cy = y + h / 2;

    // Generate hex grid (axial coordinates)
    this.cells = [];
    for (let q = -maxRings; q <= maxRings; q++) {
      for (let r = -maxRings; r <= maxRings; r++) {
        if (Math.abs(q + r) > maxRings) continue;

        const ring = Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r));

        // Hex to pixel (flat-top)
        const hx = cx + this.cellRadius * 1.73 * (q + r * 0.5);
        const hy = cy + this.cellRadius * 1.5 * r;

        // Check if cell fits within region bounds
        if (hx - this.cellRadius < x || hx + this.cellRadius > x + w) continue;
        if (hy - this.cellRadius < y || hy + this.cellRadius > y + h) continue;

        this.cells.push({ cx: hx, cy: hy, ring, builtAt: -1 });
      }
    }

    // Build order: sort by ring (inward = outer first, else inner first)
    this.buildOrder = this.cells.map((_, i) => i);
    if (p.inward) {
      // Outer rings first
      this.buildOrder.sort((a, b) => this.cells[b].ring - this.cells[a].ring);
    } else {
      // Inner rings first
      this.buildOrder.sort((a, b) => this.cells[a].ring - this.cells[b].ring);
    }
    // Shuffle within same ring for organic feel
    const shuffled: number[] = [];
    let i = 0;
    while (i < this.buildOrder.length) {
      let j = i;
      while (j < this.buildOrder.length &&
             this.cells[this.buildOrder[j]].ring === this.cells[this.buildOrder[i]].ring) {
        j++;
      }
      // Shuffle indices i..j-1
      const group = this.buildOrder.slice(i, j);
      for (let k = group.length - 1; k > 0; k--) {
        const swap = this.rng.int(0, k);
        const tmp = group[k];
        group[k] = group[swap];
        group[swap] = tmp;
      }
      shuffled.push(...group);
      i = j;
    }
    this.buildOrder = shuffled;

    this.buildStep = 0;
    this.phase = 'building';

    // Each hex = 6 line segments = 12 vertices
    this.maxVertices = this.cells.length * 12;
    const positions = new Float32Array(this.maxVertices * 3);
    const colors = new Float32Array(this.maxVertices * 3);
    for (let k = 0; k < this.maxVertices * 3; k++) {
      positions[k] = 0;
      colors[k] = 0;
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
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);

    if (this.phase === 'building') {
      this.buildTimer += dt;
      while (this.buildTimer >= this.buildInterval && this.buildStep < this.buildOrder.length) {
        this.buildTimer -= this.buildInterval;
        for (let s = 0; s < this.cellsPerStep && this.buildStep < this.buildOrder.length; s++) {
          const cellIdx = this.buildOrder[this.buildStep];
          this.cells[cellIdx].builtAt = this.buildStep;
          this.buildStep++;
        }
      }
      if (this.buildStep >= this.buildOrder.length) {
        this.phase = 'display';
        this.displayTimer = 3;
      }
    } else if (this.phase === 'display') {
      this.displayTimer -= dt;
      if (this.displayTimer <= 0) {
        this.phase = 'fading';
        this.fadeTimer = 1.5;
      }
    } else if (this.phase === 'fading') {
      this.fadeTimer -= dt;
      if (this.fadeTimer <= 0) {
        // Reset
        for (const cell of this.cells) cell.builtAt = -1;
        this.buildStep = 0;
        this.buildTimer = 0;
        this.phase = 'building';
      }
    }

    // Render built cells
    const posAttr = this.lineMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const colAttr = this.lineMesh.geometry.getAttribute('color') as THREE.BufferAttribute;
    const pos = posAttr.array as Float32Array;
    const col = colAttr.array as Float32Array;

    const pr = this.palette.primary;
    const sc = this.palette.secondary;
    const dm = this.palette.dim;
    const maxRing = this.cells.reduce((m, c) => Math.max(m, c.ring), 0);
    let vi = 0;

    for (const cell of this.cells) {
      if (cell.builtAt < 0) continue;

      const ringT = maxRing > 0 ? cell.ring / maxRing : 0;
      const r = pr.r * (1 - ringT) + sc.r * ringT;
      const g = pr.g * (1 - ringT) + sc.g * ringT;
      const b = pr.b * (1 - ringT) + sc.b * ringT;

      // Draw 6 edges of hexagon
      for (let e = 0; e < 6 && vi + 1 < this.maxVertices; e++) {
        const angle0 = (Math.PI / 3) * e;
        const angle1 = (Math.PI / 3) * (e + 1);

        pos[vi * 3] = cell.cx + Math.cos(angle0) * this.cellRadius;
        pos[vi * 3 + 1] = cell.cy + Math.sin(angle0) * this.cellRadius;
        pos[vi * 3 + 2] = 0;
        pos[(vi + 1) * 3] = cell.cx + Math.cos(angle1) * this.cellRadius;
        pos[(vi + 1) * 3 + 1] = cell.cy + Math.sin(angle1) * this.cellRadius;
        pos[(vi + 1) * 3 + 2] = 0;

        col[vi * 3] = r;
        col[vi * 3 + 1] = g;
        col[vi * 3 + 2] = b;
        col[(vi + 1) * 3] = r;
        col[(vi + 1) * 3 + 1] = g;
        col[(vi + 1) * 3 + 2] = b;

        vi += 2;
      }
    }

    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
    this.lineMesh.geometry.setDrawRange(0, vi);

    const fadeAlpha = this.phase === 'fading' ? Math.max(this.fadeTimer / 1.5, 0) : 1;
    (this.lineMesh.material as THREE.LineBasicMaterial).opacity = opacity * fadeAlpha;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Destroy random cells
      const destroyCount = Math.floor(this.buildStep * 0.2);
      for (let i = 0; i < destroyCount; i++) {
        const idx = this.rng.int(0, this.cells.length - 1);
        this.cells[idx].builtAt = -1;
      }
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) {
      this.buildInterval = 0.08;
      this.cellsPerStep = 1;
      return;
    }
    this.buildInterval = Math.max(0.01, 0.08 - level * 0.015);
    this.cellsPerStep = 1 + Math.floor(level / 2);
    if (level >= 5) {
      // Instant build remaining
      while (this.buildStep < this.buildOrder.length) {
        const cellIdx = this.buildOrder[this.buildStep];
        this.cells[cellIdx].builtAt = this.buildStep;
        this.buildStep++;
      }
      this.phase = 'display';
      this.displayTimer = 2;
    }
  }
}
