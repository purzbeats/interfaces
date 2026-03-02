import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Sinusoidal orbit ground track over lat/lon grid.
 * Grid LineSegments + sinusoidal Line path, dot moves along track leaving fading trail.
 */
export class SatelliteTrackElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'satellite-track',
    meta: { shape: 'rectangular', roles: ['scanner', 'data-display'], moods: ['tactical'], sizes: ['needs-medium', 'needs-large'] },
  };
  private gridLines!: THREE.LineSegments;
  private trackLine!: THREE.Line;
  private satDot!: THREE.Points;
  private borderLines!: THREE.LineSegments;
  private numPoints: number = 0;
  private satPosition: number = 0;
  private satSpeed: number = 0;
  private inclination: number = 0;
  private frequency: number = 0;
  build(): void {
    this.glitchAmount = 5;
    const { x, y, w, h } = this.px;
    this.numPoints = 200;
    this.satSpeed = this.rng.float(15, 40);
    this.inclination = this.rng.float(0.3, 0.45);
    this.frequency = this.rng.float(2, 4);

    // Lat/lon grid
    const gridVerts: number[] = [];
    for (let i = 0; i <= 12; i++) {
      const gx = x + w * (i / 12);
      gridVerts.push(gx, y, 0, gx, y + h, 0);
    }
    for (let i = 0; i <= 6; i++) {
      const gy = y + h * (i / 6);
      gridVerts.push(x, gy, 0, x + w, gy, 0);
    }
    const gridGeo = new THREE.BufferGeometry();
    gridGeo.setAttribute('position', new THREE.Float32BufferAttribute(gridVerts, 3));
    this.gridLines = new THREE.LineSegments(gridGeo, new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.gridLines);

    // Track line (sinusoidal)
    const trackPos = new Float32Array(this.numPoints * 3);
    const trackGeo = new THREE.BufferGeometry();
    trackGeo.setAttribute('position', new THREE.BufferAttribute(trackPos, 3));
    this.trackLine = new THREE.Line(trackGeo, new THREE.LineBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.trackLine);

    // Satellite dot
    const dotGeo = new THREE.BufferGeometry();
    dotGeo.setAttribute('position', new THREE.Float32BufferAttribute([x, y + h / 2, 2], 3));
    this.satDot = new THREE.Points(dotGeo, new THREE.PointsMaterial({
      color: this.palette.secondary,
      size: Math.max(5, Math.min(w, h) * 0.015),
      transparent: true,
      opacity: 0,
      sizeAttenuation: false,
    }));
    this.group.add(this.satDot);

    // Border
    const bv = new Float32Array([
      x, y, 0, x + w, y, 0,
      x + w, y, 0, x + w, y + h, 0,
      x + w, y + h, 0, x, y + h, 0,
      x, y + h, 0, x, y, 0,
    ]);
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.BufferAttribute(bv, 3));
    this.borderLines = new THREE.LineSegments(bg, new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.borderLines);
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    const { x, y, w, h } = this.px;

    this.satPosition += this.satSpeed * dt;

    // Update track — sinusoidal path
    const pos = this.trackLine.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < this.numPoints; i++) {
      const t = i / (this.numPoints - 1);
      const px = x + w * t;
      const py = y + h / 2 + Math.sin(t * this.frequency * Math.PI * 2 + time * 0.3) * h * this.inclination;
      pos.setXYZ(i, px, py, 1);
    }
    pos.needsUpdate = true;

    // Update satellite position on track
    const satT = ((this.satPosition / this.numPoints) % 1);
    const satX = x + w * satT;
    const satY = y + h / 2 + Math.sin(satT * this.frequency * Math.PI * 2 + time * 0.3) * h * this.inclination;
    const dotPos = this.satDot.geometry.getAttribute('position') as THREE.BufferAttribute;
    dotPos.setXY(0, satX, satY);
    dotPos.needsUpdate = true;

    (this.trackLine.material as THREE.LineBasicMaterial).opacity = opacity * 0.5;
    (this.satDot.material as THREE.PointsMaterial).opacity = opacity;
    (this.gridLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.15;
    (this.borderLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.3;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      this.frequency = this.rng.float(1, 6);
    }
    if (action === 'alert') {
      (this.satDot.material as THREE.PointsMaterial).color.copy(this.palette.alert);
    }
  }
}
