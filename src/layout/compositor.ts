import type { SeededRandom } from '../random';
import type { Region } from './region';
import { subdivide, resetRegionCounter } from './grid';
import { getTemplate, type TemplateConfig } from './templates';
import { getMeta, allElementNames } from '../elements/tags';
import { injectDividers, resetDividerCounter } from './dividers';

export interface CompositorResult {
  template: TemplateConfig;
  regions: Region[];
}

// --- Weight resolution ---

function resolveWeights(template: TemplateConfig): Record<string, number> {
  const weights: Record<string, number> = {};

  // Start from tagWeights: sum across all matching elements
  if (template.tagWeights) {
    for (const [tag, tagWeight] of Object.entries(template.tagWeights)) {
      for (const name of allElementNames()) {
        const meta = getMeta(name);
        if (!meta) continue;
        const matches =
          meta.shape === tag ||
          meta.roles.includes(tag as any) ||
          meta.moods.includes(tag as any) ||
          meta.sizes.includes(tag as any);
        if (matches) {
          weights[name] = (weights[name] ?? 0) + tagWeight;
        }
      }
    }
  }

  // elementWeights override (not add to) per-element
  if (template.elementWeights) {
    for (const [name, w] of Object.entries(template.elementWeights)) {
      weights[name] = w;
    }
  }

  return weights;
}

// --- Region shape classification ---

type RegionShape = 'square' | 'wide' | 'tall' | 'thin-strip';

const SCREEN_ASPECT = 16 / 9;

function classifyRegion(region: Region): RegionShape {
  const pixelAspect = (region.width / region.height) * SCREEN_ASPECT;
  if (pixelAspect > 3 || pixelAspect < 1 / 3) return 'thin-strip';
  if (pixelAspect >= 0.7 && pixelAspect <= 1.4) return 'square';
  return pixelAspect > 1 ? 'wide' : 'tall';
}

// --- Shape fitness multiplier ---

function shapeFitness(elementName: string, regionShape: RegionShape): number {
  const meta = getMeta(elementName);
  if (!meta) return 1.0;

  switch (meta.shape) {
    case 'radial':
      if (regionShape === 'square') return 1.5;
      if (regionShape === 'thin-strip') return 0.05;
      return 0.4; // wide or tall
    case 'linear':
      if (regionShape === 'thin-strip') return 2.0;
      if (regionShape === 'wide' || regionShape === 'tall') return 1.2;
      return 0.6; // square
    case 'rectangular':
      return 1.0;
    default:
      return 1.0;
  }
}

// --- Adjacency detection ---

const EDGE_TOLERANCE = 0.02;

function areAdjacent(a: Region, b: Region): boolean {
  // Check if regions share an edge (within tolerance) in normalized coords
  const aRight = a.x + a.width;
  const bRight = b.x + b.width;
  const aBottom = a.y + a.height;
  const bBottom = b.y + b.height;

  // Vertical overlap check
  const vertOverlap = a.y < bBottom - EDGE_TOLERANCE && b.y < aBottom - EDGE_TOLERANCE;
  // Horizontal overlap check
  const horizOverlap = a.x < bRight - EDGE_TOLERANCE && b.x < aRight - EDGE_TOLERANCE;

  // Share a vertical edge (left/right neighbors)
  if (vertOverlap && (
    Math.abs(aRight - b.x) < EDGE_TOLERANCE ||
    Math.abs(bRight - a.x) < EDGE_TOLERANCE
  )) return true;

  // Share a horizontal edge (top/bottom neighbors)
  if (horizOverlap && (
    Math.abs(aBottom - b.y) < EDGE_TOLERANCE ||
    Math.abs(bBottom - a.y) < EDGE_TOLERANCE
  )) return true;

  return false;
}

// --- Diversity multiplier ---

interface PlacementContext {
  typeCounts: Record<string, number>;
  roleCounts: Record<string, number>;
  placements: { region: Region; elementType: string }[];
}

