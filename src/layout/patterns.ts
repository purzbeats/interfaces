import type { SeededRandom } from '../random';
import type { Region } from './region';
import { createTieredRegion } from './region';

export interface LayoutPattern {
  name: string;
  generate: (rng: SeededRandom) => Region[];
}

/** Apply ±jitter to a split point, clamped to [min, max] */
function jitter(value: number, rng: SeededRandom, amount: number = 0.02, min: number = 0.05, max: number = 0.95): number {
  return Math.max(min, Math.min(max, value + rng.float(-amount, amount)));
}

// --- Pattern A: "main-sidebar" ---
function mainSidebar(rng: SeededRandom): Region[] {
  const sx = jitter(0.65, rng);   // hero/widget | sidebar split
  const sy = jitter(0.65, rng);   // hero | widget row split
  const sy2 = jitter(0.33, rng, 0.02, 0.15, 0.55); // sidebar panel1 | panel2
  const sy3 = jitter(0.66, rng, 0.02, 0.45, 0.85); // sidebar panel2 | panel3
  const wx1 = jitter(0.33, rng, 0.015, 0.15, 0.45) * sx; // widget splits within left portion
  const wx2 = jitter(0.66, rng, 0.015, 0.55, 0.85) * sx;

  return [
    createTieredRegion('hero-0', 'hero', 0, 0, sx, sy),
    createTieredRegion('panel-0', 'panel', sx, 0, 1 - sx, sy2),
    createTieredRegion('panel-1', 'panel', sx, sy2, 1 - sx, sy3 - sy2),
    createTieredRegion('panel-2', 'panel', sx, sy3, 1 - sx, 1 - sy3),
    createTieredRegion('widget-0', 'widget', 0, sy, wx1, 1 - sy),
    createTieredRegion('widget-1', 'widget', wx1, sy, wx2 - wx1, 1 - sy),
    createTieredRegion('widget-2', 'widget', wx2, sy, sx - wx2, 1 - sy),
  ];
}

// --- Pattern B: "center-focus" ---
function centerFocus(rng: SeededRandom): Region[] {
  const topH = jitter(0.22, rng, 0.02, 0.15, 0.30);
  const botY = jitter(0.78, rng, 0.02, 0.70, 0.85);
  const leftW = jitter(0.22, rng, 0.02, 0.15, 0.30);
  const rightX = jitter(0.78, rng, 0.02, 0.70, 0.85);
  // Top widget splits
  const tw1 = jitter(0.25, rng, 0.015);
  const tw2 = jitter(0.50, rng, 0.015);
  const tw3 = jitter(0.75, rng, 0.015);
  // Bottom widget splits
  const bw1 = jitter(0.25, rng, 0.015);
  const bw2 = jitter(0.50, rng, 0.015);
  const bw3 = jitter(0.75, rng, 0.015);

  return [
    // Top row widgets
    createTieredRegion('widget-0', 'widget', 0, 0, tw1, topH),
    createTieredRegion('widget-1', 'widget', tw1, 0, tw2 - tw1, topH),
    createTieredRegion('widget-2', 'widget', tw2, 0, tw3 - tw2, topH),
    createTieredRegion('widget-3', 'widget', tw3, 0, 1 - tw3, topH),
    // Middle row
    createTieredRegion('panel-0', 'panel', 0, topH, leftW, botY - topH),
    createTieredRegion('hero-0', 'hero', leftW, topH, rightX - leftW, botY - topH),
    createTieredRegion('panel-1', 'panel', rightX, topH, 1 - rightX, botY - topH),
    // Bottom row widgets
    createTieredRegion('widget-4', 'widget', 0, botY, bw1, 1 - botY),
    createTieredRegion('widget-5', 'widget', bw1, botY, bw2 - bw1, 1 - botY),
    createTieredRegion('widget-6', 'widget', bw2, botY, bw3 - bw2, 1 - botY),
    createTieredRegion('widget-7', 'widget', bw3, botY, 1 - bw3, 1 - botY),
  ];
}

