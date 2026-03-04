import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Spinning vinyl record — concentric groove circles rotating slowly,
 * a stationary tonearm, and a center label area.
 */
export class VinylSpinElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'vinyl-spin',
    meta: {
      shape: 'radial',
      roles: ['decorative'],
      moods: ['ambient'],
      sizes: ['needs-medium', 'needs-large'],
    },
  };

  private grooveGroup!: THREE.Group;
  private tonearm!: THREE.LineSegments;
  private label!: THREE.Mesh;
  private outerRing!: THREE.Line;
  private spinSpeed: number = 0.3;
  private grooveOpacities: number[] = [];
  private grooveLines: THREE.Line[] = [];

  private cx: number = 0;
  private cy: number = 0;

  build(): void {
    const { x, y, w, h } = this.px;
    this.cx = x + w / 2;
    this.cy = y + h / 2;
    const maxR = Math.min(w, h) / 2 * 0.88;
    this.spinSpeed = this.rng.float(0.2, 0.5);

    this.grooveGroup = new THREE.Group();
    this.grooveGroup.position.set(this.cx, this.cy, 0);
    this.group.add(this.grooveGroup);

    // Concentric groove rings (drawn relative to grooveGroup center at 0,0)
    const grooveCount = this.rng.int(6, 12);
    const labelRadius = maxR * 0.2;

    for (let i = 0; i < grooveCount; i++) {
      const t = (i + 1) / (grooveCount + 1);
      const r = labelRadius + (maxR - labelRadius) * t;
      const segments = 64;
      const positions = new Float32Array((segments + 1) * 3);
      for (let s = 0; s <= segments; s++) {
        const a = (s / segments) * Math.PI * 2;
        positions[s * 3 + 0] = Math.cos(a) * r;
        positions[s * 3 + 1] = Math.sin(a) * r;
        positions[s * 3 + 2] = 0;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const grooveOpacity = 0.15 + this.rng.float(0, 0.25);
      this.grooveOpacities.push(grooveOpacity);
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
        color: this.palette.dim,
        transparent: true,
        opacity: 0,
      }));
      this.grooveLines.push(line);
      this.grooveGroup.add(line);
    }

    // Outer ring (edge of record)
    const outerSegments = 64;
    const outerPositions = new Float32Array((outerSegments + 1) * 3);
    for (let s = 0; s <= outerSegments; s++) {
      const a = (s / outerSegments) * Math.PI * 2;
      outerPositions[s * 3 + 0] = Math.cos(a) * maxR;
      outerPositions[s * 3 + 1] = Math.sin(a) * maxR;
      outerPositions[s * 3 + 2] = 0;
    }
    const outerGeo = new THREE.BufferGeometry();
    outerGeo.setAttribute('position', new THREE.BufferAttribute(outerPositions, 3));
    this.outerRing = new THREE.Line(outerGeo, new THREE.LineBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
    }));
    this.grooveGroup.add(this.outerRing);

    // Center label (filled circle)
    const labelGeo = new THREE.CircleGeometry(labelRadius, 24);
    this.label = new THREE.Mesh(labelGeo, new THREE.MeshBasicMaterial({
      color: this.palette.secondary,
      transparent: true,
      opacity: 0,
    }));
    this.label.position.z = 1;
    this.grooveGroup.add(this.label);

    // Tonearm — stationary, positioned at upper-right of the record
    // A short radial line from edge inward, angled
    const armStartX = this.cx + maxR * 0.85;
    const armStartY = this.cy + maxR * 0.3;
    const armEndX = this.cx + maxR * 0.4;
    const armEndY = this.cy + maxR * 0.05;
    // Pivot at top
    const pivotX = this.cx + maxR * 0.95;
    const pivotY = this.cy + maxR * 0.5;

    const armVerts = new Float32Array([
      pivotX, pivotY, 2,
      armStartX, armStartY, 2,
      armStartX, armStartY, 2,
      armEndX, armEndY, 2,
    ]);
    const armGeo = new THREE.BufferGeometry();
    armGeo.setAttribute('position', new THREE.BufferAttribute(armVerts, 3));
    this.tonearm = new THREE.LineSegments(armGeo, new THREE.LineBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.tonearm);
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);

    // Rotate grooves
    this.grooveGroup.rotation.z += this.spinSpeed * dt;

    // Update groove opacities
    for (let i = 0; i < this.grooveLines.length; i++) {
      const mat = this.grooveLines[i].material as THREE.LineBasicMaterial;
      mat.opacity = opacity * this.grooveOpacities[i];
    }

    // Outer ring
    (this.outerRing.material as THREE.LineBasicMaterial).opacity = opacity * 0.5;

    // Label
    (this.label.material as THREE.MeshBasicMaterial).opacity = opacity * 0.3;

    // Tonearm
    (this.tonearm.material as THREE.LineBasicMaterial).opacity = opacity * 0.7;
  }
}
