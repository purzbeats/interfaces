import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Particles orbiting a center point at different radii and speeds,
 * with faint orbit trails — like an atom diagram or satellite tracker.
 */
export class OrbitalDisplayElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'orbital-display',
    meta: { shape: 'radial', roles: ['data-display', 'decorative'], moods: ['ambient'], bandAffinity: 'mid', sizes: ['needs-medium', 'needs-large'] },
  };
  private orbitLines: THREE.Line[] = [];
  private particlePoints!: THREE.Points;
  private centerDot!: THREE.Points;
  private orbits: { radius: number; speed: number; angle: number; eccentric: number }[] = [];
  private cx: number = 0;
  private cy: number = 0;
  private maxRadius: number = 0;

  build(): void {
    const variant = this.rng.int(0, 3);
    const presets = [
      { orbitMin: 3, orbitMax: 6, particleMin: 6, particleMax: 14, speedMin: 0.3, speedMax: 1.2, eccMin: 0.0, eccMax: 0.25, dotSize: 0.015 },
      { orbitMin: 6, orbitMax: 10, particleMin: 16, particleMax: 30, speedMin: 0.6, speedMax: 2.0, eccMin: 0.0, eccMax: 0.15, dotSize: 0.010 },
      { orbitMin: 2, orbitMax: 3, particleMin: 3, particleMax: 6, speedMin: 0.15, speedMax: 0.5, eccMin: 0.0, eccMax: 0.1, dotSize: 0.025 },
      { orbitMin: 4, orbitMax: 7, particleMin: 8, particleMax: 20, speedMin: 0.5, speedMax: 1.8, eccMin: 0.15, eccMax: 0.25, dotSize: 0.018 },
    ];
    const p = presets[variant];

    this.glitchAmount = 5;
    const { x, y, w, h } = this.px;
    this.cx = x + w / 2;
    this.cy = y + h / 2;
    this.maxRadius = Math.min(w, h) * 0.44 / (1 + p.eccMax);

    const orbitCount = this.rng.int(p.orbitMin, p.orbitMax);
    const particleCount = this.rng.int(p.particleMin, p.particleMax);

    // Create orbit ring lines
    for (let i = 0; i < orbitCount; i++) {
      const r = this.maxRadius * ((i + 1) / (orbitCount + 0.5));
      const eccentric = this.rng.float(p.eccMin, p.eccMax);
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
      const speed = this.rng.float(p.speedMin, p.speedMax) * (this.rng.chance(0.3) ? -1 : 1);
      const angle = this.rng.float(0, Math.PI * 2);
      const eccentric = orbitIdx < this.orbitLines.length ? this.rng.float(p.eccMin, p.eccMax) : 0;
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
      size: Math.max(5, Math.min(w, h) * p.dotSize),
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
    const opacity = this.applyEffects(dt);

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

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) return;
    if (level >= 3) {
      // Speed boost impulse
      for (const orb of this.orbits) {
        orb.speed += level * 0.3 * Math.sign(orb.speed);
      }
    }
    if (level >= 5) {
      (this.centerDot.material as THREE.PointsMaterial).color.copy(this.palette.alert);
      setTimeout(() => {
        (this.centerDot.material as THREE.PointsMaterial).color.copy(this.palette.primary);
      }, 2000);
    }
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      for (const orb of this.orbits) orb.speed *= -1;
    }
    if (action === 'alert') {
      (this.centerDot.material as THREE.PointsMaterial).color.copy(this.palette.alert);
    }
  }
}
