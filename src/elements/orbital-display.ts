import * as THREE from 'three';
import { BaseElement } from './base-element';
import { stateOpacity, pulse, glitchOffset } from '../animation/fx';

/**
 * Particles orbiting a center point at different radii and speeds,
 * with faint orbit trails — like an atom diagram or satellite tracker.
 */
export class OrbitalDisplayElement extends BaseElement {
  private orbitLines: THREE.Line[] = [];
  private particlePoints!: THREE.Points;
  private centerDot!: THREE.Points;
  private orbits: { radius: number; speed: number; angle: number; eccentric: number }[] = [];
  private cx: number = 0;
  private cy: number = 0;
  private maxRadius: number = 0;
  private pulseTimer: number = 0;
  private glitchTimer: number = 0;

  build(): void {
    const { x, y, w, h } = this.px;
    this.cx = x + w / 2;
    this.cy = y + h / 2;
    this.maxRadius = Math.min(w, h) * 0.44;

    const orbitCount = this.rng.int(3, 6);
    const particleCount = this.rng.int(6, 14);

    // Create orbit ring lines
    for (let i = 0; i < orbitCount; i++) {
      const r = this.maxRadius * ((i + 1) / (orbitCount + 0.5));
      const eccentric = this.rng.float(0.0, 0.25);
      const pts = 64;
      const positions = new Float32Array(pts * 3);
      for (let j = 0; j < pts; j++) {
        const a = (j / (pts - 1)) * Math.PI * 2;
        const rx = r * (1 + eccentric * Math.cos(a));
        const ry = r * (1 - eccentric * Math.cos(a));
        positions[j * 3] = Math.cos(a) * rx;
        positions[j * 3 + 1] = Math.sin(a) * ry;
        positions[j * 3 + 2] = 0;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const mat = new THREE.LineBasicMaterial({
        color: this.palette.primary,
        transparent: true,
        opacity: 0,
      });
      const line = new THREE.Line(geo, mat);
      line.position.set(this.cx, this.cy, 0);
      this.group.add(line);
      this.orbitLines.push(line);
    }

    // Create orbiting particles
    const particlePositions = new Float32Array(particleCount * 3);
    const particleColors = new Float32Array(particleCount * 3);
    for (let i = 0; i < particleCount; i++) {
      const orbitIdx = this.rng.int(0, orbitCount - 1);
      const r = this.maxRadius * ((orbitIdx + 1) / (orbitCount + 0.5));
      const speed = this.rng.float(0.3, 1.2) * (this.rng.chance(0.3) ? -1 : 1);
      const angle = this.rng.float(0, Math.PI * 2);
      const eccentric = orbitIdx < this.orbitLines.length ? this.rng.float(0, 0.25) : 0;
      this.orbits.push({ radius: r, speed, angle, eccentric });

      particlePositions[i * 3] = 0;
      particlePositions[i * 3 + 1] = 0;
      particlePositions[i * 3 + 2] = 0;
      particleColors[i * 3] = this.palette.primary.r;
      particleColors[i * 3 + 1] = this.palette.primary.g;
      particleColors[i * 3 + 2] = this.palette.primary.b;
    }

    const particleGeo = new THREE.BufferGeometry();
    particleGeo.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));
    particleGeo.setAttribute('color', new THREE.BufferAttribute(particleColors, 3));
    this.particlePoints = new THREE.Points(particleGeo, new THREE.PointsMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0,
      size: Math.max(5, Math.min(w, h) * 0.015),
      sizeAttenuation: false,
    }));
    this.particlePoints.position.set(this.cx, this.cy, 0);
    this.group.add(this.particlePoints);

    // Center dot
    const centerGeo = new THREE.BufferGeometry();
    centerGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0]), 3));
    this.centerDot = new THREE.Points(centerGeo, new THREE.PointsMaterial({
      color: this.palette.secondary,
      transparent: true,
      opacity: 0,
      size: Math.max(8, Math.min(w, h) * 0.025),
      sizeAttenuation: false,
    }));
    this.centerDot.position.set(this.cx, this.cy, 0);
    this.group.add(this.centerDot);
  }

  update(dt: number, time: number): void {
    let opacity = stateOpacity(this.stateMachine.state, this.stateMachine.progress);
    if (this.pulseTimer > 0) { this.pulseTimer -= dt; opacity *= pulse(this.pulseTimer); }
    const gx = this.glitchTimer > 0 ? glitchOffset(this.glitchTimer, 5) : 0;
    if (this.glitchTimer > 0) this.glitchTimer -= dt;
    this.group.position.x = gx;

    // Orbit lines
    for (const line of this.orbitLines) {
      (line.material as THREE.LineBasicMaterial).opacity = opacity * 0.3;
    }

    // Center dot
    (this.centerDot.material as THREE.PointsMaterial).opacity = opacity * 0.9;

    // Update particle positions
    const pos = this.particlePoints.geometry.getAttribute('position') as THREE.BufferAttribute;
    const colors = this.particlePoints.geometry.getAttribute('color') as THREE.BufferAttribute;
    for (let i = 0; i < this.orbits.length; i++) {
      const orb = this.orbits[i];
      orb.angle += orb.speed * dt;
      const rx = orb.radius * (1 + orb.eccentric * Math.cos(orb.angle));
      const ry = orb.radius * (1 - orb.eccentric * Math.cos(orb.angle));
      pos.setXY(i, Math.cos(orb.angle) * rx, Math.sin(orb.angle) * ry);

      // Color: brighter when moving toward viewer (top of orbit)
      const brightness = 0.5 + 0.5 * Math.sin(orb.angle);
      const pr = this.palette.dim.r + (this.palette.primary.r - this.palette.dim.r) * brightness;
      const pg = this.palette.dim.g + (this.palette.primary.g - this.palette.dim.g) * brightness;
      const pb = this.palette.dim.b + (this.palette.primary.b - this.palette.dim.b) * brightness;
      colors.setXYZ(i, pr, pg, pb);
    }
    pos.needsUpdate = true;
    colors.needsUpdate = true;
    (this.particlePoints.material as THREE.PointsMaterial).opacity = opacity;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'pulse') this.pulseTimer = 0.5;
    if (action === 'glitch') {
      this.glitchTimer = 0.4;
      for (const orb of this.orbits) orb.speed *= -1;
    }
    if (action === 'alert') {
      this.pulseTimer = 2.0;
      (this.centerDot.material as THREE.PointsMaterial).color.copy(this.palette.alert);
    }
  }
}
