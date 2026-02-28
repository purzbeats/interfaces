import * as THREE from 'three';
import { BaseElement } from './base-element';
import { stateOpacity, pulse, glitchOffset } from '../animation/fx';

/**
 * Triangular scanner — rotating triangle with scanning line,
 * data readout segments along the edges. Very angular, very EVA.
 */
export class TriScannerElement extends BaseElement {
  private triangle!: THREE.LineSegments;
  private scanLine!: THREE.Line;
  private edgeTicks: THREE.LineSegments[] = [];
  private innerTri!: THREE.LineSegments;
  private scanAngle: number = 0;
  private scanSpeed: number = 0;
  private outerRotation: number = 0;
  private innerRotSpeed: number = 0;
  private pulseTimer: number = 0;
  private glitchTimer: number = 0;

  build(): void {
    const { x, y, w, h } = this.px;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const r = Math.min(w, h) / 2 * 0.85;
    this.scanSpeed = this.rng.float(1.5, 4);
    this.innerRotSpeed = this.rng.float(-2, 2);

    // Equilateral triangle
    const triVerts: number[] = [];
    const pts: [number, number][] = [];
    for (let i = 0; i < 3; i++) {
      const a1 = (i / 3) * Math.PI * 2 - Math.PI / 2;
      const a2 = ((i + 1) / 3) * Math.PI * 2 - Math.PI / 2;
      const x1 = cx + Math.cos(a1) * r, y1 = cy + Math.sin(a1) * r;
      const x2 = cx + Math.cos(a2) * r, y2 = cy + Math.sin(a2) * r;
      triVerts.push(x1, y1, 0, x2, y2, 0);
      pts.push([x1, y1]);
    }
    const triGeo = new THREE.BufferGeometry();
    triGeo.setAttribute('position', new THREE.Float32BufferAttribute(triVerts, 3));
    this.triangle = new THREE.LineSegments(triGeo, new THREE.LineBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.triangle);

    // Tick marks along each edge
    for (let edge = 0; edge < 3; edge++) {
      const [x1, y1] = pts[edge];
      const [x2, y2] = pts[(edge + 1) % 3];
      const tickCount = this.rng.int(5, 12);
      const tickVerts: number[] = [];
      for (let t = 0; t <= tickCount; t++) {
        const frac = t / tickCount;
        const px = x1 + (x2 - x1) * frac;
        const py = y1 + (y2 - y1) * frac;
        // Tick perpendicular to edge (inward)
        const dx = -(y2 - y1);
        const dy = (x2 - x1);
        const len = Math.sqrt(dx * dx + dy * dy);
        const tickLen = (t % 3 === 0) ? r * 0.06 : r * 0.03;
        const nx = dx / len * tickLen;
        const ny = dy / len * tickLen;
        tickVerts.push(px, py, 1, px + nx, py + ny, 1);
      }
      const tGeo = new THREE.BufferGeometry();
      tGeo.setAttribute('position', new THREE.Float32BufferAttribute(tickVerts, 3));
      const ticks = new THREE.LineSegments(tGeo, new THREE.LineBasicMaterial({
        color: this.palette.dim,
        transparent: true,
        opacity: 0,
      }));
      this.edgeTicks.push(ticks);
      this.group.add(ticks);
    }

    // Inner triangle (smaller, counter-rotates)
    const ir = r * 0.4;
    const innerVerts: number[] = [];
    for (let i = 0; i < 3; i++) {
      const a1 = (i / 3) * Math.PI * 2 - Math.PI / 2;
      const a2 = ((i + 1) / 3) * Math.PI * 2 - Math.PI / 2;
      innerVerts.push(
        cx + Math.cos(a1) * ir, cy + Math.sin(a1) * ir, 1,
        cx + Math.cos(a2) * ir, cy + Math.sin(a2) * ir, 1,
      );
    }
    const innerGeo = new THREE.BufferGeometry();
    innerGeo.setAttribute('position', new THREE.Float32BufferAttribute(innerVerts, 3));
    this.innerTri = new THREE.LineSegments(innerGeo, new THREE.LineBasicMaterial({
      color: this.palette.secondary,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.innerTri);

    // Scan line from center
    const scanGeo = new THREE.BufferGeometry();
    scanGeo.setAttribute('position', new THREE.Float32BufferAttribute([
      cx, cy, 2, cx + r, cy, 2,
    ], 3));
    this.scanLine = new THREE.Line(scanGeo, new THREE.LineBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.scanLine);
  }

  update(dt: number, time: number): void {
    let opacity = stateOpacity(this.stateMachine.state, this.stateMachine.progress);
    const { x, y, w, h } = this.px;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const r = Math.min(w, h) / 2 * 0.85;

    if (this.pulseTimer > 0) {
      this.pulseTimer -= dt;
      opacity *= pulse(this.pulseTimer);
    }

    const gx = this.glitchTimer > 0 ? glitchOffset(this.glitchTimer, 5) : 0;
    if (this.glitchTimer > 0) this.glitchTimer -= dt;

    // Slow outer rotation
    this.outerRotation += dt * 0.15;
    this.triangle.rotation.z = this.outerRotation;
    (this.triangle.material as THREE.LineBasicMaterial).opacity = opacity * 0.7;

    // Edge ticks follow outer rotation
    for (const t of this.edgeTicks) {
      t.rotation.z = this.outerRotation;
      (t.material as THREE.LineBasicMaterial).opacity = opacity * 0.35;
    }

    // Inner triangle counter-rotates
    this.innerTri.rotation.z += this.innerRotSpeed * dt;
    (this.innerTri.material as THREE.LineBasicMaterial).opacity = opacity * 0.4;

    // Scan line sweeps
    this.scanAngle += dt * this.scanSpeed;
    const positions = this.scanLine.geometry.getAttribute('position') as THREE.BufferAttribute;
    positions.setXYZ(0, cx + gx, cy, 2);
    positions.setXYZ(1, cx + Math.cos(this.scanAngle) * r + gx, cy + Math.sin(this.scanAngle) * r, 2);
    positions.needsUpdate = true;
    (this.scanLine.material as THREE.LineBasicMaterial).opacity = opacity * 0.6;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'pulse') this.pulseTimer = 0.5;
    if (action === 'glitch') {
      this.glitchTimer = 0.5;
      this.scanSpeed = this.rng.float(5, 15);
    }
    if (action === 'alert') {
      this.pulseTimer = 1.5;
      (this.triangle.material as THREE.LineBasicMaterial).color.copy(this.palette.alert);
    }
  }
}
