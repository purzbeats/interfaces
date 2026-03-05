import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Multiple elliptical orbits around a central body.
 * Bodies trace Keplerian paths with orbital trails showing history.
 */
export class KeplerOrbitElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'kepler-orbit',
    meta: { shape: 'radial', roles: ['data-display', 'decorative'], moods: ['ambient', 'diagnostic'], bandAffinity: 'mid', sizes: ['needs-medium', 'needs-large'] },
  };

  private cx = 0;
  private cy = 0;
  private orbitCount = 0;
  private trailLines: THREE.Line[] = [];
  private bodyMeshes: THREE.Mesh[] = [];
  private orbitParams: Array<{ a: number; e: number; phase: number; speed: number; trailLen: number }> = [];
  private trailSegments = 64;
  private meanAnomalies: number[] = [];

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;
    this.cx = x + w / 2;
    this.cy = y + h / 2;
    const scale = Math.min(w, h) * 0.45;

    const variant = this.rng.int(0, 3);
    const presets = [
      { orbits: 3, eRange: [0.1, 0.4] as const, speedRange: [0.3, 0.8] as const, trail: 48 },
      { orbits: 5, eRange: [0.0, 0.6] as const, speedRange: [0.2, 1.2] as const, trail: 64 },
      { orbits: 2, eRange: [0.3, 0.7] as const, speedRange: [0.15, 0.5] as const, trail: 80 },
      { orbits: 4, eRange: [0.05, 0.5] as const, speedRange: [0.4, 1.0] as const, trail: 56 },
    ];
    const p = presets[variant];
    this.orbitCount = p.orbits;
    this.trailSegments = p.trail;

    // Central body
    const centerGeo = new THREE.CircleGeometry(Math.max(2, scale * 0.04), 16);
    const centerMat = new THREE.MeshBasicMaterial({ color: this.palette.primary, transparent: true });
    const centerMesh = new THREE.Mesh(centerGeo, centerMat);
    centerMesh.position.set(this.cx, this.cy, 1);
    this.group.add(centerMesh);

    for (let i = 0; i < this.orbitCount; i++) {
      const aFrac = (i + 1) / (this.orbitCount + 1);
      const a = scale * (0.2 + aFrac * 0.7);
      const e = this.rng.float(p.eRange[0], p.eRange[1]);
      const phase = this.rng.float(0, Math.PI * 2);
      const speed = this.rng.float(p.speedRange[0], p.speedRange[1]) / Math.sqrt(a / scale);

      this.orbitParams.push({ a, e, phase, speed, trailLen: this.trailSegments });
      this.meanAnomalies.push(this.rng.float(0, Math.PI * 2));

      // Trail line
      const verts = new Float32Array((this.trailSegments + 1) * 3);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
      const color = i % 2 === 0 ? this.palette.primary : this.palette.secondary;
      const trail = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0 }));
      this.trailLines.push(trail);
      this.group.add(trail);

      // Body dot
      const bodyGeo = new THREE.CircleGeometry(Math.max(1.5, scale * 0.025), 8);
      const bodyMat = new THREE.MeshBasicMaterial({ color, transparent: true });
      const body = new THREE.Mesh(bodyGeo, bodyMat);
      body.position.set(this.cx, this.cy, 2);
      this.bodyMeshes.push(body);
      this.group.add(body);
    }
  }

  /** Solve Kepler's equation M = E - e*sin(E) via Newton iteration. */
  private solveKepler(M: number, e: number): number {
    let E = M;
    for (let iter = 0; iter < 8; iter++) {
      E = E - (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    }
    return E;
  }

  private orbitalPos(a: number, e: number, theta: number, phase: number): [number, number] {
    const angle = theta + phase;
    const r = a * (1 - e * e) / (1 + e * Math.cos(theta));
    return [this.cx + r * Math.cos(angle), this.cy + r * Math.sin(angle)];
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);

    for (let i = 0; i < this.orbitCount; i++) {
      const op = this.orbitParams[i];
      this.meanAnomalies[i] += op.speed * dt;
      const M = this.meanAnomalies[i];

      // Draw full orbit trail (ellipse path)
      const pos = this.trailLines[i].geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let s = 0; s <= this.trailSegments; s++) {
        const trailM = M - (s / this.trailSegments) * Math.PI * 2;
        const E = this.solveKepler(trailM, op.e);
        const trueAnomaly = 2 * Math.atan2(
          Math.sqrt(1 + op.e) * Math.sin(E / 2),
          Math.sqrt(1 - op.e) * Math.cos(E / 2),
        );
        const [px, py] = this.orbitalPos(op.a, op.e, trueAnomaly, op.phase);
        pos.setXYZ(s, px, py, 0);
      }
      pos.needsUpdate = true;

      const fade = 0.3 + 0.2 * Math.sin(time * 0.5 + i);
      (this.trailLines[i].material as THREE.LineBasicMaterial).opacity = opacity * fade;

      // Current body position
      const E = this.solveKepler(M, op.e);
      const trueAnomaly = 2 * Math.atan2(
        Math.sqrt(1 + op.e) * Math.sin(E / 2),
        Math.sqrt(1 - op.e) * Math.cos(E / 2),
      );
      const [bx, by] = this.orbitalPos(op.a, op.e, trueAnomaly, op.phase);
      this.bodyMeshes[i].position.set(bx, by, 2);
      (this.bodyMeshes[i].material as THREE.MeshBasicMaterial).opacity = opacity;
    }
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      for (const op of this.orbitParams) {
        op.speed *= 1.5 + this.rng.float(0, 1);
      }
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level >= 3) {
      for (const op of this.orbitParams) {
        op.e = Math.min(0.9, op.e + 0.05 * level);
      }
    }
  }
}
