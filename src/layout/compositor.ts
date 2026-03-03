import type { SeededRandom } from '../random';
import type { Region, RegionTier } from './region';
import { getTemplate, type TemplateConfig } from './templates';
import { getPattern, randomPattern } from './patterns';
import { getMeta, allElementNames } from '../elements/tags';
import { injectDividers, resetDividerCounter } from './dividers';

export interface CompositorResult {
  template: TemplateConfig;
  regions: Region[];
}

// --- Weight resolution ---

function resolveWeights(template: TemplateConfig): Record<string, number> {
  const weights: Record<string, number> = {};

  // Baseline: every registered element gets a small default weight
  for (const name of allElementNames()) {
    weights[name] = 0.5;
  }

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

  if (template.elementWeights) {
    for (const [name, w] of Object.entries(template.elementWeights)) {
      weights[name] = w;
    }
  }

  return weights;
}

// --- Region shape classification ---

type RegionShape = 'square' | 'wide' | 'tall' | 'thin-strip';

let screenAspect = 16 / 9;

function classifyRegion(region: Region): RegionShape {
  const pixelAspect = (region.width / region.height) * screenAspect;
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
      return 0.4;
    case 'linear':
      if (regionShape === 'thin-strip') return 2.0;
      if (regionShape === 'wide' || regionShape === 'tall') return 1.2;
      return 0.6;
    case 'rectangular':
      return 1.0;
    default:
      return 1.0;
  }
}

// --- Adjacency detection ---

const EDGE_TOLERANCE = 0.02;

function areAdjacent(a: Region, b: Region): boolean {
  const aRight = a.x + a.width;
  const bRight = b.x + b.width;
  const aBottom = a.y + a.height;
  const bBottom = b.y + b.height;

  const vertOverlap = a.y < bBottom - EDGE_TOLERANCE && b.y < aBottom - EDGE_TOLERANCE;
  const horizOverlap = a.x < bRight - EDGE_TOLERANCE && b.x < aRight - EDGE_TOLERANCE;

  if (vertOverlap && (
    Math.abs(aRight - b.x) < EDGE_TOLERANCE ||
    Math.abs(bRight - a.x) < EDGE_TOLERANCE
  )) return true;

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
  const useCount = ctx.typeCounts[elementName] ?? 0;

  if (useCount >= 1 && elementName !== 'separator') {
    return 0;
  }

  let mult = 1.0;

  const meta = getMeta(elementName);
  if (meta) {
    for (const placed of ctx.placements) {
      if (!areAdjacent(region, placed.region)) continue;
      const placedMeta = getMeta(placed.elementType);
      if (placedMeta && meta.roles.some(r => placedMeta.roles.includes(r))) {
        mult *= 0.4;
      }
    }
  }

  if (meta) {
    for (const role of meta.roles) {
      if ((ctx.roleCounts[role] ?? 0) >= 2) {
        mult *= 0.5;
      }
    }
  }

  return mult;
}

// --- Mood coherence ---

type Mood = 'tactical' | 'diagnostic' | 'ambient';
const ALL_MOODS: Mood[] = ['tactical', 'diagnostic', 'ambient'];

function pickDominantMood(rng: SeededRandom): Mood {
  return rng.pick(ALL_MOODS);
}

function moodBoost(elementName: string, dominantMood: Mood): number {
  const meta = getMeta(elementName);
  if (!meta) return 1.0;
  if (meta.moods.includes(dominantMood)) return 2.0;
  return 0.5;
}

// --- Size fitness ---

type RegionSizeBucket = 'small' | 'medium' | 'large';

function classifyRegionSize(region: Region): RegionSizeBucket {
  const area = region.width * region.height;
  if (area < 0.03) return 'small';
  if (area < 0.10) return 'medium';
  return 'large';
}

function sizeFitness(elementName: string, regionSize: RegionSizeBucket): number {
  const meta = getMeta(elementName);
  if (!meta) return 1.0;
  const sizes = meta.sizes;

  switch (regionSize) {
    case 'small':
      if (sizes.includes('works-small')) return 1.2;
      if (sizes.includes('needs-medium')) return 0.3;
      return 0.1;
    case 'medium':
      if (sizes.includes('needs-medium')) return 1.3;
      if (sizes.includes('works-small')) return 0.8;
      if (sizes.includes('needs-large')) return 0.5;
      return 1.0;
    case 'large':
      if (sizes.includes('needs-large')) return 1.5;
      if (sizes.includes('needs-medium')) return 1.0;
      return 0.4;
  }
}

// --- Tier affinity multiplier ---

function tierAffinityMultiplier(elementName: string, tier: RegionTier): number {
  const meta = getMeta(elementName);
  if (!meta) return 1.0;
  const sizes = meta.sizes;

  switch (tier) {
    case 'hero':
      if (sizes.includes('needs-large')) return 3.0;
      if (sizes.includes('needs-medium')) return 0.5;
      if (sizes.includes('works-small')) return 0.1;
      return 1.0;
    case 'panel':
      if (sizes.includes('needs-medium')) return 2.5;
      if (sizes.includes('needs-large')) return 0.4;
      if (sizes.includes('works-small')) return 0.3;
      return 1.0;
    case 'widget':
      if (sizes.includes('works-small')) return 3.0;
      if (sizes.includes('needs-medium')) return 0.3;
      if (sizes.includes('needs-large')) return 0.05;
      return 1.0;
  }
}

// --- Tier demotion after divider slicing ---

