import * as THREE from 'three';
import type { HexCell } from './hex-grid';

export type RegionTier = 'hero' | 'panel' | 'widget';

/**
 * A rectangular region in normalized coordinates [0,1].
 */
export interface Region {
  id: string;
  x: number;       // left edge [0,1]
  y: number;       // top edge [0,1]
  width: number;   // [0,1]
  height: number;  // [0,1]
  padding: number; // inner padding as fraction of region size
  tier?: RegionTier;
  isDivider?: boolean;
  elementType?: string;
  children?: Region[];
  hexCell?: HexCell; // present only for hex-layout regions
}

export function createRegion(
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
  padding: number = 0.01
): Region {
  return { id, x, y, width, height, padding };
}

export function createTieredRegion(
  id: string,
  tier: RegionTier,
  x: number,
  y: number,
  width: number,
  height: number,
  padding: number = 0.005
): Region {
  return { id, x, y, width, height, padding, tier };
}

/** Convert normalized region coords to pixel coords.
 *  Guarantees w >= 1 and h >= 1 to prevent division-by-zero in elements. */
export function regionToPixels(
  region: Region,
  screenWidth: number,
  screenHeight: number
): { x: number; y: number; w: number; h: number } {
  const pad = region.padding;
  return {
    x: (region.x + pad) * screenWidth,
    y: (region.y + pad) * screenHeight,
    w: Math.max(1, (region.width - pad * 2) * screenWidth),
    h: Math.max(1, (region.height - pad * 2) * screenHeight),
  };
}

/**
 * Compute 4 THREE.Plane clipping planes for a rectangular region.
 * Normals point inward so fragments inside the rectangle are kept.
 * Mirrors hexClippingPlanes() but for axis-aligned rectangles.
 */
export function regionClippingPlanes(
  region: Region,
  screenWidth: number,
  screenHeight: number,
): THREE.Plane[] {
  const { x, y, w, h } = regionToPixels(region, screenWidth, screenHeight);

  return [
    // Left edge — normal points right (+x)
    new THREE.Plane(new THREE.Vector3(1, 0, 0), -x),
    // Right edge — normal points left (-x)
    new THREE.Plane(new THREE.Vector3(-1, 0, 0), x + w),
    // Bottom edge — normal points up (+y)
    new THREE.Plane(new THREE.Vector3(0, 1, 0), -y),
    // Top edge — normal points down (-y)
    new THREE.Plane(new THREE.Vector3(0, -1, 0), y + h),
  ];
}
