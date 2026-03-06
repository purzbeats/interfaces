import type { SeededRandom } from '../random';
import type { Region } from './region';
import { createTieredRegion } from './region';
import { generateHexGrid, hexInscribedRect, hexDistance, getHexAspect } from './hex-grid';

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

// --- Pattern L: "culture-plate" ---
// Asymmetric microscope-view layout: off-center hero "specimen field" with
// stacked right-side panels, bottom panels, and scattered widgets forming
// an L-shaped instrument cluster.
function culturePlate(rng: SeededRandom): Region[] {
  const leftStripW = jitter(0.08, rng, 0.015, 0.05, 0.12);
  const heroRightX = jitter(0.60, rng, 0.02, 0.54, 0.66);
  const heroBottomY = jitter(0.58, rng, 0.02, 0.52, 0.64);
  // Right side panel splits
  const rPanel0Y = jitter(0.30, rng, 0.02, 0.24, 0.36);
  const rPanel1Y = jitter(0.65, rng, 0.02, 0.58, 0.72);
  // Bottom row splits
  const bSplitX1 = jitter(0.35, rng, 0.02, 0.28, 0.42);
  const bSplitX2 = jitter(0.65, rng, 0.02, 0.58, 0.72);

  return [
    // Left strip widget
    createTieredRegion('widget-5', 'widget', 0, 0, leftStripW, heroBottomY),
    // Hero: main specimen view (upper-left, ~52% x 58%)
    createTieredRegion('hero-0', 'hero', leftStripW, 0, heroRightX - leftStripW, heroBottomY),
    // Right stacked: top widget + 2 panels
    createTieredRegion('widget-0', 'widget', heroRightX, 0, 1 - heroRightX, rPanel0Y),
    createTieredRegion('panel-0', 'panel', heroRightX, rPanel0Y, 1 - heroRightX, rPanel1Y - rPanel0Y),
    createTieredRegion('panel-1', 'panel', heroRightX, rPanel1Y, 1 - heroRightX, heroBottomY - rPanel1Y),
    // Bottom row: panel + 2 widgets
    createTieredRegion('panel-2', 'panel', 0, heroBottomY, bSplitX1, 1 - heroBottomY),
    createTieredRegion('widget-3', 'widget', bSplitX1, heroBottomY, bSplitX2 - bSplitX1, 1 - heroBottomY),
    createTieredRegion('widget-4', 'widget', bSplitX2, heroBottomY, 1 - bSplitX2, 1 - heroBottomY),
    // Corner widgets
    createTieredRegion('widget-1', 'widget', heroRightX, heroBottomY - 0.06, (1 - heroRightX) * 0.5, 0.06),
    createTieredRegion('widget-2', 'widget', heroRightX + (1 - heroRightX) * 0.5, heroBottomY - 0.06, (1 - heroRightX) * 0.5, 0.06),
  ];
}

// ---------------------------------------------------------------------------
// Hex patterns — flat-top hexagonal grids
// ---------------------------------------------------------------------------

const SQRT3 = Math.sqrt(3);

/**
 * Subdivide a hex cell into 2-4 smaller hex cells nested inside it.
 * Each sub-hex gets its own HexCell for clipping + border rendering.
 */
function subdivideHexCell(
  parentRegion: Region,
  rng: SeededRandom,
): Region[] {
  const cell = parentRegion.hexCell!;
  const aspect = getHexAspect();
  const type = rng.pick(['pair', 'trio', 'quad']);

  let subSize: number;
  let coords: { q: number; r: number }[];

  if (type === 'pair') {
    subSize = cell.size * 0.45;
    coords = [{ q: 0, r: 0 }, { q: 1, r: 0 }];
  } else if (type === 'trio') {
    subSize = cell.size * 0.30;
    coords = [{ q: 0, r: 0 }, { q: 1, r: 0 }, { q: 0, r: 1 }];
  } else {
    subSize = cell.size * 0.33;
    coords = [{ q: 0, r: 0 }, { q: 1, r: 0 }, { q: 0, r: 1 }, { q: 1, r: 1 }];
  }

  // Compute sub-hex centers in aspect-corrected space, centered on parent
  const gapScale = 1.08;
  const raw = coords.map(c => ({
    dx: subSize * 1.5 * c.q * gapScale,
    dy: subSize * SQRT3 * (c.r + c.q / 2) * gapScale,
  }));
  const avgDx = raw.reduce((s, p) => s + p.dx, 0) / raw.length;
  const avgDy = raw.reduce((s, p) => s + p.dy, 0) / raw.length;

  return raw.map((off, i) => {
    const subCell = {
      q: cell.q * 1000 + coords[i].q,
      r: cell.r * 1000 + coords[i].r,
      size: subSize,
      cx: cell.cx + (off.dx - avgDx) / aspect,
      cy: cell.cy + (off.dy - avgDy),
    };
    const rect = hexInscribedRect(subCell);
    const region = createTieredRegion(
      `${parentRegion.id}-sub${i}`, 'widget',
      rect.x, rect.y, rect.w, rect.h,
      0,
    );
    region.hexCell = subCell;
    return region;
  });
}

