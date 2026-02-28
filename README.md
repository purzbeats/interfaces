# INTERFACES

Procedural sci-fi interface generator built with Three.js and TypeScript. Produces animated HUD-style compositions from 23 visual elements — radar sweeps, waveforms, data cascades, ring gauges, and more — arranged via BSP-subdivided layout templates with seeded randomness for deterministic output.

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

## Architecture

```
src/
├── main.ts              # Entry point — Engine init + render loop
├── engine.ts            # Core engine — orchestrates layout, rendering, timeline
├── config.ts            # Runtime configuration (seed, palette, template, post-fx)
├── random.ts            # Seeded PRNG (mulberry32)
├── elements/            # 23 visual element types + registry + tag metadata
│   ├── base-element.ts  # Abstract base class
│   ├── registry.ts      # Element factory registry
│   └── tags.ts          # Shape/role/mood/size tag taxonomy
├── layout/              # Spatial layout system
│   ├── region.ts        # Normalized-coordinate region primitives
│   ├── grid.ts          # BSP subdivision
│   ├── templates.ts     # Template configs (regions, weights, BSP options)
│   └── compositor.ts    # Smart element selection (shape fitness, diversity)
├── renderer/            # Three.js rendering
├── animation/           # Timeline and animation
├── audio/               # Audio system
├── color/               # Palette management
├── postfx/              # Post-processing (bloom, CRT, chromatic aberration)
├── shaders/             # GLSL shaders
├── gui/                 # lil-gui debug panel
├── export/              # Video/image export
└── persistence.ts       # State persistence
```

## Templates

Seven built-in layout templates: `command-center`, `surveillance`, `diagnostic`, `tactical`, `nerv`, `datastream`, `geometry`. Use `auto` for random selection.

## Element Tags

Each element is tagged with metadata for smart placement:

- **Shape** (`rectangular` / `linear` / `radial`) — matched against region aspect ratio
- **Role** (`structural` / `gauge` / `scanner` / `data-display` / `text` / `decorative`) — diversity tracking
- **Mood** (`tactical` / `diagnostic` / `ambient`) — thematic grouping
- **Size** (`works-small` / `needs-medium` / `needs-large`) — region size fitness

The compositor uses these tags to bias placement: radial elements toward square regions, linear elements toward thin strips, and penalizes adjacent duplicates for visual variety.

## License

Private
