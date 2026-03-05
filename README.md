# INTERFACES

[interfaces-1772551742842.webm](https://github.com/user-attachments/assets/25a11feb-68af-4224-be79-6166f167cead)

Procedural sci-fi interface generator built with Three.js and TypeScript. Produces animated HUD-style compositions from 384 visual element types — radar sweeps, waveforms, fractals, physics simulations, cellular automata, mathematical visualizations, data cascades, oscilloscopes, star fields, cipher wheels, mechanical gauges, and more — arranged via BSP-subdivided and hexagonal layout templates with seeded randomness for deterministic output.

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
| D | Debug overlay (region outlines in compositor; performance stats in showcase) |
| G | Showcase mode (cycle through all elements) |
| F | Toggle fullscreen / multi-aspect proof sheet (in showcase) |
| B | Gallery mode (paginated grid of live previews) |
| E | Edit/Performance mode (bespoke interface building) |
| M | Toggle sound |
| 1–5 | Intensity broadcast (tap = one-shot, hold = sustained, release = baseline) |
| +/− | Adjust overscan padding (for CRT TVs) |
| Shift+Arrow | Nudge canvas X/Y offset |

On mobile (<768px), a bottom toolbar provides touch-friendly buttons for all controls.

## URL Parameters

Shareable links with full state control:

| Parameter | Values | Description |
|-----------|--------|-------------|
| `seed` | number | Random seed for deterministic generation |
| `palette` | string | Color palette name (e.g. `phosphor-green`) |
| `template` | string | Layout template (e.g. `command-center`, `auto`) |
| `element` | string | Open showcase for a specific element (e.g. `burning-ship`) |
| `view` | `single`, `full`, `multi` | `full` = fullscreen no UI (default for element links), `single` = with title bar, `multi` = proof sheet |
| `gallery` | `1` | Open gallery mode on load |
| `perf` | `1` | Show debug/performance overlay on load |

**Examples:**
```
?element=mandelbrot-zoom                    # fullscreen mandelbrot (no UI)
?element=burning-ship&view=multi            # multi-aspect proof sheet
?element=langton-ant&view=single            # with title bar overlay
?element=logic-cascade&palette=amber-crt    # specific palette
?gallery=1                                  # open gallery
?seed=12345&perf=1                          # specific seed with debug overlay
```

## Architecture

```
src/
├── main.ts              # Entry point — Engine init + render loop
├── engine.ts            # Core engine — orchestrates layout, rendering, timeline
├── config.ts            # Runtime configuration (seed, palette, template, post-fx)
├── random.ts            # Seeded PRNG (mulberry32)
├── elements/            # 384 visual element types + registry + tag metadata
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

## Elements (384)

### Fractals & Chaos
`mandelbrot-zoom`, `julia-set`, `barnsley-fern`, `dragon-curve`, `koch-snowflake`, `apollonian-gasket`, `collatz-tree`, `chaos-game`, `fractal-tree`, `fibonacci-spiral`, `diffusion-limited`, `strange-attractor`, `strange-repeller`, `lorenz-attractor`, `lorenz-section`, `logistic-map`, `chaos-pendulum`, `strange-billiards`, `quasi-crystal`, `newton-fractal`, `burning-ship`, `lyapunov-fractal`, `buddhabrot`, `sierpinski-carpet`, `cantor-dust`, `reaction-diffuse`

### Physics Simulations
`boids-swarm`, `flow-field`, `pendulum-wave`, `double-pendulum`, `cloth-sim`, `gravity-well`, `spring-mesh`, `electric-arc`, `lightning-tree`, `string-vibration`, `heat-equation`, `erosion-sim`, `n-body-ring`, `verlet-rope`, `catenary-chain`, `sine-gordon`, `wave-packet`, `wave-collapse`, `newton-cradle`, `ripple-tank`, `magnet-field`, `magnetic-field-lines`, `smoke-plume`, `pendulum-grid`, `brownian-motion`, `three-body`, `doppler-rings`, `elastic-collision`, `standing-wave`, `coupled-oscillator`, `karman-vortex`, `chladni-plate`, `kepler-orbit`, `quantum-tunnel`, `double-slit`, `rayleigh-benard`, `soliton-collide`, `phonon-dispersion`, `lens-caustic`, `bouncing-balls`, `maxwell-boltzmann`, `laminar-stream`, `shock-cone`, `bubble-raft`, `blackbody-spectrum`, `photoelectric-emit`, `eddy-current`, `capacitor-charge`, `orbital-transfer`, `coupled-pendulum`, `spring-pendulum`, `pressure-wave`, `refraction-stack`, `lorentz-force`, `thermal-gradient`

### Mathematical Visualizations
`hilbert-walk`, `prime-spiral`, `recaman-sequence`, `fourier-draw`, `fourier-heat`, `lissajous-curve`, `epitrochoid`, `harmonograph`, `harmonograph-3d`, `pursuit-curves`, `riemann-zeta`, `modular-form`, `symplectic-map`, `tensor-field`, `tensor-product`, `quantum-walk`, `pendulum-phase`, `interference-rings`, `orbit-rings`, `topo-contour`, `pascal-mod`, `stern-brocot`, `farey-diagram`, `golden-phyllotaxis`, `euler-spiral`, `pi-walk`, `gaussian-prime`, `totient-plot`, `bezier-construct`, `weierstrass-curve`, `devil-staircase`, `rose-curve`, `lissajous-table`, `cycloid-trace`, `cardioid-envelope`, `astroid-curve`, `involute-gear`

### Space-Filling Curves
`peano-curve`, `gosper-curve`, `levy-curve`

### Geometry & Tiling
`penrose-tiling`, `hyperbolic-tiling`, `geodesic-dome`, `hyperboloid`, `mobius-strip`, `minimal-surface`, `knot-theory`, `mandala-gen`, `voronoi-shatter`, `concentric-rings`, `diamond-grid`, `crosshatch-fill`, `hex-grid`, `hex-tunnel`, `kaleidoscope`, `moire-pattern`, `hypercube-rotate`, `klein-bottle`, `stereographic-map`, `ford-circles`, `truchet-tile`

### Cellular Automata & Emergent Systems
`conway-life`, `hexagonal-life`, `langton-ant`, `automata-1d`, `hex-automata`, `particle-life`, `slime-mold`, `ant-colony`, `sand-pile`, `cellular-fluid`, `belousov-zhabotinsky`, `ising-model`, `percolation-grid`, `spin-glass`, `kuramoto-sync`, `rule-grid`, `game-of-hex`, `diffusion-wave`, `wireworld`, `turmite`, `firefly-sync`, `termite-build`, `cellular-morph`

### Algorithms & Computation
`sorting-bars`, `maze-solver`, `brainfuck-vm`, `turing-tape`, `neural-mesh`, `web-graph`, `flocking-arrows`, `flocking-fish`, `tree-growth`, `pixel-fire`, `rain-matrix`, `worley-noise`, `perlin-terrain`, `strange-loop`, `gravity-lens`, `electric-potential`, `dijkstra-wave`, `convex-hull`, `delaunay-mesh`, `quadtree-decomp`, `graph-traverse`, `knight-tour`, `towers-hanoi`, `monte-carlo-pi`, `random-walk-2d`, `halton-sequence`, `poisson-disk`, `markov-chain`, `lsystem-grow`

### Data Structures
`cpu-pipeline`, `memory-fragment`, `stack-recurse`, `linked-list-op`, `btree-insert`, `hash-collision`, `red-black-tree`, `fft-butterfly`, `signal-convolve`, `shift-register`, `logic-cascade`

### Data Display
`graph`, `scrolling-numbers`, `data-cascade`, `signal-bars`, `waveform`, `cross-scope`, `freq-analyzer`, `spectrogram`, `dot-matrix`, `pulse-wave`, `binary-stream`, `cpu-cores`, `data-table`, `network-graph`, `oscilloscope`, `audio-meter`, `heart-monitor`, `voltage-arc`, `barcode-strip`, `data-rings`, `hex-counter`, `morse-ticker`, `ticker-tape`, `flip-clock`, `chess-clock`, `abacus-row`, `punch-card`, `bit-decay`, `typewriter-head`, `semaphore`

### Scanners
`radar-sweep`, `radial-scanner`, `coord-grid`, `grid-overlay`, `scan-line`, `target-lock`, `depth-sounder`, `satellite-track`, `thermal-map`, `topology-map`, `terrain-scan`, `sonar-ping`, `laser-grid`, `wave-radar`, `petri-dish`, `watching-eye`, `noise-band`, `prism-refract`

### Gauges
`ring-gauge`, `progress-bar`, `threat-meter`, `phase-indicator`, `level-rings`, `segment-display`, `pressure-gauge`, `countdown-timer`, `flight-ladder`, `gauge-needle`, `water-level`, `battery-cell`, `tilt-level`, `depth-gauge`, `wind-sock`, `hourglass-timer`, `spiral-clock`, `compass-rose`, `gyroscope`, `loading-spinner`, `iris-aperture`, `metronome`, `roulette-spin`, `seismograph`, `quake-line`, `stack-bars`

### Text
`text-label`, `status-readout`, `clock-display`, `uptime-counter`, `boot-sequence`, `corrupted-text`, `decay-text`, `rune-glyph`

### Biotech
`bio-reactor`, `capillary-network`, `cell-division`, `enzyme-cascade`, `gel-electrophoresis`, `spore-bloom`, `pulse-membrane`, `crystal-grow`, `dna-helix`

### Nature & Organic
`leaf-venation`, `root-fractal`, `river-meander`, `crack-propagate`, `spider-web`, `crystal-defect`, `aurora-sheet`, `rain-ripples`, `wind-streak`, `snowflake-hex`, `vine-climb`, `shell-logarithm`, `honeycomb-build`, `foam-relax`, `stalactite-drip`, `sand-ripple`, `frost-crystal`, `lichen-front`, `feather-barb`, `butterfly-scale`, `tide-flow`, `pollen-scatter`, `tree-rings`, `cloud-cell`, `magma-convect`, `diatom-pattern`, `nautilus-chamber`, `moth-flame`, `coral-polyp`, `seed-disperse`

### Generative & Abstract
`noise-warp`, `metaball-merge`, `distance-field`, `voronoi-relax`, `cayley-graph`, `lattice-path`

### Atmospheric & Decorative
`flame-column`, `spark-emitter`, `spark-gap`, `static-channel`, `infinite-hallway`, `clock-melt`, `light-slit`, `iso-blocks`, `smoke-rise`, `star-field`, `warp-tunnel`, `wave-interference`, `cipher-wheel`, `plasma-field`, `prism-split`, `sine-weave`, `vinyl-spin`, `card-fan`, `spiral-arm`, `spiral-vortex`, `dot-orbit`, `wave-mesh`, `waveform-3d`, `pixel-sort`, `galaxy-spiral`, `orbital-display`, `particle-field`, `memory-map`, `matrix-rain`, `gear-train`, `spring-coil`, `domino-fall`, `tape-reel`, `tuning-fork`

### Structural & Borders
`panel`, `separator`, `power-grid`, `border-chase`, `bracket-frame`, `chevron-scroll`, `circuit-trace`, `corner-pip`, `drop-shadow`, `face-brackets`, `pipe-network`, `pin-array`, `tread-track`, `zigzag-divider`, `chain-link`, `arrow-flow`, `breathing-grid`, `grid-distortion`

## Element Tags

Each element is tagged with metadata for smart placement:

- **Shape** (`rectangular` / `linear` / `radial`) -- matched against region aspect ratio
- **Role** (`structural` / `gauge` / `scanner` / `data-display` / `text` / `decorative` / `border`) -- diversity tracking
- **Mood** (`tactical` / `diagnostic` / `ambient`) -- thematic grouping
- **Size** (`works-small` / `needs-medium` / `needs-large`) -- region size fitness

The compositor uses these tags to bias placement: radial elements toward square regions, linear elements toward thin strips, and penalizes adjacent duplicates for visual variety.

## Shareable Seeds

Compositions are deterministic. Share via URL params: `?seed=X&palette=Y&template=Z`. Use the "Copy Seed URL" button in the GUI.

## License

Private
