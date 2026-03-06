# ROAST v3 — Media Mode & Custom Palettes

Audit after adding custom palette editor, speedometer element, GPU video pipeline, and video shader effects.

---

## CRITICAL

### 1. Dual resize listeners during media mode
**engine.ts:1362 + media-mode.ts:220**
Engine's resize handler in `setupEvents()` is anonymous and never removed. When media mode adds its own resize listener, both fire simultaneously. Engine's handler calls `generate()` during media mode, causing phantom rebuilds.
**Fix:** Store the engine resize handler and skip regeneration if media mode is active.

### 2. Orphaned tiles from cancelled async spawns
**media-mode.ts:414-421, 475-490**
When `spawnGeneration` changes mid-loop, the current tile has already been added to `this.tiles` and its mesh added to the scene. The loop returns early but the partially-created tile is never cleaned up.
**Fix:** Dispose the tile before returning when generation is stale.

### 3. Video elements leak when `this.active` is false
**media-mode.ts:575-615**
If media mode exits while `loadTileMedia()` is pending, the `onloadeddata` handler checks `this.active` and skips assignment — but the video element itself is never paused or cleaned up. It continues loading/playing orphaned in memory.
**Fix:** Always pause + clear src on the video in the callback, even when `!this.active`.

### 4. Help overlay says V = "Record video" (wrong)
**help-overlay.ts:14**
V key now enters media mode, not video recording. Help text is stale.
**Fix:** Update to `['V', 'Media mode']`.

---

## HIGH

### 5. Stale palette uniforms on existing video tiles
**media-mode.ts:508-524**
Video tile ShaderMaterial uniforms (uBg, uDim, uPrimary, uSecondary) are cloned at creation. If palette changes mid-session (e.g. via `rollingRearrange` re-fetching palette), existing tiles keep the old colors.
**Fix:** After palette refresh, iterate tiles and update shader uniforms.

### 6. Palette editor DOM/event listener leaks
**palette-editor.ts:257-259, 132-146**
The keydown `stopPropagation` listener, color picker `input` listeners, and button click listeners are never explicitly removed. The overlay is removed from DOM on close, but rapid open/close cycles accumulate orphaned listeners.
**Fix:** Recreate overlay from scratch each time (current pattern) is OK since `el.remove()` allows GC — but ensure the `setTimeout` in `closePaletteEditor` doesn't race with `openPaletteEditor`.

### 7. `isBuiltinPalette` hardcoded list can desync
**custom-palettes.ts:63-67 vs palettes.ts:23-32**
Builtin palette names are hardcoded in two places. Adding a new builtin to `PALETTES` without updating `isBuiltinPalette` would let users "delete" it.
**Fix:** Derive from `PALETTES` keys at module init, or snapshot the original keys before custom palettes are registered.

### 8. GUI "Record Video (V)" button label is stale
**controls.ts:184**
The export folder still labels the record button as "Record Video (V)" but V no longer triggers it.
**Fix:** Remove the `(V)` hint or add a separate keybinding for recording.

---

## MEDIUM

### 9. Object URL cache never invalidated on delete
**storage.ts:111-141**
`activeObjectUrls` caches URLs by ID. If a blob is deleted from IndexedDB via `removeItem()`, `revokeObjectUrl()` is called — but if `getObjectUrl()` was called again before disposal, the stale URL persists.
**Fix:** Ensure `removeItem` always evicts from the cache (it does call `revokeObjectUrl` — verify no re-caching race).

### 10. Config still references deleted custom palette
**palette-editor.ts delete flow -> palettes.ts:34-36**
When a custom palette is deleted, `config.palette` may still hold the deleted name. `getPalette()` silently falls back to phosphor-green, but the dropdown shows a stale selection.
**Fix:** The editor already calls `onChange('phosphor-green')` on delete — verify the dropdown rebuilds correctly.

### 11. No media mode button on mobile toolbar
**mobile-toolbar.ts**
Mobile toolbar has buttons for showcase, gallery, editor, but not media mode. Mobile users can't access media mode.
**Fix:** Add media mode callback and button to mobile toolbar.

### 12. Outgoing tiles accumulate on rapid R presses
**media-mode.ts:442-491**
Each `rollingRearrange()` pushes current tiles to `outgoingTiles`. Rapid R presses before old tiles fade out pile up outgoing tiles rendering simultaneously. They do eventually clean up when opacity hits 0, but waste GPU cycles in the interim.
**Fix:** Consider disposing outgoing tiles immediately on new rearrange, or cap outgoing count.

### 13. Engine resize handler never removed on dispose
**engine.ts:1362, 1560**
The anonymous resize listener created in `setupEvents()` is never cleaned up in `Engine.dispose()`. Multiple engine instances would accumulate listeners.
**Fix:** Store handler reference, remove in `dispose()`.

---

## LOW

### 14. Speedometer render throttle accumulator
**speedometer.ts:285**
The `renderAccum` resets after threshold but doesn't cap — extremely long frames could cause multiple redraws. Not a real problem in practice.

### 15. Custom palette name validation
**custom-palettes.ts:47-52**
`saveCustomPalette()` accepts any name. The palette editor does sanitize (lowercase, strip special chars), but direct callers could pass empty or invalid names.

### 16. IndexedDB connections opened per-call
**storage.ts:35-47**
Every `putBlob`/`getBlob`/`deleteBlob` call opens a new DB connection. Fine for low-frequency use but inefficient for batch operations. Not a practical issue at current usage levels.

### 17. Divider elements not gracefully deactivated
**media-mode.ts:331-338**
`clearDividers()` calls `dispose()` without transitioning elements to idle state first. Animations may be interrupted. Cosmetic only.

---

## PREVIOUSLY FIXED (v1/v2)

| # | Issue | Status |
|---|-------|--------|
| 1 | `Math.random()` breaking determinism | FIXED |
| 2 | `as any` tag matching | FIXED |
| 3 | Zero tests | FIXED — 80 tests |
| 4 | Magic number casino | FIXED |
| 5 | Module-level mutable state | FIXED |
| 6 | Static mutable globals | FIXED |
| 7 | `(this as any)` pattern | FIXED |
| 8 | Canvas null assertions | FIXED |
| 9 | 766-line editor overlay | NOT FIXED |
| 10 | Synth `Math.random()` | NOT FIXED |

---

## VERIFIED SAFE

- **Mode exclusivity**: All four modes properly check each other before entry. Update/render loops are mutually exclusive.
- **Post-FX pipeline**: Single shared instance, not duplicated.
- **Audio system**: Media mode has zero interaction with AudioSynth/AudioReactive.
- **Custom palette URL params**: `loadCustomPalettes()` runs before URL param resolution.
- **Speedometer auto-registration**: Glob import picks it up. No naming collisions.
- **Cover-fit UV math**: Correct for all aspect ratios.
- **Canvas null guards**: Image tiles check `ctx2d && canvas` before access.
