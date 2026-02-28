import type { SeededRandom } from '../random';
import { type Region, createRegion } from './region';
import { type BSPOptions } from './grid';

export interface TemplateConfig {
  name: string;
  createRegions: (rng: SeededRandom) => Region[];
  bspOptions: Partial<BSPOptions>;
  elementWeights?: Record<string, number>;
  tagWeights?: Record<string, number>;
}

export const TEMPLATES: Record<string, TemplateConfig> = {
  'command-center': {
    name: 'command-center',
    createRegions: () => [
      createRegion('main', 0.0, 0.0, 0.65, 0.8, 0.005),
      createRegion('sidebar', 0.65, 0.0, 0.35, 1.0, 0.005),
      createRegion('status', 0.0, 0.8, 0.65, 0.2, 0.005),
    ],
    bspOptions: { maxDepth: 3, splitVariance: 0.2, minWidth: 0.1, minHeight: 0.1 },
    elementWeights: {
      panel: 2, graph: 2, waveform: 1, 'scrolling-numbers': 1,
      'text-label': 2, 'progress-bar': 1, 'status-readout': 1,
      'signal-bars': 1, 'ring-gauge': 1, 'bracket-frame': 1,
    },
  },

  'surveillance': {
    name: 'surveillance',
    createRegions: () => {
      const regions: Region[] = [];
      const cols = 3, rows = 3;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          regions.push(createRegion(`grid-${r}-${c}`, c / cols, r / rows, 1 / cols, 1 / rows, 0.005));
        }
      }
      return regions;
    },
    bspOptions: { maxDepth: 1, splitVariance: 0.15, minWidth: 0.15, minHeight: 0.15 },
    elementWeights: {
      'radar-sweep': 2, 'target-reticle': 2, 'bracket-frame': 2,
      waveform: 1, 'grid-overlay': 1, 'cross-scope': 1, 'orbital-dots': 1,
      'concentric-rings': 1,
    },
  },

  'diagnostic': {
    name: 'diagnostic',
    createRegions: () => [
      createRegion('left', 0.0, 0.0, 0.4, 1.0, 0.005),
      createRegion('top-right', 0.4, 0.0, 0.6, 0.5, 0.005),
      createRegion('bottom-right', 0.4, 0.5, 0.6, 0.5, 0.005),
    ],
    bspOptions: { maxDepth: 3, splitVariance: 0.25, minWidth: 0.12, minHeight: 0.1 },
    elementWeights: {
      graph: 3, waveform: 2, 'progress-bar': 2, 'ring-gauge': 2,
      'signal-bars': 2, 'arc-reactor': 1, 'status-readout': 1, 'text-label': 1,
    },
  },

  'tactical': {
    name: 'tactical',
    createRegions: () => [
      createRegion('center', 0.2, 0.15, 0.6, 0.7, 0.005),
      createRegion('top', 0.0, 0.0, 1.0, 0.15, 0.005),
      createRegion('bottom', 0.0, 0.85, 1.0, 0.15, 0.005),
      createRegion('left', 0.0, 0.15, 0.2, 0.7, 0.005),
      createRegion('right', 0.8, 0.15, 0.2, 0.7, 0.005),
    ],
    bspOptions: { maxDepth: 2, splitVariance: 0.2, minWidth: 0.08, minHeight: 0.06 },
    elementWeights: {
      'radar-sweep': 2, 'target-reticle': 2, 'tri-scanner': 2,
      'scrolling-numbers': 2, 'text-label': 2, 'status-readout': 1,
      'hex-grid': 1, 'bracket-frame': 1,
    },
  },

  'nerv': {
    name: 'nerv',
    createRegions: () => [
      createRegion('center', 0.25, 0.15, 0.5, 0.7, 0.005),
      createRegion('top-bar', 0.0, 0.0, 1.0, 0.15, 0.005),
      createRegion('bottom-bar', 0.0, 0.85, 1.0, 0.15, 0.005),
      createRegion('left-col', 0.0, 0.15, 0.25, 0.7, 0.005),
      createRegion('right-col', 0.75, 0.15, 0.25, 0.7, 0.005),
    ],
    bspOptions: { maxDepth: 3, splitVariance: 0.25, minWidth: 0.08, minHeight: 0.06 },
    elementWeights: {
      'hex-grid': 3, 'target-reticle': 3, 'concentric-rings': 2, 'diamond-gauge': 2,
      'rotating-geometry': 2, 'arc-reactor': 2, 'ring-gauge': 2,
      'tri-scanner': 1, 'data-cascade': 1, 'cross-scope': 1,
      'text-label': 1, 'status-readout': 1,
    },
  },

  'datastream': {
    name: 'datastream',
    createRegions: () => [
      createRegion('main', 0.0, 0.0, 0.7, 0.7, 0.005),
      createRegion('right', 0.7, 0.0, 0.3, 1.0, 0.005),
      createRegion('bottom', 0.0, 0.7, 0.7, 0.3, 0.005),
    ],
    bspOptions: { maxDepth: 3, splitVariance: 0.3, minWidth: 0.08, minHeight: 0.08 },
    elementWeights: {
      'data-cascade': 3, 'scrolling-numbers': 3, 'signal-bars': 2,
      waveform: 2, graph: 2, 'cross-scope': 1, 'orbital-dots': 1,
      'text-label': 1, 'status-readout': 1,
    },
  },

  'geometry': {
    name: 'geometry',
    createRegions: (rng) => {
      const regions: Region[] = [];
      const cols = rng.pick([2, 3, 4]);
      const rows = rng.pick([2, 3]);
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          regions.push(createRegion(`g-${r}-${c}`, c / cols, r / rows, 1 / cols, 1 / rows, 0.005));
        }
      }
      return regions;
    },
    bspOptions: { maxDepth: 1, splitVariance: 0.1, minWidth: 0.12, minHeight: 0.12 },
    elementWeights: {
      'rotating-geometry': 3, 'concentric-rings': 3, 'orbital-dots': 2,
      'diamond-gauge': 2, 'hex-grid': 2, 'target-reticle': 2,
      'tri-scanner': 1, 'arc-reactor': 1,
    },
  },
};

export function getTemplate(name: string, rng: SeededRandom): TemplateConfig {
  if (name === 'auto') {
    const keys = Object.keys(TEMPLATES);
    return TEMPLATES[rng.pick(keys)];
  }
  return TEMPLATES[name] ?? TEMPLATES['command-center'];
}

export function templateNames(): string[] {
  return ['auto', ...Object.keys(TEMPLATES)];
}
