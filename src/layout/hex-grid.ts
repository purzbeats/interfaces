import * as THREE from 'three';

export interface HexCell {
  q: number;          // axial column
  r: number;          // axial row
  size: number;       // hex circumradius in aspect-corrected units (× screenHeight → pixels)
  cx: number;         // hex center x in normalized [0,1] coords
  cy: number;         // hex center y in normalized [0,1] coords
}

const SQRT3 = Math.sqrt(3);

/** Screen aspect ratio — set by the compositor before pattern generation. */
let _aspect = 16 / 9;
export function setHexAspect(a: number): void { _aspect = a; }

// ---------------------------------------------------------------------------
// Coordinate helpers
// ---------------------------------------------------------------------------

/** Convert axial hex (q, r) to center position in aspect-corrected space. */
function hexToAC(q: number, r: number, size: number): { x: number; y: number } {
  return {
    x: size * 1.5 * q,
    y: size * SQRT3 * (r + q / 2),
  };
}

/** Convert a HexCell's center + size to pixel-space values. */
export function hexCellToPixel(
  cell: HexCell, screenWidth: number, screenHeight: number
): { cx: number; cy: number; size: number } {
  return {
    cx: cell.cx * screenWidth,
    cy: cell.cy * screenHeight,
    size: cell.size * screenHeight,
  };
}

// ---------------------------------------------------------------------------
// Corner geometry
// ---------------------------------------------------------------------------

/** 6 corner points of a flat-top hex in pixel space. */
export function hexCornersPixel(
  cell: HexCell, screenWidth: number, screenHeight: number
): THREE.Vector3[] {
  const { cx, cy, size } = hexCellToPixel(cell, screenWidth, screenHeight);
  return Array.from({ length: 6 }, (_, i) => {
    const angle = (Math.PI / 3) * i;
    return new THREE.Vector3(
      cx + size * Math.cos(angle),
      cy + size * Math.sin(angle),
      0,
    );
  });
}

// ---------------------------------------------------------------------------
// Inscribed rectangle
// ---------------------------------------------------------------------------

/**
 * Full hex bounding box as an element Region.
 * Returns bounds in normalized [0,1] coords.
 *
 * Elements render into this rectangle; hex clipping planes trim content
 * to the actual hex shape. We use a slight *overshoot* (default 1.04)
 * so element content fills right up to the clipping edge with no gap —
 * the corners that extend past the hex are clipped away.
 */
export function hexInscribedRect(
  cell: HexCell,
  scale: number = 1.04,
): { x: number; y: number; w: number; h: number } {
  // Full hex bounding box in aspect-corrected units:
  //   width  = 2 × circumradius
  //   height = √3 × circumradius  (distance between flat top/bottom edges)
  const wAC = 2 * cell.size * scale;
  const hAC = SQRT3 * cell.size * scale;
  // Convert to normalized [0,1] coords
  const wNorm = wAC / _aspect;
  const hNorm = hAC;
  return {
    x: cell.cx - wNorm / 2,
    y: cell.cy - hNorm / 2,
    w: wNorm,
    h: hNorm,
  };
}

// ---------------------------------------------------------------------------
// Hex grid queries
// ---------------------------------------------------------------------------

/** 6 neighboring axial coordinates. */
export function hexNeighbors(q: number, r: number): { q: number; r: number }[] {
  return [
    { q: q + 1, r },     { q: q - 1, r },
    { q, r: r + 1 },     { q, r: r - 1 },
    { q: q + 1, r: r - 1 }, { q: q - 1, r: r + 1 },
  ];
}

/** Manhattan distance in hex/axial space. */
export function hexDistance(q1: number, r1: number, q2: number, r2: number): number {
  const dq = q1 - q2;
  const dr = r1 - r2;
  return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr));
}

// ---------------------------------------------------------------------------
// Grid generation
// ---------------------------------------------------------------------------

/**
 * Generate a hex grid that fills the [0,1]×[0,1] normalized viewport.
 * Hexes are regular in pixel space (uses the current _aspect).
 */
