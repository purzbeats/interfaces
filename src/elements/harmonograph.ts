import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Harmonograph — simulated pendulum drawing that traces damped Lissajous
 * curves. Two perpendicular pendulums with different frequencies and
 * phase offsets create intricate spirograph-like patterns that slowly
 * decay. Resets with new parameters when the pattern fades out.
 * Pure geometry (Line), loads instantly, always moving.
 */
export class HarmonographElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'harmonograph',
    meta: { shape: 'radial', roles: ['decorative'], moods: ['ambient', 'diagnostic'], bandAffinity: 'mid', sizes: ['needs-medium', 'needs-large'] },
  };
  private line!: THREE.Line;
  private lineMat!: THREE.LineBasicMaterial;
  private fadeLine!: THREE.Line;
  private fadeMat!: THREE.LineBasicMaterial;
  private frameLine!: THREE.LineSegments;
  private frameMat!: THREE.LineBasicMaterial;

  private maxPoints: number = 4000;
  private positions!: Float32Array;
  private head: number = 0;
  private traceTime: number = 0;

  // Pendulum parameters (randomized per cycle)
  private freqX: number = 0;
  private freqY: number = 0;
  private phaseX: number = 0;
  private phaseY: number = 0;
  private dampX: number = 0;
  private dampY: number = 0;
  private ampX: number = 0;
  private ampY: number = 0;

  // Third rotary pendulum for extra complexity
  private freqR: number = 0;
  private phaseR: number = 0;
  private dampR: number = 0;
  private ampR: number = 0;

  private cx: number = 0;
  private cy: number = 0;

  // Cycle management
  private cycleAge: number = 0;
  private cycleDuration: number = 8;
  private fadeOutStart: number = 0;
  private dampRange: [number, number] = [0.02, 0.06];
  private dampRRange: [number, number] = [0.01, 0.03];
  private ampRScale: [number, number] = [0.05, 0.2];
  private freqRRange: [number, number] = [0.3, 1.2];
  private baseFreqRange: [number, number] = [1.5, 3.0];

  build(): void {
    const variant = this.rng.int(0, 3);
    const presetList = [
      { maxPoints: 4000, cycleDuration: 8, dampRange: [0.02, 0.06] as [number, number], dampRRange: [0.01, 0.03] as [number, number], ampRScale: [0.05, 0.2] as [number, number], freqRRange: [0.3, 1.2] as [number, number], baseFreqRange: [1.5, 3.0] as [number, number] },
      { maxPoints: 8000, cycleDuration: 6, dampRange: [0.01, 0.03] as [number, number], dampRRange: [0.005, 0.015] as [number, number], ampRScale: [0.1, 0.3] as [number, number], freqRRange: [0.8, 2.5] as [number, number], baseFreqRange: [2.5, 5.0] as [number, number] },
      { maxPoints: 2000, cycleDuration: 12, dampRange: [0.05, 0.1] as [number, number], dampRRange: [0.03, 0.06] as [number, number], ampRScale: [0.02, 0.08] as [number, number], freqRRange: [0.1, 0.5] as [number, number], baseFreqRange: [1.0, 2.0] as [number, number] },
      { maxPoints: 6000, cycleDuration: 10, dampRange: [0.005, 0.02] as [number, number], dampRRange: [0.003, 0.01] as [number, number], ampRScale: [0.15, 0.35] as [number, number], freqRRange: [1.5, 4.0] as [number, number], baseFreqRange: [3.0, 6.0] as [number, number] },
    ];
    const pr = presetList[variant];
    this.maxPoints = pr.maxPoints;
    this.cycleDuration = pr.cycleDuration;
    this.dampRange = pr.dampRange;
    this.dampRRange = pr.dampRRange;
    this.ampRScale = pr.ampRScale;
    this.freqRRange = pr.freqRRange;
    this.baseFreqRange = pr.baseFreqRange;

    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;

    this.cx = x + w / 2;
    this.cy = y + h / 2;
    const radius = Math.min(w, h) * 0.42;
    this.fadeOutStart = this.cycleDuration - 2;

    // Randomize pendulum params
    this.randomizeParams(radius);

    // Main trace line
    this.positions = new Float32Array(this.maxPoints * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geo.setDrawRange(0, 0);

    this.lineMat = new THREE.LineBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
    });
    this.line = new THREE.Line(geo, this.lineMat);
    this.group.add(this.line);

    // Faded trail copy (older part of the trace rendered dimmer)
    const fadeGeo = new THREE.BufferGeometry();
    fadeGeo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    fadeGeo.setDrawRange(0, 0);
    this.fadeMat = new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    });
    this.fadeLine = new THREE.Line(fadeGeo, this.fadeMat);
    this.group.add(this.fadeLine);

    // Corner frame
    const frameVerts = new Float32Array(48);
    const cornerLen = Math.min(w, h) * 0.08;
    const lx = x + 2, rx = x + w - 2, ty = y + 2, by = y + h - 2;

    // Top-left
    frameVerts[0] = lx; frameVerts[1] = ty + cornerLen; frameVerts[2] = 1;
    frameVerts[3] = lx; frameVerts[4] = ty; frameVerts[5] = 1;
    frameVerts[6] = lx; frameVerts[7] = ty; frameVerts[8] = 1;
    frameVerts[9] = lx + cornerLen; frameVerts[10] = ty; frameVerts[11] = 1;
    // Top-right
    frameVerts[12] = rx - cornerLen; frameVerts[13] = ty; frameVerts[14] = 1;
    frameVerts[15] = rx; frameVerts[16] = ty; frameVerts[17] = 1;
    frameVerts[18] = rx; frameVerts[19] = ty; frameVerts[20] = 1;
    frameVerts[21] = rx; frameVerts[22] = ty + cornerLen; frameVerts[23] = 1;
    // Bottom-right
    frameVerts[24] = rx; frameVerts[25] = by - cornerLen; frameVerts[26] = 1;
    frameVerts[27] = rx; frameVerts[28] = by; frameVerts[29] = 1;
    frameVerts[30] = rx; frameVerts[31] = by; frameVerts[32] = 1;
    frameVerts[33] = rx - cornerLen; frameVerts[34] = by; frameVerts[35] = 1;
    // Bottom-left
    frameVerts[36] = lx + cornerLen; frameVerts[37] = by; frameVerts[38] = 1;
    frameVerts[39] = lx; frameVerts[40] = by; frameVerts[41] = 1;
    frameVerts[42] = lx; frameVerts[43] = by; frameVerts[44] = 1;
    frameVerts[45] = lx; frameVerts[46] = by - cornerLen; frameVerts[47] = 1;

    const fGeo = new THREE.BufferGeometry();
    fGeo.setAttribute('position', new THREE.BufferAttribute(frameVerts, 3));
    this.frameMat = new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    });
    this.frameLine = new THREE.LineSegments(fGeo, this.frameMat);
    this.group.add(this.frameLine);
  }

  private randomizeParams(radius: number): void {
    // Frequency ratios that produce interesting patterns
    const ratios = [
      [2, 3], [3, 4], [3, 5], [4, 5], [5, 6], [5, 7],
      [7, 8], [2, 5], [3, 7], [4, 7], [5, 8], [6, 7],
    ];
    const [a, b] = this.rng.pick(ratios);
    const baseFreq = this.rng.float(this.baseFreqRange[0], this.baseFreqRange[1]);

    this.freqX = baseFreq * a;
    this.freqY = baseFreq * b;
    this.phaseX = this.rng.float(0, Math.PI * 2);
    this.phaseY = this.rng.float(0, Math.PI * 2);
    this.dampX = this.rng.float(this.dampRange[0], this.dampRange[1]);
    this.dampY = this.rng.float(this.dampRange[0], this.dampRange[1]);
    this.ampX = radius * this.rng.float(0.7, 1.0);
    this.ampY = radius * this.rng.float(0.7, 1.0);

    // Third rotary pendulum adds wobble
    this.freqR = this.rng.float(this.freqRRange[0], this.freqRRange[1]);
    this.phaseR = this.rng.float(0, Math.PI * 2);
    this.dampR = this.rng.float(this.dampRRange[0], this.dampRRange[1]);
    this.ampR = radius * this.rng.float(this.ampRScale[0], this.ampRScale[1]);

    // Reset trace state
    this.head = 0;
    this.traceTime = 0;
    this.cycleAge = 0;
  }

  private sample(t: number): [number, number] {
    const ex = Math.exp(-this.dampX * t);
    const ey = Math.exp(-this.dampY * t);
    const er = Math.exp(-this.dampR * t);

    const px = this.ampX * ex * Math.sin(this.freqX * t + this.phaseX)
             + this.ampR * er * Math.sin(this.freqR * t + this.phaseR);
    const py = this.ampY * ey * Math.sin(this.freqY * t + this.phaseY)
             + this.ampR * er * Math.cos(this.freqR * t + this.phaseR);

    return [this.cx + px, this.cy + py];
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);
    this.cycleAge += dt;

    // Reset cycle when done
    if (this.cycleAge >= this.cycleDuration) {
      const radius = Math.min(this.px.w, this.px.h) * 0.42;
      this.randomizeParams(radius);
      // Clear buffer
      this.positions.fill(0);
      const geo = this.line.geometry;
      geo.setDrawRange(0, 0);
      (geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    }

    // Add new points (several per frame for smooth curves)
    const pointsPerFrame = 12;
    const timeStep = 0.04;

    for (let i = 0; i < pointsPerFrame; i++) {
      this.traceTime += timeStep;
      const [px, py] = this.sample(this.traceTime);

      const idx = this.head * 3;
      this.positions[idx] = px;
      this.positions[idx + 1] = py;
      this.positions[idx + 2] = 1;

      this.head++;
      if (this.head >= this.maxPoints) {
        this.head = this.maxPoints - 1;
        break;
      }
    }

    // Fade out near end of cycle
    let cycleFade = 1;
    if (this.cycleAge > this.fadeOutStart) {
      cycleFade = 1 - (this.cycleAge - this.fadeOutStart) / (this.cycleDuration - this.fadeOutStart);
    }

    // Update draw range — recent portion is bright, older is dim
    const drawCount = this.head;
    const recentStart = Math.max(0, drawCount - 800);

    const geo = this.line.geometry;
    geo.setDrawRange(recentStart, drawCount - recentStart);
    (geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    this.lineMat.opacity = opacity * 0.8 * cycleFade;

    // Fade trail: older portion
    if (recentStart > 0) {
      const fadeGeo = this.fadeLine.geometry;
      fadeGeo.setDrawRange(0, recentStart);
      (fadeGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      this.fadeMat.opacity = opacity * 0.25 * cycleFade;
    }

    this.frameMat.opacity = opacity * 0.3;
  }

  onAction(action: string): void {
    super.onAction(action);

    if (action === 'alert') {
      // Restart with new pattern immediately
      const radius = Math.min(this.px.w, this.px.h) * 0.42;
      this.randomizeParams(radius);
      this.positions.fill(0);
      this.line.geometry.setDrawRange(0, 0);
      this.pulseTimer = 1.5;
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) return;
    // Phase nudge proportional to level
    this.phaseX += level * 0.1;
    this.phaseY += level * 0.1;
    if (level >= 3) {
      this.ampX *= 1 + level * 0.05;
      this.ampY *= 1 + level * 0.05;
    }
    if (level >= 5) {
      // Full parameter reset
      const radius = Math.min(this.px.w, this.px.h) * 0.42;
      this.randomizeParams(radius);
      this.positions.fill(0);
      this.line.geometry.setDrawRange(0, 0);
    }
  }

  dispose(): void {
    super.dispose();
  }
}