/** Convert a HexCell array to Regions with inscribed rectangles and tier assignment. */
function hexCellsToRegions(
  cells: { q: number; r: number; size: number; cx: number; cy: number }[],
  tierFn: (q: number, r: number) => 'hero' | 'panel' | 'widget',
  rng?: SeededRandom,
): Region[] {
  const regions: Region[] = [];
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    const tier = tierFn(cell.q, cell.r);
    const rect = hexInscribedRect(cell);
    const region = createTieredRegion(
      `hex-${i}`, tier,
      rect.x, rect.y, rect.w, rect.h,
      0, // no padding — hex clipping planes handle boundaries
    );
    region.hexCell = cell;

    // Subdivide ~40% of panel/widget cells when rng is provided
    if (rng && tier !== 'hero' && rng.float(0, 1) < 0.4) {
      regions.push(...subdivideHexCell(region, rng));
    } else {
      regions.push(region);
    }
  }
  return regions;
}

// --- Pattern: "hex-cluster" (7 cells — 1 center + 6 ring) ---
function hexCluster(rng: SeededRandom): Region[] {
  const cells = generateHexGrid(3, 3);
  // Pick the center cell (q=1, r=1 in a 3×3 grid)
  const centerQ = 1, centerR = 1;
  // Filter to only the center + its 6 neighbors (the "flower" cluster)
  const cluster = cells.filter(c =>
    hexDistance(c.q, c.r, centerQ, centerR) <= 1
  );
  return hexCellsToRegions(cluster, (q, r) =>
    (q === centerQ && r === centerR) ? 'hero' : 'panel',
    rng,
  );
}

// --- Pattern: "hex-grid" (12–19 cells, medium) ---
function hexGrid(rng: SeededRandom): Region[] {
  const cols = rng.pick([3, 4]);
  const rows = rng.pick([4, 5]);
  const cells = generateHexGrid(cols, rows);
  // Center cell is hero; ring-1 are panels; rest are widgets
  const cq = Math.floor(cols / 2);
  const cr = Math.floor(rows / 2);
  return hexCellsToRegions(cells, (q, r) => {
    const d = hexDistance(q, r, cq, cr);
    if (d === 0) return 'hero';
    if (d === 1) return 'panel';
    return 'widget';
  }, rng);
}

// --- Pattern: "hex-wall" (20–30 cells, dense) ---
function hexWall(rng: SeededRandom): Region[] {
  const cols = rng.pick([5, 6]);
  const rows = rng.pick([4, 5]);
  const cells = generateHexGrid(cols, rows);
  // Two hero cells near center; ring-1 panels; rest widgets
  const cq = Math.floor(cols / 2);
  const cr = Math.floor(rows / 2);
  return hexCellsToRegions(cells, (q, r) => {
    const d = hexDistance(q, r, cq, cr);
    if (d === 0) return 'hero';
    if (d === 1) return 'panel';
    return 'widget';
  }, rng);
}

