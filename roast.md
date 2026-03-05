# ROAST v2 — The Sequel Nobody Asked For

The first roast found memory leaks and missing features. They got fixed. Time for round two: the sins that survived.

---

## 1. `Math.random()` in a "deterministic" system (FIXED)

The README brags about "deterministic output" and "shareable seeds." The PRNG class says "same seed always produces the same sequence." Meanwhile, **19 element files** just call `Math.random()` in their update loops — corrupted-text (12 calls!), static-channel (15 calls!), lorenz-attractor (15 calls!), and 16 others.

You wrote an entire seeded PRNG class with `chance()`, `float()`, and `pick()` methods. And then didn't use it. Across 87 call sites.

## 2. `as any` to dodge your own type system (FIXED)

The compositor — the brain of the layout engine — casts tags to `any`:

```ts
meta.roles.includes(tag as any)
```

`RoleTag`, `MoodTag`, and `SizeTag` are right there in `tags.ts`. Defined. Exported. Waiting. The type system is trying to help and you're ghosting it.

## 3. Zero tests for 161 elements (FIXED)

Not a single `.test.ts` or `.spec.ts` in the entire project. The BSP subdivision, the seeded PRNG, the compositor's weighted selection, the state machine — all untested. `@playwright/test` is in devDependencies though, so someone thought about it. Thought about it and moved on.

## 4. Magic number casino (FIXED)

`compositor.ts` was a slot machine of unexplained constants: `0.5`, `0.7`, `1.4`, `0.05`, `0.4`, `0.02`, `0.07`, `0.03`, `0.10`. Not one had a name.

## 5. Module-level mutable state (FIXED)

`grid.ts:18` — `let regionCounter = 0;` — a module-level mutable counter reset via `resetRegionCounter()`. Forget to call it and region IDs grow silently forever. State management by prayer.

## 6. Static mutable globals on `BaseElement` (FIXED)

```ts
static audioFlickerEnabled: boolean = true;
static audioJiggleEnabled: boolean = true;
static intensityFromAudio: boolean = false;
```

Three mutable statics used as global config. Set from the engine, read from every element instance. Want two independent engines for testing? This architecture says no.

## 7. The `(this as any)._propertyName` pattern (FIXED)

8 element files stored computed values by casting `this` to `any`:

```ts
(this as any)._fontScale = p.fontScale;
```

TypeScript lets you declare properties on classes. That's the whole point.

## 8. Canvas `getContext('2d')` without null checks (FIXED)

32 elements call `canvas.getContext('2d')!` with a non-null assertion. Browsers can return null under memory pressure. One null and the whole HUD explodes with an unhelpful stack trace.

## 9. The 766-line editor overlay

`editor-overlay.ts` — 766 lines handling palette selection, region editing, element picking, drag-and-drop, toolbar rendering, and overlay drawing. That's not a file, that's a department.

## 10. `synth.ts` freelancing with `Math.random()`

14 calls to `Math.random()` in the audio synth. Audio randomness doesn't need to be deterministic, fine. But the inconsistency with the project's seeded-RNG philosophy is sloppy.

---

## Scorecard

| # | Issue | Status | Fix |
|---|-------|--------|-----|
| 1 | `Math.random()` breaking determinism | FIXED | Replaced 87 calls across 19 element files with `this.rng` |
| 2 | `as any` tag matching | FIXED | Proper `RoleTag \| MoodTag \| SizeTag` casts |
| 3 | Zero tests | FIXED | 80 tests across 5 suites (SeededRandom, StateMachine, BSP, easing, fx) |
| 4 | Magic number casino | FIXED | 15 named constants with comments in compositor.ts |
| 5 | Module-level mutable state | FIXED | Counter passed through recursion, `resetRegionCounter()` eliminated |
| 6 | Static mutable globals | FIXED | `IntensityConfig` object passed by reference, no more statics |
| 7 | `(this as any)` pattern | FIXED | Proper private property declarations in 8 files |
| 8 | Canvas null assertions | FIXED | `get2DContext()` helper on BaseElement with clear error messages |
| 9 | 766-line editor overlay | NOT FIXED | Needs structural refactor into sub-modules |
| 10 | Synth `Math.random()` | NOT FIXED | Audio doesn't need determinism, just consistency |
