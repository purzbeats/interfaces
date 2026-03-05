import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

interface Streak {
  baseY: number;
  startX: number;
  length: number;
  amplitude: number;
  frequency: number;
  phase: number;
  speed: number;
  segments: number;
}

/**
 * Wind-driven streak patterns on sand or snow.
 * Parallel lines with varying density and slight curvature, animated drift.
 */
export class WindStreakElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'wind-streak',
    meta: {
      shape: 'rectangular',
      roles: ['decorative'],
      moods: ['ambient'],
      bandAffinity: 'sub',
      sizes: ['works-small', 'needs-medium'],
    } satisfies ElementMeta,
  };

  private lineMesh!: THREE.LineSegments;
  private streaks: Streak[] = [];
  private maxVertices: number = 0;
  private driftOffset: number = 0;
  private driftSpeed: number = 0;
  private windAngle: number = 0;

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;
    const variant = this.rng.int(0, 3);

    const presets = [
      { count: 12, segPer: 20, ampRange: [1, 3],  freqRange: [0.02, 0.04], drift: 15, angle: 0 },
      { count: 24, segPer: 14, ampRange: [0.5, 1.5], freqRange: [0.04, 0.08], drift: 25, angle: 0.1 },
      { count: 8,  segPer: 30, ampRange: [3, 6],  freqRange: [0.01, 0.02], drift: 8,  angle: -0.05 },
      { count: 18, segPer: 16, ampRange: [1, 4],  freqRange: [0.03, 0.06], drift: 40, angle: 0.15 },
    ];
    const p = presets[variant];

    this.driftSpeed = p.drift;
    this.windAngle = p.angle;

    const streakCount = p.count + this.rng.int(-2, 2);
    this.streaks = [];

    for (let i = 0; i < streakCount; i++) {
      const baseY = y + (h * (i + 0.5)) / streakCount + this.rng.float(-h * 0.02, h * 0.02);
      const length = w * this.rng.float(0.4, 0.95);
      const startX = x + this.rng.float(0, w - length);
      this.streaks.push({
        baseY,
        startX,
        length,
        amplitude: this.rng.float(p.ampRange[0], p.ampRange[1]),
        frequency: this.rng.float(p.freqRange[0], p.freqRange[1]),
        phase: this.rng.float(0, Math.PI * 2),
        speed: this.rng.float(0.8, 1.2),
        segments: p.segPer + this.rng.int(-2, 2),
      });
    }

    // Each streak has (segments) line-segments => segments * 2 vertices
    this.maxVertices = this.streaks.reduce((sum, s) => sum + s.segments * 2, 0);
    const positions = new Float32Array(this.maxVertices * 3);
    const colors = new Float32Array(this.maxVertices * 3);

    // Fill with zeros initially
    for (let i = 0; i < this.maxVertices * 3; i++) {
      positions[i] = 0;
      colors[i] = 0;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    this.lineMesh = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.lineMesh);
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    this.driftOffset += this.driftSpeed * dt;

    const posAttr = this.lineMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const colAttr = this.lineMesh.geometry.getAttribute('color') as THREE.BufferAttribute;
    const pos = posAttr.array as Float32Array;
    const col = colAttr.array as Float32Array;

    const { x, w } = this.px;
    const pr = this.palette.primary;
    const dm = this.palette.dim;
    let vi = 0;

    for (const streak of this.streaks) {
      const segLen = streak.length / streak.segments;
      const drift = this.driftOffset * streak.speed;

      for (let s = 0; s < streak.segments; s++) {
        const t0 = s / streak.segments;
        const t1 = (s + 1) / streak.segments;

        const x0 = streak.startX + streak.length * t0 + drift;
        const x1 = streak.startX + streak.length * t1 + drift;

        // Wrap horizontally
        const wx0 = x + ((x0 - x) % w + w) % w;
        const wx1 = x + ((x1 - x) % w + w) % w;

        const yOff0 = Math.sin(streak.phase + x0 * streak.frequency + time * 0.5) * streak.amplitude;
        const yOff1 = Math.sin(streak.phase + x1 * streak.frequency + time * 0.5) * streak.amplitude;

        const windY0 = (wx0 - x) * Math.sin(this.windAngle);
        const windY1 = (wx1 - x) * Math.sin(this.windAngle);

        pos[vi * 3] = wx0;
        pos[vi * 3 + 1] = streak.baseY + yOff0 + windY0;
        pos[vi * 3 + 2] = 0;

        pos[(vi + 1) * 3] = wx1;
        pos[(vi + 1) * 3 + 1] = streak.baseY + yOff1 + windY1;
        pos[(vi + 1) * 3 + 2] = 0;

        // Fade at edges
        const edgeFade0 = Math.min(t0 * 4, (1 - t0) * 4, 1);
        const edgeFade1 = Math.min(t1 * 4, (1 - t1) * 4, 1);

        col[vi * 3] = pr.r * edgeFade0 + dm.r * (1 - edgeFade0);
        col[vi * 3 + 1] = pr.g * edgeFade0 + dm.g * (1 - edgeFade0);
        col[vi * 3 + 2] = pr.b * edgeFade0 + dm.b * (1 - edgeFade0);

        col[(vi + 1) * 3] = pr.r * edgeFade1 + dm.r * (1 - edgeFade1);
        col[(vi + 1) * 3 + 1] = pr.g * edgeFade1 + dm.g * (1 - edgeFade1);
        col[(vi + 1) * 3 + 2] = pr.b * edgeFade1 + dm.b * (1 - edgeFade1);

        vi += 2;
      }
    }

    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
    (this.lineMesh.material as THREE.LineBasicMaterial).opacity = opacity;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Sudden gust: randomize phases
      for (const streak of this.streaks) {
        streak.phase += this.rng.float(-2, 2);
        streak.amplitude *= this.rng.float(1.5, 3.0);
      }
      // Decay amplitude back over time handled naturally
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) {
      this.driftSpeed = 15;
      return;
    }
    this.driftSpeed = 15 + level * 12;
    for (const streak of this.streaks) {
      streak.amplitude = this.rng.float(1, 3) * (1 + level * 0.3);
    }
  }
}