// --- Pattern M: "ops-center" (symmetric mission control) ---
function opsCenter(rng: SeededRandom): Region[] {
  const topH = 0.08;        // thin status strip
  const botY = 0.92;        // bottom instrument strip
  const sideW = 0.18;       // symmetric side panels
  // Widget subdivisions get subtle jitter
  const tw1 = jitter(0.25, rng, 0.01);
  const tw2 = 0.50;
  const tw3 = jitter(0.75, rng, 0.01);
  const bw1 = jitter(0.25, rng, 0.01);
  const bw2 = 0.50;
  const bw3 = jitter(0.75, rng, 0.01);

  return [
    // Top status strip: 4 widgets
    createTieredRegion('widget-0', 'widget', 0, 0, tw1, topH),
    createTieredRegion('widget-1', 'widget', tw1, 0, tw2 - tw1, topH),
    createTieredRegion('widget-2', 'widget', tw2, 0, tw3 - tw2, topH),
    createTieredRegion('widget-3', 'widget', tw3, 0, 1 - tw3, topH),
    // Main area: symmetric side panels + hero
    createTieredRegion('panel-0', 'panel', 0, topH, sideW, botY - topH),
    createTieredRegion('hero-0', 'hero', sideW, topH, 1 - 2 * sideW, botY - topH),
    createTieredRegion('panel-1', 'panel', 1 - sideW, topH, sideW, botY - topH),
    // Bottom instrument strip: 4 widgets
    createTieredRegion('widget-4', 'widget', 0, botY, bw1, 1 - botY),
    createTieredRegion('widget-5', 'widget', bw1, botY, bw2 - bw1, 1 - botY),
    createTieredRegion('widget-6', 'widget', bw2, botY, bw3 - bw2, 1 - botY),
    createTieredRegion('widget-7', 'widget', bw3, botY, 1 - bw3, 1 - botY),
  ];
}

// --- Pattern N: "bridge" (ship bridge) ---
function bridge(rng: SeededRandom): Region[] {
  const heroH = 0.40;       // wide hero across top
  const gridH = 0.22;       // each panel row
  const botH = 0.08;        // bottom widget strip (fills remaining ~0.18 → 0.08 strip)
  const gridMidX = 0.50;    // exact center split
  const gridMidY = heroH + gridH;
  const botY = heroH + 2 * gridH;
  // Bottom widget subdivisions with subtle jitter
  const bw1 = jitter(0.20, rng, 0.01);
  const bw2 = jitter(0.40, rng, 0.01);
  const bw3 = 0.60;
  const bw4 = jitter(0.80, rng, 0.01);

  return [
    // Top hero
    createTieredRegion('hero-0', 'hero', 0, 0, 1, heroH),
    // 2×2 panel grid
    createTieredRegion('panel-0', 'panel', 0, heroH, gridMidX, gridH),
    createTieredRegion('panel-1', 'panel', gridMidX, heroH, 1 - gridMidX, gridH),
    createTieredRegion('panel-2', 'panel', 0, gridMidY, gridMidX, gridH),
    createTieredRegion('panel-3', 'panel', gridMidX, gridMidY, 1 - gridMidX, gridH),
    // Bottom widget strip: 5 widgets
    createTieredRegion('widget-0', 'widget', 0, botY, bw1, 1 - botY),
    createTieredRegion('widget-1', 'widget', bw1, botY, bw2 - bw1, 1 - botY),
    createTieredRegion('widget-2', 'widget', bw2, botY, bw3 - bw2, 1 - botY),
    createTieredRegion('widget-3', 'widget', bw3, botY, bw4 - bw3, 1 - botY),
    createTieredRegion('widget-4', 'widget', bw4, botY, 1 - bw4, 1 - botY),
  ];
}

// --- Pattern O: "split-ops" (dual-screen operator) ---
function splitOps(rng: SeededRandom): Region[] {
  const sideW = 0.10;       // narrow widget columns
  const heroSplitX = 0.50;  // exact center
  const heroH = 0.60;       // hero row height
  // Widget column subdivisions with subtle jitter
  const lw1 = jitter(0.50, rng, 0.01) * heroH;
  const rw1 = jitter(0.50, rng, 0.01) * heroH;

  return [
    // Left widget column (2 stacked)
    createTieredRegion('widget-0', 'widget', 0, 0, sideW, lw1),
    createTieredRegion('widget-1', 'widget', 0, lw1, sideW, heroH - lw1),
    // Two heroes side by side
    createTieredRegion('hero-0', 'hero', sideW, 0, heroSplitX - sideW, heroH),
    createTieredRegion('hero-1', 'hero', heroSplitX, 0, 1 - sideW - heroSplitX, heroH),
    // Right widget column (2 stacked)
    createTieredRegion('widget-2', 'widget', 1 - sideW, 0, sideW, rw1),
    createTieredRegion('widget-3', 'widget', 1 - sideW, rw1, sideW, heroH - rw1),
    // Bottom panel strip
    createTieredRegion('panel-0', 'panel', sideW, heroH, heroSplitX - sideW, 1 - heroH),
    createTieredRegion('panel-1', 'panel', heroSplitX, heroH, 1 - sideW - heroSplitX, 1 - heroH),
    // Bottom corner widgets
    createTieredRegion('widget-4', 'widget', 0, heroH, sideW, 1 - heroH),
  ];
}

