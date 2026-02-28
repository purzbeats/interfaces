import type { SeededRandom } from '../random';
import { type Region, createRegion } from './region';

export interface BSPOptions {
  minWidth: number;   // minimum region width (normalized)
  minHeight: number;  // minimum region height (normalized)
  maxDepth: number;
  splitVariance: number; // 0 = always center, 1 = fully random
}

const DEFAULT_BSP: BSPOptions = {
  minWidth: 0.12,
  minHeight: 0.12,
  maxDepth: 4,
  splitVariance: 0.3,
};

let regionCounter = 0;

/**
 * Recursive BSP subdivision of a region into leaf regions.
 */
export function subdivide(
  region: Region,
  rng: SeededRandom,
  opts: Partial<BSPOptions> = {},
  depth: number = 0
): Region[] {
  const o = { ...DEFAULT_BSP, ...opts };

  if (depth >= o.maxDepth) return [region];
  if (region.width < o.minWidth * 2 && region.height < o.minHeight * 2) return [region];

  const canSplitH = region.width >= o.minWidth * 2;
  const canSplitV = region.height >= o.minHeight * 2;

  if (!canSplitH && !canSplitV) return [region];

  // Choose split direction
  let horizontal: boolean;
  if (canSplitH && canSplitV) {
    // Prefer splitting the longer axis
    horizontal = region.width / region.height > 1.2 ? true
      : region.height / region.width > 1.2 ? false
      : rng.chance(0.5);
  } else {
    horizontal = canSplitH;
  }

  // Split position with variance
  const variance = o.splitVariance;
  const splitRatio = 0.5 + rng.float(-variance, variance);

  let a: Region, b: Region;

  if (horizontal) {
    const splitW = region.width * splitRatio;
    if (splitW < o.minWidth || region.width - splitW < o.minWidth) return [region];

    a = createRegion(`r${regionCounter++}`, region.x, region.y, splitW, region.height, region.padding);
    b = createRegion(`r${regionCounter++}`, region.x + splitW, region.y, region.width - splitW, region.height, region.padding);
  } else {
    const splitH = region.height * splitRatio;
    if (splitH < o.minHeight || region.height - splitH < o.minHeight) return [region];

    a = createRegion(`r${regionCounter++}`, region.x, region.y, region.width, splitH, region.padding);
    b = createRegion(`r${regionCounter++}`, region.x, region.y + splitH, region.width, region.height - splitH, region.padding);
  }

  return [
    ...subdivide(a, rng, opts, depth + 1),
    ...subdivide(b, rng, opts, depth + 1),
  ];
}

export function resetRegionCounter(): void {
  regionCounter = 0;
}