export function generateHexGrid(cols: number, rows: number): HexCell[] {
  // Compute hex size in aspect-corrected space [0, _aspect] × [0, 1]
  const sizeFromW = _aspect / (1.5 * (cols - 1) + 2);
  const sizeFromH = 1.0 / (SQRT3 * (rows - 1) + SQRT3 + (cols > 1 ? SQRT3 / 2 : 0));
  const size = Math.max(sizeFromW, sizeFromH);

  // Generate cell centers in aspect-corrected space
  const raw: { q: number; r: number; ax: number; ay: number }[] = [];
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

  for (let q = 0; q < cols; q++) {
    for (let r = 0; r < rows; r++) {
      const { x, y } = hexToAC(q, r, size);
      raw.push({ q, r, ax: x, ay: y });
      // Track bounds including hex extent
      minX = Math.min(minX, x - size);
      maxX = Math.max(maxX, x + size);
      minY = Math.min(minY, y - size * SQRT3 / 2);
      maxY = Math.max(maxY, y + size * SQRT3 / 2);
    }
  }

  // Center the grid in [0, _aspect] × [0, 1]
  const gridW = maxX - minX;
  const gridH = maxY - minY;
  const offX = (_aspect - gridW) / 2 - minX;
  const offY = (1.0 - gridH) / 2 - minY;

  return raw.map(c => ({
    q: c.q,
    r: c.r,
    size,
    cx: (c.ax + offX) / _aspect,   // normalize x → [0,1]
    cy: c.ay + offY,                // y already in [0,1]
  }));
}

// ---------------------------------------------------------------------------
// Hex geometry helpers
// ---------------------------------------------------------------------------

/**
 * Generate points along a regular flat-top hexagon at arbitrary center/radius
 * in pixel space. Used by radial elements to draw concentric hexagons.
 */
export function hexagonPoints(
  cx: number, cy: number, radius: number, pointsPerEdge: number = 1
): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i < 6; i++) {
    const a1 = (Math.PI / 3) * i;
    const a2 = (Math.PI / 3) * ((i + 1) % 6);
    const x1 = cx + radius * Math.cos(a1), y1 = cy + radius * Math.sin(a1);
    const x2 = cx + radius * Math.cos(a2), y2 = cy + radius * Math.sin(a2);
    for (let p = 0; p < pointsPerEdge; p++) {
      const t = p / pointsPerEdge;
      pts.push({ x: x1 + (x2 - x1) * t, y: y1 + (y2 - y1) * t });
    }
  }
  return pts;
}

/**
 * Map normalized position t ∈ [0,1) to a point along a hex perimeter (6 edges).
 * Used by border-chase and corner-pip for hex perimeter traversal.
 */
export function hexPerimeterPoint(
  corners: THREE.Vector3[], t: number
): { px: number; py: number } {
  t = ((t % 1) + 1) % 1;
  const edgeIndex = Math.floor(t * 6);
  const edgeFrac = (t * 6) - edgeIndex;
  const p1 = corners[edgeIndex % 6];
  const p2 = corners[(edgeIndex + 1) % 6];
  return {
    px: p1.x + (p2.x - p1.x) * edgeFrac,
    py: p1.y + (p2.y - p1.y) * edgeFrac,
  };
}

// ---------------------------------------------------------------------------
// Clipping planes
// ---------------------------------------------------------------------------

/**
 * Compute 6 THREE.Plane clipping planes for a hex cell.
 * Normals point inward so fragments inside the hex are kept.
 */
export function hexClippingPlanes(
  cell: HexCell,
  screenWidth: number,
  screenHeight: number,
): THREE.Plane[] {
  const corners = hexCornersPixel(cell, screenWidth, screenHeight);
  const planes: THREE.Plane[] = [];

  for (let i = 0; i < 6; i++) {
    const p1 = corners[i];
    const p2 = corners[(i + 1) % 6];

    // Edge direction
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;

    // Inward normal: for CCW-ordered vertices, left-perpendicular points inward
    const nx = -dy;
    const ny = dx;
    const len = Math.sqrt(nx * nx + ny * ny);
    const normal = new THREE.Vector3(nx / len, ny / len, 0);

    const plane = new THREE.Plane();
    plane.setFromNormalAndCoplanarPoint(normal, p1);
    planes.push(plane);
  }

  return planes;
}
