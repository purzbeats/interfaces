import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Semaphore flag signal display — two arms extending from a central point,
 * rotating to different angular positions over time (like semaphore flag signaling).
 * Small square flags at the tips of each arm.
 */

// Pre-defined semaphore positions (angle pairs in radians for left and right arms)
const SEMAPHORE_POSITIONS: [number, number][] = [
  [Math.PI * 0.75, Math.PI * 1.25],   // A: down-left, down-right
  [Math.PI * 0.5, Math.PI * 1.25],    // B: left, down-right
  [Math.PI * 0.25, Math.PI * 1.25],   // C: up-left, down-right
  [0, Math.PI * 1.25],                // D: up, down-right
  [Math.PI * 0.75, Math.PI * 1.75],   // E: down-left, right
  [Math.PI * 0.75, 0],                // F: down-left, up
  [Math.PI * 0.75, Math.PI * 0.25],   // G: down-left, up-right
  [Math.PI * 0.5, Math.PI * 1.5],     // rest: left, down
  [Math.PI * 0.25, Math.PI * 1.75],   // J: up-left, right
  [0, Math.PI * 1.5],                 // K: up, down
  [Math.PI * 0.25, Math.PI * 0.5],    // attention: up-left, left
];

export class SemaphoreElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'semaphore',
    meta: {
      shape: 'radial',
      roles: ['data-display'],
      moods: ['tactical'],
      sizes: ['needs-medium'],
    },
  };

  private leftArm!: THREE.LineSegments;
  private rightArm!: THREE.LineSegments;
  private leftFlag!: THREE.Mesh;
  private rightFlag!: THREE.Mesh;
  private centerDot!: THREE.Mesh;

  private cx: number = 0;
  private cy: number = 0;
  private armLength: number = 0;
  private flagSize: number = 0;

  private currentLeftAngle: number = Math.PI * 0.5;
  private currentRightAngle: number = Math.PI * 1.5;
  private targetLeftAngle: number = Math.PI * 0.5;
  private targetRightAngle: number = Math.PI * 1.5;
  private holdTimer: number = 0;
  private holdDuration: number = 1.5;
  private positionIndex: number = 0;
  private transitioning: boolean = false;
  private transitionSpeed: number = 3.0;

  build(): void {
    const { x, y, w, h } = this.px;
    this.cx = x + w / 2;
    this.cy = y + h / 2;
    const maxR = Math.min(w, h) / 2 * 0.85;
    this.armLength = maxR * 0.75;
    this.flagSize = maxR * 0.12;

    this.holdDuration = this.rng.float(1.0, 2.0);
    this.positionIndex = this.rng.int(0, SEMAPHORE_POSITIONS.length - 1);

    const startPos = SEMAPHORE_POSITIONS[this.positionIndex];
    this.currentLeftAngle = startPos[0];
    this.currentRightAngle = startPos[1];
    this.targetLeftAngle = startPos[0];
    this.targetRightAngle = startPos[1];

    // Center dot
    const dotR = maxR * 0.06;
    const dotGeo = new THREE.CircleGeometry(dotR, 16);
    this.centerDot = new THREE.Mesh(dotGeo, new THREE.MeshBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
    }));
    this.centerDot.position.set(this.cx, this.cy, 1);
    this.group.add(this.centerDot);

    // Left arm
    const leftArmVerts = new Float32Array([0, 0, 0, 0, this.armLength, 0]);
    const leftArmGeo = new THREE.BufferGeometry();
    leftArmGeo.setAttribute('position', new THREE.BufferAttribute(leftArmVerts, 3));
    this.leftArm = new THREE.LineSegments(leftArmGeo, new THREE.LineBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
    }));
    this.leftArm.position.set(this.cx, this.cy, 0);
    this.group.add(this.leftArm);

    // Right arm
    const rightArmVerts = new Float32Array([0, 0, 0, 0, this.armLength, 0]);
    const rightArmGeo = new THREE.BufferGeometry();
    rightArmGeo.setAttribute('position', new THREE.BufferAttribute(rightArmVerts, 3));
    this.rightArm = new THREE.LineSegments(rightArmGeo, new THREE.LineBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
    }));
    this.rightArm.position.set(this.cx, this.cy, 0);
    this.group.add(this.rightArm);

    // Left flag (small square at tip)
    const flagGeo = new THREE.PlaneGeometry(this.flagSize, this.flagSize);
    this.leftFlag = new THREE.Mesh(flagGeo, new THREE.MeshBasicMaterial({
      color: this.palette.secondary,
      transparent: true,
      opacity: 0,
    }));
    this.leftFlag.position.set(this.cx, this.cy, 1);
    this.group.add(this.leftFlag);

    // Right flag
    const rightFlagGeo = new THREE.PlaneGeometry(this.flagSize, this.flagSize);
    this.rightFlag = new THREE.Mesh(rightFlagGeo, new THREE.MeshBasicMaterial({
      color: this.palette.secondary,
      transparent: true,
      opacity: 0,
    }));
    this.rightFlag.position.set(this.cx, this.cy, 1);
    this.group.add(this.rightFlag);
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);

    // Hold / transition logic
    if (!this.transitioning) {
      this.holdTimer += dt;
      if (this.holdTimer >= this.holdDuration) {
        this.holdTimer = 0;
        this.holdDuration = this.rng.float(1.0, 2.0);
        this.positionIndex = (this.positionIndex + this.rng.int(1, SEMAPHORE_POSITIONS.length - 1)) % SEMAPHORE_POSITIONS.length;
        const nextPos = SEMAPHORE_POSITIONS[this.positionIndex];
        this.targetLeftAngle = nextPos[0];
        this.targetRightAngle = nextPos[1];
        this.transitioning = true;
      }
    } else {
      // Smoothly interpolate angles toward target
      const lerpFactor = 1 - Math.exp(-this.transitionSpeed * dt);
      this.currentLeftAngle = this.lerpAngle(this.currentLeftAngle, this.targetLeftAngle, lerpFactor);
      this.currentRightAngle = this.lerpAngle(this.currentRightAngle, this.targetRightAngle, lerpFactor);

      const leftDiff = Math.abs(this.angleDiff(this.currentLeftAngle, this.targetLeftAngle));
      const rightDiff = Math.abs(this.angleDiff(this.currentRightAngle, this.targetRightAngle));
      if (leftDiff < 0.01 && rightDiff < 0.01) {
        this.currentLeftAngle = this.targetLeftAngle;
        this.currentRightAngle = this.targetRightAngle;
        this.transitioning = false;
      }
    }

    // Update arm rotations (geometry points along +Y, so rotation.z handles angle)
    this.leftArm.rotation.z = this.currentLeftAngle - Math.PI / 2;
    this.rightArm.rotation.z = this.currentRightAngle - Math.PI / 2;

    // Update flag positions
    const leftTipX = this.cx + Math.cos(this.currentLeftAngle) * this.armLength;
    const leftTipY = this.cy + Math.sin(this.currentLeftAngle) * this.armLength;
    this.leftFlag.position.set(leftTipX, leftTipY, 1);
    this.leftFlag.rotation.z = this.currentLeftAngle;

    const rightTipX = this.cx + Math.cos(this.currentRightAngle) * this.armLength;
    const rightTipY = this.cy + Math.sin(this.currentRightAngle) * this.armLength;
    this.rightFlag.position.set(rightTipX, rightTipY, 1);
    this.rightFlag.rotation.z = this.currentRightAngle;

    // Apply opacity
    (this.leftArm.material as THREE.LineBasicMaterial).opacity = opacity;
    (this.rightArm.material as THREE.LineBasicMaterial).opacity = opacity;
    (this.leftFlag.material as THREE.MeshBasicMaterial).opacity = opacity * 0.85;
    (this.rightFlag.material as THREE.MeshBasicMaterial).opacity = opacity * 0.85;
    (this.centerDot.material as THREE.MeshBasicMaterial).opacity = opacity * 0.9;
  }

  private angleDiff(from: number, to: number): number {
    let diff = to - from;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    return diff;
  }

  private lerpAngle(from: number, to: number, t: number): number {
    return from + this.angleDiff(from, to) * t;
  }
}
