import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import type { HexCell } from './hex-grid';
import { hexCornersPixel } from './hex-grid';
import type { Palette } from '../color/palettes';

/**
 * Renders the honeycomb border overlay for hex layouts.
 * Draws deduplicated hex edges as fat LineSegments2 with a subtle pulse animation.
 */
export class HexBorderOverlay {
  readonly group = new THREE.Group();
  private material: LineMaterial | null = null;
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

    // Collect unique edges keyed by rounded endpoint coordinates
    const edgeSet = new Set<string>();
    const edgeVerts: number[] = [];

    const roundK = 100; // precision for dedup (0.01 px)

    for (const cell of cells) {
      const corners = hexCornersPixel(cell, screenWidth, screenHeight);
      for (let i = 0; i < 6; i++) {
        const a = corners[i];
        const b = corners[(i + 1) % 6];

        // Create a canonical key for this edge (sorted by coords)
        const ax = Math.round(a.x * roundK);
        const ay = Math.round(a.y * roundK);
        const bx = Math.round(b.x * roundK);
        const by = Math.round(b.y * roundK);
        const key = ax < bx || (ax === bx && ay < by)
          ? `${ax},${ay}-${bx},${by}`
          : `${bx},${by}-${ax},${ay}`;

        if (edgeSet.has(key)) continue;
        edgeSet.add(key);

        edgeVerts.push(a.x, a.y, 0, b.x, b.y, 0);
      }
    }

    if (edgeVerts.length === 0) return;

    // Build line geometry
    const geo = new LineSegmentsGeometry();
    geo.setPositions(edgeVerts);

    const color = palette.dim;
    this.material = new LineMaterial({
      color: color.getHex(),
      linewidth: 1.5,
      transparent: true,
      opacity: this.baseOpacity,
      depthTest: false,
      resolution: new THREE.Vector2(screenWidth, screenHeight),
    });

    const lines = new LineSegments2(geo, this.material);
    lines.renderOrder = 15; // above elements (10 = dividers), below post-fx
    lines.computeLineDistances();

    this.group.add(lines);
  }

  /** Animate the border — subtle opacity pulse. */
  update(_dt: number, time: number): void {
    if (!this.material) return;
    const pulse = 0.08 * Math.sin(time * 1.2) + 0.04 * Math.sin(time * 3.7);
    this.material.opacity = this.baseOpacity + pulse;
  }

  dispose(): void {
    this.group.traverse(obj => {
      if (obj instanceof LineSegments2) {
        obj.geometry.dispose();
        (obj.material as LineMaterial).dispose();
      }
    });
    this.group.clear();
    this.material = null;
  }
}
