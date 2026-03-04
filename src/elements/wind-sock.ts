import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Wind direction indicator with a pole and tapered cone that sways
 * and flutters with sine-based animation. Direction shifts occasionally.
 */
export class WindSockElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'wind-sock',
    meta: {
      shape: 'linear',
      roles: ['gauge'],
      moods: ['diagnostic'],
      sizes: ['works-small'],
    },
  };

  private pole!: THREE.LineSegments;
  private cone!: THREE.LineSegments;

  private readonly CONE_SEGMENTS = 6;
  private coneBaseY: number = 0;
  private coneLength: number = 0;
  private poleX: number = 0;
  private segmentWidth: number[] = [];

  private windAngle: number = 0;
  private windAngleTarget: number = 0;
  private windShiftTimer: number = 0;
  private windShiftInterval: number = 0;
  private flutterSpeed: number = 0;

  build(): void {
    const { x, y, w, h } = this.px;

    this.poleX = x + w * 0.15;
    const poleTop = y + h * 0.1;
    const poleBottom = y + h * 0.9;
    this.coneBaseY = poleTop;
    this.coneLength = w * 0.7;
    this.flutterSpeed = this.rng.float(3.0, 5.0);
    this.windAngle = this.rng.float(-0.3, 0.3);
    this.windAngleTarget = this.windAngle;
    this.windShiftInterval = this.rng.float(3.0, 7.0);

    // Tapering widths for each cone segment (wide at base, narrow at tip)
    for (let i = 0; i <= this.CONE_SEGMENTS; i++) {
      const t = i / this.CONE_SEGMENTS;
      this.segmentWidth.push(h * 0.18 * (1 - t * 0.85));
    }

    // Pole
    const poleVerts = new Float32Array([
      this.poleX, poleTop, 0,
      this.poleX, poleBottom, 0,
    ]);
    const poleGeo = new THREE.BufferGeometry();
    poleGeo.setAttribute('position', new THREE.Float32BufferAttribute(poleVerts, 3));
    this.pole = new THREE.LineSegments(poleGeo, new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.pole);

    // Cone segments — each ring connected to next ring
    // Each segment is 2 horizontal lines (top and bottom edges) + 2 vertical connectors
    const maxVerts = this.CONE_SEGMENTS * 4 * 2 * 3; // 4 line segments per cone section, 2 verts each
    const coneGeo = new THREE.BufferGeometry();
    coneGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(maxVerts), 3));
    this.cone = new THREE.LineSegments(coneGeo, new THREE.LineBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.cone);
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);

    // Shift wind direction occasionally
    this.windShiftTimer += dt;
    if (this.windShiftTimer >= this.windShiftInterval) {
      this.windShiftTimer = 0;
      this.windShiftInterval = this.rng.float(3.0, 7.0);
      this.windAngleTarget = this.rng.float(-0.5, 0.5);
    }
    this.windAngle += (this.windAngleTarget - this.windAngle) * dt * 0.8;

    // Build cone vertices with wave flutter
    const pos = this.cone.geometry.getAttribute('position') as THREE.BufferAttribute;
    let vi = 0;
    const segLen = this.coneLength / this.CONE_SEGMENTS;

    for (let i = 0; i < this.CONE_SEGMENTS; i++) {
      const t0 = i / this.CONE_SEGMENTS;
      const t1 = (i + 1) / this.CONE_SEGMENTS;

      // Each segment gets a delayed wave phase for ripple effect
      const phase0 = time * this.flutterSpeed - i * 0.7;
      const phase1 = time * this.flutterSpeed - (i + 1) * 0.7;
      const flutter0 = Math.sin(phase0) * t0 * 12 + this.windAngle * t0 * this.coneLength * 0.3;
      const flutter1 = Math.sin(phase1) * t1 * 12 + this.windAngle * t1 * this.coneLength * 0.3;

      const x0 = this.poleX + segLen * i;
      const x1 = this.poleX + segLen * (i + 1);
      const y0 = this.coneBaseY + flutter0;
      const y1 = this.coneBaseY + flutter1;
      const hw0 = this.segmentWidth[i] * 0.5;
      const hw1 = this.segmentWidth[i + 1] * 0.5;

      // Top edge
      pos.setXYZ(vi++, x0, y0 - hw0, 0);
      pos.setXYZ(vi++, x1, y1 - hw1, 0);
      // Bottom edge
      pos.setXYZ(vi++, x0, y0 + hw0, 0);
      pos.setXYZ(vi++, x1, y1 + hw1, 0);
      // Left connector
      pos.setXYZ(vi++, x0, y0 - hw0, 0);
      pos.setXYZ(vi++, x0, y0 + hw0, 0);
      // Right connector
      pos.setXYZ(vi++, x1, y1 - hw1, 0);
      pos.setXYZ(vi++, x1, y1 + hw1, 0);
    }

    pos.needsUpdate = true;
    this.cone.geometry.setDrawRange(0, vi);

    (this.pole.material as THREE.LineBasicMaterial).opacity = opacity * 0.5;
    (this.cone.material as THREE.LineBasicMaterial).opacity = opacity * 0.8;
  }
}
