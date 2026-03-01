# INTERFACES

Procedural sci-fi interface generator built with Three.js and TypeScript. Produces animated HUD-style compositions from 64 visual element types — radar sweeps, waveforms, data cascades, oscilloscopes, star fields, cipher wheels, and more — arranged via BSP-subdivided layout templates with seeded randomness for deterministic output.

## Quick Start

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
npm run preview
```

## Controls

| Key | Action |
|-----|--------|
| Space | Pause / play |
| Backspace | Restart current seed |
| R | Regenerate with new seed |
| L | Toggle continuous loop mode |
| G | Showcase mode (cycle through all elements) |
| M | Toggle sound |

On mobile (<768px), a bottom toolbar provides touch-friendly buttons for all controls.

## Architecture

```
src/
├── main.ts              # Entry point — Engine init + render loop
├── engine.ts            # Core engine — orchestrates layout, rendering, timeline
├── config.ts            # Runtime configuration (seed, palette, template, post-fx)
├── random.ts            # Seeded PRNG (mulberry32)
├── elements/            # 64 visual element types + registry + tag metadata
│   ├── base-element.ts  # Abstract base class (pulse/glitch/opacity effects)
│   ├── registry.ts      # Element factory registry
│   └── tags.ts          # Shape/role/mood/size tag taxonomy
├── layout/              # Spatial layout system
│   ├── region.ts        # Normalized-coordinate region primitives
│   ├── grid.ts          # BSP subdivision
│   ├── templates.ts     # 7 template configs (regions, weights, BSP options)
│   ├── compositor.ts    # Smart element selection (shape fitness, diversity)
│   └── dividers.ts      # Inter-region divider lines
├── renderer/            # Three.js rendering
├── animation/           # Timeline, state machine, easing, retro text effects
├── audio/               # Web Audio API synthesis (keystroke, blip, glitch, alert)
├── color/               # Palette management
├── postfx/              # Post-processing (bloom, CRT, chromatic aberration)
├── shaders/             # GLSL shaders
├── gui/                 # lil-gui debug panel + mobile toolbar
├── export/              # Video/image export
└── persistence.ts       # State persistence (localStorage + URL params)
```

## Templates

Seven built-in layout templates: `command-center`, `surveillance`, `diagnostic`, `tactical`, `nerv`, `datastream`, `geometry`. Use `auto` for random selection.

## Elements (64)

### Data Display
`graph`, `scrolling-numbers`, `data-cascade`, `signal-bars`, `waveform`, `cross-scope`, `freq-analyzer`, `spectrogram`, `dot-matrix`, `pulse-wave`, `binary-stream`, `cpu-cores`, `data-table`, `network-graph`, `oscilloscope`, `audio-meter`, `heart-monitor`, `voltage-arc`

### Simulations
`boids-swarm`, `rule-grid`, `lorenz-attractor`, `neural-mesh`, `flow-field`, `pendulum-wave`, `reaction-diffusion`

> *Note: `reaction-diffusion` is a harmonograph (damped pendulum spirograph).*

### Scanners
`radar-sweep`, `radial-scanner`, `coord-grid`, `grid-overlay`, `bracket-frame`, `scan-line`, `target-lock`, `depth-sounder`, `satellite-track`, `thermal-map`, `topology-map`

### Gauges
`ring-gauge`, `progress-bar`, `threat-meter`, `phase-indicator`, `level-rings`, `segment-display`, `pressure-gauge`, `countdown-timer`, `flight-ladder`

### Text
`text-label`, `status-readout`, `clock-display`, `uptime-counter`, `boot-sequence`

### Decorative
`concentric-rings`, `hex-grid`, `hex-tunnel`, `orbital-display`, `particle-field`, `memory-map`, `star-field`, `warp-tunnel`, `wave-interference`, `cipher-wheel`, `plasma-field`, `dna-helix`, `fractal-tree`

### Structural
`panel`, `separator`, `power-grid`

## Element Tags

Each element is tagged with metadata for smart placement:

- **Shape** (`rectangular` / `linear` / `radial`) -- matched against region aspect ratio
- **Role** (`structural` / `gauge` / `scanner` / `data-display` / `text` / `decorative`) -- diversity tracking
- **Mood** (`tactical` / `diagnostic` / `ambient`) -- thematic grouping
- **Size** (`works-small` / `needs-medium` / `needs-large`) -- region size fitness

The compositor uses these tags to bias placement: radial elements toward square regions, linear elements toward thin strips, and penalizes adjacent duplicates for visual variety.

## Shareable Seeds

Compositions are deterministic. Share via URL params: `?seed=X&palette=Y&template=Z`. Use the "Copy Seed URL" button in the GUI.

## License

Private
