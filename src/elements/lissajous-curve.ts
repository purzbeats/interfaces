import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Lissajous curve oscilloscope display.
 * Parametric x=sin(at+d), y=sin(bt) with slowly drifting frequency ratios
 * creates endlessly morphing figures on an oscilloscope-style display.
 */
export class LissajousCurveElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'lissajous-curve',
    meta: { shape: 'radial', roles: ['data-display', 'decorative'], moods: ['diagnostic', 'ambient'], bandAffinity: 'mid', sizes: ['works-small', 'needs-medium', 'needs-large'] },
  };

  private a = 3;
  private b = 2;
  private delta = Math.PI / 2;
  private targetA = 3;
  private targetB = 2;
  private driftTimer = 0;

  private trailLen = 500;
  private trailMesh!: THREE.Line;
  private trailMat!: THREE.LineBasicMaterial;
  private dotMesh!: THREE.Points;
  private crosshair!: THREE.LineSegments;
  private crosshairMat!: THREE.LineBasicMaterial;

  private cx = 0;
  private cy = 0;
  private scaleX = 0;
  private scaleY = 0;

  build(): void {
    const variant = this.rng.int(0, 3);
    const presets = [
      { a: 3, b: 2, trail: 500, delta: Math.PI / 2 },
      { a: 5, b: 4, trail: 800, delta: Math.PI / 4 },
      { a: 2, b: 3, trail: 300, delta: Math.PI / 3 },
      { a: 7, b: 5, trail: 1000, delta: Math.PI / 6 },
    ];
    const p = presets[variant];
    this.glitchAmount = 4;

    const { x, y, w, h } = this.px;
    this.cx = x + w / 2;
    this.cy = y + h / 2;
    this.scaleX = w * 0.4;
    this.scaleY = h * 0.4;
    this.a = p.a + this.rng.float(-0.1, 0.1);
    this.b = p.b + this.rng.float(-0.1, 0.1);
    this.delta = p.delta;
    this.targetA = this.a;
    this.targetB = this.b;
    this.trailLen = p.trail;

    const pts = new Float32Array(this.trailLen * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pts, 3));
    this.trailMat = new THREE.LineBasicMaterial({ color: this.palette.secondary, transparent: true, opacity: 0 });
    this.trailMesh = new THREE.Line(geo, this.trailMat);
    this.group.add(this.trailMesh);

    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3));
    this.dotMesh = new THREE.Points(dg, new THREE.PointsMaterial({
      color: this.palette.secondary, transparent: true, opacity: 0, size: 4, sizeAttenuation: false,
    }));
    this.group.add(this.dotMesh);

    // Crosshair/graticule
    const chLen = Math.min(w, h) * 0.44;
    const cv = new Float32Array([
      this.cx - chLen, this.cy, -0.5, this.cx + chLen, this.cy, -0.5,
      this.cx, this.cy - chLen, -0.5, this.cx, this.cy + chLen, -0.5,
    ]);
    const cg = new THREE.BufferGeometry();
    cg.setAttribute('position', new THREE.BufferAttribute(cv, 3));
    this.crosshairMat = new THREE.LineBasicMaterial({ color: this.palette.dim, transparent: true, opacity: 0 });
    this.crosshair = new THREE.LineSegments(cg, this.crosshairMat);
    this.group.add(this.crosshair);
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);

    // Drift parameters
    this.driftTimer -= dt;
    if (this.driftTimer <= 0) {
      this.driftTimer = this.rng.float(4, 10);
      this.targetA = this.rng.int(1, 7) + this.rng.float(-0.05, 0.05);
      this.targetB = this.rng.int(1, 7) + this.rng.float(-0.05, 0.05);
    }
    this.a += (this.targetA - this.a) * 0.3 * dt;
    this.b += (this.targetB - this.b) * 0.3 * dt;
    this.delta += dt * 0.1;

    // Compute trail
    const pos = this.trailMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < this.trailLen; i++) {
      const t = time + (i / this.trailLen) * Math.PI * 2;
      const lx = this.cx + Math.sin(this.a * t + this.delta) * this.scaleX;
      const ly = this.cy + Math.sin(this.b * t) * this.scaleY;
      pos.setXYZ(i, lx, ly, 0);
    }
    pos.needsUpdate = true;

    // Current dot
    const dx = this.cx + Math.sin(this.a * time + this.delta) * this.scaleX;
    const dy = this.cy + Math.sin(this.b * time) * this.scaleY;
    const dpos = this.dotMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    dpos.setXYZ(0, dx, dy, 1);
    dpos.needsUpdate = true;

    this.trailMat.opacity = opacity * 0.7;
    (this.dotMesh.material as THREE.PointsMaterial).opacity = opacity;
    this.crosshairMat.opacity = opacity * 0.1;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      this.a += this.rng.float(-2, 2);
      this.b += this.rng.float(-2, 2);
    }
    if (action === 'alert') {
      this.targetA = this.rng.int(1, 9);
      this.targetB = this.rng.int(1, 9);
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level >= 4) {
      this.targetA = this.rng.int(3, 11);
      this.targetB = this.rng.int(3, 11);
    }
  }
}
