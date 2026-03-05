# Changelog

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
