import * as THREE from 'three';
import type { HexCell } from './hex-grid';
import { hexCornersPixel, hexCellToPixel } from './hex-grid';
import type { Palette } from '../color/palettes';

/**
 * Convert a list of line segments (pairs of endpoints) into a merged
 * BufferGeometry of screen-space quads with a given pixel half-width.
 * Each segment becomes two triangles forming a thin rectangle.
 */
function segmentsToQuadGeo(
  segments: { ax: number; ay: number; bx: number; by: number }[],
  halfWidth: number,
): THREE.BufferGeometry {
  const positions = new Float32Array(segments.length * 6 * 3); // 6 verts per segment (2 tris)
  let vi = 0;

  for (const { ax, ay, bx, by } of segments) {
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 0.001) continue;

    // Perpendicular offset
    const nx = (-dy / len) * halfWidth;
    const ny = (dx / len) * halfWidth;

    // 4 corners of the quad
    const x0 = ax + nx, y0 = ay + ny;
    const x1 = ax - nx, y1 = ay - ny;
    const x2 = bx + nx, y2 = by + ny;
    const x3 = bx - nx, y3 = by - ny;

    // Triangle 1: 0-1-2
    positions[vi++] = x0; positions[vi++] = y0; positions[vi++] = 0;
    positions[vi++] = x1; positions[vi++] = y1; positions[vi++] = 0;
    positions[vi++] = x2; positions[vi++] = y2; positions[vi++] = 0;
    // Triangle 2: 1-3-2
    positions[vi++] = x1; positions[vi++] = y1; positions[vi++] = 0;
    positions[vi++] = x3; positions[vi++] = y3; positions[vi++] = 0;
    positions[vi++] = x2; positions[vi++] = y2; positions[vi++] = 0;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions.slice(0, vi), 3));
  return geo;
}

type Segment = { ax: number; ay: number; bx: number; by: number };

/**
 * Renders the honeycomb border overlay for hex layouts.
 * Uses mesh-based quads instead of line geometry for reliable rendering.
 */
export class HexBorderOverlay {
  readonly group = new THREE.Group();
  private material: THREE.MeshBasicMaterial | null = null;
  private baseOpacity = 0.6;

