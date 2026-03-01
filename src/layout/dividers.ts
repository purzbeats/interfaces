import type { SeededRandom } from '../random';
import type { Region } from './region';
import { createRegion } from './region';

export interface DividerResult {
  contentRegions: Region[];
  dividerRegions: Region[];
}

let dividerCounter = 0;

export function resetDividerCounter(): void {
  dividerCounter = 0;
}

/**
 * Inject full-span horizontal and vertical divider strips.
 * Called after template regions are created but before BSP subdivision.
 */
export function injectDividers(
  regions: Region[],
  rng: SeededRandom
): DividerResult {
  // 60% chance dividers appear at all
  if (!rng.chance(0.6)) {
    return { contentRegions: regions, dividerRegions: [] };
  }

  // Pick counts: horizontal 0-3, vertical 0-2
  const hCount = rng.weighted([20, 40, 30, 10]); // 0,1,2,3
  const vCount = rng.weighted([30, 45, 25]);      // 0,1,2

  if (hCount === 0 && vCount === 0) {
    return { contentRegions: regions, dividerRegions: [] };
  }

  const MIN_GAP = 0.1;
  const MIN_THICK = 0.02;
  const MAX_THICK = 0.05;

  // Pick horizontal positions
  const hDividers = pickPositions(hCount, MIN_GAP, MIN_THICK, MAX_THICK, rng);
  // Pick vertical positions
  const vDividers = pickPositions(vCount, MIN_GAP, MIN_THICK, MAX_THICK, rng);

  // Create divider regions
  const dividerRegions: Region[] = [];

  for (const { pos, thickness } of hDividers) {
    const r = createRegion(
      `divider-h-${dividerCounter++}`,
      0, pos, 1.0, thickness, 0.002
    );
    r.isDivider = true;
    r.elementType = 'separator';
    dividerRegions.push(r);
  }

  for (const { pos, thickness } of vDividers) {
    const r = createRegion(
      `divider-v-${dividerCounter++}`,
      pos, 0, thickness, 1.0, 0.002
    );
    r.isDivider = true;
    r.elementType = 'separator';
    dividerRegions.push(r);
  }

  // Slice existing regions around all dividers
  let contentRegions = [...regions];
  for (const divider of dividerRegions) {
    contentRegions = sliceRegionsAroundDivider(contentRegions, divider);
  }

  // Filter out slivers (< 0.04 in either dimension)
  contentRegions = contentRegions.filter(
    r => r.width >= 0.04 && r.height >= 0.04
  );

  return { contentRegions, dividerRegions };
}

interface DividerPos {
  pos: number;
  thickness: number;
}

function pickPositions(
  count: number,
  minGap: number,
  minThick: number,
  maxThick: number,
  rng: SeededRandom
): DividerPos[] {
  const result: DividerPos[] = [];
  const MAX_ATTEMPTS = 20;

  for (let i = 0; i < count; i++) {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const thickness = rng.float(minThick, maxThick);
      const pos = rng.float(0.1, 0.9 - thickness);

      // Check gap from edges
      if (pos < 0.1 || pos + thickness > 0.9) continue;

      // Check gap from other dividers
      let tooClose = false;
      for (const existing of result) {
        const existingEnd = existing.pos + existing.thickness;
        const newEnd = pos + thickness;
        // Gap between the two divider strips
        const gap = Math.max(pos - existingEnd, existing.pos - newEnd);
        if (gap < minGap) {
          tooClose = true;
          break;
        }
      }
      if (tooClose) continue;

      result.push({ pos, thickness });
      break;
    }
  }

  return result;
}

/**
 * Slice content regions to make room for a divider.
 * Horizontal divider (width ~1.0): split intersecting regions into above/below.
 * Vertical divider (height ~1.0): split intersecting regions into left/right.
 */
function sliceRegionsAroundDivider(
  regions: Region[],
  divider: Region
): Region[] {
  const result: Region[] = [];
  const isHorizontal = divider.width > divider.height;

  for (const region of regions) {
    if (!regionsOverlap(region, divider)) {
      result.push(region);
      continue;
    }

    if (isHorizontal) {
      // Split into above and below
      const divTop = divider.y;
      const divBottom = divider.y + divider.height;
      const regBottom = region.y + region.height;

      // Above piece
      if (divTop > region.y) {
        const above = createRegion(
          region.id + '-a',
          region.x, region.y,
          region.width, divTop - region.y,
          region.padding
        );
        result.push(above);
      }

      // Below piece
      if (divBottom < regBottom) {
        const below = createRegion(
          region.id + '-b',
          region.x, divBottom,
          region.width, regBottom - divBottom,
          region.padding
        );
        result.push(below);
      }
    } else {
      // Vertical: split into left and right
      const divLeft = divider.x;
      const divRight = divider.x + divider.width;
      const regRight = region.x + region.width;

      // Left piece
      if (divLeft > region.x) {
        const left = createRegion(
          region.id + '-l',
          region.x, region.y,
          divLeft - region.x, region.height,
          region.padding
        );
        result.push(left);
      }

      // Right piece
      if (divRight < regRight) {
        const right = createRegion(
          region.id + '-r',
          divRight, region.y,
          regRight - divRight, region.height,
          region.padding
        );
        result.push(right);
      }
    }
  }

  return result;
}

function regionsOverlap(a: Region, b: Region): boolean {
  return !(
    a.x + a.width <= b.x ||
    b.x + b.width <= a.x ||
    a.y + a.height <= b.y ||
    b.y + b.height <= a.y
  );
}
