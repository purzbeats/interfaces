# Element Quality Checklist

Best practices for creating and reviewing visual elements in this project. Every element extends `BaseElement` and must render correctly at any tile size and aspect ratio.

## The Scaling Ethos

**Every visual measurement must derive from `this.px` (tile bounds).** The tile's width and height are the single source of truth for all sizes. Nothing is hardcoded. If you can't trace a number back to `this.px.w` or `this.px.h`, it's wrong.

- **No magic pixel numbers.** Never write `6`, `14`, `20`, `40` as a size, offset, or margin. Always compute from tile dimensions.
- **Margins/padding:** `cw * 0.02` or `Math.max(2, cw * 0.02)`, never `4` or `10`.
- **Font sizes:** `Math.max(6, Math.floor(ch * 0.08))`, never `Math.min(10, ...)` with a hardcoded cap.
- **Mesh geometry:** `PlaneGeometry(Math.min(w,h) * 0.04, ...)`, never `PlaneGeometry(6, 6)`.
- **lineWidth:** `Math.max(0.5, cw * 0.008)`, never bare `2`.
- **Arc radius (dots/particles):** `Math.max(1, Math.min(cw, ch) * 0.008)`, never bare `2`.
- **Layout offsets (tree nodes, rows):** `ch * 0.15`, never `30` or `40`.
- **Physics boundaries/OOB margins:** `Math.min(w, h) * 0.06`, never `20`.
- **Progress bar heights:** `Math.max(2, ch * 0.04)`, never `4`.
- **Minimum floors:** Use `Math.max(6, computed)` — the `6` is a readability floor, not a design target.

### Acceptable Constants

The **only** acceptable hardcoded pixel values are:
- `0`, `1` as minimum floors for `Math.max()` (e.g. `Math.max(1, ...)` for minimum visible size)
- `6` as a minimum font size floor (`Math.max(6, ...)`) — below 6px text is unreadable
- Proportional fractions like `0.008`, `0.04`, `0.06` (these are ratios, not pixels)

## Tile Bounds

- All geometry (lines, points, meshes, canvas content) must stay within `this.px` (`{ x, y, w, h }`).
- Position meshes at `x + w/2, y + h/2` for centered placement.
- For radial elements, use `Math.min(w, h) * factor` for radius, never a fixed pixel value.
- When using parametric curves (involute, L-system, attractor), compute the bounding box of generated points and scale/clamp to fit within `this.px`.
- For rotation: store geometry in local coords (centered at origin), set `mesh.position` to the tile center. Never call `geometry.translate()` per frame — it accumulates.

## Canvas Sizing and Performance

- **CRITICAL: Canvas must preserve tile aspect ratio.** Never cap width and height independently (e.g. `Math.min(512, w)` / `Math.min(256, h)`). Always use a uniform scale:
  ```ts
  const maxRes = 200;
  const scale = Math.min(1, maxRes / Math.max(w, h));
  const cw = Math.max(64, Math.floor(w * scale));
  const ch = Math.max(64, Math.floor(h * scale));
  ```
  This prevents stretching when the tile is very wide or very tall.
- Never use `devicePixelRatio` for canvas sizing — it causes 3840px+ canvases on 4K.
- Add render throttle for expensive canvas redraws:
  ```ts
  private renderAccum = 0;
  // In update(), AFTER applyEffects:
  this.renderAccum += dt;
  if (this.renderAccum < 0.066) return; // ~15fps
  this.renderAccum = 0;
  ```
- **ALWAYS use `THREE.NearestFilter`** for both `minFilter` and `magFilter` on canvas textures. Never use `LinearFilter` — we want crisp nearest-neighbor pixels, not blurry interpolation.
- If an element has text overlays on a low-res compute canvas, render the text on a **separate high-res canvas/mesh** layered on top (see `burning-ship.ts` for the pattern).

## Scaling and Proportions

All visual sizes must be derived from tile/canvas dimensions. The patterns below are the **only** acceptable approaches:

### Font Sizes
```ts
// GOOD — scales with canvas, has a readability floor
const fontSize = Math.max(6, Math.floor(ch * 0.08));
ctx.font = `${fontSize}px monospace`;

// BAD — hardcoded cap prevents scaling on large tiles
ctx.font = `${Math.min(10, someExpr)}px monospace`;

// BAD — hardcoded literal
ctx.font = '14px monospace';
```

