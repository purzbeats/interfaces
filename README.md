# INTERFACES

[interfaces-1772551742842.webm](https://github.com/user-attachments/assets/25a11feb-68af-4224-be79-6166f167cead)

Procedural sci-fi interface generator built with Three.js and TypeScript. Produces animated HUD-style compositions from 161 visual element types — radar sweeps, waveforms, data cascades, oscilloscopes, star fields, cipher wheels, mechanical gauges, physics simulations, and more — arranged via BSP-subdivided and hexagonal layout templates with seeded randomness for deterministic output.

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
| F | Toggle fullscreen / multi-aspect proof sheet (in showcase) |
| B | Gallery mode (paginated grid of live previews) |
| E | Edit/Performance mode (bespoke interface building) |
| M | Toggle sound |
| 1–5 | Intensity broadcast (tap = one-shot, hold = sustained, release = baseline) |

On mobile (<768px), a bottom toolbar provides touch-friendly buttons for all controls.

## Architecture

```
src/
├── main.ts              # Entry point — Engine init + render loop
├── engine.ts            # Core engine — orchestrates layout, rendering, timeline
├── config.ts            # Runtime configuration (seed, palette, template, post-fx)
├── random.ts            # Seeded PRNG (mulberry32)
├── elements/            # 161 visual element types + registry + tag metadata
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

Ten built-in layout templates: `command-center`, `surveillance`, `diagnostic`, `tactical`, `nerv`, `datastream`, `geometry`, `biolab`, `biblically-accurate`, `ops-hud`. Use `auto` for random selection. Supports both rectangular BSP and hexagonal tile layouts.

## Elements (161)

### Data Display
`graph`, `scrolling-numbers`, `data-cascade`, `signal-bars`, `waveform`, `cross-scope`, `freq-analyzer`, `spectrogram`, `dot-matrix`, `pulse-wave`, `binary-stream`, `cpu-cores`, `data-table`, `network-graph`, `oscilloscope`, `audio-meter`, `heart-monitor`, `voltage-arc`, `barcode-strip`, `data-rings`, `hex-counter`, `morse-ticker`, `ticker-tape`, `flip-clock`, `chess-clock`, `abacus-row`, `punch-card`, `bit-decay`, `typewriter-head`

### Simulations & Physics
`boids-swarm`, `rule-grid`, `lorenz-attractor`, `neural-mesh`, `flow-field`, `pendulum-wave`, `harmonograph`, `cell-division`, `enzyme-cascade`, `gel-electrophoresis`, `newton-cradle`, `pendulum-grid`, `ripple-tank`, `magnet-field`, `crystal-grow`

### Scanners
`radar-sweep`, `radial-scanner`, `coord-grid`, `grid-overlay`, `bracket-frame`, `scan-line`, `target-lock`, `depth-sounder`, `satellite-track`, `thermal-map`, `topology-map`, `terrain-scan`, `sonar-ping`, `laser-grid`, `wave-radar`

### Gauges
`ring-gauge`, `progress-bar`, `threat-meter`, `phase-indicator`, `level-rings`, `segment-display`, `pressure-gauge`, `countdown-timer`, `flight-ladder`, `gauge-needle`, `water-level`, `battery-cell`, `tilt-level`, `depth-gauge`, `wind-sock`, `hourglass-timer`

### Text
`text-label`, `status-readout`, `clock-display`, `uptime-counter`, `boot-sequence`, `corrupted-text`, `decay-text`, `rune-glyph`

### Mechanical & Kinetic
`gear-train`, `metronome`, `spring-coil`, `domino-fall`, `loading-spinner`, `tape-reel`, `iris-aperture`, `semaphore`, `roulette-spin`

### Decorative & Generative
`concentric-rings`, `hex-grid`, `hex-tunnel`, `orbital-display`, `particle-field`, `memory-map`, `star-field`, `warp-tunnel`, `wave-interference`, `cipher-wheel`, `plasma-field`, `dna-helix`, `fractal-tree`, `moire-pattern`, `kaleidoscope`, `fibonacci-spiral`, `prism-split`, `sine-weave`, `vinyl-spin`, `card-fan`, `diamond-grid`, `crosshatch-fill`, `spiral-arm`, `spiral-vortex`, `dot-orbit`, `wave-mesh`, `waveform-3d`, `noise-band`, `pixel-sort`, `smoke-rise`, `tuning-fork`

### Biotech
`bio-reactor`, `capillary-network`, `petri-dish`, `spore-bloom`, `pulse-membrane`

### Atmospheric
`flame-column`, `spark-emitter`, `spark-gap`, `static-channel`, `drop-shadow`, `infinite-hallway`, `clock-melt`, `watching-eye`, `light-slit`, `iso-blocks`

### Structural
`panel`, `separator`, `power-grid`, `border-chase`, `chevron-scroll`, `circuit-trace`, `corner-pip`, `face-brackets`, `pipe-network`, `pin-array`, `stack-bars`, `tread-track`, `zigzag-divider`, `chain-link`, `arrow-flow`, `breathing-grid`, `prism-refract`, `seismograph`, `quake-line`, `grid-distortion`, `compass-rose`, `gyroscope`, `matrix-rain`

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
