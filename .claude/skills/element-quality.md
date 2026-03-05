# Element Quality Checklist

Best practices for creating and reviewing visual elements in this project. Every element extends `BaseElement` and must render correctly at any tile size.

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

- Font sizes must scale with tile/canvas dimensions: `${Math.floor(canvasHeight * 0.06)}px monospace`, not fixed `14px`.
- Point sizes should be proportional: `Math.min(w, h) * 0.01`, not fixed `size: 2`.
- Line widths: use 1-2px for canvas, or scale with tile size for very large tiles.
- Never use hardcoded pixel positions — always derive from `this.px`.

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
