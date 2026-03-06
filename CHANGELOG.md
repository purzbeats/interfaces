# Changelog

## v5.5.0

Editor UX redesign with bottom-panel layout, element thumbnail previews, and polished styling.

### Added
- **Element thumbnail previews**: palette tiles now show live-rendered previews of each element type, generated progressively via offscreen WebGLRenderTarget (batches of 4/frame, ~1.5s for all 380+ elements)
- **Thumbnail generator** (`src/editor/thumbnail-generator.ts`): renders each element type at 120x72px to an offscreen target, reads pixels back with Y-flip, exports as JPEG data URLs
- **Thumbnails regenerate on palette change** so previews always match the active color scheme

### Changed
- **Bottom-anchored panel layout**: element palette and inspector moved from left sidebar to a 140px bottom panel — better for both desktop and mobile (thumb-reachable, doesn't eat canvas width)
- **Horizontal scrolling palette**: element tiles scroll horizontally with custom styled scrollbar (thin green-tinted track/thumb matching the accent scheme)
- **Hamburger menu**: toolbar overflow items (New/Save/Load/Export/Import/Clear/Toggle Panel) collapsed into a dropdown menu
- **Inspector/palette mode switching**: bottom panel toggles between palette view (browse elements) and inspector view (edit selected element properties)
- **Canvas positioning**: viewport now accounts for toolbar (40px top) and bottom panel (140px) insets, keeping the rendered scene properly centered
- **Tile hover effects**: cards lift 2px with green glow shadow on hover, placeholder uses diagonal hatching pattern
- **Panel styling**: gradient backgrounds with drop shadows and inset highlights on toolbar and bottom panel, dark-tinted header rows, focus glow on search input
- **Custom scrollbar**: thin styled scrollbar via CSS (webkit + Firefox `scrollbar-width`) instead of default browser chrome
- **Pixel-crisp thumbnails**: `image-rendering: pixelated` on thumbnail images for sharp rendering

### Fixed
- **`togglePalette` → `togglePanel`**: key handler referenced removed method
- **Missing `startThumbnailGenerator` method**: was called but never defined

---

## v5.4.0

Massive editor overhaul with search, inspector panel, undo/redo, and Playwright test coverage.

### Added
- **Search box** in element palette — filters 380+ elements by name in real-time
- **Inspector/properties panel** with type swap dropdown, position/size number inputs
- **Undo/redo system** (Ctrl+Z / Ctrl+Y) with 50-level snapshot stack
- **Duplicate element** (Ctrl+D) with offset placement
- **Arrow key nudge** moves selected element by one grid unit
- **Element type swap** via inspector dropdown — replaces element in-place
- **Bring to front / Send to back** z-ordering
- **12-column grid overlay** toggle (G key)
- **Right-click context menu** with Duplicate, Delete, z-order, Undo/Redo
- **Keyboard shortcuts help dialog** (? key)
- **Inline layout rename** — click layout name in status bar to edit
- **Palette selector** in toolbar — switch palettes without leaving editor
- **Selection labels** — element type name above, dimensions below selection outline
- **Filter by tag** dropdown (shape, role, mood categories)
- **13 Playwright tests** covering all new editor features

### Fixed
- Engine key handler no longer interferes with editor shortcuts (guard added before main switch)
- Help dialog (`?` key) now shows editor shortcuts instead of engine help when editor is active

---

## v5.3.0

### Added
- **Shareable element URLs**: `?element=burning-ship` opens showcase mode for any element. URL updates as you navigate.
- **View mode param**: `?view=single` (default) or `?view=multi` for multi-aspect proof sheet
- **Gallery param**: `?gallery=1` opens gallery mode on load
- **Performance param**: `?perf=1` shows debug/performance overlay on load
- Documented all URL parameters and overscan controls in README

---

## v5.2.0

Visual quality pass, overscan fixes, and element scaling audit.

### Fixed
- **Overscan crash**: adjusting overscan padding in rolling sync mode crashed due to `dispose()` being called on elements that hadn't finished building yet. Added `_built` flag to skip dispose for unbuilt elements.
- **Overscan X/Y nudge (Shift+Arrow)**: never worked — arrow key cases used `'ArrowLeft'` but the switch lowercased all keys to `'arrowleft'`. Fixed case labels.
- **Zero-dimension crashes**: overscan could produce zero-width/height layouts, crashing elements that divide by `w` or `h`. Added minimum dimension guards in `computeAspectSize`, `regionToPixels`, `resizeRenderer`, and `pipeline.resize`.
- **Audio blip crash**: `blip(0, 0)` used for AudioContext resume passed `freq=0` to `exponentialRampToValueAtTime`, which throws. Now early-returns for zero frequency.
- **Canvas aspect ratio stretching**: 13 elements had width/height capped independently, causing stretched rendering on non-square tiles. All now use uniform scale pattern.
- **Logic cascade gate distortion**: gates were stretched because canvas aspect didn't match tile aspect. Fixed canvas sizing and gate dimensions to use `Math.min(colW, rowH)`.

### Changed
- **All canvas textures now use `NearestFilter`** (87 files, 134 occurrences) instead of `LinearFilter` for crisp nearest-neighbor pixel rendering.
- **Burning ship text overlay**: zoom indicator text now renders on a separate high-res canvas mesh instead of the low-res fractal canvas.
- **~35 elements**: hardcoded point sizes replaced with proportional `Math.min(w, h) * factor` scaling.
- **14 boring/empty elements** improved with more particles, larger sizes, better positioning, and more visual density (capillary-network, cellular-morph, compass-rose, hex-automata, klein-bottle, moth-flame, photoelectric-emit, pollen-scatter, pressure-gauge, rain-ripples, seed-disperse, smoke-rise, thermal-gradient, turmite).
- **Bounds fixes**: ford-circles, involute-gear, lsystem-grow, lorenz-section, prism-split, hyperbolic-tiling, chain-link, cantor-dust, shock-cone — all now stay within tile bounds.
- **Hyperbolic tiling**: rewritten with local-coord geometry, progressive reveal animation, and vertex colors.
- **Brightness/contrast**: crosshatch-fill and maze-solver improved. monte-carlo-pi text scaling fixed.

---

## v5.1.0

Performance optimization pass across 28 elements, showcase perf overlay, and bug fixes.

### Added
- **Showcase performance overlay** (D key in fullscreen multi-view): FPS counter, update/render timing, budget headroom, and sparkline frame-time chart
- Engine debug overlay now correctly hidden during showcase and gallery modes

### Fixed
- **poisson-disk**: crash when loading individually — `seedFirstPoint()` was called before Points mesh existed
- **scrolling-numbers**: canvas now renders at native element resolution instead of tiny grid stretched to fill, eliminating blurry/pixelated text

### Performance
- **Canvas resolution caps**: hex-automata (full pixel→200px), corrupted-text (3840px→400px), dijkstra-wave (512→200px), termite-build (512→256px), cloud-cell (400→160px), hexagonal-life (w×0.8→200px), distance-field (256→160px), quasi-crystal (w×0.5→160px), noise-warp (160→120px), pressure-wave (w×0.5→160px), voronoi-shatter (200→150px), interference-rings (220→150px), lyapunov-fractal (200→140px), newton-fractal (200→140px)
- **Render throttles added**: hex-automata, quasi-crystal, noise-warp, pressure-wave, distance-field, cloud-cell, termite-build, pixel-fire, dijkstra-wave, cellular-fluid (~10–20fps canvas redraws)
- **Mesh batching**: punch-card (144 meshes→1 canvas), pixel-sort (768 meshes→1 canvas), hex-grid (per-cell geometries→1 canvas), iso-blocks (removed per-frame computeBoundingSphere)
- **Simulation cost reduction**: slime-mold (reuse diffusion buffer, cap agents at 6000), cellular-fluid (fewer LBM steps, coarser grid), sand-pile (topple iterations 100→25), foam-relax (voronoi throttled to 15fps)
- **Other**: buddhabrot/burning-ship/butterfly-scale (reduced iterations, canvas caps, throttles), pursuit-curves (trail points 700→300), scrolling-numbers (capped cols/rows), pendulum-grid (batched geometry)

---

## v5.0.0

128 more visual elements (384 total) across four new categories.

### Added
- **128 new visual elements** in four themed batches:
  - **Physics & Waves** (32): brownian-motion, three-body, doppler-rings, elastic-collision, standing-wave, coupled-oscillator, karman-vortex, chladni-plate, kepler-orbit, quantum-tunnel, double-slit, rayleigh-benard, soliton-collide, reaction-diffuse, phonon-dispersion, lens-caustic, bouncing-balls, maxwell-boltzmann, laminar-stream, shock-cone, bubble-raft, blackbody-spectrum, photoelectric-emit, eddy-current, capacitor-charge, orbital-transfer, coupled-pendulum, spring-pendulum, pressure-wave, refraction-stack, lorentz-force, thermal-gradient
  - **Mathematics & Geometry** (32): pascal-mod, stern-brocot, farey-diagram, golden-phyllotaxis, euler-spiral, pi-walk, gaussian-prime, totient-plot, bezier-construct, hypercube-rotate, klein-bottle, cayley-graph, lattice-path, cantor-dust, weierstrass-curve, devil-staircase, peano-curve, gosper-curve, levy-curve, ford-circles, stereographic-map, sierpinski-carpet, newton-fractal, burning-ship, lyapunov-fractal, buddhabrot, rose-curve, lissajous-table, involute-gear, cycloid-trace, cardioid-envelope, astroid-curve
  - **Nature & Organic** (32): leaf-venation, root-fractal, river-meander, crack-propagate, spider-web, crystal-defect, aurora-sheet, rain-ripples, wind-streak, snowflake-hex, firefly-sync, termite-build, vine-climb, shell-logarithm, honeycomb-build, foam-relax, stalactite-drip, sand-ripple, frost-crystal, lichen-front, feather-barb, butterfly-scale, tide-flow, pollen-scatter, tree-rings, cloud-cell, magma-convect, diatom-pattern, nautilus-chamber, moth-flame, coral-polyp, seed-disperse
  - **Computing & Data Structures** (32): cpu-pipeline, memory-fragment, stack-recurse, linked-list-op, btree-insert, hash-collision, red-black-tree, graph-traverse, dijkstra-wave, convex-hull, delaunay-mesh, quadtree-decomp, fft-butterfly, signal-convolve, shift-register, logic-cascade, wireworld, turmite, towers-hanoi, knight-tour, monte-carlo-pi, random-walk-2d, truchet-tile, halton-sequence, markov-chain, voronoi-relax, poisson-disk, lsystem-grow, metaball-merge, distance-field, cellular-morph, noise-warp

---

## v4.0.0

Massive element expansion to 256 visual elements with bug fixes.

### Added
- **95 new visual elements** spanning fractals, physics simulations, mathematical visualizations, cellular automata, and algorithmic art:
  - **Fractals & chaos**: mandelbrot-zoom, julia-set, barnsley-fern, dragon-curve, koch-snowflake, apollonian-gasket, collatz-tree, chaos-game, strange-repeller, logistic-map, chaos-pendulum, lorenz-section, strange-billiards
  - **Physics simulations**: cloth-sim, double-pendulum, gravity-well, spring-mesh, electric-arc, lightning-tree, string-vibration, heat-equation, erosion-sim, n-body-ring, verlet-rope, catenary-chain, sine-gordon, smoke-plume, wave-packet, wave-collapse
  - **Math & algorithms**: hilbert-walk, prime-spiral, recaman-sequence, fourier-draw, fourier-heat, lissajous-curve, sorting-bars, maze-solver, voronoi-shatter, epitrochoid, harmonograph-3d, pursuit-curves, riemann-zeta, modular-form, symplectic-map, tensor-product, quantum-walk
  - **Cellular automata & emergent**: conway-life, hexagonal-life, langton-ant, automata-1d, hex-automata, particle-life, slime-mold, ant-colony, sand-pile, diffusion-limited, cellular-fluid, belousov-zhabotinsky, ising-model, percolation-grid, spin-glass, kuramoto-sync, flocking-arrows, flocking-fish
  - **Geometry & tiling**: penrose-tiling, hyperbolic-tiling, geodesic-dome, hyperboloid, mobius-strip, minimal-surface, knot-theory, mandala-gen, quasi-crystal
  - **Data & decorative**: spiral-clock, galaxy-spiral, orbit-rings, interference-rings, magnetic-field, perlin-terrain, topo-contour, tensor-field, tree-growth, strange-attractor, web-graph, gravity-lens, electric-potential, diffusion-wave, pixel-fire, rain-matrix, worley-noise, strange-loop, game-of-hex, pendulum-phase, brainfuck-vm, turing-tape

### Fixed
- **magnetic-field-lines**: field lines no longer draw long connecting lines to screen origin when tracing exits bounds (remaining buffer positions now repeat last valid point)
- **diffusion-wave**: profile line no longer extends outside region bounds (repositioned and clamped)

---

## v3.3.0

Determinism fixes, type safety, test suite, and code quality sweep.

### Added
- **Test suite**: 80 tests across 5 suites covering SeededRandom, StateMachine, BSP subdivision, easing functions, and visual effect utilities (vitest)
- **`IntensityConfig` interface**: replaces static mutable globals on BaseElement with a shared config object passed by reference from the engine — enables independent engine instances for testing

### Fixed
- **Seeded PRNG enforcement**: replaced 87 `Math.random()` calls across 19 element files with `this.rng` to restore deterministic output
- **Type safety in compositor**: replaced `as any` tag matching with proper `RoleTag | MoodTag | SizeTag` casts
- **Module-level mutable state**: eliminated `regionCounter` global and `resetRegionCounter()` in grid.ts; counter now scoped to recursion
- **`(this as any)` anti-pattern**: added proper private property declarations in 8 element files
- **Canvas null safety**: replaced 32 `getContext('2d')!` non-null assertions with `get2DContext()` helper that throws a clear error

### Changed
- **Compositor tuning constants**: extracted 15 magic numbers into named, documented constants

---

## v3.2.0

Border overlay system and debug mode.

### Added
- **Border overlay system**: border elements (border-chase, bracket-frame, corner-pip, drop-shadow, face-brackets, zigzag-divider) now render as overlays on top of ~30% of content cells instead of occupying regions exclusively. The compositor selects overlays weighted by shape fitness and the engine renders them at a higher layer with proper clipping.
- **`border` role tag**: new element role for the 6 border element types, added to gallery tag filters
- **Debug overlay** (D key): toggleable HTML overlay showing region outlines, IDs, element types, and border overlay assignments. Green solid borders for content, magenta dashed for border overlays. Auto-refreshes during rolling swap.

### Changed
- Border elements excluded from standalone content assignment (near-zero weight) — they now appear only as overlays
- Rolling swap mutations correctly retire and respawn border overlays alongside their host content elements

---

## v3.1.0

31 new widget elements and multi-aspect showcase fullscreen, bringing the total to 161.

### Added
- **31 new element types**:
  - Gauges: battery-cell, tilt-level, depth-gauge
  - Mechanical: gear-train, metronome, spring-coil, newton-cradle
  - Waves & patterns: sine-weave, ripple-tank, fibonacci-spiral, prism-split
  - Data displays: flip-clock, chess-clock, abacus-row, punch-card, bit-decay
  - Tactical: laser-grid, semaphore, roulette-spin
  - Nature & physics: magnet-field, crystal-grow, smoke-rise, pendulum-grid, hourglass-timer, tuning-fork, wind-sock
  - Decorative: kaleidoscope, domino-fall, vinyl-spin, card-fan, typewriter-head
- **Multi-aspect showcase fullscreen**: pressing F in showcase mode now shows 7 simultaneous instances of the current element at different aspect ratios (16:9 wide, 9:16 tall, 1:1 square, 4 small squares) as a design proof sheet

---

## v3.0.0

Massive expansion: element count tripled from 64 to 130. Hex layouts, biotech and weirdcore themes, rolling swap transitions, audio-reactive compositing, edit mode, HUD mode, and clipping plane system.

### Added
- **66 new element types** across multiple expansions: arrow-flow, barcode-strip, bio-reactor, border-chase, breathing-grid, capillary-network, card-fan, cell-division, chain-link, chevron-scroll, circuit-trace, clock-melt, compass-rose, corner-pip, corrupted-text, crosshatch-fill, data-rings, decay-text, diamond-grid, dot-orbit, drop-shadow, enzyme-cascade, face-brackets, flame-column, gauge-needle, gel-electrophoresis, grid-distortion, gyroscope, hex-counter, infinite-hallway, iris-aperture, iso-blocks, light-slit, loading-spinner, matrix-rain, moire-pattern, morse-ticker, noise-band, petri-dish, pin-array, pipe-network, pixel-sort, prism-refract, pulse-membrane, quake-line, rune-glyph, seismograph, sonar-ping, spark-emitter, spark-gap, spiral-arm, spiral-vortex, spore-bloom, stack-bars, static-channel, tape-reel, terrain-scan, ticker-tape, tread-track, watching-eye, water-level, wave-mesh, wave-radar, waveform-3d, zigzag-divider
- **Hexagonal tile layout** with clipping planes and honeycomb borders
- **Biotech expansion**: 8 bio-themed elements, bioluminescent palette, biolab template
- **Weirdcore expansion**: 8 surreal elements, backrooms palette, biblically-accurate template
- **Edit/Performance mode** (E key): bespoke interface building with drag-and-drop
- **HUD mode**: symmetric patterns with ops-hud template
- **Live compositing**: crossfade transitions and rolling swap mutations
- **Audio band affinity and sensitivity** metadata on all elements
- **4 visual presets** per element for variant diversity
- **Rectangular clipping planes** to prevent element overflow

### Changed
- Power-on/off animations: dramatic boot sequences with flicker/strobe styles
- Hex cell subdivision with mesh-based borders

---

## v2.1.0

10 new simulation and generative art elements, bringing the total to 64.

### Added
- **10 new element types**: boids-swarm (flocking simulation), rule-grid (Wolfram elementary cellular automata), lorenz-attractor (strange attractor traces), neural-mesh (firing neural network), reaction-diffusion (Gray-Scott Turing patterns), plasma-field (demoscene plasma interference), dna-helix (rotating double helix), pendulum-wave (phase-shifting pendulums), fractal-tree (L-system branching with wind), flow-field (noise-driven particle flow)
- All new elements integrated into template weights across all 7 layout templates

---

## v2.0.0

Major expansion: element count more than doubled (23 to 54), boilerplate extracted, dead code removed.

### Added
- **19 new element types**: voltage-arc, countdown-timer, heart-monitor, uptime-counter, pressure-gauge, oscilloscope, audio-meter, depth-sounder, satellite-track, network-graph, cpu-cores, power-grid, star-field, warp-tunnel, wave-interference, flight-ladder, data-table, boot-sequence, cipher-wheel
- All new elements integrated into template weights across all 7 layout templates
- `thermal-map` and `memory-map` added to diagnostic template weights (were registered but unreferenced)

### Changed
- Extracted pulse/glitch/opacity boilerplate into `BaseElement.applyEffects(dt)` — removes ~10 duplicated lines from each of 55 element files
- `BaseElement.onAction()` now handles `pulse` and `glitch` actions; subclasses only override for custom behavior
- `pulseTimer`, `glitchTimer`, `glitchAmount` moved from private per-element fields to protected base class fields

### Removed
- 6 rejected element files: barcode-scanner, compass-rose, gyroscope, sine-rain, sonar-ping, spiral-scanner
- `animation/tween.ts` — entire unused tween system
- 6 unused easing functions: elastic, bounce, stepped, glitch, snap, overshoot
- `glitchSlice()` from `animation/fx.ts` (exported but never called)
- Test artifacts: playwright.config.ts, screenshots/, tests/

---

## v1.5.0

Mobile support, showcase mode, hierarchical layouts, and continuous loop mode.

### Added
- **Mobile toolbar**: bottom bar with 6 touch-friendly buttons (regen, play/pause, sound, screenshot, showcase, menu) on viewports <768px
- **Showcase mode** (G key): cycles through all element types individually, with swipe navigation on mobile
- **Continuous loop mode** (L key): after fadeout, 1.5s dark dwell, then auto-regenerate with new seed for endless compositions
- **Global aspect ratio setting** with letterbox/pillarbox support
- **8 new elements**: dot-matrix, hex-tunnel, orbital-display, particle-field, pulse-wave, spectrogram, target-lock, topology-map
- 10 hand-crafted hierarchical layout patterns with hero/panel/widget tier assignments

### Changed
- Layout system: BSP grid subdivision replaced with tier-based templates that strongly prefer large elements for hero regions and small elements for widgets
- GUI starts hidden until first click, includes close button
- Default to continuous loop mode
- lil-gui repositions as full-width bottom sheet on mobile

---

## v1.4.0

Timeline controls and retro text rendering.

### Added
- **Timeline playback**: pause/play (Space), restart (Backspace), loop toggle
- **Retro text rendering** (`animation/retro-text.ts`): phosphor glow, per-character brightness jitter, scanline overlay, rolling interference band
- Retro text applied to text-label, status-readout, clock-display, ring-gauge center labels
- Playback folder in GUI with buttons and loop checkbox

---

## v1.3.0

Shader upgrades and element expansion.

### Added
- **12 new elements**: threat-meter, scan-line, binary-stream, clock-display, freq-analyzer, phase-indicator, segment-display, thermal-map, memory-map, coord-grid, level-rings, radial-scanner
- Line compositor: finds aligned region groups and assigns uniform types across rows/columns
- Divider line support between regions

### Changed
- CRT shader: added interlacing artifacts, horizontal tearing, corner darkening, luminance-dependent phosphor glow
- Chromatic aberration: all 3 channels shift radially with non-linear distance falloff
- Engine: element groups wrapped in THREE.Group for transform support

### Removed
- 6 rotation-based elements (caused bleed outside bounds): arc-reactor, diamond-gauge, orbital-dots, rotating-geometry, target-reticle, tri-scanner

### Fixed
- Stale element refs in template weights (removed references to deleted elements)
- Missing alert handlers in grid-overlay and separator

---

## v1.2.0

Audio system and compositor improvements.

### Added
- **Audio synthesis** (`audio/synth.ts`): keystroke, blip, data chirp, glitch noise, alert, deactivation, and reboot sequence sounds via Web Audio API
- Segment line compositor for visual coherence across contiguous regions
- `StateMachine.forceIdle()` for immediate state reset

---

## v1.1.0

Bug fixes and quality improvements.

### Fixed
- Memory leaks: graph.ts and progress-bar.ts no longer recreate geometry every frame (use `mesh.scale` instead)
- Radar sweep pulse timer now read in `update()` and modulates opacity
- Stale pixel cache after resize: window resize rebuilds all elements
- Unified pulse effect across all elements via shared `pulse()` utility
- Canvas textures throttled to 10-20fps via `renderAccum` accumulators
- Config now persists to localStorage and syncs URL params
- Video exporter codec detection with VP9/VP8/WebM/MP4 fallback

---

## v1.0.0

Initial release. Procedural sci-fi interface generator with 23 visual elements, BSP layout, seeded PRNG, 7 templates, post-processing pipeline (bloom, CRT, chromatic aberration), and video/image export.
