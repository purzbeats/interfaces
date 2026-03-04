import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * A swinging metronome arm with a weight at the top, base platform,
 * and tick marks at extreme positions. Speed varies per variant.
 */
export class MetronomeElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'metronome',
    meta: {
      shape: 'linear',
      roles: ['decorative', 'gauge'],
      moods: ['ambient'],
      sizes: ['works-small'],
    },
  };

  private armLine!: THREE.LineSegments;
  private weightDot!: THREE.Mesh;
  private baseLine!: THREE.LineSegments;
  private tickLines!: THREE.LineSegments;

  private pivotX: number = 0;
  private pivotY: number = 0;
  private armLength: number = 0;
  private swingAngle: number = 0;
  private speed: number = 0;
  private variant: number = 0;

  build(): void {
    const { x, y, w, h } = this.px;
    this.variant = this.rng.int(0, 3);

    const presets = [
      // Variant 0: Slow, wide swing
      { speed: 1.2, swingAngle: 0.55 },
      // Variant 1: Fast, narrow swing
      { speed: 2.8, swingAngle: 0.3 },
      // Variant 2: Medium, moderate swing
      { speed: 1.8, swingAngle: 0.42 },
      // Variant 3: Very slow, dramatic swing
      { speed: 0.7, swingAngle: 0.65 },
    ];

    const p = presets[this.variant];
    this.speed = p.speed;
    this.swingAngle = p.swingAngle;

    // Pivot at bottom center, arm extends upward
    this.pivotX = x + w / 2;
    this.pivotY = y + h * 0.85;
    this.armLength = h * 0.7;

    // Base platform line
    const baseW = w * 0.5;
    const baseVerts = [
      this.pivotX - baseW / 2, this.pivotY, 0,
      this.pivotX + baseW / 2, this.pivotY, 0,
      // Small feet
      this.pivotX - baseW / 2, this.pivotY, 0,
      this.pivotX - baseW / 2, this.pivotY + h * 0.03, 0,
      this.pivotX + baseW / 2, this.pivotY, 0,
      this.pivotX + baseW / 2, this.pivotY + h * 0.03, 0,
    ];

    const baseGeo = new THREE.BufferGeometry();
    baseGeo.setAttribute('position', new THREE.Float32BufferAttribute(baseVerts, 3));
    this.baseLine = new THREE.LineSegments(baseGeo, new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.baseLine);

    // Tick marks at extreme positions
    const tickVerts: number[] = [];
    const tickLen = h * 0.04;
    for (const sign of [-1, 1]) {
      const angle = sign * this.swingAngle;
      const tipX = this.pivotX + Math.sin(angle) * this.armLength * 0.85;
      const tipY = this.pivotY - Math.cos(angle) * this.armLength * 0.85;
      // Small vertical tick
      tickVerts.push(
        tipX, tipY - tickLen / 2, 0,
        tipX, tipY + tickLen / 2, 0,
      );
    }
    // Center tick (rest position)
    const centerTipY = this.pivotY - this.armLength * 0.85;
    tickVerts.push(
      this.pivotX, centerTipY - tickLen / 2, 0,
      this.pivotX, centerTipY + tickLen / 2, 0,
    );

    const tickGeo = new THREE.BufferGeometry();
    tickGeo.setAttribute('position', new THREE.Float32BufferAttribute(tickVerts, 3));
    this.tickLines = new THREE.LineSegments(tickGeo, new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.tickLines);

    // Arm line (will be updated each frame)
    const armVerts = [
      this.pivotX, this.pivotY, 1,
      this.pivotX, this.pivotY - this.armLength, 1,
    ];

    const armGeo = new THREE.BufferGeometry();
    armGeo.setAttribute('position', new THREE.Float32BufferAttribute(armVerts, 3));
    this.armLine = new THREE.LineSegments(armGeo, new THREE.LineBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.armLine);

    // Weight at the top of the arm (small triangle approximated as a dot)
    const weightR = Math.max(2, Math.min(w, h) * 0.035);
    const weightGeo = new THREE.CircleGeometry(weightR, 6); // hexagonal weight
    this.weightDot = new THREE.Mesh(weightGeo, new THREE.MeshBasicMaterial({
      color: this.palette.secondary,
      transparent: true,
      opacity: 0,
    }));
    this.weightDot.position.set(this.pivotX, this.pivotY - this.armLength * 0.75, 2);
    this.group.add(this.weightDot);

    // Pivot dot
    const pivotR = Math.max(1.5, Math.min(w, h) * 0.02);
    const pivotGeo = new THREE.CircleGeometry(pivotR, 8);
    const pivotDot = new THREE.Mesh(pivotGeo, new THREE.MeshBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
    }));
    pivotDot.position.set(this.pivotX, this.pivotY, 2);
    this.group.add(pivotDot);
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);

    // Swing angle using sine wave
    const angle = Math.sin(time * this.speed) * this.swingAngle;

    // Update arm line: from pivot to tip
    const tipX = this.pivotX + Math.sin(angle) * this.armLength;
    const tipY = this.pivotY - Math.cos(angle) * this.armLength;

    const armPos = this.armLine.geometry.getAttribute('position') as THREE.BufferAttribute;
    armPos.setXYZ(0, this.pivotX, this.pivotY, 1);
    armPos.setXYZ(1, tipX, tipY, 1);
    armPos.needsUpdate = true;

    // Update weight position (at ~75% of arm length)
    const weightX = this.pivotX + Math.sin(angle) * this.armLength * 0.75;
    const weightY = this.pivotY - Math.cos(angle) * this.armLength * 0.75;
    this.weightDot.position.set(weightX, weightY, 2);

    // Set opacities
    (this.armLine.material as THREE.LineBasicMaterial).opacity = opacity * 0.85;
    (this.weightDot.material as THREE.MeshBasicMaterial).opacity = opacity * 0.9;
    (this.baseLine.material as THREE.LineBasicMaterial).opacity = opacity * 0.5;
    (this.tickLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.4;

    // Pivot dot
    const pivotDot = this.group.children[4] as THREE.Mesh;
    (pivotDot.material as THREE.MeshBasicMaterial).opacity = opacity * 0.7;
  }
}
