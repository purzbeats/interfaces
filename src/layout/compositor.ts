import type { SeededRandom } from '../random';
import type { Region } from './region';
import { subdivide, resetRegionCounter } from './grid';
import { getTemplate, type TemplateConfig } from './templates';
import { getMeta, allElementNames } from '../elements/tags';

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
  const template = getTemplate(templateName, rng);
  const topRegions = template.createRegions(rng);

  // Subdivide each top-level region
  const leafRegions: Region[] = [];
  for (const region of topRegions) {
    const leaves = subdivide(region, rng, template.bspOptions);
    leafRegions.push(...leaves);
  }

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

  // Process regions sequentially, building context
  for (const region of leafRegions) {
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
