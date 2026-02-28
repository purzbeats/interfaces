import * as THREE from 'three';
import { BaseElement } from './base-element';
import { stateOpacity, pulse, glitchOffset } from '../animation/fx';

/**
 * Concentric expanding rings that ripple outward from center.
 * Each ring spawns at center and grows outward, fading as it expands.
 */
export class ConcentricRingsElement extends BaseElement {
  private ringMeshes: THREE.Line[] = [];
  private ringPhases: number[] = [];
  private maxRings: number = 0;
  private rippleSpeed: number = 0;
  private segments: number = 0;
  private pulseTimer: number = 0;
  private glitchTimer: number = 0;

  build(): void {
    const { x, y, w, h } = this.px;
    const cx = x + w / 2;
    const cy = y + h / 2;
    this.maxRings = this.rng.int(4, 8);
    this.rippleSpeed = this.rng.float(0.3, 0.8);
    this.segments = 64;

    for (let i = 0; i < this.maxRings; i++) {
      const positions = new Float32Array((this.segments + 1) * 3);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const ring = new THREE.Line(geo, new THREE.LineBasicMaterial({
        color: i % 2 === 0 ? this.palette.primary : this.palette.secondary,
        transparent: true,
        opacity: 0,
      }));
      this.ringMeshes.push(ring);
      this.ringPhases.push(i / this.maxRings); // staggered
      this.group.add(ring);
    }

    // Center dot
    const dotGeo = new THREE.CircleGeometry(2, 8);
    const dot = new THREE.Mesh(dotGeo, new THREE.MeshBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0.6,
    }));
    dot.position.set(cx, cy, 2);
    this.group.add(dot);
  }

  update(dt: number, time: number): void {
    let opacity = stateOpacity(this.stateMachine.state, this.stateMachine.progress);
    const { x, y, w, h } = this.px;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const maxR = Math.min(w, h) / 2 * 0.9;

    if (this.pulseTimer > 0) {
      this.pulseTimer -= dt;
      opacity *= pulse(this.pulseTimer);
    }

    const gx = this.glitchTimer > 0 ? glitchOffset(this.glitchTimer, 4) : 0;
    if (this.glitchTimer > 0) this.glitchTimer -= dt;

    for (let i = 0; i < this.maxRings; i++) {
      this.ringPhases[i] = (this.ringPhases[i] + dt * this.rippleSpeed) % 1;
      const phase = this.ringPhases[i];
      const radius = phase * maxR;

      // Ease out the expansion — starts fast, slows down
      const easedRadius = maxR * (1 - Math.pow(1 - phase, 2.5));
      const fadeOut = 1 - phase; // fade as it expands

      const positions = this.ringMeshes[i].geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let s = 0; s <= this.segments; s++) {
        const a = (s / this.segments) * Math.PI * 2;
        positions.setXYZ(s, cx + Math.cos(a) * easedRadius + gx, cy + Math.sin(a) * easedRadius, 1);
      }
      positions.needsUpdate = true;

      (this.ringMeshes[i].material as THREE.LineBasicMaterial).opacity = opacity * fadeOut * 0.7;
    }

    // Update center dot
    const dot = this.group.children[this.group.children.length - 1] as THREE.Mesh;
    dot.position.x = cx + gx;
    (dot.material as THREE.MeshBasicMaterial).opacity = opacity * 0.6;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'pulse') {
      this.pulseTimer = 0.5;
      // Reset all rings to center for a burst effect
      for (let i = 0; i < this.maxRings; i++) {
        this.ringPhases[i] = i * 0.05;
      }
    }
    if (action === 'glitch') this.glitchTimer = 0.4;
    if (action === 'alert') {
      this.rippleSpeed *= 2.5;
      this.pulseTimer = 1.5;
    }
  }
}