function diversityMultiplier(
  elementName: string,
  region: Region,
  ctx: PlacementContext
): number {
  let mult = 1.0;

  // Reuse penalty: 0.5x per prior use
  const useCount = ctx.typeCounts[elementName] ?? 0;
  mult *= Math.pow(0.5, useCount);

  // Adjacent same-type penalty
  for (const placed of ctx.placements) {
    if (placed.elementType === elementName && areAdjacent(region, placed.region)) {
      mult *= 0.15;
    }
  }

  // Role saturation: 0.6x per role used 3+ times
  const meta = getMeta(elementName);
  if (meta) {
    for (const role of meta.roles) {
      if ((ctx.roleCounts[role] ?? 0) >= 3) {
        mult *= 0.6;
      }
    }
  }

  return mult;
}

// --- Segment lines (uniform widget bands) ---

interface AlignedGroup {
  axis: 'row' | 'column';
  regions: Region[];
}

function findAlignedGroups(regions: Region[]): AlignedGroup[] {
  const groups: AlignedGroup[] = [];
  const tol = EDGE_TOLERANCE;

  // Find rows: regions sharing same y and y+height
  const rowBuckets = new Map<string, Region[]>();
  for (const r of regions) {
    // Quantize y and bottom to tolerance
    const key = `${Math.round(r.y / tol)}|${Math.round((r.y + r.height) / tol)}`;
    let bucket = rowBuckets.get(key);
    if (!bucket) { bucket = []; rowBuckets.set(key, bucket); }
    bucket.push(r);
  }
  for (const bucket of rowBuckets.values()) {
    if (bucket.length < 2) continue;
    // Sort by x, check contiguity
    bucket.sort((a, b) => a.x - b.x);
    if (isContiguous(bucket, 'x', 'width')) {
      groups.push({ axis: 'row', regions: [...bucket] });
    }
  }

  // Find columns: regions sharing same x and x+width
  const colBuckets = new Map<string, Region[]>();
  for (const r of regions) {
    const key = `${Math.round(r.x / tol)}|${Math.round((r.x + r.width) / tol)}`;
    let bucket = colBuckets.get(key);
    if (!bucket) { bucket = []; colBuckets.set(key, bucket); }
    bucket.push(r);
  }
  for (const bucket of colBuckets.values()) {
    if (bucket.length < 2) continue;
    bucket.sort((a, b) => a.y - b.y);
    if (isContiguous(bucket, 'y', 'height')) {
      groups.push({ axis: 'column', regions: [...bucket] });
    }
  }

  return groups;
}

function isContiguous(
  sorted: Region[],
  posKey: 'x' | 'y',
  sizeKey: 'width' | 'height'
): boolean {
  for (let i = 1; i < sorted.length; i++) {
    const prevEnd = sorted[i - 1][posKey] + sorted[i - 1][sizeKey];
    if (Math.abs(prevEnd - sorted[i][posKey]) > EDGE_TOLERANCE) return false;
  }
  return true;
}

function selectSegmentLines(
  groups: AlignedGroup[],
  rng: SeededRandom
): AlignedGroup[] {
  // 0 (20%), 1 (40%), 2 (30%), 3 (10%)
  const countIdx = rng.weighted([20, 40, 30, 10]);
  const segmentCount = countIdx; // 0,1,2,3

  if (segmentCount === 0 || groups.length === 0) return [];

  const shuffled = rng.shuffle([...groups]);
  const selected: AlignedGroup[] = [];
  const usedRegions = new Set<Region>();

  for (const group of shuffled) {
    if (selected.length >= segmentCount) break;
    // Check no region overlap with already-selected segments
    if (group.regions.some(r => usedRegions.has(r))) continue;
    selected.push(group);
    for (const r of group.regions) usedRegions.add(r);
  }

  return selected;
}

