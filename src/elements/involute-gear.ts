import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Involute of a circle — the curve traced by unwinding a taut string
 * from a circle. Shows the base circle, the unwinding string, and the
 * involute curve. Animates the unwinding process. The involute profile
 * is the basis for gear tooth shapes. Line geometry.
 */
export class InvoluteGearElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'involute-gear',
    meta: {
      shape: 'radial',
      roles: ['decorative', 'gauge'],
      moods: ['tactical', 'diagnostic'],
      bandAffinity: 'bass',
      sizes: ['needs-medium', 'needs-large'],
    },
  };

  private circleLine!: THREE.Line;
  private circleMat!: THREE.LineBasicMaterial;
  private involuteLine!: THREE.Line;
  private involuteMat!: THREE.LineBasicMaterial;
  private stringLine!: THREE.Line;
  private stringMat!: THREE.LineBasicMaterial;
  private teethLine!: THREE.LineSegments;
  private teethMat!: THREE.LineBasicMaterial;

  private cx = 0;
  private cy = 0;
  private baseRadius = 0;
  private circleSegments = 64;
  private involutePoints = 0;
  private involutePositions!: Float32Array;
  private stringPositions!: Float32Array;
  private teethPositions!: Float32Array;

  private maxTurns = 0;
  private animSpeed = 0;
  private numTeeth = 0;
  private toothDepth = 0;

  build(): void {
    this.glitchAmount = 4;
    const variant = this.rng.int(0, 3);
    const { x, y, w, h } = this.px;

    this.cx = x + w / 2;
    this.cy = y + h / 2;

    const presets = [
      { points: 300, turns: 2.5, speed: 0.4,  teeth: 12, depth: 0.35 },
      { points: 400, turns: 3.0, speed: 0.3,  teeth: 18, depth: 0.25 },
      { points: 200, turns: 2.0, speed: 0.6,  teeth: 8,  depth: 0.45 },
      { points: 350, turns: 3.5, speed: 0.25, teeth: 24, depth: 0.20 },
    ];
    const p = presets[variant];

    this.involutePoints = p.points;
    this.maxTurns = p.turns;
    this.animSpeed = p.speed;
    this.numTeeth = p.teeth;
    this.toothDepth = p.depth;

    // Size base radius so max involute extent fits within region
    // Involute distance from center ≈ r * t, max t = maxTurns * 2π
    const maxT = this.maxTurns * Math.PI * 2;
    this.baseRadius = Math.min(w, h) * 0.45 / maxT;

    // Base circle
    const circlePositions = new Float32Array((this.circleSegments + 1) * 3);
    for (let i = 0; i <= this.circleSegments; i++) {
      const a = (i / this.circleSegments) * Math.PI * 2;
      circlePositions[i * 3] = this.cx + Math.cos(a) * this.baseRadius;
      circlePositions[i * 3 + 1] = this.cy + Math.sin(a) * this.baseRadius;
      circlePositions[i * 3 + 2] = 0;
    }
    const circleGeo = new THREE.BufferGeometry();
    circleGeo.setAttribute('position', new THREE.BufferAttribute(circlePositions, 3));
    this.circleMat = new THREE.LineBasicMaterial({
      color: this.palette.dim, transparent: true, opacity: 0,
    });
    this.circleLine = new THREE.Line(circleGeo, this.circleMat);
    this.group.add(this.circleLine);

    // Involute curve
    this.involutePositions = new Float32Array(this.involutePoints * 3);
    for (let i = 0; i < this.involutePoints * 3; i += 3) {
      this.involutePositions[i] = this.cx;
      this.involutePositions[i + 1] = this.cy;
      this.involutePositions[i + 2] = 0;
    }
    const invGeo = new THREE.BufferGeometry();
    invGeo.setAttribute('position', new THREE.BufferAttribute(this.involutePositions, 3));
    invGeo.setDrawRange(0, 0);
    this.involuteMat = new THREE.LineBasicMaterial({
      color: this.palette.primary, transparent: true, opacity: 0,
    });
    this.involuteLine = new THREE.Line(invGeo, this.involuteMat);
    this.group.add(this.involuteLine);

    // String from tangent point to involute tip
    this.stringPositions = new Float32Array(6);
    for (let i = 0; i < 6; i++) this.stringPositions[i] = this.cx;
    const stringGeo = new THREE.BufferGeometry();
    stringGeo.setAttribute('position', new THREE.BufferAttribute(this.stringPositions, 3));
    this.stringMat = new THREE.LineBasicMaterial({
      color: this.palette.secondary, transparent: true, opacity: 0,
    });
    this.stringLine = new THREE.Line(stringGeo, this.stringMat);
    this.group.add(this.stringLine);

    // Gear teeth outlines
    const teethVerts = this.numTeeth * 2 * 2 * 3; // numTeeth * 2 lines * 2 points * 3 coords
    this.teethPositions = new Float32Array(teethVerts);
    for (let i = 0; i < teethVerts; i += 3) {
      this.teethPositions[i] = this.cx;
      this.teethPositions[i + 1] = this.cy;
      this.teethPositions[i + 2] = 0;
    }
    const teethGeo = new THREE.BufferGeometry();
    teethGeo.setAttribute('position', new THREE.BufferAttribute(this.teethPositions, 3));
    this.teethMat = new THREE.LineBasicMaterial({
      color: this.palette.secondary, transparent: true, opacity: 0,
    });
    this.teethLine = new THREE.LineSegments(teethGeo, this.teethMat);
    this.group.add(this.teethLine);
  }

  /** Involute of a circle: parametric form */
  private involute(t: number): [number, number] {
    const r = this.baseRadius;
    const ix = r * (Math.cos(t) + t * Math.sin(t));
    const iy = r * (Math.sin(t) - t * Math.cos(t));
    return [this.cx + ix, this.cy + iy];
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);

    // Animate how much of the involute is drawn (cyclic unwinding)
    const cycle = (time * this.animSpeed) % (this.maxTurns * 2);
    const drawTurns = cycle <= this.maxTurns ? cycle : this.maxTurns * 2 - cycle;
    const thetaMax = drawTurns * Math.PI * 2;

    // Update involute positions
    const drawCount = Math.max(2, (drawTurns / this.maxTurns * this.involutePoints) | 0);
    for (let i = 0; i < drawCount; i++) {
      const t = (i / (drawCount - 1)) * thetaMax;
      const [ix, iy] = this.involute(t);
      this.involutePositions[i * 3] = ix;
      this.involutePositions[i * 3 + 1] = iy;
      this.involutePositions[i * 3 + 2] = 0;
    }
    this.involuteLine.geometry.setDrawRange(0, drawCount);
    (this.involuteLine.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    this.involuteMat.opacity = opacity * 0.8;

    // Update string: from tangent point on circle to involute tip
    const tipT = thetaMax;
    const tangentX = this.cx + this.baseRadius * Math.cos(tipT);
    const tangentY = this.cy + this.baseRadius * Math.sin(tipT);
    const [tipX, tipY] = this.involute(tipT);
    this.stringPositions[0] = tangentX;
    this.stringPositions[1] = tangentY;
    this.stringPositions[2] = 0;
    this.stringPositions[3] = tipX;
    this.stringPositions[4] = tipY;
    this.stringPositions[5] = 0;
    (this.stringLine.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    this.stringMat.opacity = opacity * 0.5;

    // Update gear teeth: simple trapezoidal profiles on base circle
    const gearRotation = time * this.animSpeed * 0.3;
    for (let i = 0; i < this.numTeeth; i++) {
      const angle = (i / this.numTeeth) * Math.PI * 2 + gearRotation;
      const halfTooth = (Math.PI / this.numTeeth) * 0.4;
      const outerR = this.baseRadius * (1 + this.toothDepth);

      // Two lines per tooth: left edge and right edge
      const idx = i * 12; // 2 lines * 2 points * 3 coords
      // Left edge: base to tip
      this.teethPositions[idx]     = this.cx + Math.cos(angle - halfTooth) * this.baseRadius;
      this.teethPositions[idx + 1] = this.cy + Math.sin(angle - halfTooth) * this.baseRadius;
      this.teethPositions[idx + 2] = 0;
      this.teethPositions[idx + 3] = this.cx + Math.cos(angle - halfTooth * 0.6) * outerR;
      this.teethPositions[idx + 4] = this.cy + Math.sin(angle - halfTooth * 0.6) * outerR;
      this.teethPositions[idx + 5] = 0;
      // Right edge: tip to base
      this.teethPositions[idx + 6] = this.cx + Math.cos(angle + halfTooth * 0.6) * outerR;
      this.teethPositions[idx + 7] = this.cy + Math.sin(angle + halfTooth * 0.6) * outerR;
      this.teethPositions[idx + 8] = 0;
      this.teethPositions[idx + 9] = this.cx + Math.cos(angle + halfTooth) * this.baseRadius;
      this.teethPositions[idx + 10] = this.cy + Math.sin(angle + halfTooth) * this.baseRadius;
      this.teethPositions[idx + 11] = 0;
    }
    (this.teethLine.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    this.teethMat.opacity = opacity * 0.4;

    this.circleMat.opacity = opacity * 0.35;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      this.animSpeed *= 3;
      setTimeout(() => { this.animSpeed /= 3; }, 500);
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) {
      this.animSpeed = 0.4;
      return;
    }
    this.animSpeed = 0.4 + level * 0.1;
    if (level >= 4) {
      this.toothDepth = 0.35 + (level - 3) * 0.1;
    }
  }
}
