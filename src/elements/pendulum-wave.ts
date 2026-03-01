import * as THREE from 'three';
import { BaseElement } from './base-element';

/**
 * Multiple pendulums swinging at slightly different periods, creating
 * mesmerizing wave patterns. Classic physics demonstration rendered
 * as a retro terminal display with fading trails.
 */
export class PendulumWaveElement extends BaseElement {
  private supportBeam!: THREE.LineSegments;
  private strings!: THREE.LineSegments;
  private bobs!: THREE.Points;
  private trail!: THREE.Points;
  private equilibriumLine!: THREE.Line;
  private frameLine!: THREE.LineSegments;

  private pendulumCount: number = 0;
  private pivots: { x: number; y: number }[] = [];
  private lengths: number[] = [];
  private phases: number[] = [];
  private amplitudes: number[] = [];
  private baseAmplitude: number = 0;
  private amplitudeBoost: number = 0;

  private trailHistorySize: number = 25;
  private trailHistory: Array<{ x: number; y: number }[]> = [];
  private trailHead: number = 0;

  private tBase: number = 0;
  private increment: number = 0;
  private lengthsIncrease: boolean = true;
  private time: number = 0;

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;

    this.pendulumCount = this.rng.int(15, 25);
    this.tBase = this.rng.float(1.5, 2.5);
    this.increment = this.rng.float(0.02, 0.04);
    this.lengthsIncrease = this.rng.chance(0.5);
    this.baseAmplitude = h * 0.3;

    const beamY = y + h * 0.08;
    const beamLeft = x + w * 0.06;
    const beamRight = x + w * 0.94;
    const pendulumSpacing = (beamRight - beamLeft) / (this.pendulumCount - 1);

    // Initialize pendulums
    for (let i = 0; i < this.pendulumCount; i++) {
      const px = beamLeft + i * pendulumSpacing;
      this.pivots.push({ x: px, y: beamY });

      const n = this.lengthsIncrease ? i : (this.pendulumCount - 1 - i);
      const period = this.tBase * (1 + n * this.increment);
      this.lengths.push(period); // store period, we compute position from it

      this.phases.push(0);
      this.amplitudes.push(this.baseAmplitude);
    }

    // --- Support beam ---
    const beamVerts = new Float32Array([
      beamLeft, beamY, 1, beamRight, beamY, 1,
      // End caps
      beamLeft, beamY - 3, 1, beamLeft, beamY + 3, 1,
      beamRight, beamY - 3, 1, beamRight, beamY + 3, 1,
    ]);
    const beamGeo = new THREE.BufferGeometry();
    beamGeo.setAttribute('position', new THREE.BufferAttribute(beamVerts, 3));
    this.supportBeam = new THREE.LineSegments(beamGeo, new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.supportBeam);

    // --- Strings (line from pivot to bob for each pendulum) ---
    const stringVerts = new Float32Array(this.pendulumCount * 2 * 3);
    const stringGeo = new THREE.BufferGeometry();
    stringGeo.setAttribute('position', new THREE.BufferAttribute(stringVerts, 3));
    this.strings = new THREE.LineSegments(stringGeo, new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.strings);

