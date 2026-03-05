import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Minimal surface wireframe (catenoid/helicoid family).
 * Parametric surface that can morph between the two.
 */
export class MinimalSurfaceElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'minimal-surface',
    meta: { shape: 'radial', roles: ['decorative', 'data-display'], moods: ['ambient', 'diagnostic'], bandAffinity: 'bass', sizes: ['needs-medium', 'needs-large'] },
  };

  private lineMesh!: THREE.LineSegments;
  private uSteps = 0;
  private vSteps = 0;
  private cx = 0;
  private cy = 0;
  private scaleR = 0;
  private morphParam = 0;      // 0 = catenoid, pi/2 = helicoid
  private morphTarget = 0;
  private morphSpeed = 0;
  private rotX = 0;
  private rotY = 0;
  private rotSpeedX = 0;
  private rotSpeedY = 0;

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;
    this.cx = x + w / 2;
    this.cy = y + h / 2;
    this.scaleR = Math.min(w, h) * 0.35;

    const variant = this.rng.int(0, 3);
    const presets = [
      { uS: 30, vS: 20, morphSpd: 0.3, rotSX: 0.15, rotSY: 0.1 },
      { uS: 40, vS: 25, morphSpd: 0.2, rotSX: 0.1, rotSY: 0.2 },
      { uS: 20, vS: 15, morphSpd: 0.5, rotSX: 0.2, rotSY: 0.05 },
      { uS: 35, vS: 30, morphSpd: 0.15, rotSX: 0.08, rotSY: 0.15 },
    ];
    const p = presets[variant];
    this.uSteps = p.uS;
    this.vSteps = p.vS;
    this.morphSpeed = p.morphSpd;
    this.rotSpeedX = p.rotSX;
    this.rotSpeedY = p.rotSY;

    // Wireframe: grid lines along u and v
    const uLines = (this.uSteps + 1) * this.vSteps * 2 * 3;
    const vLines = this.uSteps * (this.vSteps + 1) * 2 * 3;
    const totalFloats = uLines + vLines;
    const positions = new Float32Array(totalFloats);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.lineMesh = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
      color: this.palette.primary, transparent: true, opacity: 0,
    }));
    this.group.add(this.lineMesh);
  }

  // The Bonnet transformation: parameterizes catenoid-helicoid family
  // x = cos(theta)*cosh(v)*cos(u) + sin(theta)*sinh(v)*sin(u)
  // y = -cos(theta)*cosh(v)*sin(u) + sin(theta)*sinh(v)*cos(u)
  // z = cos(theta)*v + sin(theta)*u
  private surfacePoint(u: number, v: number, theta: number): [number, number, number] {
    const ct = Math.cos(theta);
    const st = Math.sin(theta);
    const cu = Math.cos(u);
    const su = Math.sin(u);
    const chv = Math.cosh(v);
    const shv = Math.sinh(v);
    const sx = ct * chv * cu + st * shv * su;
    const sy = -ct * chv * su + st * shv * cu;
    const sz = ct * v + st * u;
    return [sx, sy, sz];
  }

  private project3D(px: number, py: number, pz: number): [number, number] {
    // Simple 3D rotation then orthographic projection
    const cosX = Math.cos(this.rotX), sinX = Math.sin(this.rotX);
    const cosY = Math.cos(this.rotY), sinY = Math.sin(this.rotY);
    // Rotate around X
    const y1 = py * cosX - pz * sinX;
    const z1 = py * sinX + pz * cosX;
    // Rotate around Y
    const x2 = px * cosY + z1 * sinY;
    // Orthographic projection
    return [x2, y1];
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);

    this.rotX += this.rotSpeedX * dt;
    this.rotY += this.rotSpeedY * dt;

    // Morph between catenoid and helicoid
    this.morphParam += (this.morphTarget - this.morphParam) * dt * this.morphSpeed * 2;
    if (Math.abs(this.morphParam - this.morphTarget) < 0.01) {
      this.morphTarget = this.morphTarget < Math.PI / 4 ? Math.PI / 2 : 0;
    }

    const pos = this.lineMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const uRange = Math.PI;
    const vRange = 1.2;
    let idx = 0;
    const scale = this.scaleR / 3;

    // U-direction lines
    for (let ui = 0; ui <= this.uSteps; ui++) {
      const u = -uRange + (ui / this.uSteps) * uRange * 2;
      for (let vi = 0; vi < this.vSteps; vi++) {
        const v0 = -vRange + (vi / this.vSteps) * vRange * 2;
        const v1 = -vRange + ((vi + 1) / this.vSteps) * vRange * 2;
        const [x0, y0, z0] = this.surfacePoint(u, v0, this.morphParam);
        const [x1, y1, z1] = this.surfacePoint(u, v1, this.morphParam);
        const [sx0, sy0] = this.project3D(x0, y0, z0);
        const [sx1, sy1] = this.project3D(x1, y1, z1);
        pos.setXYZ(idx++, this.cx + sx0 * scale, this.cy + sy0 * scale, 0);
        pos.setXYZ(idx++, this.cx + sx1 * scale, this.cy + sy1 * scale, 0);
      }
    }

    // V-direction lines
    for (let vi = 0; vi <= this.vSteps; vi++) {
      const v = -vRange + (vi / this.vSteps) * vRange * 2;
      for (let ui = 0; ui < this.uSteps; ui++) {
        const u0 = -uRange + (ui / this.uSteps) * uRange * 2;
        const u1 = -uRange + ((ui + 1) / this.uSteps) * uRange * 2;
        const [x0, y0, z0] = this.surfacePoint(u0, v, this.morphParam);
        const [x1, y1, z1] = this.surfacePoint(u1, v, this.morphParam);
        const [sx0, sy0] = this.project3D(x0, y0, z0);
        const [sx1, sy1] = this.project3D(x1, y1, z1);
        pos.setXYZ(idx++, this.cx + sx0 * scale, this.cy + sy0 * scale, 0);
        pos.setXYZ(idx++, this.cx + sx1 * scale, this.cy + sy1 * scale, 0);
      }
    }

    pos.needsUpdate = true;
    (this.lineMesh.material as THREE.LineBasicMaterial).opacity = opacity * 0.6;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      this.morphTarget = this.rng.float(0, Math.PI / 2);
      this.rotSpeedX = this.rng.float(-0.5, 0.5);
      this.rotSpeedY = this.rng.float(-0.5, 0.5);
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level >= 2) {
      this.rotSpeedX = 0.15 * (1 + level * 0.3);
      this.rotSpeedY = 0.1 * (1 + level * 0.3);
    }
  }
}
