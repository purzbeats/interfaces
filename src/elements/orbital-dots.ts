import * as THREE from 'three';
import { BaseElement } from './base-element';
import { stateOpacity, pulse, glitchOffset } from '../animation/fx';

/**
 * Particles orbiting on elliptical paths at different speeds and radii.
 * Some fast, some slow, creating a sense of data flowing through a system.
 */
export class OrbitalDotsElement extends BaseElement {
  private points!: THREE.Points;
  private orbits: Array<{ rx: number; ry: number; speed: number; phase: number; size: number }> = [];
  private trailLines: THREE.Line[] = [];
  private particleCount: number = 0;
  private pulseTimer: number = 0;
  private glitchTimer: number = 0;

  build(): void {
    const { x, y, w, h } = this.px;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const maxRx = w / 2 * 0.85;
    const maxRy = h / 2 * 0.85;
    this.particleCount = this.rng.int(12, 40);

    for (let i = 0; i < this.particleCount; i++) {
      this.orbits.push({
        rx: this.rng.float(0.15, 1) * maxRx,
        ry: this.rng.float(0.15, 1) * maxRy,
        speed: this.rng.float(0.5, 4) * (this.rng.chance(0.5) ? 1 : -1),
        phase: this.rng.float(0, Math.PI * 2),
        size: this.rng.float(2, 5),
      });
    }

    const positions = new Float32Array(this.particleCount * 3);
    const sizes = new Float32Array(this.particleCount);
    for (let i = 0; i < this.particleCount; i++) {
      sizes[i] = this.orbits[i].size;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({
      color: this.palette.primary,
      size: 3,
      transparent: true,
      opacity: 0,
      sizeAttenuation: false,
    }));
    this.group.add(this.points);

    // A few orbit path rings (decorative)
    const trailCount = Math.min(4, Math.floor(this.particleCount / 4));
    for (let t = 0; t < trailCount; t++) {
      const orb = this.orbits[t * 3]; // sample every 3rd orbit
      const trailPositions: number[] = [];
      const segs = 48;
      for (let s = 0; s <= segs; s++) {
        const a = (s / segs) * Math.PI * 2;
        trailPositions.push(cx + Math.cos(a) * orb.rx, cy + Math.sin(a) * orb.ry, 0);
      }
      const tGeo = new THREE.BufferGeometry();
      tGeo.setAttribute('position', new THREE.Float32BufferAttribute(trailPositions, 3));
      const trail = new THREE.Line(tGeo, new THREE.LineBasicMaterial({
        color: this.palette.dim,
        transparent: true,
        opacity: 0,
      }));
      this.trailLines.push(trail);
      this.group.add(trail);
    }
  }

  update(dt: number, time: number): void {
    let opacity = stateOpacity(this.stateMachine.state, this.stateMachine.progress);
    const { x, y, w, h } = this.px;
    const cx = x + w / 2;
    const cy = y + h / 2;

    if (this.pulseTimer > 0) {
      this.pulseTimer -= dt;
      opacity *= pulse(this.pulseTimer);
    }

    const gx = this.glitchTimer > 0 ? glitchOffset(this.glitchTimer, 5) : 0;
    if (this.glitchTimer > 0) this.glitchTimer -= dt;

    const positions = this.points.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < this.particleCount; i++) {
      const orb = this.orbits[i];
      const a = time * orb.speed + orb.phase;
      positions.setXYZ(i,
        cx + Math.cos(a) * orb.rx + gx,
        cy + Math.sin(a) * orb.ry,
        2
      );
    }
    positions.needsUpdate = true;
    (this.points.material as THREE.PointsMaterial).opacity = opacity * 0.8;

    for (const trail of this.trailLines) {
      (trail.material as THREE.LineBasicMaterial).opacity = opacity * 0.12;
    }
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'pulse') {
      this.pulseTimer = 0.5;
      // Speed burst
      for (const orb of this.orbits) {
        orb.speed *= 1.5;
      }
      setTimeout(() => {
        for (const orb of this.orbits) {
          orb.speed /= 1.5;
        }
      }, 500);
    }
    if (action === 'glitch') {
      this.glitchTimer = 0.4;
      for (const orb of this.orbits) {
        orb.phase += this.rng.float(-1, 1);
      }
    }
    if (action === 'alert') {
      this.pulseTimer = 1.5;
      (this.points.material as THREE.PointsMaterial).color.copy(this.palette.alert);
    }
  }
}
