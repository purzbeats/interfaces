# INTERFACES - Project Guidelines

Procedural sci-fi interface generator. 384 visual element types rendered via Three.js + TypeScript.

## Key Architecture

- `src/elements/base-element.ts` — Abstract base class. All elements extend this.
- `this.px` = `{ x, y, w, h }` — pixel bounds of the element's tile region.
- `this.palette` = `{ primary, secondary, dim, bg, alert }` — THREE.Color objects (r/g/b in 0-1 range).
- `this.rng` — Seeded PRNG. Never use `Math.random()`.
- `this.applyEffects(dt)` — Call at top of every `update()`. Returns opacity.

## Element Quality

When creating or modifying visual elements, follow the checklist in `.claude/skills/element-quality.md`. Key rules:
- All rendering must stay within `this.px` bounds
- Canvas resolution capped for performance (200-400px max), with render throttle
- No individual meshes per grid cell — use canvas textures or Points
- Sizes (fonts, points, lines, radii) must scale with tile dimensions, never hardcoded pixels
- Initialize canvas before any method that reads its dimensions
- Float32Array positions initialized to tile center, not origin

## Commands

```bash
npm run dev          # Dev server
npm run build        # Production build
npx tsc --noEmit     # Type check
npx vitest run       # Run tests (80 tests across 5 suites)
```

## Controls

- Space: pause, R: new seed, G: showcase, F: fullscreen multi-view, B: gallery
- D: debug overlay (compositor regions in main view, performance stats in showcase)
- 1-5: intensity broadcast

## Conventions

- Use `this.get2DContext(canvas)` instead of `canvas.getContext('2d')!`
- Texture filters: `THREE.LinearFilter` for canvas textures
- Dispose textures in `dispose()` if element creates them
- Keep element files self-contained — one class per file
