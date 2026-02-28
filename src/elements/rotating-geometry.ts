import * as THREE from 'three';
import { BaseElement } from './base-element';
import { stateOpacity, pulse, glitchOffset } from '../animation/fx';

/**
 * Nested rotating polygons — layered geometric shapes spinning at different rates.
 * Each layer is a different polygon (triangle, square, pentagon, hex, octagon)
 * creating mesmerizing moiré-like patterns.
 */
export class RotatingGeometryElement extends BaseElement {
  private layers: THREE.LineSegments[] = [];
  private layerSpeeds: number[] = [];
  private layerSides: number[] = [];
  private breathePhase: number = 0;
  private pulseTimer: number = 0;
  private glitchTimer: number = 0;

  build(): void {
    const { x, y, w, h } = this.px;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const maxR = Math.min(w, h) / 2 * 0.85;
    const layerCount = this.rng.int(3, 7);
    this.breathePhase = this.rng.float(0, Math.PI * 2);

    for (let l = 0; l < layerCount; l++) {
      const sides = this.rng.pick([3, 4, 5, 6, 8]);
      const radius = maxR * (0.3 + (l / layerCount) * 0.7);
      const speed = this.rng.float(-2, 2) * (l % 2 === 0 ? 1 : -1); // alternate directions

      const verts: number[] = [];
      for (let i = 0; i < sides; i++) {
        const a1 = (i / sides) * Math.PI * 2;
        const a2 = ((i + 1) / sides) * Math.PI * 2;
        verts.push(
          cx + Math.cos(a1) * radius, cy + Math.sin(a1) * radius, l * 0.5,
          cx + Math.cos(a2) * radius, cy + Math.sin(a2) * radius, l * 0.5,
        );
      }

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
      const color = l === layerCount - 1 ? this.palette.secondary
        : l === 0 ? this.palette.dim
        : this.palette.primary;
      const line = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity: 0,
      }));
      this.layers.push(line);
      this.layerSpeeds.push(speed);
      this.layerSides.push(sides);
      this.group.add(line);
    }
  }

  update(dt: number, time: number): void {
    let opacity = stateOpacity(this.stateMachine.state, this.stateMachine.progress);

    if (this.pulseTimer > 0) {
      this.pulseTimer -= dt;
      opacity *= pulse(this.pulseTimer);
    }

    const gx = this.glitchTimer > 0 ? glitchOffset(this.glitchTimer, 5) : 0;
    if (this.glitchTimer > 0) this.glitchTimer -= dt;
    this.group.position.x = gx;

    const breathe = 1 + Math.sin(time * 0.8 + this.breathePhase) * 0.05;

    for (let l = 0; l < this.layers.length; l++) {
      this.layers[l].rotation.z += this.layerSpeeds[l] * dt;

      // Each layer scales slightly differently for depth effect
      const layerScale = breathe + Math.sin(time * 1.2 + l * 0.8) * 0.03;
      this.layers[l].scale.set(layerScale, layerScale, 1);

      const layerOpacity = opacity * (0.25 + (l / this.layers.length) * 0.45);
      (this.layers[l].material as THREE.LineBasicMaterial).opacity = layerOpacity;
    }
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'pulse') {
      this.pulseTimer = 0.5;
      // Reverse all rotations briefly
      for (let l = 0; l < this.layers.length; l++) {
        this.layerSpeeds[l] *= -1;
      }
    }
    if (action === 'glitch') {
      this.glitchTimer = 0.5;
      // Randomize speeds
      for (let l = 0; l < this.layers.length; l++) {
        this.layerSpeeds[l] = this.rng.float(-6, 6);
      }
    }
    if (action === 'alert') {
      this.pulseTimer = 2.0;
      // All spin fast same direction
      for (let l = 0; l < this.layers.length; l++) {
        this.layerSpeeds[l] = 5 * (l % 2 === 0 ? 1 : -1);
        (this.layers[l].material as THREE.LineBasicMaterial).color.copy(this.palette.alert);
      }
    }
  }
}