    // --- Bobs (primary colored dots) ---
    const bobVerts = new Float32Array(this.pendulumCount * 3);
    const bobGeo = new THREE.BufferGeometry();
    bobGeo.setAttribute('position', new THREE.BufferAttribute(bobVerts, 3));
    this.bobs = new THREE.Points(bobGeo, new THREE.PointsMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
      size: Math.max(3, Math.min(w, h) * 0.015),
      sizeAttenuation: false,
    }));
    this.group.add(this.bobs);

    // --- Trail points (secondary color, fading) ---
    const totalTrailPoints = this.pendulumCount * this.trailHistorySize;
    const trailVerts = new Float32Array(totalTrailPoints * 3);
    const trailColors = new Float32Array(totalTrailPoints * 3);
    const trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute('position', new THREE.BufferAttribute(trailVerts, 3));
    trailGeo.setAttribute('color', new THREE.BufferAttribute(trailColors, 3));
    this.trail = new THREE.Points(trailGeo, new THREE.PointsMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0,
      size: Math.max(2, Math.min(w, h) * 0.006),
      sizeAttenuation: false,
    }));
    this.group.add(this.trail);

    // Initialize trail history
    for (let t = 0; t < this.trailHistorySize; t++) {
      const frame: { x: number; y: number }[] = [];
      for (let i = 0; i < this.pendulumCount; i++) {
        frame.push({ x: this.pivots[i].x, y: beamY + h * 0.4 });
      }
      this.trailHistory.push(frame);
    }

    // --- Equilibrium reference line ---
    const eqY = beamY + h * 0.42;
    const eqVerts = new Float32Array([ beamLeft, eqY, 0.5, beamRight, eqY, 0.5 ]);
    const eqGeo = new THREE.BufferGeometry();
    eqGeo.setAttribute('position', new THREE.BufferAttribute(eqVerts, 3));
    this.equilibriumLine = new THREE.Line(eqGeo, new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.equilibriumLine);

    // --- Outer frame ---
    const pad = 2;
    const frameVerts = new Float32Array([
      x + pad, y + pad, 0.3, x + w - pad, y + pad, 0.3,
      x + w - pad, y + pad, 0.3, x + w - pad, y + h - pad, 0.3,
      x + w - pad, y + h - pad, 0.3, x + pad, y + h - pad, 0.3,
      x + pad, y + h - pad, 0.3, x + pad, y + pad, 0.3,
    ]);
    const frameGeo = new THREE.BufferGeometry();
    frameGeo.setAttribute('position', new THREE.BufferAttribute(frameVerts, 3));
    this.frameLine = new THREE.LineSegments(frameGeo, new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.frameLine);
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    const { h } = this.px;

    this.time += dt;

    // Decay amplitude boost
    if (this.amplitudeBoost > 0) this.amplitudeBoost = Math.max(0, this.amplitudeBoost - dt * 1.5);

    const currentAmplitude = this.baseAmplitude * (1 + this.amplitudeBoost * 1.5);

    const beamY = this.pivots[0].y;
    const restY = beamY + h * 0.42;

    const stringPos = this.strings.geometry.getAttribute('position') as THREE.BufferAttribute;
    const bobPos = this.bobs.geometry.getAttribute('position') as THREE.BufferAttribute;

    // Current frame for trail
    const currentFrame: { x: number; y: number }[] = [];

    for (let i = 0; i < this.pendulumCount; i++) {
      // Period-based angular velocity: omega = 2*PI / T
      const period = this.lengths[i];
      const omega = (2 * Math.PI) / period;
      const angle = Math.sin(omega * this.time + this.phases[i]);

      // Bob swings horizontally around the pivot
      const bobX = this.pivots[i].x + angle * currentAmplitude * 0.15;
      // Bob Y uses pendulum arc: roughly restY + small vertical motion
      const verticalDrop = currentAmplitude * (1 - Math.cos(angle * 0.15));
      const bobY = restY + angle * currentAmplitude * 0.6;

      currentFrame.push({ x: bobX, y: bobY });

      // String from pivot to bob
      stringPos.setXYZ(i * 2, this.pivots[i].x, beamY, 1);
      stringPos.setXYZ(i * 2 + 1, bobX, bobY, 1);

      // Bob position
      bobPos.setXYZ(i, bobX, bobY, 2);
    }
    stringPos.needsUpdate = true;
    bobPos.needsUpdate = true;

    // Store trail frame
    this.trailHistory[this.trailHead] = currentFrame;
    this.trailHead = (this.trailHead + 1) % this.trailHistorySize;

    // Update trail points
    const trailPos = this.trail.geometry.getAttribute('position') as THREE.BufferAttribute;
    const trailCol = this.trail.geometry.getAttribute('color') as THREE.BufferAttribute;

    const sc = this.palette.secondary;
    const bg = this.palette.dim;

    for (let t = 0; t < this.trailHistorySize; t++) {
      // Age: 0 = oldest, trailHistorySize-1 = newest
      const age = (t - this.trailHead + this.trailHistorySize) % this.trailHistorySize;
      const ageFraction = age / this.trailHistorySize; // 0 = newest, ~1 = oldest
      const fadeFactor = Math.pow(1 - ageFraction, 2); // quadratic fade

      const frame = this.trailHistory[t];
      for (let i = 0; i < this.pendulumCount; i++) {
        const idx = t * this.pendulumCount + i;
        const pt = frame[i];
        trailPos.setXYZ(idx, pt.x, pt.y, 0.8);

        // Blend from secondary (newest) to dim (oldest)
        const r = bg.r + (sc.r - bg.r) * fadeFactor;
        const g = bg.g + (sc.g - bg.g) * fadeFactor;
        const b = bg.b + (sc.b - bg.b) * fadeFactor;
        trailCol.setXYZ(idx, r * fadeFactor, g * fadeFactor, b * fadeFactor);
      }
    }
    trailPos.needsUpdate = true;
    trailCol.needsUpdate = true;

    // Material opacities
    (this.supportBeam.material as THREE.LineBasicMaterial).opacity = opacity * 0.5;
    (this.strings.material as THREE.LineBasicMaterial).opacity = opacity * 0.35;
    (this.bobs.material as THREE.PointsMaterial).opacity = opacity;
    (this.trail.material as THREE.PointsMaterial).opacity = opacity * 0.7;
    (this.equilibriumLine.material as THREE.LineBasicMaterial).opacity = opacity * 0.15;
    (this.frameLine.material as THREE.LineBasicMaterial).opacity = opacity * 0.2;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Randomize all phases — destroys the wave pattern momentarily
      for (let i = 0; i < this.pendulumCount; i++) {
        this.phases[i] = this.rng.float(0, Math.PI * 2);
      }
    }
    if (action === 'alert') {
      // Dramatic amplitude increase
      this.amplitudeBoost = 2.0;
      this.pulseTimer = 2.0;
    }
    if (action === 'pulse') {
      // Momentary amplitude boost
      this.amplitudeBoost = Math.max(this.amplitudeBoost, 0.6);
    }
  }
}