// --- Pattern C: "dual-monitor" ---
function dualMonitor(rng: SeededRandom): Region[] {
  const topH = jitter(0.22, rng, 0.02, 0.15, 0.30);
  const midY = jitter(0.72, rng, 0.02, 0.60, 0.80);
  const heroSplit = jitter(0.50, rng, 0.02, 0.35, 0.65);
  // Top widget splits (5 widgets)
  const tw1 = jitter(0.20, rng, 0.015);
  const tw2 = jitter(0.40, rng, 0.015);
  const tw3 = jitter(0.60, rng, 0.015);
  const tw4 = jitter(0.80, rng, 0.015);
  // Bottom panel splits
  const bp1 = jitter(0.25, rng, 0.02);
  const bp2 = jitter(0.50, rng, 0.02);

  return [
    // Top row: 5 widgets
    createTieredRegion('widget-0', 'widget', 0, 0, tw1, topH),
    createTieredRegion('widget-1', 'widget', tw1, 0, tw2 - tw1, topH),
    createTieredRegion('widget-2', 'widget', tw2, 0, tw3 - tw2, topH),
    createTieredRegion('widget-3', 'widget', tw3, 0, tw4 - tw3, topH),
    createTieredRegion('widget-4', 'widget', tw4, 0, 1 - tw4, topH),
    // Middle: 2 heroes
    createTieredRegion('hero-0', 'hero', 0, topH, heroSplit, midY - topH),
    createTieredRegion('hero-1', 'hero', heroSplit, topH, 1 - heroSplit, midY - topH),
    // Bottom: 3 panels
    createTieredRegion('panel-0', 'panel', 0, midY, bp1, 1 - midY),
    createTieredRegion('panel-1', 'panel', bp1, midY, bp2 - bp1, 1 - midY),
    createTieredRegion('panel-2', 'panel', bp2, midY, 1 - bp2, 1 - midY),
  ];
}

// --- Pattern D: "hud-frame" ---
function hudFrame(rng: SeededRandom): Region[] {
  const frameW = jitter(0.20, rng, 0.02, 0.14, 0.26);
  const frameH = jitter(0.25, rng, 0.02, 0.18, 0.32);
  const rightX = 1 - frameW;
  const botY = 1 - frameH;
  // Top middle widget split
  const tmSplit = jitter(0.50, rng, 0.02);
  // Bottom middle widget split
  const bmSplit = jitter(0.50, rng, 0.02);

  return [
    // Corners: panels
    createTieredRegion('panel-0', 'panel', 0, 0, frameW, frameH),
    createTieredRegion('panel-1', 'panel', rightX, 0, frameW, frameH),
    createTieredRegion('panel-2', 'panel', 0, botY, frameW, frameH),
    createTieredRegion('panel-3', 'panel', rightX, botY, frameW, frameH),
    // Top middle: 2 widgets
    createTieredRegion('widget-0', 'widget', frameW, 0, tmSplit - frameW, frameH),
    createTieredRegion('widget-1', 'widget', tmSplit, 0, rightX - tmSplit, frameH),
    // Center: hero
    createTieredRegion('hero-0', 'hero', frameW, frameH, rightX - frameW, botY - frameH),
    // Side widgets
    createTieredRegion('widget-2', 'widget', 0, frameH, frameW, botY - frameH),
    createTieredRegion('widget-3', 'widget', rightX, frameH, frameW, botY - frameH),
    // Bottom middle: 2 widgets
    createTieredRegion('widget-4', 'widget', frameW, botY, bmSplit - frameW, frameH),
    createTieredRegion('widget-5', 'widget', bmSplit, botY, rightX - bmSplit, frameH),
  ];
}

// --- Pattern E: "grid-dashboard" ---
function gridDashboard(rng: SeededRandom): Region[] {
  const heroW = jitter(0.58, rng, 0.02, 0.48, 0.68);
  const heroH = jitter(0.55, rng, 0.02, 0.45, 0.65);
  const midSplitY = jitter(0.55, rng, 0.02, 0.45, 0.65) * (1 - heroH) + heroH;
  // Right side splits
  const rSplitY = jitter(0.50, rng, 0.02) * heroH;
  const rSplitX = jitter(0.50, rng, 0.02) * (1 - heroW) + heroW;
  // Bottom left panel
  const blW = jitter(0.30, rng, 0.02, 0.20, 0.40);
  // Bottom widgets
  const bw1 = jitter(0.20, rng, 0.015, 0.10, 0.30);
  const bw2 = jitter(0.45, rng, 0.015, 0.35, 0.55);
  const bw3 = jitter(0.70, rng, 0.015, 0.60, 0.80);

  return [
    createTieredRegion('hero-0', 'hero', 0, 0, heroW, heroH),
    createTieredRegion('panel-0', 'panel', heroW, 0, 1 - heroW, rSplitY),
    createTieredRegion('widget-0', 'widget', heroW, rSplitY, rSplitX - heroW, heroH - rSplitY),
    createTieredRegion('widget-1', 'widget', rSplitX, rSplitY, 1 - rSplitX, heroH - rSplitY),
    createTieredRegion('panel-1', 'panel', 0, heroH, blW, midSplitY - heroH),
    createTieredRegion('panel-2', 'panel', blW, heroH, 1 - blW, midSplitY - heroH),
    createTieredRegion('widget-2', 'widget', 0, midSplitY, bw1, 1 - midSplitY),
    createTieredRegion('widget-3', 'widget', bw1, midSplitY, bw2 - bw1, 1 - midSplitY),
    createTieredRegion('widget-4', 'widget', bw2, midSplitY, bw3 - bw2, 1 - midSplitY),
    createTieredRegion('widget-5', 'widget', bw3, midSplitY, 1 - bw3, 1 - midSplitY),
  ];
}

