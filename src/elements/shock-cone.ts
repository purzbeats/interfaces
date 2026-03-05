import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * A source moving faster than the wave speed creating a Mach cone.
 * Circular wavefronts emanate from past positions of the source.
 * The cone angle depends on the Mach number: sin(theta) = 1/M.
 */
export class ShockConeElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'shock-cone',
    meta: { shape: 'rectangular', roles: ['data-display', 'decorative'], moods: ['tactical', 'diagnostic'], bandAffinity: 'sub', sizes: ['needs-medium', 'needs-large'] },
  };

  private machNumber = 2;
  private waveSpeed = 0;
  private sourceSpeed = 0;
  private waveCount = 16;
  private circSegs = 48;
  private sourceX = 0;
  private sourceDir = 1;

  private waveEmitX!: Float32Array;  // x where wave was emitted
  private waveAge!: Float32Array;    // age of each wave in seconds
  private waveActive!: Uint8Array;

  private waveMesh!: THREE.Line;
  private coneMesh!: THREE.LineSegments;
  private sourcePoint!: THREE.Points;
  private borderLines!: THREE.LineSegments;
  private emitAccum = 0;
  private emitInterval = 0;

  build(): void {
    this.glitchAmount = 4;
    const variant = this.rng.int(0, 3);
    const presets = [
      { mach: 2.0, waves: 16, waveSpd: 0.15 },
      { mach: 3.0, waves: 24, waveSpd: 0.12 },
      { mach: 1.5, waves: 12, waveSpd: 0.2 },
      { mach: 2.5, waves: 20, waveSpd: 0.1 },
    ];
    const p = presets[variant];

    const { x, y, w, h } = this.px;
    this.machNumber = p.mach;
    this.waveCount = p.waves;
    this.waveSpeed = Math.min(w, h) * p.waveSpd;
    this.sourceSpeed = this.waveSpeed * this.machNumber;
    this.emitInterval = (Math.min(w, h) * 0.08) / this.sourceSpeed;
    this.sourceX = x + w * 0.1;
    this.sourceDir = 1;

    this.waveEmitX = new Float32Array(this.waveCount);
    this.waveAge = new Float32Array(this.waveCount);
    this.waveActive = new Uint8Array(this.waveCount);

    // Wave circles: each wave = circSegs+1 vertices
    const totalVerts = this.waveCount * (this.circSegs + 1);
    const wavePositions = new Float32Array(totalVerts * 3);
    // Fill with a single collapsed point to avoid stray lines
    for (let i = 0; i < totalVerts; i++) {
      wavePositions[i * 3] = x;
      wavePositions[i * 3 + 1] = y + h / 2;
      wavePositions[i * 3 + 2] = 0;
    }
    const waveGeo = new THREE.BufferGeometry();
    waveGeo.setAttribute('position', new THREE.BufferAttribute(wavePositions, 3));
    this.waveMesh = new THREE.Line(waveGeo, new THREE.LineBasicMaterial({
      color: this.palette.secondary, transparent: true, opacity: 0,
    }));
    this.group.add(this.waveMesh);

    // Mach cone lines (2 lines = 4 vertices = 2 segments)
    const conePositions = new Float32Array(4 * 3);
    const coneGeo = new THREE.BufferGeometry();
    coneGeo.setAttribute('position', new THREE.BufferAttribute(conePositions, 3));
    this.coneMesh = new THREE.LineSegments(coneGeo, new THREE.LineBasicMaterial({
      color: this.palette.primary, transparent: true, opacity: 0,
    }));
    this.group.add(this.coneMesh);

    // Source point
    const srcPositions = new Float32Array(3);
    const srcGeo = new THREE.BufferGeometry();
    srcGeo.setAttribute('position', new THREE.BufferAttribute(srcPositions, 3));
    this.sourcePoint = new THREE.Points(srcGeo, new THREE.PointsMaterial({
      color: this.palette.primary, transparent: true, opacity: 0,
      size: Math.max(1, Math.min(w, h) * 0.02), sizeAttenuation: false,
    }));
    this.group.add(this.sourcePoint);

    // Border
    const bv = [x, y, 0, x + w, y, 0, x + w, y, 0, x + w, y + h, 0,
      x + w, y + h, 0, x, y + h, 0, x, y + h, 0, x, y, 0];
    const borderGeo = new THREE.BufferGeometry();
    borderGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(bv), 3));
    this.borderLines = new THREE.LineSegments(borderGeo, new THREE.LineBasicMaterial({
      color: this.palette.dim, transparent: true, opacity: 0,
    }));
    this.group.add(this.borderLines);
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);
    const { x, y, w, h } = this.px;
    const cy = y + h / 2;
    const cdt = Math.min(dt, 0.033);

    // Move source
    this.sourceX += this.sourceSpeed * this.sourceDir * cdt;
    if (this.sourceX > x + w * 0.9) { this.sourceDir = -1; }
    if (this.sourceX < x + w * 0.1) { this.sourceDir = 1; }

    // Emit new waves periodically
    this.emitAccum += cdt;
    if (this.emitAccum >= this.emitInterval) {
      this.emitAccum = 0;
      // Find inactive wave slot
      for (let i = 0; i < this.waveCount; i++) {
        if (!this.waveActive[i]) {
          this.waveActive[i] = 1;
          this.waveEmitX[i] = this.sourceX;
          this.waveAge[i] = 0;
          break;
        }
      }
    }

    // Update waves
    const wavePos = this.waveMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const maxRadius = Math.max(w, h) * 0.6;

    for (let i = 0; i < this.waveCount; i++) {
      const baseIdx = i * (this.circSegs + 1);
      if (this.waveActive[i]) {
        this.waveAge[i] += cdt;
        const radius = this.waveAge[i] * this.waveSpeed;
        if (radius > maxRadius) {
          this.waveActive[i] = 0;
          // Collapse to single point
          for (let s = 0; s <= this.circSegs; s++) {
            wavePos.setXYZ(baseIdx + s, this.waveEmitX[i], cy, 0);
          }
        } else {
          for (let s = 0; s <= this.circSegs; s++) {
            const a = (s / this.circSegs) * Math.PI * 2;
            const wx = Math.max(x, Math.min(x + w, this.waveEmitX[i] + Math.cos(a) * radius));
            const wy = Math.max(y, Math.min(y + h, cy + Math.sin(a) * radius));
            wavePos.setXYZ(baseIdx + s, wx, wy, 0);
          }
        }
      } else {
        // Inactive: collapse all points to same spot
        for (let s = 0; s <= this.circSegs; s++) {
          wavePos.setXYZ(baseIdx + s, x, cy, 0);
        }
      }
    }
    wavePos.needsUpdate = true;

    // Update Mach cone lines
    const halfAngle = Math.asin(Math.min(1, 1 / this.machNumber));
    const coneLen = Math.max(w, h) * 0.5;
    const conePos = this.coneMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const dir = this.sourceDir;
    // Two lines from source backward at +/- halfAngle, clamped to tile bounds
    const sx = Math.max(x, Math.min(x + w, this.sourceX));
    const cone1x = Math.max(x, Math.min(x + w, this.sourceX - dir * Math.cos(halfAngle) * coneLen));
    const cone1y = Math.max(y, Math.min(y + h, cy + Math.sin(halfAngle) * coneLen));
    const cone2y = Math.max(y, Math.min(y + h, cy - Math.sin(halfAngle) * coneLen));
    conePos.setXYZ(0, sx, cy, 0.5);
    conePos.setXYZ(1, cone1x, cone1y, 0.5);
    conePos.setXYZ(2, sx, cy, 0.5);
    conePos.setXYZ(3, cone1x, cone2y, 0.5);
    conePos.needsUpdate = true;

    // Update source point
    const srcPos = this.sourcePoint.geometry.getAttribute('position') as THREE.BufferAttribute;
    srcPos.setXYZ(0, Math.max(x, Math.min(x + w, this.sourceX)), cy, 1);
    srcPos.needsUpdate = true;

    (this.waveMesh.material as THREE.LineBasicMaterial).opacity = opacity * 0.4;
    (this.coneMesh.material as THREE.LineBasicMaterial).opacity = opacity * 0.8;
    (this.sourcePoint.material as THREE.PointsMaterial).opacity = opacity;
    (this.borderLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.25;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Clear all waves and reverse direction
      this.waveActive.fill(0);
      this.sourceDir *= -1;
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) { this.machNumber = 2; return; }
    this.machNumber = 2 + level * 0.3;
    this.sourceSpeed = this.waveSpeed * this.machNumber;
  }
}