// --- Pattern P: "quad-hero" (4 equal heroes in a 2×2 grid) ---
function quadHero(rng: SeededRandom): Region[] {
  const mx = jitter(0.50, rng, 0.02, 0.42, 0.58);
  const my = jitter(0.50, rng, 0.02, 0.42, 0.58);
  return [
    createTieredRegion('hero-0', 'hero', 0, 0, mx, my),
    createTieredRegion('hero-1', 'hero', mx, 0, 1 - mx, my),
    createTieredRegion('hero-2', 'hero', 0, my, mx, 1 - my),
    createTieredRegion('hero-3', 'hero', mx, my, 1 - mx, 1 - my),
  ];
}

// --- Pattern Q: "letterbox" (wide cinematic hero with thin strips) ---
function letterbox(rng: SeededRandom): Region[] {
  const topH = jitter(0.12, rng, 0.02, 0.08, 0.16);
  const botH = jitter(0.14, rng, 0.02, 0.10, 0.18);
  const botY = 1 - botH;
  // Top strip widgets
  const tw1 = jitter(0.20, rng, 0.015);
  const tw2 = jitter(0.40, rng, 0.015);
  const tw3 = jitter(0.60, rng, 0.015);
  const tw4 = jitter(0.80, rng, 0.015);
  // Bottom strip widgets
  const bw1 = jitter(0.16, rng, 0.015);
  const bw2 = jitter(0.33, rng, 0.015);
  const bw3 = jitter(0.50, rng, 0.015);
  const bw4 = jitter(0.67, rng, 0.015);
  const bw5 = jitter(0.84, rng, 0.015);

  return [
    // Top instrument strip
    createTieredRegion('widget-0', 'widget', 0, 0, tw1, topH),
    createTieredRegion('widget-1', 'widget', tw1, 0, tw2 - tw1, topH),
    createTieredRegion('widget-2', 'widget', tw2, 0, tw3 - tw2, topH),
    createTieredRegion('widget-3', 'widget', tw3, 0, tw4 - tw3, topH),
    createTieredRegion('widget-4', 'widget', tw4, 0, 1 - tw4, topH),
    // Wide hero
    createTieredRegion('hero-0', 'hero', 0, topH, 1, botY - topH),
    // Bottom instrument strip
    createTieredRegion('widget-5', 'widget', 0, botY, bw1, botH),
    createTieredRegion('widget-6', 'widget', bw1, botY, bw2 - bw1, botH),
    createTieredRegion('widget-7', 'widget', bw2, botY, bw3 - bw2, botH),
    createTieredRegion('widget-8', 'widget', bw3, botY, bw4 - bw3, botH),
    createTieredRegion('widget-9', 'widget', bw4, botY, bw5 - bw4, botH),
    createTieredRegion('widget-10', 'widget', bw5, botY, 1 - bw5, botH),
  ];
}

