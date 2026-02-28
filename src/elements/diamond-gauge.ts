import * as THREE from 'three';
import { BaseElement } from './base-element';
import { stateOpacity, pulse, glitchOffset } from '../animation/fx';

/**
 * Diamond/rhombus-shaped gauge with rotating corners and value indicator.
 * Angular, geometric, very EVA.
 */
export class DiamondGaugeElement extends BaseElement {
  private outerDiamond!: THREE.LineSegments;
  private innerDiamond!: THREE.LineSegments;
  private fillMesh!: THREE.Mesh;
  private cornerDots: THREE.Mesh[] = [];
  private value: number = 0;
  private targetValue: number = 0;
  private rotationSpeed: number = 0;
  private rotAngle: number = 0;
  private cycleTimer: number = 0;
  private pulseTimer: number = 0;
  private glitchTimer: number = 0;

  build(): void {
    const { x, y, w, h } = this.px;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const rx = w / 2 * 0.85;
    const ry = h / 2 * 0.85;
    this.targetValue = this.rng.float(0.3, 0.9);
    this.rotationSpeed = this.rng.float(0.3, 1.2);

    // Outer diamond
    const outerVerts = new Float32Array([
      cx, cy - ry, 0, cx + rx, cy, 0,
      cx + rx, cy, 0, cx, cy + ry, 0,
      cx, cy + ry, 0, cx - rx, cy, 0,
      cx - rx, cy, 0, cx, cy - ry, 0,
    ]);
    const outerGeo = new THREE.BufferGeometry();
    outerGeo.setAttribute('position', new THREE.BufferAttribute(outerVerts, 3));
    this.outerDiamond = new THREE.LineSegments(outerGeo, new THREE.LineBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.outerDiamond);

    // Inner diamond (smaller, rotates)
    const irx = rx * 0.5;
    const iry = ry * 0.5;
    const innerVerts = new Float32Array([
      cx, cy - iry, 1, cx + irx, cy, 1,
      cx + irx, cy, 1, cx, cy + iry, 1,
      cx, cy + iry, 1, cx - irx, cy, 1,
      cx - irx, cy, 1, cx, cy - iry, 1,
    ]);
    const innerGeo = new THREE.BufferGeometry();
    innerGeo.setAttribute('position', new THREE.BufferAttribute(innerVerts, 3));
    this.innerDiamond = new THREE.LineSegments(innerGeo, new THREE.LineBasicMaterial({
      color: this.palette.secondary,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.innerDiamond);

    // Corner indicator dots
    const corners = [
      [cx, cy - ry], [cx + rx, cy], [cx, cy + ry], [cx - rx, cy]
    ];
    for (const [dx, dy] of corners) {
      const dotGeo = new THREE.CircleGeometry(3, 6);
      const dot = new THREE.Mesh(dotGeo, new THREE.MeshBasicMaterial({
        color: this.palette.primary,
        transparent: true,
        opacity: 0,
      }));
      dot.position.set(dx, dy, 2);
      this.cornerDots.push(dot);
      this.group.add(dot);
    }

    // Value fill — a smaller diamond that scales with value
    const shape = new THREE.Shape();
    shape.moveTo(0, -1);
    shape.lineTo(1, 0);
    shape.lineTo(0, 1);
    shape.lineTo(-1, 0);
    shape.closePath();
    const fillGeo = new THREE.ShapeGeometry(shape);
    this.fillMesh = new THREE.Mesh(fillGeo, new THREE.MeshBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
    }));
    this.fillMesh.position.set(cx, cy, 0.5);
    this.group.add(this.fillMesh);
  }

  update(dt: number, time: number): void {
    let opacity = stateOpacity(this.stateMachine.state, this.stateMachine.progress);
    const { x, y, w, h } = this.px;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const rx = w / 2 * 0.85;
    const ry = h / 2 * 0.85;

    if (this.pulseTimer > 0) {
      this.pulseTimer -= dt;
      opacity *= pulse(this.pulseTimer);
    }

    const gx = this.glitchTimer > 0 ? glitchOffset(this.glitchTimer, 5) : 0;
    if (this.glitchTimer > 0) this.glitchTimer -= dt;
    this.group.position.x = gx;

    // Cycle value
    this.cycleTimer += dt;
    if (this.cycleTimer > this.rng.float(1.5, 4)) {
      this.cycleTimer = 0;
      this.targetValue = this.rng.float(0.2, 1.0);
    }
    // Springy interpolation
    const diff = this.targetValue - this.value;
    this.value += diff * dt * 3;
    if (Math.abs(diff) > 0.01) {
      this.value += Math.sin(time * 12) * 0.005; // micro-vibration while moving
    }

    (this.outerDiamond.material as THREE.LineBasicMaterial).opacity = opacity * 0.7;

    // Inner diamond rotates
    this.rotAngle += this.rotationSpeed * dt;
    this.innerDiamond.rotation.z = this.rotAngle;
    (this.innerDiamond.material as THREE.LineBasicMaterial).opacity = opacity * 0.5;

    // Fill scales with value
    this.fillMesh.scale.set(rx * this.value * 0.4, ry * this.value * 0.4, 1);
    (this.fillMesh.material as THREE.MeshBasicMaterial).opacity = opacity * 0.15;

    // Corner dots pulse at different phases
    for (let i = 0; i < this.cornerDots.length; i++) {
      const dotPulse = 0.3 + Math.sin(time * 3 + i * Math.PI / 2) * 0.3;
      (this.cornerDots[i].material as THREE.MeshBasicMaterial).opacity = opacity * dotPulse;
    }
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'pulse') this.pulseTimer = 0.5;
    if (action === 'glitch') this.glitchTimer = 0.4;
    if (action === 'alert') {
      this.targetValue = 1.0;
      this.pulseTimer = 2.0;
      (this.outerDiamond.material as THREE.LineBasicMaterial).color.copy(this.palette.alert);
    }
  }
}
