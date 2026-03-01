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
  'concentric-rings':   { shape: 'radial',      roles: ['decorative'],               moods: ['ambient'],                sizes: ['needs-medium'] },
  'ring-gauge':         { shape: 'radial',      roles: ['gauge'],                    moods: ['diagnostic'],             sizes: ['needs-medium'] },
  'cross-scope':        { shape: 'radial',      roles: ['data-display'],             moods: ['diagnostic'],             sizes: ['needs-medium'] },
  'hex-grid':           { shape: 'radial',      roles: ['decorative', 'scanner'],    moods: ['tactical'],               sizes: ['needs-medium', 'needs-large'] },
  'threat-meter':       { shape: 'linear',      roles: ['gauge'],                    moods: ['tactical'],               sizes: ['works-small'] },
  'scan-line':          { shape: 'linear',      roles: ['scanner', 'decorative'],    moods: ['ambient', 'tactical'],    sizes: ['works-small', 'needs-medium'] },
  'binary-stream':      { shape: 'linear',      roles: ['data-display', 'decorative'], moods: ['ambient', 'diagnostic'], sizes: ['works-small'] },
  'clock-display':      { shape: 'linear',      roles: ['text', 'data-display'],     moods: ['tactical', 'diagnostic'], sizes: ['works-small'] },
  'freq-analyzer':      { shape: 'rectangular', roles: ['data-display', 'gauge'],    moods: ['diagnostic'],             sizes: ['works-small', 'needs-medium'] },
  'phase-indicator':    { shape: 'radial',      roles: ['gauge'],                    moods: ['tactical', 'diagnostic'], sizes: ['works-small', 'needs-medium'] },
  'segment-display':    { shape: 'rectangular', roles: ['text', 'gauge'],            moods: ['tactical'],               sizes: ['works-small', 'needs-medium'] },
  'thermal-map':        { shape: 'rectangular', roles: ['data-display', 'scanner'],  moods: ['tactical', 'diagnostic'], sizes: ['needs-medium'] },
  'memory-map':         { shape: 'rectangular', roles: ['data-display', 'decorative'], moods: ['diagnostic', 'ambient'], sizes: ['needs-medium'] },
  'coord-grid':         { shape: 'rectangular', roles: ['scanner', 'data-display'],  moods: ['tactical'],               sizes: ['needs-medium', 'needs-large'] },
  'level-rings':        { shape: 'radial',      roles: ['gauge', 'data-display'],    moods: ['diagnostic'],             sizes: ['needs-medium'] },
  'radial-scanner':     { shape: 'radial',      roles: ['scanner'],                  moods: ['tactical'],               sizes: ['needs-medium', 'needs-large'] },
  'hex-tunnel':         { shape: 'radial',      roles: ['decorative'],               moods: ['ambient', 'tactical'],    sizes: ['needs-medium', 'needs-large'] },
  'dot-matrix':         { shape: 'rectangular', roles: ['data-display', 'decorative'], moods: ['ambient', 'diagnostic'], sizes: ['needs-medium'] },
  'orbital-display':    { shape: 'radial',      roles: ['data-display', 'decorative'], moods: ['ambient'],              sizes: ['needs-medium', 'needs-large'] },
  'pulse-wave':         { shape: 'linear',      roles: ['data-display', 'gauge'],    moods: ['diagnostic'],             sizes: ['works-small', 'needs-medium'] },
  'spectrogram':        { shape: 'rectangular', roles: ['data-display'],             moods: ['diagnostic'],             sizes: ['needs-medium'] },
  'particle-field':     { shape: 'rectangular', roles: ['decorative', 'data-display'], moods: ['ambient'],              sizes: ['needs-medium', 'needs-large'] },
  'topology-map':       { shape: 'rectangular', roles: ['scanner', 'decorative'],    moods: ['tactical', 'ambient'],    sizes: ['needs-medium', 'needs-large'] },
  'target-lock':        { shape: 'radial',      roles: ['scanner', 'gauge'],         moods: ['tactical'],               sizes: ['needs-medium', 'needs-large'] },
  'voltage-arc':        { shape: 'linear',      roles: ['decorative', 'data-display'], moods: ['ambient', 'diagnostic'],  sizes: ['works-small', 'needs-medium'] },
  'countdown-timer':    { shape: 'rectangular', roles: ['text', 'gauge'],            moods: ['tactical'],               sizes: ['works-small', 'needs-medium'] },
  'heart-monitor':      { shape: 'linear',      roles: ['data-display', 'gauge'],    moods: ['diagnostic', 'tactical'], sizes: ['works-small', 'needs-medium'] },

  'uptime-counter':     { shape: 'linear',      roles: ['text', 'data-display'],     moods: ['diagnostic', 'ambient'],  sizes: ['works-small'] },

  'pressure-gauge':     { shape: 'radial',      roles: ['gauge'],                    moods: ['diagnostic', 'tactical'], sizes: ['works-small', 'needs-medium'] },

  'oscilloscope':       { shape: 'rectangular', roles: ['data-display', 'gauge'],    moods: ['diagnostic'],             sizes: ['needs-medium'] },
  'audio-meter':        { shape: 'rectangular', roles: ['gauge', 'data-display'],    moods: ['diagnostic'],             sizes: ['works-small', 'needs-medium'] },


  'depth-sounder':      { shape: 'rectangular', roles: ['data-display', 'scanner'],  moods: ['tactical'],               sizes: ['needs-medium'] },
  'satellite-track':    { shape: 'rectangular', roles: ['scanner', 'data-display'],  moods: ['tactical'],               sizes: ['needs-medium', 'needs-large'] },
  'network-graph':      { shape: 'rectangular', roles: ['data-display', 'decorative'], moods: ['diagnostic', 'ambient'], sizes: ['needs-medium', 'needs-large'] },
  'cpu-cores':          { shape: 'rectangular', roles: ['data-display', 'gauge'],    moods: ['diagnostic'],             sizes: ['works-small', 'needs-medium'] },
  'power-grid':         { shape: 'rectangular', roles: ['data-display', 'structural'], moods: ['diagnostic'],           sizes: ['needs-medium', 'needs-large'] },
  'star-field':         { shape: 'rectangular', roles: ['decorative'],               moods: ['ambient'],                sizes: ['needs-medium', 'needs-large'] },
  'warp-tunnel':        { shape: 'radial',      roles: ['decorative'],               moods: ['ambient'],                sizes: ['needs-medium', 'needs-large'] },
  'wave-interference':  { shape: 'rectangular', roles: ['decorative', 'data-display'], moods: ['ambient', 'diagnostic'], sizes: ['needs-medium', 'needs-large'] },
  'flight-ladder':      { shape: 'linear',      roles: ['gauge', 'text'],            moods: ['tactical'],               sizes: ['works-small', 'needs-medium'] },
  'data-table':         { shape: 'rectangular', roles: ['data-display', 'text'],     moods: ['diagnostic'],             sizes: ['needs-medium', 'needs-large'] },
  'boot-sequence':      { shape: 'rectangular', roles: ['text', 'data-display'],     moods: ['diagnostic', 'ambient'],  sizes: ['needs-medium', 'needs-large'] },

  'cipher-wheel':       { shape: 'radial',      roles: ['data-display', 'decorative'], moods: ['tactical', 'ambient'],  sizes: ['needs-medium', 'needs-large'] },
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
