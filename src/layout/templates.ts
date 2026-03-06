import type { SeededRandom } from '../random';
import { type Region, createRegion } from './region';
import { type BSPOptions } from './grid';

export interface TemplateConfig {
  name: string;
  layoutPattern?: string;
  dominantMood?: 'tactical' | 'diagnostic' | 'ambient';
  createRegions: (rng: SeededRandom) => Region[];
  bspOptions: Partial<BSPOptions>;
  elementWeights?: Record<string, number>;
  tagWeights?: Record<string, number>;
}

export const TEMPLATES: Record<string, TemplateConfig> = {
  'command-center': {
    name: 'command-center',
    layoutPattern: 'main-sidebar',
    createRegions: () => [
      createRegion('main', 0.0, 0.0, 0.65, 0.8, 0.005),
      createRegion('sidebar', 0.65, 0.0, 0.35, 1.0, 0.005),
      createRegion('status', 0.0, 0.8, 0.65, 0.2, 0.005),
    ],
    bspOptions: { maxDepth: 2, splitVariance: 0.2, minWidth: 0.14, minHeight: 0.12 },
    elementWeights: {
      graph: 2, waveform: 2, 'scrolling-numbers': 1,
      'text-label': 2, 'progress-bar': 1, 'status-readout': 1,
      'signal-bars': 1, 'ring-gauge': 1, 'bracket-frame': 1,
      'threat-meter': 1, 'clock-display': 1, 'segment-display': 1,
      'freq-analyzer': 1, 'binary-stream': 1, 'scan-line': 1,
      'radar-sweep': 1, 'cross-scope': 1,
      'pulse-wave': 2, 'spectrogram': 1, 'target-lock': 1,
      'countdown-timer': 2, 'heart-monitor': 1, 'flight-ladder': 1,
      'cpu-cores': 1, 'audio-meter': 1, 'data-table': 1,
      'uptime-counter': 1, 'pressure-gauge': 1,
      'neural-mesh': 1, 'rule-grid': 1, 'harmonograph': 1,
      'grid-distortion': 1,
    },
  },

  'surveillance': {
    name: 'surveillance',
    layoutPattern: 'dual-monitor',
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
    bspOptions: { maxDepth: 0, splitVariance: 0.15, minWidth: 0.15, minHeight: 0.15 },
    elementWeights: {
      'radar-sweep': 2, 'bracket-frame': 2, 'cross-scope': 2,
      waveform: 1, 'grid-overlay': 1, 'concentric-rings': 1,
      'radial-scanner': 2, 'scan-line': 1, 'coord-grid': 1,
      'ring-gauge': 1, 'level-rings': 1,
      'target-lock': 2, 'hex-tunnel': 1, 'orbital-display': 1,
      'satellite-track': 2, 'depth-sounder': 1, 'cipher-wheel': 1,
      'pressure-gauge': 1, 'network-graph': 1,
      'boids-swarm': 2, 'flow-field': 1, 'neural-mesh': 1,
    },
  },

  'diagnostic': {
    name: 'diagnostic',
    layoutPattern: 'grid-dashboard',
    createRegions: () => [
      createRegion('left', 0.0, 0.0, 0.4, 1.0, 0.005),
      createRegion('top-right', 0.4, 0.0, 0.6, 0.5, 0.005),
      createRegion('bottom-right', 0.4, 0.5, 0.6, 0.5, 0.005),
    ],
    bspOptions: { maxDepth: 2, splitVariance: 0.25, minWidth: 0.14, minHeight: 0.12 },
    elementWeights: {
      graph: 3, waveform: 2, 'progress-bar': 2, 'ring-gauge': 2,
      'signal-bars': 2, 'status-readout': 1, 'text-label': 1,
      'freq-analyzer': 2, 'level-rings': 2, 'phase-indicator': 1, 'threat-meter': 1,
      'cross-scope': 1, 'clock-display': 1, 'scan-line': 1, 'segment-display': 1,
      'pulse-wave': 2, 'spectrogram': 2, 'dot-matrix': 1,
      'oscilloscope': 2, 'audio-meter': 2, 'cpu-cores': 2,
      'heart-monitor': 2, 'power-grid': 1, 'data-table': 1,
      'boot-sequence': 1, 'voltage-arc': 1, 'uptime-counter': 1,
      'thermal-map': 1, 'memory-map': 1,
      'lorenz-attractor': 2, 'dna-helix': 2, 'pendulum-wave': 1,
      'rule-grid': 1, 'neural-mesh': 1, 'plasma-field': 1,
      'grid-distortion': 2,
    },
  },

  'tactical': {
    name: 'tactical',
    layoutPattern: 'hud-frame',
    createRegions: () => [
      createRegion('center', 0.2, 0.15, 0.6, 0.7, 0.005),
      createRegion('top', 0.0, 0.0, 1.0, 0.15, 0.005),
      createRegion('bottom', 0.0, 0.85, 1.0, 0.15, 0.005),
      createRegion('left', 0.0, 0.15, 0.2, 0.7, 0.005),
      createRegion('right', 0.8, 0.15, 0.2, 0.7, 0.005),
    ],
    bspOptions: { maxDepth: 1, splitVariance: 0.2, minWidth: 0.1, minHeight: 0.08 },
    elementWeights: {
      'radar-sweep': 2, 'scrolling-numbers': 2, 'text-label': 2, 'status-readout': 1,
      'hex-grid': 1, 'bracket-frame': 1,
      'radial-scanner': 2, 'coord-grid': 2, 'scan-line': 1, 'threat-meter': 1,
      'segment-display': 1, 'clock-display': 1, 'phase-indicator': 1,
      'cross-scope': 1, 'waveform': 1,
      'target-lock': 2, 'topology-map': 1, 'hex-tunnel': 1,
      'countdown-timer': 2, 'flight-ladder': 2, 'depth-sounder': 1,
      'satellite-track': 2, 'pressure-gauge': 1,
      'boids-swarm': 1, 'harmonograph': 1, 'fractal-tree': 1,
    },
  },

  'nerv': {
    name: 'nerv',
    layoutPattern: 'center-focus',
    createRegions: () => [
      createRegion('center', 0.25, 0.15, 0.5, 0.7, 0.005),
      createRegion('top-bar', 0.0, 0.0, 1.0, 0.15, 0.005),
      createRegion('bottom-bar', 0.0, 0.85, 1.0, 0.15, 0.005),
      createRegion('left-col', 0.0, 0.15, 0.25, 0.7, 0.005),
      createRegion('right-col', 0.75, 0.15, 0.25, 0.7, 0.005),
    ],
    bspOptions: { maxDepth: 2, splitVariance: 0.25, minWidth: 0.1, minHeight: 0.08 },
    elementWeights: {
      'hex-grid': 3, 'concentric-rings': 2, 'ring-gauge': 2,
      'data-cascade': 1, 'cross-scope': 1,
      'text-label': 1, 'status-readout': 1,
      'level-rings': 2, 'phase-indicator': 1, 'radial-scanner': 1,
      'segment-display': 1, 'bracket-frame': 1,
      'scan-line': 1, 'waveform': 1,
      'hex-tunnel': 3, 'orbital-display': 2, 'dot-matrix': 1, 'target-lock': 1,
      'warp-tunnel': 2, 'cipher-wheel': 2, 'wave-interference': 1,
      'star-field': 1, 'voltage-arc': 1, 'boot-sequence': 1,
      'plasma-field': 2, 'lorenz-attractor': 1, 'dna-helix': 1,
      'fractal-tree': 1, 'flow-field': 1, 'pendulum-wave': 1,
    },
  },

  'datastream': {
    name: 'datastream',
    layoutPattern: 'asymmetric-split',
    createRegions: () => [
      createRegion('main', 0.0, 0.0, 0.7, 0.7, 0.005),
      createRegion('right', 0.7, 0.0, 0.3, 1.0, 0.005),
      createRegion('bottom', 0.0, 0.7, 0.7, 0.3, 0.005),
    ],
    bspOptions: { maxDepth: 2, splitVariance: 0.3, minWidth: 0.12, minHeight: 0.1 },
    elementWeights: {
      'data-cascade': 3, 'scrolling-numbers': 3, 'signal-bars': 2,
      waveform: 2, graph: 2, 'cross-scope': 1, 'text-label': 1, 'status-readout': 1,
      'binary-stream': 2, 'freq-analyzer': 1, 'clock-display': 1,
      'scan-line': 1, 'progress-bar': 1, 'threat-meter': 1,
      'spectrogram': 2, 'pulse-wave': 1, 'dot-matrix': 1, 'particle-field': 1,
      'uptime-counter': 1, 'boot-sequence': 2, 'network-graph': 2,
      'data-table': 2, 'cpu-cores': 1, 'voltage-arc': 1,
      'harmonograph': 2, 'flow-field': 1, 'neural-mesh': 1, 'rule-grid': 1,
      'grid-distortion': 1,
    },
  },

  'geometry': {
    name: 'geometry',
    layoutPattern: 'cockpit',
    createRegions: (rng) => {
      const regions: Region[] = [];
      const cols = rng.pick([2, 3]);
      const rows = rng.pick([2, 3]);
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          regions.push(createRegion(`g-${r}-${c}`, c / cols, r / rows, 1 / cols, 1 / rows, 0.005));
        }
      }
      return regions;
    },
    bspOptions: { maxDepth: 0, splitVariance: 0.1, minWidth: 0.15, minHeight: 0.15 },
    elementWeights: {
      'concentric-rings': 3, 'hex-grid': 2,
      'level-rings': 2, 'radial-scanner': 2, 'phase-indicator': 1,
      'coord-grid': 1, 'cross-scope': 2, 'ring-gauge': 1,
      'radar-sweep': 2,
      'hex-tunnel': 3, 'orbital-display': 2, 'topology-map': 1, 'target-lock': 1,
      'particle-field': 1, 'dot-matrix': 1,
      'warp-tunnel': 2, 'cipher-wheel': 2, 'pressure-gauge': 1,
      'wave-interference': 2, 'star-field': 1,
      'lorenz-attractor': 2, 'pendulum-wave': 2, 'plasma-field': 1,
      'dna-helix': 1, 'fractal-tree': 1, 'boids-swarm': 1,
      'grid-distortion': 2,
    },
  },
  'biblically-accurate': {
    name: 'biblically-accurate',
    layoutPattern: 'radial-sanctum',
    createRegions: () => [
      createRegion('center', 0.40, 0.40, 0.20, 0.20, 0.005),
      createRegion('inner-ring', 0.20, 0.20, 0.60, 0.60, 0.005),
      createRegion('outer-ring', 0.0, 0.0, 1.0, 1.0, 0.005),
    ],
    bspOptions: { maxDepth: 0, splitVariance: 0.1, minWidth: 0.12, minHeight: 0.1 },
    elementWeights: {
      'watching-eye': 4, 'spiral-vortex': 3, 'clock-melt': 3,
      'concentric-rings': 3, 'iris-aperture': 2, 'cipher-wheel': 2,
      'data-rings': 2, 'ring-gauge': 2, 'level-rings': 2,
      'breathing-grid': 2, 'infinite-hallway': 2, 'static-channel': 2,
      'corrupted-text': 2, 'face-brackets': 2,
      'hex-tunnel': 2, 'warp-tunnel': 2, 'orbital-display': 2,
      'radial-scanner': 1, 'radar-sweep': 1, 'target-lock': 1,
      'harmonograph': 1, 'plasma-field': 1, 'star-field': 1,
    },
  },
  'biolab': {
    name: 'biolab',
    layoutPattern: 'culture-plate',
    createRegions: () => [
      createRegion('specimen', 0.08, 0.0, 0.52, 0.58, 0.005),
      createRegion('instruments-right', 0.60, 0.0, 0.40, 0.58, 0.005),
      createRegion('instruments-bottom', 0.0, 0.58, 1.0, 0.42, 0.005),
    ],
    bspOptions: { maxDepth: 2, splitVariance: 0.25, minWidth: 0.10, minHeight: 0.10 },
    elementWeights: {
      // New biotech elements (high)
      'cell-division': 3, 'petri-dish': 3, 'bio-reactor': 3,
      'capillary-network': 2, 'spore-bloom': 2, 'gel-electrophoresis': 2,
      'pulse-membrane': 2, 'enzyme-cascade': 2,
      // Existing organic elements (medium)
      'dna-helix': 3, 'fractal-tree': 2, 'flow-field': 2,
      'neural-mesh': 2, 'boids-swarm': 2, 'heart-monitor': 2,
      'plasma-field': 1, 'network-graph': 1,
      // Lab-fitting general elements (low)
      'concentric-rings': 1, 'ring-gauge': 1, 'thermal-map': 1,
      'waveform': 1, 'graph': 1, 'oscilloscope': 1,
      'progress-bar': 1, 'data-table': 1, 'text-label': 1,
    },
  },
  'hive': {
    name: 'hive',
    layoutPattern: 'hex-cluster',
    createRegions: () => [
      createRegion('center', 0.35, 0.35, 0.30, 0.30, 0.005),
      createRegion('ring', 0.10, 0.10, 0.80, 0.80, 0.005),
    ],
    bspOptions: { maxDepth: 0 },
    elementWeights: {
      'concentric-rings': 3, 'hex-grid': 2, 'ring-gauge': 2,
      'radar-sweep': 2, 'radial-scanner': 2, 'cipher-wheel': 2,
      'orbital-display': 2, 'hex-tunnel': 2, 'target-lock': 2,
      'level-rings': 2, 'phase-indicator': 1,
      'cross-scope': 1, 'coord-grid': 1,
      'waveform': 1, 'signal-bars': 1, 'text-label': 1,
      'status-readout': 1, 'clock-display': 1, 'segment-display': 1,
      'pulse-wave': 1, 'countdown-timer': 1,
      'pressure-gauge': 1, 'data-table': 1,
      'harmonograph': 1, 'lorenz-attractor': 1, 'plasma-field': 1,
      'star-field': 1, 'boids-swarm': 1, 'flow-field': 1,
    },
  },

  'honeycomb': {
    name: 'honeycomb',
    layoutPattern: 'hex-grid',
    createRegions: () => [
      createRegion('full', 0.0, 0.0, 1.0, 1.0, 0.005),
    ],
    bspOptions: { maxDepth: 0 },
    elementWeights: {
      graph: 2, waveform: 2, 'scrolling-numbers': 1,
      'text-label': 2, 'progress-bar': 1, 'status-readout': 1,
      'signal-bars': 1, 'ring-gauge': 2, 'bracket-frame': 1,
      'threat-meter': 1, 'clock-display': 1, 'segment-display': 1,
      'freq-analyzer': 1, 'binary-stream': 1, 'scan-line': 1,
      'radar-sweep': 1, 'cross-scope': 1,
      'pulse-wave': 2, 'spectrogram': 1, 'target-lock': 1,
      'countdown-timer': 2, 'heart-monitor': 1, 'flight-ladder': 1,
      'cpu-cores': 1, 'audio-meter': 1, 'data-table': 1,
      'neural-mesh': 1, 'hex-tunnel': 1, 'orbital-display': 1,
      'concentric-rings': 2, 'radial-scanner': 1, 'cipher-wheel': 1,
    },
  },

  'hexwall': {
    name: 'hexwall',
    layoutPattern: 'hex-wall',
    createRegions: () => [
      createRegion('full', 0.0, 0.0, 1.0, 1.0, 0.005),
    ],
    bspOptions: { maxDepth: 0 },
    elementWeights: {
      'concentric-rings': 2, 'ring-gauge': 2, 'radar-sweep': 2,
      'radial-scanner': 2, 'cross-scope': 2, 'target-lock': 2,
      'hex-grid': 1, 'hex-tunnel': 1, 'cipher-wheel': 1,
      'phase-indicator': 1, 'level-rings': 1,
      'signal-bars': 1, 'waveform': 1, 'graph': 1,
      'text-label': 1, 'status-readout': 1, 'clock-display': 1,
      'pulse-wave': 1, 'dot-matrix': 1, 'segment-display': 1,
      'countdown-timer': 1, 'pressure-gauge': 1, 'data-table': 1,
      'boids-swarm': 1, 'flow-field': 1, 'plasma-field': 1,
    },
  },
  'cinema': {
    name: 'cinema',
    layoutPattern: 'letterbox',
    createRegions: () => [
      createRegion('full', 0.0, 0.0, 1.0, 1.0, 0.005),
    ],
    bspOptions: { maxDepth: 0 },
    tagWeights: {
      'decorative': 2, 'data-display': 1, 'ambient': 2,
    },
    elementWeights: {
      'waveform': 2, 'spectrogram': 2, 'freq-analyzer': 2,
      'audio-meter': 2, 'heart-monitor': 2, 'oscilloscope': 2,
      'pulse-wave': 2, 'signal-bars': 1, 'progress-bar': 1,
      'harmonograph': 3, 'lorenz-attractor': 3, 'pendulum-wave': 2,
      'flow-field': 2, 'plasma-field': 2, 'star-field': 2,
      'boids-swarm': 2, 'neural-mesh': 2, 'grid-distortion': 2,
      'wave-interference': 2, 'dna-helix': 2, 'fractal-tree': 2,
    },
  },

  'quad-view': {
    name: 'quad-view',
    layoutPattern: 'quad-hero',
    createRegions: () => [
      createRegion('full', 0.0, 0.0, 1.0, 1.0, 0.005),
    ],
    bspOptions: { maxDepth: 0 },
    tagWeights: {
      'data-display': 2, 'scanner': 2, 'gauge': 1,
    },
    elementWeights: {
      'radar-sweep': 2, 'cross-scope': 2, 'radial-scanner': 2,
      'target-lock': 2, 'ring-gauge': 2, 'concentric-rings': 2,
      'hex-tunnel': 2, 'orbital-display': 2, 'topology-map': 2,
      'lorenz-attractor': 2, 'flow-field': 2, 'boids-swarm': 2,
      'plasma-field': 2, 'grid-distortion': 2, 'wave-interference': 2,
      'cellular-morph': 2, 'distance-field': 2, 'double-slit': 2,
    },
  },

  'mosaic': {
    name: 'mosaic',
    layoutPattern: 'mosaic',
    createRegions: () => [
      createRegion('full', 0.0, 0.0, 1.0, 1.0, 0.005),
    ],
    bspOptions: { maxDepth: 0 },
    tagWeights: {
      'decorative': 2, 'data-display': 1, 'diagnostic': 1, 'ambient': 2,
    },
  },

  'mission-board': {
    name: 'mission-board',
    layoutPattern: 'ticker-board',
    dominantMood: 'tactical',
    createRegions: () => [
      createRegion('full', 0.0, 0.0, 1.0, 1.0, 0.005),
    ],
    bspOptions: { maxDepth: 0 },
    elementWeights: {
      'segment-display': 3, 'clock-display': 3, 'countdown-timer': 3,
      'status-readout': 3, 'text-label': 2, 'progress-bar': 2,
      'signal-bars': 2, 'threat-meter': 2, 'uptime-counter': 2,
      'binary-stream': 2, 'ring-gauge': 1, 'phase-indicator': 1,
      'data-table': 2, 'cpu-cores': 1, 'power-grid': 1,
      'barcode-strip': 2, 'dot-matrix': 2, 'ticker-tape': 2,
      'scrolling-numbers': 2, 'flight-ladder': 2,
    },
  },

  'golden': {
    name: 'golden',
    layoutPattern: 'golden-ratio',
    createRegions: () => [
      createRegion('full', 0.0, 0.0, 1.0, 1.0, 0.005),
    ],
    bspOptions: { maxDepth: 0 },
    tagWeights: {
      'decorative': 2, 'data-display': 1,
    },
    elementWeights: {
      'harmonograph': 3, 'lorenz-attractor': 3, 'spiral-vortex': 3,
      'fractal-tree': 2, 'mandelbrot-zoom': 2, 'julia-morph': 2,
      'pendulum-wave': 2, 'flow-field': 2, 'plasma-field': 2,
      'cellular-morph': 2, 'reaction-diffuse': 2,
      'dna-helix': 1, 'wave-interference': 1, 'star-field': 1,
    },
  },

  'ops-hud': {
    name: 'ops-hud',
    dominantMood: 'tactical',
    createRegions: () => [
      createRegion('full', 0.0, 0.0, 1.0, 1.0, 0.005),
    ],
    bspOptions: { maxDepth: 0 },
    tagWeights: {
      'gauge': 3, 'scanner': 3, 'data-display': 2, 'text': 2,
      'decorative': -2,
    },
    elementWeights: {
      // Realistic instruments (boosted)
      'radar-sweep': 3, 'ring-gauge': 3, 'cross-scope': 3,
      'radial-scanner': 3, 'target-lock': 2, 'flight-ladder': 3,
      'pressure-gauge': 3, 'segment-display': 3, 'clock-display': 2,
      'countdown-timer': 2, 'status-readout': 2, 'text-label': 2,
      'signal-bars': 2, 'progress-bar': 2, 'threat-meter': 2,
      'coord-grid': 2, 'data-table': 2, 'cpu-cores': 2,
      'audio-meter': 2, 'heart-monitor': 2, 'oscilloscope': 2,
      'freq-analyzer': 2, 'uptime-counter': 2, 'power-grid': 2,
      'satellite-track': 2, 'depth-sounder': 2, 'thermal-map': 2,
      'memory-map': 2, 'network-graph': 2,
      graph: 2, waveform: 2, 'pulse-wave': 2, 'spectrogram': 2,
      'scan-line': 1, 'phase-indicator': 1, 'level-rings': 1,
      // Abstract/decorative (zeroed out)
      'watching-eye': 0, 'spiral-vortex': 0, 'clock-melt': 0,
      'iris-aperture': 0, 'breathing-grid': 0, 'infinite-hallway': 0,
      'static-channel': 0, 'corrupted-text': 0, 'face-brackets': 0,
      'warp-tunnel': 0, 'hex-tunnel': 0, 'star-field': 0,
      'plasma-field': 0, 'lorenz-attractor': 0, 'dna-helix': 0,
      'fractal-tree': 0, 'pendulum-wave': 0, 'harmonograph': 0,
      'boids-swarm': 0, 'flow-field': 0, 'neural-mesh': 0,
      'grid-distortion': 0, 'rule-grid': 0, 'wave-interference': 0,
      'voltage-arc': 0, 'dot-matrix': 0, 'particle-field': 0,
      'cell-division': 0, 'petri-dish': 0, 'bio-reactor': 0,
      'capillary-network': 0, 'spore-bloom': 0, 'gel-electrophoresis': 0,
      'pulse-membrane': 0, 'enzyme-cascade': 0,
    },
  },
};

const HEX_TEMPLATES = new Set(['hive', 'honeycomb', 'hexwall']);

export function isHexTemplate(name: string): boolean {
  return HEX_TEMPLATES.has(name);
}

const OPS_HUD_PATTERNS = ['ops-center', 'bridge', 'split-ops'];

export function getTemplate(name: string, rng: SeededRandom, hexLayout?: boolean): TemplateConfig {
  if (name === 'auto') {
    const keys = Object.keys(TEMPLATES).filter(k =>
      hexLayout === undefined ? true : hexLayout === HEX_TEMPLATES.has(k)
    );
    return TEMPLATES[rng.pick(keys)];
  }
  const tmpl = TEMPLATES[name] ?? TEMPLATES['command-center'];
  // ops-hud randomly picks from its dedicated symmetric patterns
  if (name === 'ops-hud') {
    return { ...tmpl, layoutPattern: rng.pick(OPS_HUD_PATTERNS) };
  }
  return tmpl;
}

export function templateNames(): string[] {
  return ['auto', ...Object.keys(TEMPLATES)];
}