// --- Pattern F: "tri-column" ---
function triColumn(rng: SeededRandom): Region[] {
  const sideW = jitter(0.20, rng, 0.02, 0.14, 0.26);
  const rightX = 1 - sideW;
  const leftSplit = jitter(0.50, rng, 0.02, 0.35, 0.65);
  const rightSplit = jitter(0.50, rng, 0.02, 0.35, 0.65);
  // Panel/widget distribution on sides
  const lPanelY = jitter(0.33, rng, 0.02, 0.20, 0.45);
  const lPanelH = jitter(0.34, rng, 0.02, 0.25, 0.45);
  const rPanelY = jitter(0.33, rng, 0.02, 0.20, 0.45);
  const rPanelH = jitter(0.34, rng, 0.02, 0.25, 0.45);

  return [
    // Left column
    createTieredRegion('widget-0', 'widget', 0, 0, sideW, lPanelY),
    createTieredRegion('panel-0', 'panel', 0, lPanelY, sideW, lPanelH),
    createTieredRegion('widget-1', 'widget', 0, lPanelY + lPanelH, sideW, 1 - lPanelY - lPanelH),
    // Center hero
    createTieredRegion('hero-0', 'hero', sideW, 0, rightX - sideW, 1),
    // Right column
    createTieredRegion('widget-2', 'widget', rightX, 0, sideW, rPanelY),
    createTieredRegion('panel-1', 'panel', rightX, rPanelY, sideW, rPanelH),
    createTieredRegion('widget-3', 'widget', rightX, rPanelY + rPanelH, sideW, 1 - rPanelY - rPanelH),
  ];
}

// --- Pattern G: "asymmetric-split" ---
function asymmetricSplit(rng: SeededRandom): Region[] {
  const leftW = jitter(0.38, rng, 0.02, 0.30, 0.46);
  const panelSplit = jitter(0.50, rng, 0.02, 0.35, 0.65);
  const heroH = jitter(0.70, rng, 0.02, 0.60, 0.80);
  // Widget splits in bottom row
  const w1 = jitter(0.20, rng, 0.015);
  const w2 = jitter(0.40, rng, 0.015);
  const w3 = jitter(0.60, rng, 0.015);
  const w4 = jitter(0.80, rng, 0.015);

  return [
    createTieredRegion('panel-0', 'panel', 0, 0, leftW, panelSplit * heroH),
    createTieredRegion('panel-1', 'panel', 0, panelSplit * heroH, leftW, heroH - panelSplit * heroH),
    createTieredRegion('hero-0', 'hero', leftW, 0, 1 - leftW, heroH),
    createTieredRegion('widget-0', 'widget', 0, heroH, w1, 1 - heroH),
    createTieredRegion('widget-1', 'widget', w1, heroH, w2 - w1, 1 - heroH),
    createTieredRegion('widget-2', 'widget', w2, heroH, w3 - w2, 1 - heroH),
    createTieredRegion('widget-3', 'widget', w3, heroH, w4 - w3, 1 - heroH),
    createTieredRegion('widget-4', 'widget', w4, heroH, 1 - w4, 1 - heroH),
  ];
}