// --- Pattern R: "tall-spine" (vertical hero spine with flanking panels) ---
function tallSpine(rng: SeededRandom): Region[] {
  const spineW = jitter(0.30, rng, 0.02, 0.24, 0.36);
  const spineX = jitter(0.35, rng, 0.02, 0.30, 0.40);
  const rightX = spineX + spineW;
  // Left column splits
  const lSplit1 = jitter(0.33, rng, 0.02, 0.25, 0.42);
  const lSplit2 = jitter(0.66, rng, 0.02, 0.58, 0.75);
  // Right column splits
  const rSplit1 = jitter(0.25, rng, 0.02, 0.18, 0.32);
  const rSplit2 = jitter(0.50, rng, 0.02, 0.42, 0.58);
  const rSplit3 = jitter(0.75, rng, 0.02, 0.68, 0.82);

  return [
    // Left column: 3 panels
    createTieredRegion('panel-0', 'panel', 0, 0, spineX, lSplit1),
    createTieredRegion('panel-1', 'panel', 0, lSplit1, spineX, lSplit2 - lSplit1),
    createTieredRegion('panel-2', 'panel', 0, lSplit2, spineX, 1 - lSplit2),
    // Center spine: hero
    createTieredRegion('hero-0', 'hero', spineX, 0, spineW, 1),
    // Right column: 4 widgets
    createTieredRegion('widget-0', 'widget', rightX, 0, 1 - rightX, rSplit1),
    createTieredRegion('widget-1', 'widget', rightX, rSplit1, 1 - rightX, rSplit2 - rSplit1),
    createTieredRegion('widget-2', 'widget', rightX, rSplit2, 1 - rightX, rSplit3 - rSplit2),
    createTieredRegion('widget-3', 'widget', rightX, rSplit3, 1 - rightX, 1 - rSplit3),
  ];
}

// --- Pattern S: "golden-ratio" (Fibonacci spiral-inspired nested rectangles) ---
function goldenRatio(rng: SeededRandom): Region[] {
  // Golden ratio ≈ 0.618
  const phi = 0.618;
  const p1 = jitter(phi, rng, 0.02, 0.56, 0.68);        // main split
  const p2 = jitter(1 - phi, rng, 0.02, 0.32, 0.44);     // secondary

  return [
    // Large hero (golden rectangle)
    createTieredRegion('hero-0', 'hero', 0, 0, p1, 1),
    // Right column: stacked subdivisions
    createTieredRegion('panel-0', 'panel', p1, 0, 1 - p1, p2),
    createTieredRegion('panel-1', 'panel', p1, p2, (1 - p1) * p1, 1 - p2),
    createTieredRegion('widget-0', 'widget', p1 + (1 - p1) * p1, p2, (1 - p1) * (1 - p1), (1 - p2) * p1),
    createTieredRegion('widget-1', 'widget', p1 + (1 - p1) * p1, p2 + (1 - p2) * p1, (1 - p1) * (1 - p1), (1 - p2) * (1 - p1)),
  ];
}

// --- Pattern T: "film-strip" (horizontal ribbon of equal panels) ---
function filmStrip(rng: SeededRandom): Region[] {
  const topH = jitter(0.10, rng, 0.015, 0.06, 0.14);
  const botH = jitter(0.10, rng, 0.015, 0.06, 0.14);
  const botY = 1 - botH;
  const midH = botY - topH;
  const cols = rng.pick([4, 5, 6]);
  const colW = 1 / cols;

  const regions: Region[] = [];
  // Top strip: 2 wide widgets
  const tSplit = jitter(0.50, rng, 0.015);
  regions.push(createTieredRegion('widget-t0', 'widget', 0, 0, tSplit, topH));
  regions.push(createTieredRegion('widget-t1', 'widget', tSplit, 0, 1 - tSplit, topH));

  // Middle: equal panels
  for (let c = 0; c < cols; c++) {
    const tier = c === Math.floor(cols / 2) ? 'hero' as const : 'panel' as const;
    regions.push(createTieredRegion(`panel-${c}`, tier, c * colW, topH, colW, midH));
  }

  // Bottom strip: 2 wide widgets
  const bSplit = jitter(0.50, rng, 0.015);
  regions.push(createTieredRegion('widget-b0', 'widget', 0, botY, bSplit, botH));
  regions.push(createTieredRegion('widget-b1', 'widget', bSplit, botY, 1 - bSplit, botH));

  return regions;
}

// --- Pattern U: "cross" (+ shaped hero with corner panels) ---
function crossLayout(rng: SeededRandom): Region[] {
  const armW = jitter(0.30, rng, 0.02, 0.24, 0.36);
  const armH = jitter(0.30, rng, 0.02, 0.24, 0.36);
  const cx = (1 - armW) / 2;
  const cy = (1 - armH) / 2;

  return [
    // Four corner panels
    createTieredRegion('panel-0', 'panel', 0, 0, cx, cy),
    createTieredRegion('panel-1', 'panel', cx + armW, 0, 1 - cx - armW, cy),
    createTieredRegion('panel-2', 'panel', 0, cy + armH, cx, 1 - cy - armH),
    createTieredRegion('panel-3', 'panel', cx + armW, cy + armH, 1 - cx - armW, 1 - cy - armH),
    // Cross arms (hero pieces)
    createTieredRegion('hero-0', 'hero', cx, 0, armW, 1),           // vertical arm
    createTieredRegion('hero-1', 'hero', 0, cy, cx, armH),          // left arm
    createTieredRegion('hero-2', 'hero', cx + armW, cy, 1 - cx - armW, armH), // right arm
  ];
}

