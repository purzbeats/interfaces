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

/** Convert normalized region coords to pixel coords */
export function regionToPixels(
  region: Region,
  screenWidth: number,
  screenHeight: number
): { x: number; y: number; w: number; h: number } {
  const pad = region.padding;
  return {
    x: (region.x + pad) * screenWidth,
    y: (region.y + pad) * screenHeight,
    w: (region.width - pad * 2) * screenWidth,
    h: (region.height - pad * 2) * screenHeight,
  };
}
