export type ShapeTag = 'rectangular' | 'linear' | 'radial';
export type RoleTag = 'structural' | 'gauge' | 'scanner' | 'data-display' | 'text' | 'decorative';
export type MoodTag = 'tactical' | 'diagnostic' | 'ambient';
export type SizeTag = 'works-small' | 'needs-medium' | 'needs-large';

export interface ElementMeta {
  shape: ShapeTag;
  roles: RoleTag[];
  moods: MoodTag[];
  sizes: SizeTag[];
}

const ELEMENT_META: Record<string, ElementMeta> = {
  'panel':              { shape: 'rectangular', roles: ['structural'],               moods: ['ambient'],                sizes: ['works-small', 'needs-medium', 'needs-large'] },
  'grid-overlay':       { shape: 'rectangular', roles: ['scanner'],                  moods: ['tactical'],               sizes: ['needs-medium', 'needs-large'] },
  'graph':              { shape: 'rectangular', roles: ['data-display'],             moods: ['diagnostic'],             sizes: ['needs-medium'] },
  'scrolling-numbers':  { shape: 'rectangular', roles: ['data-display', 'text'],     moods: ['tactical', 'diagnostic'], sizes: ['works-small', 'needs-medium'] },
  'data-cascade':       { shape: 'rectangular', roles: ['data-display', 'decorative'], moods: ['ambient'],             sizes: ['needs-medium', 'needs-large'] },
  'bracket-frame':      { shape: 'rectangular', roles: ['structural', 'scanner'],    moods: ['tactical'],               sizes: ['needs-medium', 'needs-large'] },
  'signal-bars':        { shape: 'rectangular', roles: ['data-display', 'gauge'],    moods: ['diagnostic'],             sizes: ['works-small', 'needs-medium'] },
  'waveform':           { shape: 'linear',      roles: ['data-display'],             moods: ['diagnostic'],             sizes: ['works-small'] },
  'progress-bar':       { shape: 'linear',      roles: ['gauge'],                    moods: ['diagnostic'],             sizes: ['works-small'] },
  'separator':          { shape: 'linear',      roles: ['structural'],               moods: ['ambient'],                sizes: ['works-small'] },
  'text-label':         { shape: 'linear',      roles: ['text'],                     moods: ['ambient', 'tactical'],    sizes: ['works-small'] },
  'status-readout':     { shape: 'linear',      roles: ['text'],                     moods: ['tactical', 'diagnostic'], sizes: ['works-small'] },
  'radar-sweep':        { shape: 'radial',      roles: ['scanner'],                  moods: ['tactical'],               sizes: ['needs-medium', 'needs-large'] },
  'target-reticle':     { shape: 'radial',      roles: ['scanner'],                  moods: ['tactical'],               sizes: ['needs-medium'] },
  'concentric-rings':   { shape: 'radial',      roles: ['decorative'],               moods: ['ambient'],                sizes: ['needs-medium'] },
  'diamond-gauge':      { shape: 'radial',      roles: ['gauge'],                    moods: ['tactical', 'diagnostic'], sizes: ['needs-medium'] },
  'tri-scanner':        { shape: 'radial',      roles: ['scanner'],                  moods: ['tactical'],               sizes: ['needs-medium'] },
  'arc-reactor':        { shape: 'radial',      roles: ['gauge'],                    moods: ['diagnostic'],             sizes: ['needs-medium'] },
  'ring-gauge':         { shape: 'radial',      roles: ['gauge'],                    moods: ['diagnostic'],             sizes: ['needs-medium'] },
  'rotating-geometry':  { shape: 'radial',      roles: ['decorative'],               moods: ['ambient'],                sizes: ['needs-medium'] },
  'orbital-dots':       { shape: 'radial',      roles: ['decorative'],               moods: ['ambient'],                sizes: ['needs-medium'] },
  'cross-scope':        { shape: 'radial',      roles: ['data-display'],             moods: ['diagnostic'],             sizes: ['needs-medium'] },
  'hex-grid':           { shape: 'radial',      roles: ['decorative', 'scanner'],    moods: ['tactical'],               sizes: ['needs-medium', 'needs-large'] },
};

export function getMeta(name: string): ElementMeta | undefined {
  return ELEMENT_META[name];
}

export function elementsByTag(tag: string): string[] {
  return Object.entries(ELEMENT_META)
    .filter(([, meta]) =>
      meta.shape === tag ||
      meta.roles.includes(tag as RoleTag) ||
      meta.moods.includes(tag as MoodTag) ||
      meta.sizes.includes(tag as SizeTag)
    )
    .map(([name]) => name);
}

export function allElementNames(): string[] {
  return Object.keys(ELEMENT_META);
}
