# ROAST.md — A Brutal Audit of `interfaces/`

## The Verdict

This codebase is a **first-draft prototype masquerading as a finished system**. It compiles, it runs, and it even looks kinda cool for about 45 seconds — right up until the memory leaks eat your browser alive and you notice that half the "features" are stubs that do nothing.

---

## Critical Bugs (the show-stoppers)

### 1. ~~Memory Leaks That Would Make Chrome Weep~~ ✅ FIXED
~~`graph.ts` and `progress-bar.ts` both **recreate THREE.PlaneGeometry every single frame**.~~

Both now use `mesh.scale` instead of geometry recreation.

### 2. ~~Radar Sweep Has a Dead Pulse~~ ✅ FIXED
~~`radar-sweep.ts` declares `pulseTimer`, sets it in `onAction('pulse')`, and then... never reads it in `update()`.~~

`pulseTimer` is read in `update()` and modulates opacity correctly.

### 3. ~~Stale Pixel Cache After Resize~~ ✅ FIXED
~~Every element computes `this.px = regionToPixels(...)` once in the constructor.~~

Window resize handler now calls `generate()` to rebuild all elements with correct dimensions.

---

## Visual Crimes Against Retro-Futurism

### 4. ~~The Pulse Effect Is Having an Identity Crisis~~ ✅ FIXED
~~Every element implements pulse differently.~~

All elements use the shared `pulse()` utility from `animation/fx.ts`.

### 5. ~~CRT Shader Is Barely Trying~~ ✅ FIXED
~~The CRT pass applies a basic barrel distortion and a sine-wave scanline.~~

CRT shader now includes: phosphor sub-pixel shadow mask, scanlines with proper falloff, interlacing artifacts, horizontal beam interference, horizontal tearing, corner darkening, phosphor glow boost, and soft edge curvature.

### 6. ~~Chromatic Aberration Only Shifts Two Channels~~ ✅ FIXED
~~The shader shifts R right and B left but leaves G centered.~~

All three channels now shift radially from center with different magnitudes (R > G > B, like real glass optics) using non-linear distance falloff.

### 7. Text Looks Like It Was Rendered in 2024
Canvas-rendered monospace text with no glow, no scan interference, no phosphor bleed. The typewriter effect is cute but the text itself looks like a modern terminal, not NORAD circa 1983. Where's the character-level jitter? The uneven brightness? The slight misalignment between rows?

### 8. ~~Glitch Action: Mostly Unimplemented~~ ✅ FIXED
~~Out of 10 element types, only 2 respond to glitch.~~

All 54 element types now handle pulse, glitch, and alert actions. Pulse/glitch boilerplate extracted into `BaseElement.applyEffects()`.

---

## Performance Sins

### 9. ~~Canvas Textures Updated Every Frame~~ ✅ FIXED
~~`scrolling-numbers.ts`, `text-label.ts`, etc. all render canvas textures every frame.~~

All canvas-based elements use reduced render rates (10-20fps) via `renderAccum` accumulators.

### 10. String Operations in Hot Loops
`val.toString(16).toUpperCase()` runs per-cell per-frame in scrolling-numbers. These create garbage strings that stress the GC. Minor perf issue.

---

## Architecture & Code Quality

### 11. Magic Numbers: The Gathering
The codebase is a museum of unexplained constants. `0.08`, `12`, `64`, `7`, `1.65`, `0.97` — sprinkled everywhere with zero documentation. Want to tune the feel? Hope you enjoy binary-searching through `rng.float(0.3, 0.8)` calls across 15 files.

### 12. ~~No Regeneration on Palette/Template Change~~ ✅ FIXED
GUI changes trigger `onRegenerate()` callback which calls `generate()`.

### 13. ~~Hardcoded Video Codec~~ ✅ FIXED
~~`exporter.ts` hardcodes `video/webm;codecs=vp9`.~~

`detectMimeType()` now tries VP9 → VP8 → WebM → MP4 with fallback.

### 14. ~~Config Doesn't Persist~~ ✅ FIXED
`persistence.ts` saves to localStorage and syncs URL params (`?seed=X&palette=Y&template=Z`). "Copy Seed URL" button in GUI.

---

## Missing Features That Hurt

### 15. ~~No Sound~~ ✅ FIXED
`AudioSynth` provides keystroke, blip, data chirp, glitch noise, alert, and deactivation sounds with Web Audio API.

### 16. No Timeline Scrubbing
You can't pause, rewind, or scrub the animation. You watch it play once, and if you want to see the boot sequence again, you regenerate. No playback controls whatsoever.

### 17. ~~No Shareable Seeds~~ ✅ FIXED
URL params support seed/palette/template. `updateURL()` keeps browser URL in sync. Copy button in GUI.

---

## The Bottom Line

The **architecture is sound** — seeded PRNG, BSP layout, element registry, timeline cues, post-FX pipeline. Remaining work:

1. **Add retro texture to text** (glow, phosphor bleed, character jitter)
2. **Timeline scrubbing** (pause/play/rewind controls)
3. **Clean up magic numbers** (document or extract to config)
4. **Minor GC pressure** (reduce string allocations in hot loops)

It's a good skeleton with flesh and skin. Now it needs a sick leather jacket.
