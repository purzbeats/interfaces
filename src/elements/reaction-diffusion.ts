import * as THREE from 'three';
import { BaseElement } from './base-element';

/**
 * Harmonograph — simulated pendulum drawing that traces damped Lissajous
 * curves. Two perpendicular pendulums with different frequencies and
 * phase offsets create intricate spirograph-like patterns that slowly
 * decay. Resets with new parameters when the pattern fades out.
 * Pure geometry (Line), loads instantly, always moving.
 */
export class ReactionDiffusionElement extends BaseElement {
  private line!: THREE.Line;
  private lineMat!: THREE.LineBasicMaterial;
  private fadeLine!: THREE.Line;
  private fadeMat!: THREE.LineBasicMaterial;
  private frameLine!: THREE.LineSegments;
  private frameMat!: THREE.LineBasicMaterial;

  private readonly MAX_POINTS = 4000;
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
  private readonly CYCLE_DURATION = 8; // seconds before reset
  private fadeOutStart: number = 0;

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;

    this.cx = x + w / 2;
    this.cy = y + h / 2;
    const radius = Math.min(w, h) * 0.42;
    this.fadeOutStart = this.CYCLE_DURATION - 2;

    // Randomize pendulum params
    this.randomizeParams(radius);

    // Main trace line
    this.positions = new Float32Array(this.MAX_POINTS * 3);
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
    const baseFreq = this.rng.float(1.5, 3.0);

    this.freqX = baseFreq * a;
    this.freqY = baseFreq * b;
    this.phaseX = this.rng.float(0, Math.PI * 2);
    this.phaseY = this.rng.float(0, Math.PI * 2);
    this.dampX = this.rng.float(0.02, 0.06);
    this.dampY = this.rng.float(0.02, 0.06);
    this.ampX = radius * this.rng.float(0.7, 1.0);
    this.ampY = radius * this.rng.float(0.7, 1.0);

    // Third rotary pendulum adds wobble
    this.freqR = this.rng.float(0.3, 1.2);
    this.phaseR = this.rng.float(0, Math.PI * 2);
    this.dampR = this.rng.float(0.01, 0.03);
    this.ampR = radius * this.rng.float(0.05, 0.2);

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
    if (this.cycleAge >= this.CYCLE_DURATION) {
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
      if (this.head >= this.MAX_POINTS) {
        this.head = this.MAX_POINTS - 1;
        break;
      }
    }

    // Fade out near end of cycle
    let cycleFade = 1;
    if (this.cycleAge > this.fadeOutStart) {
      cycleFade = 1 - (this.cycleAge - this.fadeOutStart) / (this.CYCLE_DURATION - this.fadeOutStart);
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

  dispose(): void {
    super.dispose();
  }
}
