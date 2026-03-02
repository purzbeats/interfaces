import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Cross-shaped oscilloscope — two perpendicular waveforms (X and Y axis)
 * creating Lissajous-like patterns in the center. Very technical, very EVA.
 */
export class CrossScopeElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'cross-scope',
    meta: { shape: 'radial', roles: ['data-display'], moods: ['diagnostic'], sizes: ['needs-medium'] },
  };
  private hLine!: THREE.Line;
  private vLine!: THREE.Line;
  private crosshair!: THREE.LineSegments;
  private lissajous!: THREE.Line;
  private hFreq: number = 0;
  private vFreq: number = 0;
  private lissPoints: number = 0;

  build(): void {
    const { x, y, w, h } = this.px;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const numPoints = 128;
    this.hFreq = this.rng.float(1.5, 5);
    this.vFreq = this.rng.float(1.5, 5);
    this.lissPoints = this.rng.int(128, 300);

    // Horizontal waveform (along bottom half)
    const hPos = new Float32Array(numPoints * 3);
    const hGeo = new THREE.BufferGeometry();
    hGeo.setAttribute('position', new THREE.BufferAttribute(hPos, 3));
    this.hLine = new THREE.Line(hGeo, new THREE.LineBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.hLine);

    // Vertical waveform (along left side)
    const vPos = new Float32Array(numPoints * 3);
    const vGeo = new THREE.BufferGeometry();
    vGeo.setAttribute('position', new THREE.BufferAttribute(vPos, 3));
    this.vLine = new THREE.Line(vGeo, new THREE.LineBasicMaterial({
      color: this.palette.secondary,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.vLine);

    // Center Lissajous figure
    const lPos = new Float32Array(this.lissPoints * 3);
    const lGeo = new THREE.BufferGeometry();
    lGeo.setAttribute('position', new THREE.BufferAttribute(lPos, 3));
    this.lissajous = new THREE.Line(lGeo, new THREE.LineBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.lissajous);

    // Thin crosshair
    const chVerts = new Float32Array([
      x, cy, 0, x + w, cy, 0,
      cx, y, 0, cx, y + h, 0,
    ]);
    const chGeo = new THREE.BufferGeometry();
    chGeo.setAttribute('position', new THREE.BufferAttribute(chVerts, 3));
    this.crosshair = new THREE.LineSegments(chGeo, new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.crosshair);
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    const { x, y, w, h } = this.px;
    const cx = x + w / 2;
    const cy = y + h / 2;

    // Horizontal waveform
    const hPos = this.hLine.geometry.getAttribute('position') as THREE.BufferAttribute;
    const numH = hPos.count;
    for (let i = 0; i < numH; i++) {
      const t = i / (numH - 1);
      const px = x + w * t;
      const py = y + h * 0.85 + Math.sin(t * this.hFreq * Math.PI * 2 + time * 3) * h * 0.1;
      hPos.setXYZ(i, px, py, 1);
    }
    hPos.needsUpdate = true;
    (this.hLine.material as THREE.LineBasicMaterial).opacity = opacity * 0.6;

    // Vertical waveform
    const vPos = this.vLine.geometry.getAttribute('position') as THREE.BufferAttribute;
    const numV = vPos.count;
    for (let i = 0; i < numV; i++) {
      const t = i / (numV - 1);
      const py = y + h * t;
      const px = x + w * 0.15 + Math.sin(t * this.vFreq * Math.PI * 2 + time * 2.5) * w * 0.1;
      vPos.setXYZ(i, px, py, 1);
    }
    vPos.needsUpdate = true;
    (this.vLine.material as THREE.LineBasicMaterial).opacity = opacity * 0.6;

    // Lissajous figure in center region
    const lPos = this.lissajous.geometry.getAttribute('position') as THREE.BufferAttribute;
    const regionW = w * 0.5;
    const regionH = h * 0.5;
    for (let i = 0; i < this.lissPoints; i++) {
      const t = i / this.lissPoints;
      const a = t * Math.PI * 2;
      const lx = cx + Math.sin(a * this.hFreq + time * 1.3) * regionW * 0.4;
      const ly = cy + Math.sin(a * this.vFreq + time * 0.9 + Math.PI * 0.25) * regionH * 0.4;
      lPos.setXYZ(i, lx, ly, 2);
    }
    lPos.needsUpdate = true;
    (this.lissajous.material as THREE.LineBasicMaterial).opacity = opacity * 0.45;

    (this.crosshair.material as THREE.LineBasicMaterial).opacity = opacity * 0.15;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      this.hFreq = this.rng.float(1, 8);
      this.vFreq = this.rng.float(1, 8);
    }
    if (action === 'alert') {
      this.pulseTimer = 1.5;
      (this.lissajous.material as THREE.LineBasicMaterial).color.copy(this.palette.alert);
    }
  }
}