// --- Pattern H: "cockpit" ---
function cockpit(rng: SeededRandom): Region[] {
  const topH = jitter(0.20, rng, 0.02, 0.14, 0.26);
  const botY = jitter(0.78, rng, 0.02, 0.72, 0.84);
  const sideW = jitter(0.15, rng, 0.02, 0.10, 0.22);
  const rightX = 1 - sideW;
  // Top widget splits
  const tw1 = jitter(0.25, rng, 0.015);
  const tw2 = jitter(0.50, rng, 0.015);
  const tw3 = jitter(0.75, rng, 0.015);
  // Bottom widget splits
  const bw1 = jitter(0.25, rng, 0.015);
  const bw2 = jitter(0.50, rng, 0.015);
  const bw3 = jitter(0.75, rng, 0.015);

  return [
    // Top widgets
    createTieredRegion('widget-0', 'widget', 0, 0, tw1, topH),
    createTieredRegion('widget-1', 'widget', tw1, 0, tw2 - tw1, topH),
    createTieredRegion('widget-2', 'widget', tw2, 0, tw3 - tw2, topH),
    createTieredRegion('widget-3', 'widget', tw3, 0, 1 - tw3, topH),
    // Middle
    createTieredRegion('panel-0', 'panel', 0, topH, sideW, botY - topH),
    createTieredRegion('hero-0', 'hero', sideW, topH, rightX - sideW, botY - topH),
    createTieredRegion('panel-1', 'panel', rightX, topH, sideW, botY - topH),
    // Bottom widgets
    createTieredRegion('widget-4', 'widget', 0, botY, bw1, 1 - botY),
    createTieredRegion('widget-5', 'widget', bw1, botY, bw2 - bw1, 1 - botY),
    createTieredRegion('widget-6', 'widget', bw2, botY, bw3 - bw2, 1 - botY),
    createTieredRegion('widget-7', 'widget', bw3, botY, 1 - bw3, 1 - botY),
  ];
}

// --- Pattern I: "watchtower" ---
function watchtower(rng: SeededRandom): Region[] {
  const sideW = jitter(0.13, rng, 0.02, 0.08, 0.18);
  const rightX = 1 - sideW;
  const heroH = jitter(0.55, rng, 0.02, 0.45, 0.65);
  const midH = jitter(0.25, rng, 0.02, 0.18, 0.32);
  const botY = heroH + midH;
  // Panel splits in middle row
  const p1 = jitter(0.33, rng, 0.02, 0.20, 0.45);
  const p2 = jitter(0.66, rng, 0.02, 0.55, 0.80);
  // Bottom widget splits
  const bw1 = jitter(0.40, rng, 0.02, 0.30, 0.50);
  const bw2 = jitter(0.50, rng, 0.015, 0.40, 0.60);

  return [
    // Top: hero with side widgets
    createTieredRegion('widget-0', 'widget', 0, 0, sideW, heroH),
    createTieredRegion('hero-0', 'hero', sideW, 0, rightX - sideW, heroH),
    createTieredRegion('widget-1', 'widget', rightX, 0, sideW, heroH),
    // Middle row: side widgets + panels
    createTieredRegion('widget-2', 'widget', 0, heroH, sideW, midH),
    createTieredRegion('panel-0', 'panel', sideW, heroH, p1 - sideW, midH),
    createTieredRegion('panel-1', 'panel', p1, heroH, p2 - p1, midH),
    createTieredRegion('panel-2', 'panel', p2, heroH, rightX - p2, midH),
    createTieredRegion('widget-3', 'widget', rightX, heroH, sideW, midH),
    // Bottom row: 3 widgets
    createTieredRegion('widget-4', 'widget', 0, botY, bw1, 1 - botY),
    createTieredRegion('widget-5', 'widget', bw1, botY, bw2 - bw1, 1 - botY),
    createTieredRegion('widget-6', 'widget', bw2, botY, 1 - bw2, 1 - botY),
  ];
}

// --- Pattern J: "picture-in-picture" ---
function pictureInPicture(rng: SeededRandom): Region[] {
  const leftW = jitter(0.55, rng, 0.02, 0.45, 0.65);
  const topH = jitter(0.30, rng, 0.02, 0.22, 0.38);
  const heroH = jitter(0.45, rng, 0.02, 0.35, 0.55);
  const botY = topH + heroH;
  // Top-left widget splits (3 widgets)
  const tw1 = jitter(0.33, rng, 0.015) * leftW;
  const tw2 = jitter(0.66, rng, 0.015) * leftW;
  // Right panel split
  const rSplitY = jitter(0.50, rng, 0.02, 0.35, 0.65);

  return [
    // Top-left: 3 widgets
    createTieredRegion('widget-0', 'widget', 0, 0, tw1, topH),
    createTieredRegion('widget-1', 'widget', tw1, 0, tw2 - tw1, topH),
    createTieredRegion('widget-2', 'widget', tw2, 0, leftW - tw2, topH),
    // Right: panel 1
    createTieredRegion('panel-0', 'panel', leftW, 0, 1 - leftW, rSplitY),
    // Heroes side by side
    createTieredRegion('hero-0', 'hero', 0, topH, leftW, heroH),
    createTieredRegion('hero-1', 'hero', leftW, rSplitY, 1 - leftW, topH + heroH - rSplitY),
    // Bottom row
    createTieredRegion('widget-3', 'widget', 0, botY, leftW * 0.35, 1 - botY),
    createTieredRegion('panel-1', 'panel', leftW * 0.35, botY, 1 - leftW * 0.35, 1 - botY),
  ];
}

