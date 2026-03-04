import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Bubble level / spirit level indicator. A horizontal tube with a sliding
 * bubble that drifts with sine-based oscillation. Tick marks at center
 * and quarter points. Bubble occasionally settles near center.
 */
export class TiltLevelElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'tilt-level',
    meta: {
      shape: 'linear',
      roles: ['gauge'],
      moods: ['diagnostic'],
      sizes: ['works-small'],
    },
  };

  private tubeLine!: THREE.LineSegments;
  private tickLines!: THREE.LineSegments;
  private bubble!: THREE.Mesh;
  private bubbleMat!: THREE.MeshBasicMaterial;
  private centerMark!: THREE.LineSegments;

  // Bubble physics
  private bubblePos: number = 0;     // -1..1 normalized position
  private bubbleTarget: number = 0;
  private driftPhase: number = 0;
  private driftSpeed: number = 0.4;
  private driftAmp: number = 0.6;
  private settleTimer: number = 0;
  private settleInterval: number = 5.0;
  private isSettling: boolean = false;

  // Layout cache
  private tubeLeft: number = 0;
  private tubeRight: number = 0;
  private tubeCenterY: number = 0;
  private tubeHalfH: number = 0;
  private bubbleRadius: number = 0;
  private variant: number = 0;

  build(): void {
    this.variant = this.rng.int(0, 3);
    const presets = [
      // 0: Standard level, moderate drift
      { driftSpd: 0.4, driftAmp: 0.55, settleInt: [4, 8] as const, bubbleSizeFrac: 0.08, tubeHFrac: 0.22 },
      // 1: Sensitive level, fast jittery drift
      { driftSpd: 0.9, driftAmp: 0.8, settleInt: [2, 4] as const, bubbleSizeFrac: 0.06, tubeHFrac: 0.18 },
      // 2: Sluggish level, slow wide drift
      { driftSpd: 0.2, driftAmp: 0.9, settleInt: [6, 12] as const, bubbleSizeFrac: 0.10, tubeHFrac: 0.28 },
      // 3: Precision level, small movements near center
      { driftSpd: 0.6, driftAmp: 0.3, settleInt: [3, 5] as const, bubbleSizeFrac: 0.07, tubeHFrac: 0.20 },
    ];
    const p = presets[this.variant];

    this.driftSpeed = p.driftSpd + this.rng.float(-0.05, 0.05);
    this.driftAmp = p.driftAmp;
    this.settleInterval = this.rng.float(p.settleInt[0], p.settleInt[1]);
    this.driftPhase = this.rng.float(0, Math.PI * 2);

    const { x, y, w, h } = this.px;
    const margin = Math.min(w * 0.08, 8);
    this.tubeLeft = x + margin;
    this.tubeRight = x + w - margin;
    this.tubeCenterY = y + h / 2;
    this.tubeHalfH = Math.max(h * p.tubeHFrac, 4);
    this.bubbleRadius = Math.max(w * p.bubbleSizeFrac, 3);

    const tl = this.tubeLeft;
    const tr = this.tubeRight;
    const cy = this.tubeCenterY;
    const hh = this.tubeHalfH;

    // --- Tube outline: top line, bottom line, left cap, right cap ---
    const tv: number[] = [
      // Top line
      tl, cy - hh, 0, tr, cy - hh, 0,
      // Bottom line
      tl, cy + hh, 0, tr, cy + hh, 0,
      // Left end cap
      tl, cy - hh, 0, tl, cy + hh, 0,
      // Right end cap
      tr, cy - hh, 0, tr, cy + hh, 0,
    ];
    const tubeGeo = new THREE.BufferGeometry();
    tubeGeo.setAttribute('position', new THREE.Float32BufferAttribute(tv, 3));
    this.tubeLine = new THREE.LineSegments(tubeGeo, new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.tubeLine);

    // --- Tick marks: center, quarter points ---
    const tubeW = tr - tl;
    const tickPositions = [0.0, 0.25, 0.5, 0.75, 1.0];
    const tkv: number[] = [];
    for (const t of tickPositions) {
      const tx = tl + tubeW * t;
      const isMajor = t === 0.5;
      const tickH = isMajor ? hh * 0.8 : hh * 0.4;
      tkv.push(
        tx, cy - tickH, 0.5, tx, cy + tickH, 0.5,
      );
    }
    const tickGeo = new THREE.BufferGeometry();
    tickGeo.setAttribute('position', new THREE.Float32BufferAttribute(tkv, 3));
    this.tickLines = new THREE.LineSegments(tickGeo, new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.tickLines);

    // --- Center mark (brighter) ---
    const cmx = tl + tubeW * 0.5;
    const cmv: number[] = [
      cmx, cy - hh * 1.1, 0.5, cmx, cy + hh * 1.1, 0.5,
    ];
    const cmGeo = new THREE.BufferGeometry();
    cmGeo.setAttribute('position', new THREE.Float32BufferAttribute(cmv, 3));
    this.centerMark = new THREE.LineSegments(cmGeo, new THREE.LineBasicMaterial({
      color: this.palette.secondary,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.centerMark);

    // --- Bubble (small square used as dot approximation) ---
    const bubbleSize = this.bubbleRadius * 2;
    const bubbleGeo = new THREE.PlaneGeometry(bubbleSize, Math.min(bubbleSize, this.tubeHalfH * 1.4));
    this.bubbleMat = new THREE.MeshBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
    });
    this.bubble = new THREE.Mesh(bubbleGeo, this.bubbleMat);
    this.bubble.position.z = 1;
    this.group.add(this.bubble);
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);

    // Settle timer: periodically drift toward center
    this.settleTimer += dt;
    if (this.settleTimer >= this.settleInterval) {
      this.settleTimer = 0;
      this.isSettling = !this.isSettling;
      if (!this.isSettling) {
        this.settleInterval = this.rng.float(3, 8);
      } else {
        this.settleInterval = this.rng.float(1.5, 3.0);
      }
    }

    // Drift with sine oscillation
    this.driftPhase += this.driftSpeed * dt;
    const sineTarget = Math.sin(this.driftPhase) * this.driftAmp;
    const secondaryWave = Math.sin(this.driftPhase * 2.3 + 1.7) * this.driftAmp * 0.3;

    if (this.isSettling) {
      // Settle toward center with small wobble
      this.bubbleTarget = sineTarget * 0.1;
    } else {
      this.bubbleTarget = sineTarget + secondaryWave;
    }

    // Smooth movement
    this.bubblePos += (this.bubbleTarget - this.bubblePos) * dt * 3.0;
    this.bubblePos = Math.max(-1, Math.min(1, this.bubblePos));

    // Position bubble
    const tubeW = this.tubeRight - this.tubeLeft;
    const usable = tubeW - this.bubbleRadius * 2;
    const bx = this.tubeLeft + tubeW / 2 + this.bubblePos * usable / 2;
    this.bubble.position.set(bx, this.tubeCenterY, 1);

    // Color: brighter when near center
    const distFromCenter = Math.abs(this.bubblePos);
    const lerpColor = new THREE.Color();
    lerpColor.lerpColors(this.palette.primary, this.palette.secondary, 1 - distFromCenter);
    this.bubbleMat.color.copy(lerpColor);

    // Opacities
    this.bubbleMat.opacity = opacity * 0.8;
    (this.tubeLine.material as THREE.LineBasicMaterial).opacity = opacity * 0.5;
    (this.tickLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.35;
    (this.centerMark.material as THREE.LineBasicMaterial).opacity = opacity * 0.6;
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) return;
    this.driftAmp = Math.min(1.0, this.driftAmp + level * 0.1);
    this.driftSpeed += level * 0.15;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'pulse') {
      this.bubblePos += this.rng.float(-0.3, 0.3);
    }
    if (action === 'glitch') {
      this.bubblePos = this.rng.float(-0.9, 0.9);
    }
  }
}
