import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Pipe network — connected horizontal and vertical conduit segments forming
 * a schematic network. Small circles mark junctions. Animated flow dots
 * travel through the pipes in sequence.
 */
export class PipeNetworkElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'pipe-network',
    meta: {
      shape: 'rectangular',
      roles: ['structural', 'data-display'],
      moods: ['tactical', 'diagnostic'],
      bandAffinity: 'mid',
      sizes: ['works-small', 'needs-medium'],
    },
  };

  private pipeLines!: THREE.LineSegments;
  private junctionDots!: THREE.Points;
  private flowDots!: THREE.Points;

  /** Each pipe segment: [x1, y1, x2, y2] */
  private segments: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];

  /** Each flow dot: which segment it's on + t progress [0..1] */
  private flowPositions: Float32Array = new Float32Array(0);
  private flowSegments: Int32Array = new Int32Array(0);
  private flowSpeeds: Float32Array = new Float32Array(0);
  private flowCount: number = 0;

  private speedMultiplier: number = 1;
  private alertTimer: number = 0;

  build(): void {
    const variant = this.rng.int(0, 3);
    const { x, y, w, h } = this.px;

    const presets = [
      { name: 'L-shape', flowCount: 6, dotSpeed: 0.25, dotSize: 2.5 },
      { name: 'T-junction', flowCount: 10, dotSpeed: 0.3, dotSize: 2.0 },
      { name: 'full-grid', flowCount: 18, dotSpeed: 0.2, dotSize: 1.8 },
      { name: 'random-maze', flowCount: 14, dotSpeed: 0.28, dotSize: 2.2 },
    ];
    const p = presets[variant];

    const segs = this.segments;
    const margin = Math.min(w, h) * 0.08;
    const x0 = x + margin;
    const y0 = y + margin;
    const x1 = x + w - margin;
    const y1 = y + h - margin;

    if (variant === 0) {
      // Simple L-shape: one horizontal, one vertical, corner junction
      const mx = x0 + (x1 - x0) * 0.35;
      const my = y0 + (y1 - y0) * 0.55;
      segs.push({ x1: x0, y1: my, x2: mx, y2: my });
      segs.push({ x1: mx, y1: my, x2: mx, y2: y0 });
      // Secondary branch
      const mx2 = x0 + (x1 - x0) * 0.7;
      segs.push({ x1: mx, y1: my, x2: mx2, y2: my });
      segs.push({ x1: mx2, y1: my, x2: mx2, y2: y1 });
      segs.push({ x1: mx2, y1: y1, x2: x1, y2: y1 });
    } else if (variant === 1) {
      // T-junction: central horizontal with branches
      const midY = y0 + (y1 - y0) * 0.5;
      segs.push({ x1: x0, y1: midY, x2: x1, y2: midY });           // main horizontal
      segs.push({ x1: x0 + (x1 - x0) * 0.3, y1: y0, x2: x0 + (x1 - x0) * 0.3, y2: midY }); // left branch up
      segs.push({ x1: x0 + (x1 - x0) * 0.6, y1: midY, x2: x0 + (x1 - x0) * 0.6, y2: y1 }); // right branch down
      segs.push({ x1: x0 + (x1 - x0) * 0.3, y1: y0, x2: x0 + (x1 - x0) * 0.6, y2: y0 }); // top connector
      segs.push({ x1: x0, y1: midY, x2: x0, y2: y1 });             // left vertical
      segs.push({ x1: x0, y1: y1, x2: x0 + (x1 - x0) * 0.6, y2: y1 }); // bottom
    } else if (variant === 2) {
      // Full grid: 3x3 grid of pipes
      const cols = 3;
      const rows = 3;
      const cw = (x1 - x0) / cols;
      const ch = (y1 - y0) / rows;
      for (let c = 0; c <= cols; c++) {
        segs.push({ x1: x0 + c * cw, y1: y0, x2: x0 + c * cw, y2: y1 });
      }
      for (let r = 0; r <= rows; r++) {
        segs.push({ x1: x0, y1: y0 + r * ch, x2: x1, y2: y0 + r * ch });
      }
    } else {
      // Random maze: generate a plausible branching tree
      const nodes: Array<{ x: number; y: number }> = [
        { x: x0 + (x1 - x0) * 0.5, y: y0 + (y1 - y0) * 0.5 }, // center
      ];
      const gridW = (x1 - x0) / 3;
      const gridH = (y1 - y0) / 3;
      const gridNodes = [
        { x: x0, y: y0 }, { x: x0 + gridW, y: y0 }, { x: x0 + 2 * gridW, y: y0 }, { x: x1, y: y0 },
        { x: x0, y: y0 + gridH }, { x: x0 + gridW, y: y0 + gridH }, { x: x0 + 2 * gridW, y: y0 + gridH }, { x: x1, y: y0 + gridH },
        { x: x0, y: y0 + 2 * gridH }, { x: x0 + gridW, y: y0 + 2 * gridH }, { x: x0 + 2 * gridW, y: y0 + 2 * gridH }, { x: x1, y: y0 + 2 * gridH },
        { x: x0, y: y1 }, { x: x0 + gridW, y: y1 }, { x: x0 + 2 * gridW, y: y1 }, { x: x1, y: y1 },
      ];
      const picked = new Set<number>();
      // Always include a spanning set of random segments (axis-aligned only)
      const addSegment = (a: { x: number; y: number }, b: { x: number; y: number }) => {
        // Force axis-alignment: either go horizontal then vertical or vice versa
        segs.push({ x1: a.x, y1: a.y, x2: b.x, y2: a.y }); // horizontal
        segs.push({ x1: b.x, y1: a.y, x2: b.x, y2: b.y }); // vertical
      };
      for (let i = 0; i < 6; i++) {
        const ai = this.rng.int(0, gridNodes.length - 1);
        const bi = this.rng.int(0, gridNodes.length - 1);
        if (ai !== bi) {
          addSegment(gridNodes[ai], gridNodes[bi]);
          picked.add(ai);
          picked.add(bi);
        }
      }
      // Extra horizontal/vertical lines for density
      segs.push({ x1: x0, y1: y0 + (y1 - y0) * 0.33, x2: x1, y2: y0 + (y1 - y0) * 0.33 });
      segs.push({ x1: x0 + (x1 - x0) * 0.5, y1: y0, x2: x0 + (x1 - x0) * 0.5, y2: y1 });
    }

    // --- Pipe line geometry ---
    const lineVerts: number[] = [];
    for (const s of segs) {
      lineVerts.push(s.x1, s.y1, 0, s.x2, s.y2, 0);
    }
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(lineVerts, 3));
    this.pipeLines = new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.pipeLines);

    // --- Junction dots: endpoints + intersections ---
    const junctionSet = new Map<string, { x: number; y: number }>();
    const addJunction = (nx: number, ny: number) => {
      const key = `${nx.toFixed(1)},${ny.toFixed(1)}`;
      if (!junctionSet.has(key)) junctionSet.set(key, { x: nx, y: ny });
    };
    for (const s of segs) {
      addJunction(s.x1, s.y1);
      addJunction(s.x2, s.y2);
    }
    const jVerts = new Float32Array(junctionSet.size * 3);
    let ji = 0;
    for (const j of junctionSet.values()) {
      jVerts[ji++] = j.x; jVerts[ji++] = j.y; jVerts[ji++] = 0.5;
    }
    const jGeo = new THREE.BufferGeometry();
    jGeo.setAttribute('position', new THREE.BufferAttribute(jVerts, 3));
    this.junctionDots = new THREE.Points(jGeo, new THREE.PointsMaterial({
      color: this.palette.secondary,
      transparent: true,
      opacity: 0,
      size: 4,
      sizeAttenuation: false,
    }));
    this.group.add(this.junctionDots);

    // --- Flow dots ---
    this.flowCount = Math.min(p.flowCount, segs.length * 3);
    const maxFlow = this.flowCount + 8; // headroom for alert
    this.flowPositions = new Float32Array(maxFlow);
    this.flowSegments = new Int32Array(maxFlow);
    this.flowSpeeds = new Float32Array(maxFlow);

    for (let i = 0; i < maxFlow; i++) {
      this.flowSegments[i] = this.rng.int(0, segs.length - 1);
      this.flowPositions[i] = this.rng.float(0, 1);
      this.flowSpeeds[i] = p.dotSpeed * this.rng.float(0.6, 1.4);
    }

    const flowVerts = new Float32Array(maxFlow * 3);
    const flowGeo = new THREE.BufferGeometry();
    flowGeo.setAttribute('position', new THREE.BufferAttribute(flowVerts, 3));
    flowGeo.setDrawRange(0, this.flowCount);
    this.flowDots = new THREE.Points(flowGeo, new THREE.PointsMaterial({
      color: this.palette.bg,
      transparent: true,
      opacity: 0,
      size: p.dotSize,
      sizeAttenuation: false,
    }));
    this.group.add(this.flowDots);
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);

    if (this.alertTimer > 0) {
      this.alertTimer -= dt;
      this.speedMultiplier = 3.5;
      if (this.alertTimer <= 0) this.speedMultiplier = 1;
    }

    // Advance flow dots along segments
    const pos = this.flowDots.geometry.getAttribute('position') as THREE.BufferAttribute;
    const segs = this.segments;

    for (let i = 0; i < this.flowCount; i++) {
      this.flowPositions[i] += dt * this.flowSpeeds[i] * this.speedMultiplier;
      if (this.flowPositions[i] > 1) {
        this.flowPositions[i] = 0;
        // Jump to a connected segment (start or end matches current end)
        const cur = segs[this.flowSegments[i]];
        let next = this.rng.int(0, segs.length - 1);
        // Try to find a connected segment
        for (let attempt = 0; attempt < 5; attempt++) {
          const candidate = segs[next];
          const d = (ax: number, ay: number, bx: number, by: number) =>
            Math.abs(ax - bx) < 1 && Math.abs(ay - by) < 1;
          if (d(cur.x2, cur.y2, candidate.x1, candidate.y1) ||
              d(cur.x2, cur.y2, candidate.x2, candidate.y2)) break;
          next = this.rng.int(0, segs.length - 1);
        }
        this.flowSegments[i] = next;
      }

      const seg = segs[this.flowSegments[i]];
      const t = this.flowPositions[i];
      const fx = seg.x1 + (seg.x2 - seg.x1) * t;
      const fy = seg.y1 + (seg.y2 - seg.y1) * t;
      pos.setXYZ(i, fx, fy, 1);
    }
    pos.needsUpdate = true;

    // Pulsing glow for flow dots
    const flowBrightness = 0.8 + Math.sin(time * 4) * 0.2;
    (this.pipeLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.55;
    (this.junctionDots.material as THREE.PointsMaterial).opacity = opacity * 0.9;
    (this.flowDots.material as THREE.PointsMaterial).opacity = opacity * flowBrightness;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'activate') {
      // Reset all flow dots
      for (let i = 0; i < this.flowCount; i++) {
        this.flowPositions[i] = this.rng.float(0, 1);
      }
    }
    if (action === 'alert') {
      this.alertTimer = 2.0;
      this.pulseTimer = 1.5;
      (this.pipeLines.material as THREE.LineBasicMaterial).color.copy(this.palette.alert);
      (this.flowDots.material as THREE.PointsMaterial).color.copy(this.palette.alert);
    }
    if (action === 'pulse') {
      this.speedMultiplier = 2.5;
      setTimeout(() => { this.speedMultiplier = 1; }, 400);
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) {
      this.speedMultiplier = 1;
      return;
    }
    if (level >= 4) {
      this.speedMultiplier = 2 + level * 0.4;
    } else if (level >= 2) {
      this.speedMultiplier = 1.5;
    }
  }
}