function assignSegmentLines(
  segments: AlignedGroup[],
  baseWeights: Record<string, number>,
  candidates: string[],
  ctx: PlacementContext,
  rng: SeededRandom
): Set<Region> {
  const preAssigned = new Set<Region>();

  for (const seg of segments) {
    // Use first region's shape as representative
    const regionShape = classifyRegion(seg.regions[0]);

    // Pick element via weighted random with shape fitness
    const adjustedWeights: number[] = candidates.map(name => {
      const base = baseWeights[name];
      const fit = shapeFitness(name, regionShape);
      const div = diversityMultiplier(name, seg.regions[0], ctx);
      return base * fit * div;
    });

    const idx = rng.weighted(adjustedWeights);
    const chosen = candidates[idx];

    // Assign to all regions in segment
    for (const region of seg.regions) {
      region.elementType = chosen;
      preAssigned.add(region);

      ctx.typeCounts[chosen] = (ctx.typeCounts[chosen] ?? 0) + 1;
      const meta = getMeta(chosen);
      if (meta) {
        for (const role of meta.roles) {
          ctx.roleCounts[role] = (ctx.roleCounts[role] ?? 0) + 1;
        }
      }
      ctx.placements.push({ region, elementType: chosen });
    }
  }

  return preAssigned;
}

// --- Compose ---

/**
 * Layout engine: selects template, subdivides regions, assigns element types
 * with shape-aware fitness and diversity penalties.
 */
export function compose(
  templateName: string,
  rng: SeededRandom
): CompositorResult {
  resetRegionCounter();
  resetDividerCounter();
  const template = getTemplate(templateName, rng);
  const topRegions = template.createRegions(rng);

  // Inject dividers: carve through template regions before BSP
  const { contentRegions, dividerRegions } = injectDividers(topRegions, rng);

  // Subdivide each content region (not dividers)
  const leafRegions: Region[] = [];
  for (const region of contentRegions) {
    const leaves = subdivide(region, rng, template.bspOptions);
    leafRegions.push(...leaves);
  }
  // Add divider regions as leaf regions (no subdivision)
  leafRegions.push(...dividerRegions);

  // Resolve base weights from tagWeights + elementWeights
  const baseWeights = resolveWeights(template);
  const candidates = Object.keys(baseWeights);

  // If no candidates (shouldn't happen with valid templates), fall back
  if (candidates.length === 0) {
    return { template, regions: leafRegions };
  }

  // Placement context for diversity tracking
  const ctx: PlacementContext = {
    typeCounts: {},
    roleCounts: {},
    placements: [],
  };

  // Segment lines: find aligned groups, select 0-3, pre-assign
  const alignedGroups = findAlignedGroups(leafRegions);
  const segments = selectSegmentLines(alignedGroups, rng);
  const preAssigned = assignSegmentLines(segments, baseWeights, candidates, ctx, rng);

  // Process remaining regions sequentially, building context
  for (const region of leafRegions) {
    if (preAssigned.has(region)) continue;
    if (region.isDivider) continue;

    const regionShape = classifyRegion(region);

    // Compute adjusted weights for each candidate
    const adjustedWeights: number[] = candidates.map(name => {
      const base = baseWeights[name];
      const fit = shapeFitness(name, regionShape);
      const div = diversityMultiplier(name, region, ctx);
      return base * fit * div;
    });

    // Weighted random select
    const idx = rng.weighted(adjustedWeights);
    const chosen = candidates[idx];
    region.elementType = chosen;

    // Update context
    ctx.typeCounts[chosen] = (ctx.typeCounts[chosen] ?? 0) + 1;
    const meta = getMeta(chosen);
    if (meta) {
      for (const role of meta.roles) {
        ctx.roleCounts[role] = (ctx.roleCounts[role] ?? 0) + 1;
      }
    }
    ctx.placements.push({ region, elementType: chosen });
  }

  return { template, regions: leafRegions };
}
