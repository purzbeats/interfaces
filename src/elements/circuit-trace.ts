import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

interface Trace {
  points: { x: number; y: number }[];
  viaIndices: number[]; // which segment endpoints have via holes
}

interface SignalPulse {
  traceIndex: number;
  t: number;       // 0..1 along the trace
  speed: number;   // units/sec in t space
}

/**
 * PCB-style circuit board traces with right-angle paths, via holes at junctions,
 * and animated signal pulses travelling along the lines.
 */
export class CircuitTraceElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'circuit-trace',
    meta: {
      shape: 'rectangular',
      roles: ['decorative', 'data-display'],
      moods: ['tactical', 'diagnostic'],
      sizes: ['works-small', 'needs-medium'],
    },
  };

  private traceLines!: THREE.LineSegments;
  private viaMesh!: THREE.Points;
  private pulsePoints!: THREE.Points;
  private borderLines!: THREE.LineSegments;

  private traces: Trace[] = [];
  private pulses: SignalPulse[] = [];

  // Per-trace total lengths (sum of segment lengths) for pulse lerp
  private traceLengths: number[] = [];
  // Flat segment data for each trace: [x0,y0,x1,y1, ...]
  private traceSegments: { ax: number; ay: number; bx: number; by: number }[][] = [];

  private maxPulses: number = 16;
  private pulseSpawnRate: number = 1.2; // pulses per second
  private pulseSpawnAccum: number = 0;

  private alertMode: boolean = false;

  build(): void {
    const variant = this.rng.int(0, 3);
    const { x, y, w, h } = this.px;

    this.traces = [];
    this.traceLengths = [];
    this.traceSegments = [];

    const presets = [
      // 0: simple path — a few long L-shaped traces
      { traceCount: 4, branchDepth: 0, density: 'low', pads: false },
      // 1: branching — Y-forks with multiple arms
      { traceCount: 3, branchDepth: 2, density: 'medium', pads: false },
      // 2: dense PCB — many traces filling the area
      { traceCount: 8, branchDepth: 1, density: 'high', pads: false },
      // 3: with component pads — traces end with fat pad circles
      { traceCount: 5, branchDepth: 1, density: 'medium', pads: true },
    ];
    const preset = presets[variant];

    // Build traces
    for (let t = 0; t < preset.traceCount; t++) {
      const trace = this.buildTrace(x, y, w, h, preset.density as 'low' | 'medium' | 'high');
      this.traces.push(trace);
    }

    // Compute geometry
    const totalSegments = this.traces.reduce((s, tr) => s + Math.max(0, tr.points.length - 1), 0);
    const lineVerts = new Float32Array(totalSegments * 2 * 3);
    let li = 0;

    for (let ti = 0; ti < this.traces.length; ti++) {
      const tr = this.traces[ti];
      const segs: { ax: number; ay: number; bx: number; by: number }[] = [];
      let totalLen = 0;

      for (let pi = 0; pi < tr.points.length - 1; pi++) {
        const ax = tr.points[pi].x;
        const ay = tr.points[pi].y;
        const bx = tr.points[pi + 1].x;
        const by = tr.points[pi + 1].y;

        lineVerts[li++] = ax;
        lineVerts[li++] = ay;
        lineVerts[li++] = 0;
        lineVerts[li++] = bx;
        lineVerts[li++] = by;
        lineVerts[li++] = 0;

        const len = Math.sqrt((bx - ax) ** 2 + (by - ay) ** 2);
        totalLen += len;
        segs.push({ ax, ay, bx, by });
      }

      this.traceSegments.push(segs);
      this.traceLengths.push(totalLen);
    }

    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.BufferAttribute(lineVerts.slice(0, li), 3));
    this.traceLines = new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.traceLines);

    // Via holes — small circles approximated as Points
    const viaPositions: number[] = [];
    for (const tr of this.traces) {
      for (const vi of tr.viaIndices) {
        if (vi < tr.points.length) {
          viaPositions.push(tr.points[vi].x, tr.points[vi].y, 0.5);
        }
      }
    }
    const viaGeo = new THREE.BufferGeometry();
    viaGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(viaPositions), 3));
    this.viaMesh = new THREE.Points(viaGeo, new THREE.PointsMaterial({
      color: this.palette.secondary,
      transparent: true,
      opacity: 0,
      size: Math.max(3, Math.min(w, h) * 0.018),
      sizeAttenuation: false,
    }));
    this.group.add(this.viaMesh);

    // Pulse points (preallocated pool)
    const pulsePositions = new Float32Array(this.maxPulses * 3);
    const pulseColors = new Float32Array(this.maxPulses * 3);
    const pulseGeo = new THREE.BufferGeometry();
    pulseGeo.setAttribute('position', new THREE.BufferAttribute(pulsePositions, 3));
    pulseGeo.setAttribute('color', new THREE.BufferAttribute(pulseColors, 3));
    pulseGeo.setDrawRange(0, 0);
    this.pulsePoints = new THREE.Points(pulseGeo, new THREE.PointsMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0,
      size: Math.max(4, Math.min(w, h) * 0.028),
      sizeAttenuation: false,
    }));
    this.group.add(this.pulsePoints);

    // Border
    const bv = new Float32Array([
      x, y, 0, x + w, y, 0,
      x + w, y, 0, x + w, y + h, 0,
      x + w, y + h, 0, x, y + h, 0,
      x, y + h, 0, x, y, 0,
    ]);
    const borderGeo = new THREE.BufferGeometry();
    borderGeo.setAttribute('position', new THREE.BufferAttribute(bv, 3));
    this.borderLines = new THREE.LineSegments(borderGeo, new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.borderLines);
  }

  /** Build a single right-angle trace within the region. */
  private buildTrace(
    x: number, y: number, w: number, h: number,
    density: 'low' | 'medium' | 'high',
  ): Trace {
    const segCount = density === 'low' ? this.rng.int(2, 4)
      : density === 'medium' ? this.rng.int(3, 6)
      : this.rng.int(5, 10);

    const margin = Math.min(w, h) * 0.08;
    const points: { x: number; y: number }[] = [];
    const viaIndices: number[] = [];

    // Start at a random edge position
    let cx = x + margin + this.rng.float(0, w - margin * 2);
    let cy = y + margin + this.rng.float(0, h - margin * 2);
    points.push({ x: cx, y: cy });

    let horizontal = this.rng.chance(0.5); // alternate direction

    for (let s = 0; s < segCount; s++) {
      const maxDist = density === 'low'
        ? Math.min(w, h) * 0.35
        : density === 'medium'
        ? Math.min(w, h) * 0.25
        : Math.min(w, h) * 0.18;

      const dist = this.rng.float(maxDist * 0.3, maxDist);

      if (horizontal) {
        cx = Math.max(x + margin, Math.min(x + w - margin, cx + (this.rng.chance(0.5) ? dist : -dist)));
      } else {
        cy = Math.max(y + margin, Math.min(y + h - margin, cy + (this.rng.chance(0.5) ? dist : -dist)));
      }

      points.push({ x: cx, y: cy });

      // Mark junction vias at most corners
      if (s > 0 && this.rng.chance(0.6)) {
        viaIndices.push(points.length - 1);
      }

      horizontal = !horizontal;
    }

    return { points, viaIndices };
  }

  /** Evaluate position along a trace at normalized t [0..1]. */
  private evalTrace(traceIndex: number, t: number): { x: number; y: number } {
    const segs = this.traceSegments[traceIndex];
    const totalLen = this.traceLengths[traceIndex];
    if (segs.length === 0 || totalLen === 0) return { x: 0, y: 0 };

    const targetDist = t * totalLen;
    let accumulated = 0;

    for (const seg of segs) {
      const len = Math.sqrt((seg.bx - seg.ax) ** 2 + (seg.by - seg.ay) ** 2);
      if (accumulated + len >= targetDist) {
        const local = (targetDist - accumulated) / len;
        return {
          x: seg.ax + (seg.bx - seg.ax) * local,
          y: seg.ay + (seg.by - seg.ay) * local,
        };
      }
      accumulated += len;
    }

    const last = segs[segs.length - 1];
    return { x: last.bx, y: last.by };
  }

  private spawnPulse(): void {
    if (this.traces.length === 0) return;
    const ti = this.rng.int(0, this.traces.length - 1);
    if (this.traceSegments[ti].length === 0) return;
    this.pulses.push({
      traceIndex: ti,
      t: 0,
      speed: this.rng.float(0.4, 1.2),
    });
    if (this.pulses.length > this.maxPulses) {
      this.pulses.shift();
    }
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);

    // Spawn pulses
    const rate = this.alertMode ? this.pulseSpawnRate * 3 : this.pulseSpawnRate;
    this.pulseSpawnAccum += dt * rate;
    while (this.pulseSpawnAccum >= 1) {
      this.pulseSpawnAccum -= 1;
      this.spawnPulse();
    }

    // Advance and cull pulses
    for (let i = this.pulses.length - 1; i >= 0; i--) {
      this.pulses[i].t += this.pulses[i].speed * dt;
      if (this.pulses[i].t > 1.0) {
        this.pulses.splice(i, 1);
      }
    }

    // Update GPU buffers for pulses
    const pulsePos = this.pulsePoints.geometry.getAttribute('position') as THREE.BufferAttribute;
    const pulseCol = this.pulsePoints.geometry.getAttribute('color') as THREE.BufferAttribute;
    const pulseColor = this.alertMode ? this.palette.alert : this.palette.secondary;
    const dimColor = this.palette.dim;

    for (let i = 0; i < this.maxPulses; i++) {
      if (i < this.pulses.length) {
        const p = this.pulses[i];
        const pos = this.evalTrace(p.traceIndex, p.t);
        // Brightness peaks in middle of journey
        const brightness = Math.sin(p.t * Math.PI);
        pulsePos.setXYZ(i, pos.x, pos.y, 1);
        pulseCol.setXYZ(i,
          dimColor.r + (pulseColor.r - dimColor.r) * brightness,
          dimColor.g + (pulseColor.g - dimColor.g) * brightness,
          dimColor.b + (pulseColor.b - dimColor.b) * brightness,
        );
      } else {
        pulsePos.setXYZ(i, -99999, -99999, 0);
        pulseCol.setXYZ(i, 0, 0, 0);
      }
    }
    pulsePos.needsUpdate = true;
    pulseCol.needsUpdate = true;
    this.pulsePoints.geometry.setDrawRange(0, Math.min(this.pulses.length, this.maxPulses));

    // Opacity
    (this.traceLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.7;
    (this.viaMesh.material as THREE.PointsMaterial).opacity = opacity * 0.85;
    (this.pulsePoints.material as THREE.PointsMaterial).opacity = opacity;
    (this.borderLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.15;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Burst of pulses
      for (let i = 0; i < 6; i++) this.spawnPulse();
    }
    if (action === 'alert') {
      this.alertMode = true;
      this.pulseTimer = 2.0;
      setTimeout(() => { this.alertMode = false; }, 3000);
    }
    if (action === 'pulse') {
      this.spawnPulse();
      this.spawnPulse();
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) {
      this.alertMode = false;
      return;
    }
    // More frequent pulses at higher levels
    for (let i = 0; i < level; i++) this.spawnPulse();
    if (level >= 5) {
      this.alertMode = true;
      setTimeout(() => { this.alertMode = false; }, 1500);
    }
  }
}