// --- Pattern K: "radial-sanctum" ---
// Concentric 5×5 grid: small central hero, 8 inner ring panels, 8 outer frame widgets.
// Designed for "wheels within wheels" — dense ring of radial elements around a focal point.
function radialSanctum(rng: SeededRandom): Region[] {
  // Jittered 5×5 grid boundaries
  const c1 = jitter(0.20, rng, 0.015, 0.16, 0.24);
  const c2 = jitter(0.40, rng, 0.015, 0.36, 0.44);
  const c3 = jitter(0.60, rng, 0.015, 0.56, 0.64);
  const c4 = jitter(0.80, rng, 0.015, 0.76, 0.84);

  const r1 = jitter(0.20, rng, 0.015, 0.16, 0.24);
  const r2 = jitter(0.40, rng, 0.015, 0.36, 0.44);
  const r3 = jitter(0.60, rng, 0.015, 0.56, 0.64);
  const r4 = jitter(0.80, rng, 0.015, 0.76, 0.84);

  return [
    // Ring 0: central hero (the entity)
    createTieredRegion('hero-0', 'hero', c2, r2, c3 - c2, r3 - r2),

    // Ring 1: 8 inner panels (the eyes / wheels)
    createTieredRegion('panel-0', 'panel', c1, r1, c2 - c1, r2 - r1),   // top-left
    createTieredRegion('panel-1', 'panel', c2, r1, c3 - c2, r2 - r1),   // top
    createTieredRegion('panel-2', 'panel', c3, r1, c4 - c3, r2 - r1),   // top-right
    createTieredRegion('panel-3', 'panel', c1, r2, c2 - c1, r3 - r2),   // left
    createTieredRegion('panel-4', 'panel', c3, r2, c4 - c3, r3 - r2),   // right
    createTieredRegion('panel-5', 'panel', c1, r3, c2 - c1, r4 - r3),   // bottom-left
    createTieredRegion('panel-6', 'panel', c2, r3, c3 - c2, r4 - r3),   // bottom
    createTieredRegion('panel-7', 'panel', c3, r3, c4 - c3, r4 - r3),   // bottom-right

    // Ring 2: 8 outer widgets (4 corners + 4 edges)
    createTieredRegion('widget-0', 'widget', 0, 0, c1, r1),             // corner TL
    createTieredRegion('widget-1', 'widget', c4, 0, 1 - c4, r1),        // corner TR
    createTieredRegion('widget-2', 'widget', 0, r4, c1, 1 - r4),        // corner BL
    createTieredRegion('widget-3', 'widget', c4, r4, 1 - c4, 1 - r4),   // corner BR
    createTieredRegion('widget-4', 'widget', c1, 0, c4 - c1, r1),       // edge top
    createTieredRegion('widget-5', 'widget', c1, r4, c4 - c1, 1 - r4),  // edge bottom
    createTieredRegion('widget-6', 'widget', 0, r1, c1, r4 - r1),       // edge left
    createTieredRegion('widget-7', 'widget', c4, r1, 1 - c4, r4 - r1),  // edge right
  ];
}

// --- Pattern registry ---

export const PATTERNS: Record<string, LayoutPattern> = {
  'main-sidebar':       { name: 'main-sidebar',       generate: mainSidebar },
  'center-focus':       { name: 'center-focus',        generate: centerFocus },
  'dual-monitor':       { name: 'dual-monitor',        generate: dualMonitor },
  'hud-frame':          { name: 'hud-frame',           generate: hudFrame },
  'grid-dashboard':     { name: 'grid-dashboard',      generate: gridDashboard },
  'tri-column':         { name: 'tri-column',          generate: triColumn },
  'asymmetric-split':   { name: 'asymmetric-split',    generate: asymmetricSplit },
  'cockpit':            { name: 'cockpit',             generate: cockpit },
  'watchtower':         { name: 'watchtower',          generate: watchtower },
  'picture-in-picture': { name: 'picture-in-picture',  generate: pictureInPicture },
  'radial-sanctum':     { name: 'radial-sanctum',      generate: radialSanctum },
};

export function getPattern(name: string): LayoutPattern | undefined {
  return PATTERNS[name];
}

export function allPatternNames(): string[] {
  return Object.keys(PATTERNS);
}

export function randomPattern(rng: SeededRandom): LayoutPattern {
  const keys = Object.keys(PATTERNS);
  return PATTERNS[rng.pick(keys)];
}
