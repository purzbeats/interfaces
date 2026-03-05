import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Meandering river simulation. A curve that becomes more sinuous over time
 * as meanders grow. Eventually an oxbow lake forms (loop cutoff).
 */
export class RiverMeanderElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'river-meander',
    meta: {
      shape: 'rectangular',
      roles: ['decorative'],
      moods: ['ambient'],
      bandAffinity: 'sub',
      sizes: ['needs-medium', 'needs-large'],
    },
  };

  private riverLine!: THREE.Line;
  private oxbowLines: THREE.Line[] = [];
  private pointCount: number = 0;
  private offsets: number[] = [];
  private speeds: number[] = [];
  private amplitudeGrowth: number = 0;
  private baseAmplitude: number = 0;
  private maxAmplitude: number = 0;
  private oxbowThreshold: number = 0;
  private cycleTime: number = 0;
  private cycleDuration: number = 0;
  private oxbowSegments: number = 32;

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;

    const variant = this.rng.int(0, 3);
    const presets = [
      { points: 60, ampGrowth: 0.08, baseAmp: 0.05, maxAmp: 0.35, oxbow: 0.3, duration: 12 },
      { points: 100, ampGrowth: 0.12, baseAmp: 0.03, maxAmp: 0.45, oxbow: 0.25, duration: 8 },
      { points: 40, ampGrowth: 0.05, baseAmp: 0.08, maxAmp: 0.25, oxbow: 0.35, duration: 16 },
      { points: 80, ampGrowth: 0.15, baseAmp: 0.04, maxAmp: 0.5, oxbow: 0.2, duration: 6 },
    ];
    const p = presets[variant];
    this.pointCount = p.points;
    this.amplitudeGrowth = p.ampGrowth;
    this.baseAmplitude = p.baseAmp;
    this.maxAmplitude = p.maxAmp;
    this.oxbowThreshold = p.oxbow;
    this.cycleDuration = p.duration;

    // Initialize offsets and speeds for each point
    this.offsets = [];
    this.speeds = [];
    for (let i = 0; i < this.pointCount; i++) {
      this.offsets.push(this.rng.float(0, Math.PI * 2));
      this.speeds.push(this.rng.float(0.3, 1.2));
    }

    // River line
    const positions = new Float32Array(this.pointCount * 3);
    for (let i = 0; i < this.pointCount; i++) {
      positions[i * 3] = x + (i / (this.pointCount - 1)) * w;
      positions[i * 3 + 1] = y + h / 2;
      positions[i * 3 + 2] = 0;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.riverLine = new THREE.Line(geo, new THREE.LineBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.riverLine);

    // Pre-create a few oxbow lake lines
    for (let i = 0; i < 3; i++) {
      const oxPositions = new Float32Array(this.oxbowSegments * 3);
      for (let j = 0; j < this.oxbowSegments; j++) {
        oxPositions[j * 3] = x;
        oxPositions[j * 3 + 1] = y;
        oxPositions[j * 3 + 2] = 0;
      }
      const oxGeo = new THREE.BufferGeometry();
      oxGeo.setAttribute('position', new THREE.BufferAttribute(oxPositions, 3));
      oxGeo.setDrawRange(0, 0);
      const oxLine = new THREE.Line(oxGeo, new THREE.LineBasicMaterial({
        color: this.palette.dim,
        transparent: true,
        opacity: 0,
      }));
      this.group.add(oxLine);
      this.oxbowLines.push(oxLine);
    }
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    const { x, y, w, h } = this.px;

    this.cycleTime += dt;
    if (this.cycleTime > this.cycleDuration) {
      this.cycleTime -= this.cycleDuration;
      // Reset oxbow lakes
      for (const ol of this.oxbowLines) {
        ol.geometry.setDrawRange(0, 0);
      }
    }

    const cycleFrac = this.cycleTime / this.cycleDuration;
    const currentAmplitude = this.baseAmplitude + cycleFrac * this.amplitudeGrowth;
    const clampedAmp = Math.min(currentAmplitude, this.maxAmplitude);

    const posAttr = this.riverLine.geometry.getAttribute('position') as THREE.BufferAttribute;
    const cy = y + h / 2;

    // Check for oxbow (self-intersection) candidates
    let oxbowIdx = 0;
    const pts: Array<{ x: number; y: number }> = [];

    for (let i = 0; i < this.pointCount; i++) {
      const frac = i / (this.pointCount - 1);
      const px = x + frac * w;
      const wavePhase = this.offsets[i] + time * this.speeds[i] * 0.5;
      const amp = clampedAmp * h * Math.sin(frac * Math.PI); // taper at edges
      const py = cy + Math.sin(wavePhase + frac * Math.PI * 3) * amp;

      posAttr.setXYZ(i, px, py, 0);
      pts.push({ x: px, y: py });
    }

    // Detect near-intersections for oxbow lakes
    for (let i = 0; i < pts.length - 10 && oxbowIdx < this.oxbowLines.length; i++) {
      for (let j = i + 10; j < pts.length; j++) {
        const dx = pts[i].x - pts[j].x;
        const dy = pts[i].y - pts[j].y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < h * this.oxbowThreshold && cycleFrac > 0.5) {
          // Draw an ellipse at the midpoint
          const mx = (pts[i].x + pts[j].x) / 2;
          const my = (pts[i].y + pts[j].y) / 2;
          const rx = Math.abs(pts[j].x - pts[i].x) * 0.5 + 5;
          const ry = Math.abs(pts[j].y - pts[i].y) * 0.5 + 5;
          const oxAttr = this.oxbowLines[oxbowIdx].geometry.getAttribute('position') as THREE.BufferAttribute;
          for (let s = 0; s < this.oxbowSegments; s++) {
            const a = (s / (this.oxbowSegments - 1)) * Math.PI * 2;
            oxAttr.setXYZ(s, mx + Math.cos(a) * rx, my + Math.sin(a) * ry, 0);
          }
          oxAttr.needsUpdate = true;
          this.oxbowLines[oxbowIdx].geometry.setDrawRange(0, this.oxbowSegments);
          (this.oxbowLines[oxbowIdx].material as THREE.LineBasicMaterial).opacity = opacity * 0.4;
          oxbowIdx++;
          break; // one oxbow per i
        }
      }
    }

    posAttr.needsUpdate = true;
    (this.riverLine.material as THREE.LineBasicMaterial).opacity = opacity;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Randomize offsets for visual disruption
      for (let i = 0; i < this.offsets.length; i++) {
        this.offsets[i] += this.rng.float(-2, 2);
      }
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level >= 2) {
      for (let i = 0; i < this.speeds.length; i++) {
        this.speeds[i] = this.rng.float(0.5, 1.5 + level * 0.3);
      }
    }
  }
}