  /**
   * Build the border geometry from hex cells.
   * Deduplicates shared edges between adjacent cells.
   */
  create(
    cells: HexCell[],
    screenWidth: number,
    screenHeight: number,
    palette: Palette,
  ): void {
    this.dispose();

    const roundK = 100; // precision for dedup (0.01 px)
    const edgeSegments: Segment[] = [];
    const decorSegments: Segment[] = [];

    // --- Collect unique hex edges ---
    const edgeSet = new Set<string>();
    for (const cell of cells) {
      const corners = hexCornersPixel(cell, screenWidth, screenHeight);
      for (let i = 0; i < 6; i++) {
        const a = corners[i];
        const b = corners[(i + 1) % 6];

        const ax = Math.round(a.x * roundK);
        const ay = Math.round(a.y * roundK);
        const bx = Math.round(b.x * roundK);
        const by = Math.round(b.y * roundK);
        const key = ax < bx || (ax === bx && ay < by)
          ? `${ax},${ay}-${bx},${by}`
          : `${bx},${by}-${ax},${ay}`;

        if (edgeSet.has(key)) continue;
        edgeSet.add(key);

        edgeSegments.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y });
      }
    }

    if (edgeSegments.length === 0) return;

    // --- Corner pips at hex vertices ---
    const vertexSet = new Set<string>();
    for (const cell of cells) {
      const corners = hexCornersPixel(cell, screenWidth, screenHeight);
      for (let i = 0; i < 6; i++) {
        const c = corners[i];
        const vKey = `${Math.round(c.x * roundK)},${Math.round(c.y * roundK)}`;
        if (vertexSet.has(vKey)) continue;
        vertexSet.add(vKey);

        const prev = corners[(i + 5) % 6];
        const next = corners[(i + 1) % 6];
        const edgeLen1 = Math.sqrt((prev.x - c.x) ** 2 + (prev.y - c.y) ** 2);
        const edgeLen2 = Math.sqrt((next.x - c.x) ** 2 + (next.y - c.y) ** 2);
        const pipLen1 = edgeLen1 * 0.12;
        const pipLen2 = edgeLen2 * 0.12;

        const d1x = (prev.x - c.x) / edgeLen1;
        const d1y = (prev.y - c.y) / edgeLen1;
        decorSegments.push({ ax: c.x, ay: c.y, bx: c.x + d1x * pipLen1, by: c.y + d1y * pipLen1 });

        const d2x = (next.x - c.x) / edgeLen2;
        const d2y = (next.y - c.y) / edgeLen2;
        decorSegments.push({ ax: c.x, ay: c.y, bx: c.x + d2x * pipLen2, by: c.y + d2y * pipLen2 });
      }
    }

    // --- Tick marks along main edges ---
    for (const seg of edgeSegments) {
      const edgeLen = Math.sqrt((seg.bx - seg.ax) ** 2 + (seg.by - seg.ay) ** 2);
      if (edgeLen < 1) continue;
      const tickLen = edgeLen * 0.04;
      const step = 0.2;
      const dx = (seg.bx - seg.ax) / edgeLen;
      const dy = (seg.by - seg.ay) / edgeLen;
      const nx = -dy, ny = dx;
      for (let t = step; t < 1 - step / 2; t += step) {
        const px = seg.ax + (seg.bx - seg.ax) * t;
        const py = seg.ay + (seg.by - seg.ay) * t;
        decorSegments.push({
          ax: px - nx * tickLen, ay: py - ny * tickLen,
          bx: px + nx * tickLen, by: py + ny * tickLen,
        });
      }
    }

    // --- Inner hex outline at 90% radius ---
    const innerCellSet = new Set<string>();
    for (const cell of cells) {
      const cellKey = `${cell.q},${cell.r}`;
      if (innerCellSet.has(cellKey)) continue;
      innerCellSet.add(cellKey);

      const px = hexCellToPixel(cell, screenWidth, screenHeight);
      const corners = hexCornersPixel(cell, screenWidth, screenHeight);
      for (let i = 0; i < 6; i++) {
        const c1 = corners[i];
        const c2 = corners[(i + 1) % 6];
        decorSegments.push({
          ax: px.cx + (c1.x - px.cx) * 0.9,
          ay: px.cy + (c1.y - px.cy) * 0.9,
          bx: px.cx + (c2.x - px.cx) * 0.9,
          by: px.cy + (c2.y - px.cy) * 0.9,
        });
      }
    }

    // --- Build mesh geometry ---
    const color = palette.dim;
    this.material = new THREE.MeshBasicMaterial({
      color: color.getHex(),
      transparent: true,
      opacity: this.baseOpacity,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    // Main edges: thicker (1.2px half-width)
    const edgeGeo = segmentsToQuadGeo(edgeSegments, 1.2);
    const edgeMesh = new THREE.Mesh(edgeGeo, this.material);
    edgeMesh.renderOrder = 15;
    this.group.add(edgeMesh);

    // Decorations: thinner (0.7px half-width)
    if (decorSegments.length > 0) {
      const decorGeo = segmentsToQuadGeo(decorSegments, 0.7);
      const decorMesh = new THREE.Mesh(decorGeo, this.material);
      decorMesh.renderOrder = 15;
      this.group.add(decorMesh);
    }
  }

  /** Animate the border — subtle opacity pulse. */
  update(_dt: number, time: number): void {
    if (!this.material) return;
    const pulse = 0.08 * Math.sin(time * 1.2) + 0.04 * Math.sin(time * 3.7);
    this.material.opacity = this.baseOpacity + pulse;
  }

  dispose(): void {
    this.group.traverse(obj => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
      }
    });
    if (this.material) {
      this.material.dispose();
      this.material = null;
    }
    this.group.clear();
  }
}
