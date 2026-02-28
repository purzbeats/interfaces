# ROAST.md — A Brutal Audit of `interfaces/`

## The Verdict

This codebase is a **first-draft prototype masquerading as a finished system**. It compiles, it runs, and it even looks kinda cool for about 45 seconds — right up until the memory leaks eat your browser alive and you notice that half the "features" are stubs that do nothing.

---

## Critical Bugs (the show-stoppers)

### 1. Memory Leaks That Would Make Chrome Weep
`graph.ts` and `progress-bar.ts` both **recreate THREE.PlaneGeometry every single frame**. That's `new PlaneGeometry()` at 60fps. For a bar graph with 32 bars, that's 1,920 geometry allocations per second, each one silently leaking GPU memory. Run this for 5 minutes and watch your tab crash.

```typescript
// graph.ts — this runs EVERY FRAME
bar.geometry.dispose();
bar.geometry = new THREE.PlaneGeometry(barW, bh);  // 💀
```

The fix is trivial: use `mesh.scale` instead of rebuilding geometry. This is Three.js 101.

### 2. Radar Sweep Has a Dead Pulse
`radar-sweep.ts` declares `pulseTimer`, sets it in `onAction('pulse')`, and then... never reads it in `update()`. The pulse action literally does nothing. It's a no-op with extra steps.

### 3. Stale Pixel Cache After Resize
Every element computes `this.px = regionToPixels(...)` once in the constructor. Resize the window and every element is still drawing to the old coordinates. The elements don't move, don't scale, don't adapt. The resize handler updates the camera and composer but forgets the actual content.

---

## Visual Crimes Against Retro-Futurism

### 4. The Pulse Effect Is Having an Identity Crisis
Every element implements pulse differently:
- Panel: `sin(t * 15) * 0.5`
- Graph: `sin(t * 12) * 0.5`
- Grid: `sin(t * 20) * 0.4`
- Progress: `sin(t * 20) * 0.3`
- Separator: `sin(t * 10) * 0.5`

Five elements, five frequencies, three amplitudes. This isn't "variety," it's chaos. A shared pulse utility would take 4 lines.

### 5. CRT Shader Is Barely Trying
The CRT pass applies a basic barrel distortion and a sine-wave scanline. Real CRT emulation needs:
- Proper phosphor simulation (RGB sub-pixel pattern)
- Interlacing artifacts
- Beam persistence / phosphor decay
- Edge curvature falloff, not a hard black cutoff
- Signal interference / horizontal tearing

What we have is "Instagram filter" tier.

### 6. Chromatic Aberration Only Shifts Two Channels
The shader shifts R right and B left but leaves G centered. Real chromatic aberration shifts all three channels radially from center with varying magnitude. And the offset is a flat `vec2(2.0, 0.0)` — purely horizontal, ignoring vertical shift entirely.

### 7. Text Looks Like It Was Rendered in 2024
Canvas-rendered monospace text with no glow, no scan interference, no phosphor bleed. The typewriter effect is cute but the text itself looks like a modern terminal, not NORAD circa 1983. Where's the character-level jitter? The uneven brightness? The slight misalignment between rows?

### 8. Glitch Action: Mostly Unimplemented
The timeline fires `'glitch'` cues. Out of 10 element types, only 2 (text-label and scrolling-numbers) actually respond to it. The other 8 silently ignore it. That's an 80% failure rate for a core feature of the retro aesthetic.

---

## Performance Sins

### 9. Canvas Textures Updated Every Frame, No Questions Asked
`scrolling-numbers.ts`, `text-label.ts`, and `status-readout.ts` all call `clearRect` + `fillText` + set `needsUpdate = true` on their canvas textures every single frame. Canvas 2D rendering is expensive. A dirty flag or reduced update rate would cut GPU texture uploads by 90%.

### 10. String Operations in Hot Loops
`val.toString(16).toUpperCase()` runs per-cell per-frame in scrolling-numbers. `time.toFixed(1)` runs every frame in status-readout. These create garbage strings that stress the GC.

---

## Architecture & Code Quality

### 11. Magic Numbers: The Gathering
The codebase is a museum of unexplained constants. `0.08`, `12`, `64`, `7`, `1.65`, `0.97` — sprinkled everywhere with zero documentation. Want to tune the feel? Hope you enjoy binary-searching through `rng.float(0.3, 0.8)` calls across 15 files.

### 12. No Regeneration on Palette/Template Change
Change the palette in the GUI → nothing happens until you click "Regenerate." The GUI gives the illusion of live control but actually requires a manual rebuild step. This is confusing UX.

### 13. Hardcoded Video Codec
`exporter.ts` hardcodes `video/webm;codecs=vp9`. Safari doesn't support WebM. Firefox's VP9 support is spotty. No codec detection, no fallback, no error message. Just silent failure.

### 14. Config Doesn't Persist
Every page refresh resets to defaults. No localStorage, no URL params, no shareable seed links. You find a gorgeous composition at seed 73812 with the synthwave palette and... it's gone.

---

## Missing Features That Hurt

### 15. No Sound
Retro-futuristic interfaces without sound are like silent movies without intertitles. No boot-up chirps, no data transmission bleeps, no alert klaxons. The Web Audio API is right there.

### 16. No Timeline Scrubbing
You can't pause, rewind, or scrub the animation. You watch it play once, and if you want to see the boot sequence again, you regenerate. No playback controls whatsoever.

### 17. No Shareable Seeds
The whole point of a seeded system is reproducibility and sharing. There's no URL parameter for seed, no copy-to-clipboard, no preset gallery. The seed is just a number in a GUI slider.

---

## The Bottom Line

The **architecture is sound** — seeded PRNG, BSP layout, element registry, timeline cues, post-FX pipeline. These are good design decisions. But the execution is a first pass that needs:

1. **Fix the memory leaks** (geometry recreation)
2. **Implement what's stubbed** (glitch effects, pulse on radar, resize handling)
3. **Unify the visual language** (shared pulse/opacity/animation utilities)
4. **Upgrade the shaders** (real CRT emulation, proper chromatic aberration)
5. **Add texture** (glow on text, jitter, screen-door effect, phosphor persistence)
6. **Ship the experience** (sound, timeline controls, shareable seeds, config persistence)

It's a good skeleton. Now it needs flesh, skin, and a sick leather jacket.
