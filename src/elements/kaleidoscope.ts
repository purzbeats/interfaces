import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Rotating kaleidoscope with 6-fold hexagonal symmetry.
 * Simple shapes in one slice are mirrored/rotated around the center.
 * Individual shapes drift slowly within each slice.
 */
export class KaleidoscopeElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'kaleidoscope',
    meta: { shape: 'radial', roles: ['decorative'], moods: ['ambient'], sizes: ['needs-medium', 'needs-large'] },
  };

  private outerGroup!: THREE.Group;
  private sliceGroups: THREE.Group[] = [];
  private sliceLines: THREE.Line[][] = [];
  private sliceMaterials: THREE.LineBasicMaterial[][] = [];
  private rotationSpeed: number = 0;
  private driftSpeeds: number[] = [];
  private driftPhases: number[] = [];
  private shapeCount: number = 0;
  private radius: number = 0;

  build(): void {
    const { x, y, w, h } = this.px;
    const cx = x + w / 2;
    const cy = y + h / 2;
    this.radius = Math.min(w, h) * 0.45;
    this.rotationSpeed = this.rng.float(0.1, 0.3) * (this.rng.chance(0.5) ? 1 : -1);
    this.shapeCount = this.rng.int(3, 6);

    const sliceCount = 6;

    this.outerGroup = new THREE.Group();
    this.outerGroup.position.set(cx, cy, 0);
    this.group.add(this.outerGroup);

    // Pre-generate shape data for one slice
    const shapeData: Array<{ points: THREE.Vector2[]; drift: number; phase: number }> = [];
    for (let s = 0; s < this.shapeCount; s++) {
      const dist = this.rng.float(0.15, 0.85) * this.radius;
      const angle = this.rng.float(0, Math.PI / sliceCount);
      const size = this.rng.float(0.08, 0.25) * this.radius;

      // Simple triangle shape
      const pts: THREE.Vector2[] = [];
      const triVerts = 3;
      for (let v = 0; v < triVerts; v++) {
        const a = (v / triVerts) * Math.PI * 2;
        pts.push(new THREE.Vector2(
          Math.cos(angle) * dist + Math.cos(a) * size,
          Math.sin(angle) * dist + Math.sin(a) * size,
        ));
      }
      pts.push(pts[0].clone()); // close the shape

      const drift = this.rng.float(0.1, 0.4);
      const phase = this.rng.float(0, Math.PI * 2);
      shapeData.push({ points: pts, drift, phase });
      this.driftSpeeds.push(drift);
      this.driftPhases.push(phase);
    }

    this.sliceGroups = [];
    this.sliceLines = [];
    this.sliceMaterials = [];

    for (let sl = 0; sl < sliceCount; sl++) {
      const sliceGroup = new THREE.Group();
      sliceGroup.rotation.z = (sl / sliceCount) * Math.PI * 2;
      this.outerGroup.add(sliceGroup);
      this.sliceGroups.push(sliceGroup);

      const lines: THREE.Line[] = [];
      const mats: THREE.LineBasicMaterial[] = [];

      for (let s = 0; s < this.shapeCount; s++) {
        const color = (sl + s) % 2 === 0 ? this.palette.primary : this.palette.secondary;
        const mat = new THREE.LineBasicMaterial({
          color,
          transparent: true,
          opacity: 0,
        });

        const geo = new THREE.BufferGeometry();
        const positions = new Float32Array(shapeData[s].points.length * 3);
        for (let p = 0; p < shapeData[s].points.length; p++) {
          positions[p * 3] = shapeData[s].points[p].x;
          positions[p * 3 + 1] = shapeData[s].points[p].y;
          positions[p * 3 + 2] = 0;
        }
        geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

        const line = new THREE.Line(geo, mat);
        sliceGroup.add(line);
        lines.push(line);
        mats.push(mat);
      }

      this.sliceLines.push(lines);
      this.sliceMaterials.push(mats);
    }
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);

    // Slowly rotate the whole pattern
    this.outerGroup.rotation.z += this.rotationSpeed * dt;

    // Drift individual shapes within each slice
    for (let sl = 0; sl < this.sliceGroups.length; sl++) {
      for (let s = 0; s < this.shapeCount; s++) {
        const line = this.sliceLines[sl][s];
        const drift = this.driftSpeeds[s];
        const phase = this.driftPhases[s];
        // Small oscillation in position
        line.position.x = Math.sin(time * drift + phase) * this.radius * 0.05;
        line.position.y = Math.cos(time * drift * 0.7 + phase) * this.radius * 0.05;

        this.sliceMaterials[sl][s].opacity = opacity * 0.8;
      }
    }
  }
}