const HERO_MIN_AREA = 0.06;

function demoteSlicedHeroes(regions: Region[]): void {
  for (const r of regions) {
    if (r.tier === 'hero' && r.width * r.height < HERO_MIN_AREA) {
      r.tier = 'panel';
    }
  }
}

// --- Compose ---

/**
 * Layout engine: selects template, generates tiered pattern regions,
 * assigns element types with tier affinity, shape fitness, and diversity.
 */
export function compose(
  templateName: string,
  rng: SeededRandom,
  canvasAspect?: number
): CompositorResult {
  if (canvasAspect && canvasAspect > 0) screenAspect = canvasAspect;
  resetDividerCounter();
  const template = getTemplate(templateName, rng);

  // 1. Generate regions from pattern
  const patternName = template.layoutPattern;
  const pattern = patternName ? getPattern(patternName) : undefined;
  const patternRegions = pattern
    ? pattern.generate(rng)
    : randomPattern(rng).generate(rng);

  // 2. Inject dividers (slice regions; dividers are pre-assigned)
  const { contentRegions, dividerRegions } = injectDividers(patternRegions, rng);

  // Demote heroes that got sliced too small
  demoteSlicedHeroes(contentRegions);

  const allRegions = [...contentRegions, ...dividerRegions];

  // 3. Resolve base weights
  const baseWeights = resolveWeights(template);
  const candidates = Object.keys(baseWeights);

  if (candidates.length === 0) {
    return { template, regions: allRegions };
  }

  // Cap content regions to available candidate count
  let assignable = contentRegions.filter(r => !r.isDivider);
  if (assignable.length > candidates.length) {
    assignable.sort((a, b) => (b.width * b.height) - (a.width * a.height));
    const toDrop = new Set(assignable.slice(candidates.length));
    for (let i = allRegions.length - 1; i >= 0; i--) {
      if (toDrop.has(allRegions[i])) {
        allRegions.splice(i, 1);
      }
    }
    assignable = assignable.slice(0, candidates.length);
  }

  // 4. Pick dominant mood
  const dominantMood = pickDominantMood(rng);

  // Placement context
  const ctx: PlacementContext = {
    typeCounts: {},
    roleCounts: {},
    placements: [],
  };

  // 5. Assign tier-by-tier: heroes first, then panels, then widgets
  const tierOrder: RegionTier[] = ['hero', 'panel', 'widget'];
  const regionsByTier: Record<RegionTier, Region[]> = { hero: [], panel: [], widget: [] };

  for (const r of assignable) {
    const tier = r.tier ?? 'widget';
    regionsByTier[tier].push(r);
  }

  // Within each tier, assign larger regions first
  for (const tier of tierOrder) {
    const tierRegions = regionsByTier[tier];
    tierRegions.sort((a, b) => (b.width * b.height) - (a.width * a.height));

    for (const region of tierRegions) {
      const regionShape = classifyRegion(region);
      const regionSize = classifyRegionSize(region);
      const regionTier = region.tier ?? 'widget';

      const adjustedWeights: number[] = candidates.map(name => {
        const base = baseWeights[name];
        const fit = shapeFitness(name, regionShape);
        const size = sizeFitness(name, regionSize);
        const mood = moodBoost(name, dominantMood);
        const div = diversityMultiplier(name, region, ctx);
        const tierAff = tierAffinityMultiplier(name, regionTier);
        return base * fit * size * mood * div * tierAff;
      });

      const total = adjustedWeights.reduce((a, b) => a + b, 0);
      const chosen = total > 0
        ? candidates[rng.weighted(adjustedWeights)]
        : 'panel';
      region.elementType = chosen;

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

  return { template, regions: allRegions };
}

/**
 * Pick a single element type for a region, reusing the same scoring logic as compose().
 * Used by rolling swap to replace one element at a time.
 */
export function pickElementForRegion(
  region: Region,
  currentTypes: Set<string>,
  excludeType: string,
  rng: SeededRandom,
  canvasAspect?: number
): string {
  if (canvasAspect && canvasAspect > 0) screenAspect = canvasAspect;

  const candidates = allElementNames();
  if (candidates.length === 0) return 'panel';

  const regionShape = classifyRegion(region);
  const regionSize = classifyRegionSize(region);
  const regionTier = region.tier ?? 'widget';
  const dominantMood = pickDominantMood(rng);

  // Build a lightweight placement context from currentTypes
  const ctx: PlacementContext = {
    typeCounts: {},
    roleCounts: {},
    placements: [],
  };
  for (const t of currentTypes) {
    ctx.typeCounts[t] = (ctx.typeCounts[t] ?? 0) + 1;
    const meta = getMeta(t);
    if (meta) {
      for (const role of meta.roles) {
        ctx.roleCounts[role] = (ctx.roleCounts[role] ?? 0) + 1;
      }
    }
  }

  const adjustedWeights: number[] = candidates.map(name => {
    if (name === excludeType) return 0;
    const base = 0.5; // default baseline weight
    const fit = shapeFitness(name, regionShape);
    const size = sizeFitness(name, regionSize);
    const mood = moodBoost(name, dominantMood);
    const div = diversityMultiplier(name, region, ctx);
    const tierAff = tierAffinityMultiplier(name, regionTier);
    return base * fit * size * mood * div * tierAff;
  });

  const total = adjustedWeights.reduce((a, b) => a + b, 0);
  if (total <= 0) return 'panel';
  return candidates[rng.weighted(adjustedWeights)];
}