// --- Pattern V: "staircase" (diagonal stepping layout) ---
function staircase(rng: SeededRandom): Region[] {
  const steps = rng.pick([3, 4]);
  const stepW = 1 / steps;
  const stepH = 1 / steps;
  const regions: Region[] = [];

  for (let i = 0; i < steps; i++) {
    const x = i * stepW;
    const y = i * stepH;
    // Each step has a panel portion and widget strip
    const tier = i === 0 ? 'hero' as const : 'panel' as const;
    // Main block
    regions.push(createTieredRegion(`step-${i}`, tier, x, y, stepW, 1 - y));
    // Top sliver widget (above the step, filling the gap)
    if (i > 0) {
      regions.push(createTieredRegion(`widget-${i}`, 'widget', x, 0, stepW, y));
    }
  }

  return regions;
}

// --- Pattern W: "mosaic" (irregular tile grid with varied sizes) ---
function mosaic(rng: SeededRandom): Region[] {
  // 4 columns, varied heights per column
  const c1 = jitter(0.25, rng, 0.02, 0.20, 0.30);
  const c2 = jitter(0.50, rng, 0.02, 0.45, 0.55);
  const c3 = jitter(0.75, rng, 0.02, 0.70, 0.80);

  // Each column has 2-3 splits
  const r1a = jitter(0.45, rng, 0.03, 0.35, 0.55);
  const r2a = jitter(0.35, rng, 0.03, 0.25, 0.45);
  const r2b = jitter(0.70, rng, 0.03, 0.60, 0.80);
  const r3a = jitter(0.55, rng, 0.03, 0.45, 0.65);
  const r4a = jitter(0.40, rng, 0.03, 0.30, 0.50);
  const r4b = jitter(0.75, rng, 0.03, 0.65, 0.85);

  return [
    // Column 1: 2 tiles
    createTieredRegion('panel-0', 'panel', 0, 0, c1, r1a),
    createTieredRegion('hero-0', 'hero', 0, r1a, c1, 1 - r1a),
    // Column 2: 3 tiles
    createTieredRegion('widget-0', 'widget', c1, 0, c2 - c1, r2a),
    createTieredRegion('panel-1', 'panel', c1, r2a, c2 - c1, r2b - r2a),
    createTieredRegion('widget-1', 'widget', c1, r2b, c2 - c1, 1 - r2b),
    // Column 3: 2 tiles
    createTieredRegion('hero-1', 'hero', c2, 0, c3 - c2, r3a),
    createTieredRegion('panel-2', 'panel', c2, r3a, c3 - c2, 1 - r3a),
    // Column 4: 3 tiles
    createTieredRegion('widget-2', 'widget', c3, 0, 1 - c3, r4a),
    createTieredRegion('panel-3', 'panel', c3, r4a, 1 - c3, r4b - r4a),
    createTieredRegion('widget-3', 'widget', c3, r4b, 1 - c3, 1 - r4b),
  ];
}

// --- Pattern X: "l-shaped" (L-shaped hero with widgets filling the corner) ---
function lShaped(rng: SeededRandom): Region[] {
  const heroW = jitter(0.62, rng, 0.02, 0.55, 0.70);
  const heroH = jitter(0.60, rng, 0.02, 0.52, 0.68);
  const cornerW = 1 - heroW;
  const cornerH = 1 - heroH;
  // Split the corner area
  const cSplitY = jitter(0.50, rng, 0.02, 0.35, 0.65) * cornerH;
  // Split the bottom strip
  const bSplit = jitter(0.50, rng, 0.02, 0.35, 0.65) * heroW;

  return [
    // L-shaped hero (top-left block)
    createTieredRegion('hero-0', 'hero', 0, 0, heroW, heroH),
    // Corner: 2 panels stacked
    createTieredRegion('panel-0', 'panel', heroW, 0, cornerW, heroH * 0.5),
    createTieredRegion('panel-1', 'panel', heroW, heroH * 0.5, cornerW, heroH * 0.5),
    // Bottom strip: 2 widgets + 1 panel
    createTieredRegion('widget-0', 'widget', 0, heroH, bSplit, cornerH),
    createTieredRegion('widget-1', 'widget', bSplit, heroH, heroW - bSplit, cornerH),
    createTieredRegion('panel-2', 'panel', heroW, heroH, cornerW, cornerH),
  ];
}

