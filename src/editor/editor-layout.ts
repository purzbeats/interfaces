import { createRegion, type Region } from '../layout/region';
import { getMeta } from '../elements/tags';

/* ---------- Data model ---------- */

export interface EditorRegion {
  id: string;
  x: number;       // normalized [0,1]
  y: number;        // normalized [0,1]
  width: number;    // normalized [0,1]
  height: number;   // normalized [0,1]
  padding: number;
  elementType: string;
}

export interface EditorLayout {
  name: string;
  palette: string;
  regions: EditorRegion[];
  created: number;
  modified: number;
}

/* ---------- Helpers ---------- */

const GRID_COLS = 12;
const GRID_SIZE = 1 / GRID_COLS;
const MIN_SIZE = 0.05;

/** Convert EditorRegion to engine Region for createElement. */
export function toRegion(er: EditorRegion): Region {
  const region = createRegion(er.id, er.x, er.y, er.width, er.height, er.padding);
  region.elementType = er.elementType;
  return region;
}

/** Snap a value to 12-column grid increments. */
export function snapToGrid(value: number, gridSize: number = GRID_SIZE): number {
  return Math.round(value / gridSize) * gridSize;
}

/** Enforce minimum size and keep within [0,1] bounds. */
export function clampRegion(region: EditorRegion): EditorRegion {
  let { x, y, width, height } = region;
  width = Math.max(MIN_SIZE, width);
  height = Math.max(MIN_SIZE, height);
  x = Math.max(0, Math.min(1 - width, x));
  y = Math.max(0, Math.min(1 - height, y));
  return { ...region, x, y, width, height };
}

/** Check if two regions overlap (with a small tolerance). */
export function regionsOverlap(a: EditorRegion, b: EditorRegion): boolean {
  const tol = 0.001;
  return !(
    a.x + a.width <= b.x + tol ||
    b.x + b.width <= a.x + tol ||
    a.y + a.height <= b.y + tol ||
    b.y + b.height <= a.y + tol
  );
}

/**
 * Capture the current generative composition into an EditorLayout.
 * `regions` come from the engine's current composition.
 */
export function captureCurrentLayout(
  regions: Region[],
  elementTypeMap: Map<string, string>,
  paletteName: string,
): EditorLayout {
  const now = Date.now();
  const editorRegions: EditorRegion[] = [];

  for (const r of regions) {
    if (r.isDivider) continue; // skip dividers
    const elementType = r.elementType ?? elementTypeMap.get(r.id) ?? 'panel';
    editorRegions.push({
      id: r.id,
      x: r.x,
      y: r.y,
      width: r.width,
      height: r.height,
      padding: r.padding,
      elementType,
    });
  }

  return {
    name: 'Untitled',
    palette: paletteName,
    regions: editorRegions,
    created: now,
    modified: now,
  };
}

/** Default region size based on element's SizeTag metadata. */
export function defaultRegionSize(elementType: string): { w: number; h: number } {
  const meta = getMeta(elementType);
  if (!meta) return { w: 2 * GRID_SIZE, h: 2 * GRID_SIZE };

  const sizes = meta.sizes;
  if (sizes.includes('needs-large')) return { w: 4 * GRID_SIZE, h: 3 * GRID_SIZE };
  if (sizes.includes('needs-medium')) return { w: 3 * GRID_SIZE, h: 2 * GRID_SIZE };
  // works-small or default
  return { w: 2 * GRID_SIZE, h: 2 * GRID_SIZE };
}

/** Create a new blank EditorLayout. */
export function createBlankLayout(paletteName: string): EditorLayout {
  return {
    name: 'Untitled',
    palette: paletteName,
    regions: [],
    created: Date.now(),
    modified: Date.now(),
  };
}

/** Generate a unique region ID. */
let regionCounter = 0;
export function nextRegionId(): string {
  return `er_${++regionCounter}_${Date.now().toString(36)}`;
}