### Mesh Geometry
```ts
// GOOD — derived from tile
const dotSize = Math.max(2, Math.min(w, h) * 0.04);
new THREE.PlaneGeometry(dotSize, dotSize);

// BAD — hardcoded
new THREE.PlaneGeometry(6, 6);
```

### Line Width / Dot Radius
```ts
// GOOD — proportional
ctx.lineWidth = Math.max(0.5, cw * 0.008);
ctx.arc(cx, cy, Math.max(1, Math.min(cw, ch) * 0.008), 0, Math.PI * 2);

// BAD — hardcoded
ctx.lineWidth = 2;
ctx.arc(cx, cy, 2, 0, Math.PI * 2);
```

### Margins and Layout Offsets
```ts
// GOOD — proportional
const m = Math.max(2, cw * 0.02);
const headerH = ch * 0.08;
const rowH = (ch - headerH - m * 2) / rowCount;

// BAD — hardcoded pixels
const m = 4;
const topY = hH + 14;
const nodeOffset = 40;
```

### Physics Boundaries / OOB Margins
```ts
// GOOD — proportional
const pad = Math.min(w, h) * 0.06;
if (px < x - pad || px > x + w + pad) respawn();

// BAD — hardcoded
if (px < x - 20 || px > x + w + 20) respawn();
```

### Point Sizes
```ts
// GOOD
Math.min(w, h) * 0.01

// BAD
size: 2
```

## Initialization Order

- Always create the canvas BEFORE calling any method that reads `this.canvas.width/height`. A common bug: calling `buildCircuit()` before `document.createElement('canvas')`, causing fallback to 512x512.
- Initialize `Float32Array` positions to the tile center (not 0,0,0) to avoid lines-to-origin artifacts.
- Set `geometry.setDrawRange(0, 0)` for buffers that fill progressively.

## Mesh Count

- Never create individual meshes per grid cell (e.g. 144 PlaneGeometry+MeshBasicMaterial = 144 draw calls + shader compiles).
- Use one of: single canvas texture on one mesh, `THREE.Points` for particle systems, or `THREE.InstancedMesh` for repeated geometry.
- If updating geometry per frame, update buffer attributes directly and set `needsUpdate = true`.

## Visual Density

- Elements should fill their tile. Don't leave large empty margins.
- Use at least 2 palette colors for contrast (primary + secondary or dim).
- Canvas elements: clear with `palette.bg`, draw with `palette.primary`/`secondary`/`dim`.
- Particle counts should scale with tile area, not be fixed constants.
- Initial states (seeds, starting positions) should cover a meaningful portion of the tile, not cluster in one corner.

## Animation

- Always call `this.applyEffects(dt)` at the top of `update()` and use the returned opacity.
- Simulations should show visible progress — if the user sees a static image for several seconds, increase steps per frame.
- For progressive reveal (fractals, L-systems, graph traversals), the growth should be apparent within 1-2 seconds.

## Common Pitfalls

| Problem | Cause | Fix |
|---------|-------|-----|
| Lines to origin | Float32Array defaults to 0,0,0 | Init positions to tile center |
| Geometry drifts off-screen | `geometry.translate()` in update loop | Use mesh.position + local coords |
| Blurry/stretched text | Canvas too small for tile | Size canvas to element dimensions |
| Shader compile stall | Too many individual meshes | Batch into canvas or Points |
| Invisible at small sizes | Fixed pixel sizes for points/lines | Scale with `Math.min(w, h)` |
| Content outside tile | No bounds checking on parametric curves | Clamp or scale-to-fit after generation |
| Build-time crash | Accessing geometry before it's created | Order: allocate buffers, create mesh, THEN seed/populate |
| Text unreadable at small sizes | `Math.min(10, ...)` caps font | Use `Math.max(6, ...)` floor instead |
| Tiny dots on large tiles | `arc(x, y, 2, ...)` hardcoded radius | Use `Math.min(cw, ch) * 0.008` |
| Hairline borders on large tiles | `lineWidth = 1` hardcoded | Use `Math.max(0.5, cw * 0.008)` |
| Layout breaks at extreme sizes | Hardcoded `+40`, `+30` offsets | Derive from `ch * fraction` |