// --- Pattern Y: "ticker-board" (many small equal widgets like an airport departures board) ---
function tickerBoard(rng: SeededRandom): Region[] {
  const headerH = jitter(0.12, rng, 0.015, 0.08, 0.16);
  const footerH = jitter(0.08, rng, 0.015, 0.05, 0.12);
  const footerY = 1 - footerH;
  const gridH = footerY - headerH;
  const cols = rng.pick([3, 4, 5]);
  const rows = rng.pick([3, 4]);
  const cellW = 1 / cols;
  const cellH = gridH / rows;

  const regions: Region[] = [];
  // Header: hero
  regions.push(createTieredRegion('hero-0', 'hero', 0, 0, 1, headerH));
  // Grid of widgets
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      regions.push(createTieredRegion(
        `cell-${r}-${c}`, 'widget',
        c * cellW, headerH + r * cellH, cellW, cellH,
      ));
    }
  }
  // Footer: 2 panel strips
  const fSplit = jitter(0.50, rng, 0.02);
  regions.push(createTieredRegion('panel-0', 'panel', 0, footerY, fSplit, footerH));
  regions.push(createTieredRegion('panel-1', 'panel', fSplit, footerY, 1 - fSplit, footerH));

  return regions;
}

// --- Pattern Z: "diamond" (rotated square hero with triangular corner widgets) ---
function diamond(rng: SeededRandom): Region[] {
  const inset = jitter(0.28, rng, 0.02, 0.22, 0.34);
  const cx = 0.50;
  const cy = 0.50;

  return [
    // Central hero diamond (approximated as rectangle)
    createTieredRegion('hero-0', 'hero', inset, inset, 1 - 2 * inset, 1 - 2 * inset),
    // Top triangle zone → 2 widgets
    createTieredRegion('widget-0', 'widget', 0, 0, cx, inset),
    createTieredRegion('widget-1', 'widget', cx, 0, 1 - cx, inset),
    // Bottom triangle zone → 2 widgets
    createTieredRegion('widget-2', 'widget', 0, 1 - inset, cx, inset),
    createTieredRegion('widget-3', 'widget', cx, 1 - inset, 1 - cx, inset),
    // Left triangle → panel
    createTieredRegion('panel-0', 'panel', 0, inset, inset, 1 - 2 * inset),
    // Right triangle → panel
    createTieredRegion('panel-1', 'panel', 1 - inset, inset, inset, 1 - 2 * inset),
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
  'culture-plate':      { name: 'culture-plate',       generate: culturePlate },
  'ops-center':         { name: 'ops-center',          generate: opsCenter },
  'bridge':             { name: 'bridge',              generate: bridge },
  'split-ops':          { name: 'split-ops',           generate: splitOps },
  'quad-hero':          { name: 'quad-hero',           generate: quadHero },
  'letterbox':          { name: 'letterbox',           generate: letterbox },
  'tall-spine':         { name: 'tall-spine',          generate: tallSpine },
  'golden-ratio':       { name: 'golden-ratio',        generate: goldenRatio },
  'film-strip':         { name: 'film-strip',          generate: filmStrip },
  'cross':              { name: 'cross',               generate: crossLayout },
  'staircase':          { name: 'staircase',           generate: staircase },
  'mosaic':             { name: 'mosaic',              generate: mosaic },
  'l-shaped':           { name: 'l-shaped',            generate: lShaped },
  'ticker-board':       { name: 'ticker-board',        generate: tickerBoard },
  'diamond':            { name: 'diamond',             generate: diamond },
  'hex-cluster':        { name: 'hex-cluster',         generate: hexCluster },
  'hex-grid':           { name: 'hex-grid',            generate: hexGrid },
  'hex-wall':           { name: 'hex-wall',            generate: hexWall },
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
