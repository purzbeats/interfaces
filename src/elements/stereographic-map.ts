import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Stereographic projection — a grid of circles on a sphere projected to
 * a plane. Circles map to circles/lines. Animates rotation of the sphere
 * so projected circles move and deform. Line geometry.
 */
export class StereographicMapElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'stereographic-map',
    meta: {
      shape: 'rectangular',
      roles: ['data-display', 'decorative'],
      moods: ['ambient', 'tactical'],
      bandAffinity: 'mid',
      sizes: ['needs-medium', 'needs-large'],
    },
  };

  private lines!: THREE.LineSegments;
  private linesMat!: THREE.LineBasicMaterial;
  private borderMat!: THREE.LineBasicMaterial;
  private gridLines = 12;
  private circleRes = 48;
  private rotSpeedX = 0.15;
  private rotSpeedY = 0.1;
  private rotSpeedZ = 0.05;
  private projScale = 1.0;

  build(): void {
    this.glitchAmount = 4;
    const variant = this.rng.int(0, 4);
    const { x, y, w, h } = this.px;

    const presets = [
      { gridLines: 12, circleRes: 48, rotSpeedX: 0.15, rotSpeedY: 0.10, rotSpeedZ: 0.05, projScale: 1.0 },
      { gridLines: 16, circleRes: 64, rotSpeedX: 0.08, rotSpeedY: 0.12, rotSpeedZ: 0.03, projScale: 0.8 },
      { gridLines: 8,  circleRes: 32, rotSpeedX: 0.25, rotSpeedY: 0.15, rotSpeedZ: 0.10, projScale: 1.2 },
      { gridLines: 10, circleRes: 40, rotSpeedX: 0.12, rotSpeedY: 0.08, rotSpeedZ: 0.07, projScale: 0.9 },
    ];
    const p = presets[variant];
    this.gridLines = p.gridLines;
    this.circleRes = p.circleRes;
    this.rotSpeedX = p.rotSpeedX;
    this.rotSpeedY = p.rotSpeedY;
    this.rotSpeedZ = p.rotSpeedZ;
    this.projScale = p.projScale;

    // Latitude + longitude lines, each a circle of circleRes segments
    const totalCircles = this.gridLines * 2; // lat + lon
    const vertsPerCircle = this.circleRes * 2;
    const totalVerts = totalCircles * vertsPerCircle;
    const positions = new Float32Array(totalVerts * 3);
    for (let i = 0; i < totalVerts; i++) {
      positions[i * 3] = x + w / 2;
      positions[i * 3 + 1] = y + h / 2;
      positions[i * 3 + 2] = 0;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setDrawRange(0, 0);
    this.linesMat = new THREE.LineBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
    });
    this.lines = new THREE.LineSegments(geo, this.linesMat);
    this.group.add(this.lines);

    // Border
    const bv = new Float32Array([
      x, y, 0, x + w, y, 0,
      x + w, y, 0, x + w, y + h, 0,
      x + w, y + h, 0, x, y + h, 0,
      x, y + h, 0, x, y, 0,
    ]);
    const borderGeo = new THREE.BufferGeometry();
    borderGeo.setAttribute('position', new THREE.BufferAttribute(bv, 3));
    this.borderMat = new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    });
    this.group.add(new THREE.LineSegments(borderGeo, this.borderMat));
  }

  /** Rotate a 3D point by Euler angles */
  private rotate(px: number, py: number, pz: number, ax: number, ay: number, az: number): [number, number, number] {
    // Rotate around X
    let y1 = py * Math.cos(ax) - pz * Math.sin(ax);
    let z1 = py * Math.sin(ax) + pz * Math.cos(ax);
    let x1 = px;
    // Rotate around Y
    let x2 = x1 * Math.cos(ay) + z1 * Math.sin(ay);
    let z2 = -x1 * Math.sin(ay) + z1 * Math.cos(ay);
    let y2 = y1;
    // Rotate around Z
    let x3 = x2 * Math.cos(az) - y2 * Math.sin(az);
    let y3 = x2 * Math.sin(az) + y2 * Math.cos(az);
    return [x3, y3, z2];
  }

  /** Stereographic projection from (x,y,z) on unit sphere to plane */
  private project(sx: number, sy: number, sz: number): [number, number] | null {
    // Project from north pole (0,0,1) to z=0 plane
    const denom = 1 - sz;
    if (Math.abs(denom) < 0.01) return null; // Near the pole, skip
    return [sx / denom, sy / denom];
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    const { x, y, w, h } = this.px;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const scale = Math.min(w, h) * 0.2 * this.projScale;

    const ax = time * this.rotSpeedX;
    const ay = time * this.rotSpeedY;
    const az = time * this.rotSpeedZ;

    const pos = this.lines.geometry.getAttribute('position') as THREE.BufferAttribute;
    let vi = 0;

    const clampToRegion = (px: number, py: number): [number, number] => {
      return [
        Math.max(x, Math.min(x + w, px)),
        Math.max(y, Math.min(y + h, py)),
      ];
    };

    // Draw latitude circles
    for (let i = 0; i < this.gridLines; i++) {
      const lat = -Math.PI / 2 + (Math.PI / (this.gridLines + 1)) * (i + 1);
      const cosLat = Math.cos(lat);
      const sinLat = Math.sin(lat);

      for (let j = 0; j < this.circleRes; j++) {
        if (vi + 2 > pos.count) break;
        const lon1 = (j / this.circleRes) * Math.PI * 2;
        const lon2 = ((j + 1) / this.circleRes) * Math.PI * 2;

        const [rx1, ry1, rz1] = this.rotate(cosLat * Math.cos(lon1), cosLat * Math.sin(lon1), sinLat, ax, ay, az);
        const [rx2, ry2, rz2] = this.rotate(cosLat * Math.cos(lon2), cosLat * Math.sin(lon2), sinLat, ax, ay, az);

        const p1 = this.project(rx1, ry1, rz1);
        const p2 = this.project(rx2, ry2, rz2);

        if (p1 && p2 && Math.abs(p1[0]) < 8 && Math.abs(p1[1]) < 8 && Math.abs(p2[0]) < 8 && Math.abs(p2[1]) < 8) {
          const [sx1, sy1] = clampToRegion(cx + p1[0] * scale, cy + p1[1] * scale);
          const [sx2, sy2] = clampToRegion(cx + p2[0] * scale, cy + p2[1] * scale);
          pos.setXYZ(vi++, sx1, sy1, 0);
          pos.setXYZ(vi++, sx2, sy2, 0);
        } else {
          pos.setXYZ(vi++, cx, cy, 0);
          pos.setXYZ(vi++, cx, cy, 0);
        }
      }
    }

    // Draw longitude circles
    for (let i = 0; i < this.gridLines; i++) {
      const lon = (i / this.gridLines) * Math.PI * 2;
      const cosLon = Math.cos(lon);
      const sinLon = Math.sin(lon);

      for (let j = 0; j < this.circleRes; j++) {
        if (vi + 2 > pos.count) break;
        const lat1 = -Math.PI / 2 + (j / this.circleRes) * Math.PI;
        const lat2 = -Math.PI / 2 + ((j + 1) / this.circleRes) * Math.PI;

        const [rx1, ry1, rz1] = this.rotate(Math.cos(lat1) * cosLon, Math.cos(lat1) * sinLon, Math.sin(lat1), ax, ay, az);
        const [rx2, ry2, rz2] = this.rotate(Math.cos(lat2) * cosLon, Math.cos(lat2) * sinLon, Math.sin(lat2), ax, ay, az);

        const p1 = this.project(rx1, ry1, rz1);
        const p2 = this.project(rx2, ry2, rz2);

        if (p1 && p2 && Math.abs(p1[0]) < 8 && Math.abs(p1[1]) < 8 && Math.abs(p2[0]) < 8 && Math.abs(p2[1]) < 8) {
          const [sx1, sy1] = clampToRegion(cx + p1[0] * scale, cy + p1[1] * scale);
          const [sx2, sy2] = clampToRegion(cx + p2[0] * scale, cy + p2[1] * scale);
          pos.setXYZ(vi++, sx1, sy1, 0);
          pos.setXYZ(vi++, sx2, sy2, 0);
        } else {
          pos.setXYZ(vi++, cx, cy, 0);
          pos.setXYZ(vi++, cx, cy, 0);
        }
      }
    }

    pos.needsUpdate = true;
    this.lines.geometry.setDrawRange(0, vi);

    const colorT = Math.sin(time * 0.2) * 0.5 + 0.5;
    const col = new THREE.Color().copy(this.palette.primary).lerp(this.palette.secondary, colorT * 0.3);
    this.linesMat.color.copy(col);
    this.linesMat.opacity = opacity * 0.7;
    this.borderMat.opacity = opacity * 0.3;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      this.rotSpeedX = this.rng.float(0.1, 0.4);
      this.rotSpeedY = this.rng.float(0.05, 0.3);
      this.projScale = this.rng.float(0.6, 1.5);
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level >= 3) {
      this.rotSpeedX *= 1 + level * 0.15;
      this.rotSpeedY *= 1 + level * 0.15;
    }
  }
}
