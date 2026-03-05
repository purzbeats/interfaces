import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Klein bottle parametric surface wireframe. u,v parameter grid rendered
 * as line strips. Slowly rotating. Self-intersection visible.
 */
export class KleinBottleElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'klein-bottle',
    meta: {
      shape: 'rectangular',
      roles: ['decorative'],
      moods: ['ambient', 'diagnostic'],
      bandAffinity: 'sub',
      sizes: ['needs-medium', 'needs-large'],
    },
  };

  private uLines: THREE.Line[] = [];
  private vLines: THREE.Line[] = [];
  private uCount: number = 20;
  private vCount: number = 20;
  private uRes: number = 40;
  private vRes: number = 40;
  private rotSpeedX: number = 0.15;
  private rotSpeedY: number = 0.1;
  private cx: number = 0;
  private cy: number = 0;
  private scl: number = 1;

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;
    this.cx = x + w / 2;
    this.cy = y + h / 2;
    this.scl = Math.min(w, h) * 0.08;

    const variant = this.rng.int(0, 3);
    const presets = [
      { uCount: 16, vCount: 16, uRes: 40, vRes: 40, rotX: 0.15, rotY: 0.10 },
      { uCount: 24, vCount: 24, uRes: 50, vRes: 50, rotX: 0.08, rotY: 0.12 },
      { uCount: 12, vCount: 12, uRes: 30, vRes: 30, rotX: 0.25, rotY: 0.18 },
      { uCount: 20, vCount: 20, uRes: 60, vRes: 60, rotX: 0.10, rotY: 0.05 },
    ];
    const p = presets[variant];
    this.uCount = p.uCount;
    this.vCount = p.vCount;
    this.uRes = p.uRes;
    this.vRes = p.vRes;
    this.rotSpeedX = p.rotX;
    this.rotSpeedY = p.rotY;

    // Create u-lines (constant u, varying v)
    for (let i = 0; i < this.uCount; i++) {
      const pos = new Float32Array(this.vRes * 3);
      for (let j = 0; j < this.vRes; j++) {
        pos[j * 3] = this.cx;
        pos[j * 3 + 1] = this.cy;
        pos[j * 3 + 2] = 0;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const t = i / (this.uCount - 1);
      const col = new THREE.Color().copy(this.palette.dim).lerp(this.palette.primary, t);
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
        color: col, transparent: true, opacity: 0,
      }));
      this.group.add(line);
      this.uLines.push(line);
    }

    // Create v-lines (constant v, varying u)
    for (let j = 0; j < this.vCount; j++) {
      const pos = new Float32Array(this.uRes * 3);
      for (let i = 0; i < this.uRes; i++) {
        pos[i * 3] = this.cx;
        pos[i * 3 + 1] = this.cy;
        pos[i * 3 + 2] = 0;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const t = j / (this.vCount - 1);
      const col = new THREE.Color().copy(this.palette.dim).lerp(this.palette.secondary, t);
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
        color: col, transparent: true, opacity: 0,
      }));
      this.group.add(line);
      this.vLines.push(line);
    }
  }

  /** Klein bottle parametric surface (figure-8 immersion) */
  private kleinPoint(u: number, v: number): [number, number, number] {
    const cu = Math.cos(u), su = Math.sin(u);
    const cv = Math.cos(v), sv = Math.sin(v);
    const r = 4 * (1 - cu / 2);
    // Figure-8 Klein bottle immersion in 3D
    let xk: number, yk: number, zk: number;
    if (u < Math.PI) {
      xk = 6 * cu * (1 + su) + r * cu * cv;
      yk = 16 * su + r * su * cv;
    } else {
      xk = 6 * cu * (1 + su) + r * Math.cos(v + Math.PI);
      yk = 16 * su;
    }
    zk = r * sv;
    return [xk * 0.08, yk * 0.08, zk * 0.08];
  }

  private rotate3D(
    px: number, py: number, pz: number,
    ax: number, ay: number,
  ): [number, number] {
    // Rotate around X
    let y1 = py * Math.cos(ax) - pz * Math.sin(ax);
    let z1 = py * Math.sin(ax) + pz * Math.cos(ax);
    // Rotate around Y
    let x2 = px * Math.cos(ay) + z1 * Math.sin(ay);
    // Project to 2D (orthographic)
    return [this.cx + x2 * this.scl, this.cy + y1 * this.scl];
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    const ax = time * this.rotSpeedX;
    const ay = time * this.rotSpeedY;

    // Update u-lines
    for (let i = 0; i < this.uCount; i++) {
      const u = (i / this.uCount) * Math.PI * 2;
      const attr = this.uLines[i].geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let j = 0; j < this.vRes; j++) {
        const v = (j / (this.vRes - 1)) * Math.PI * 2;
        const [kx, ky, kz] = this.kleinPoint(u, v);
        const [sx, sy] = this.rotate3D(kx, ky, kz, ax, ay);
        attr.setXYZ(j, sx, sy, 0);
      }
      attr.needsUpdate = true;
      (this.uLines[i].material as THREE.LineBasicMaterial).opacity = opacity * 0.7;
    }

    // Update v-lines
    for (let j = 0; j < this.vCount; j++) {
      const v = (j / this.vCount) * Math.PI * 2;
      const attr = this.vLines[j].geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < this.uRes; i++) {
        const u = (i / (this.uRes - 1)) * Math.PI * 2;
        const [kx, ky, kz] = this.kleinPoint(u, v);
        const [sx, sy] = this.rotate3D(kx, ky, kz, ax, ay);
        attr.setXYZ(i, sx, sy, 0);
      }
      attr.needsUpdate = true;
      (this.vLines[j].material as THREE.LineBasicMaterial).opacity = opacity * 0.55;
    }
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      this.rotSpeedX += this.rng.float(-0.3, 0.3);
      this.rotSpeedY += this.rng.float(-0.3, 0.3);
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) return;
    this.rotSpeedX = 0.15 + level * 0.1;
    this.rotSpeedY = 0.1 + level * 0.08;
  }
}
