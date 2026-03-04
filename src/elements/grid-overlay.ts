import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';
import { hexCornersPixel, hexCellToPixel, hexagonPoints } from '../layout/hex-grid';

export class GridOverlayElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'grid-overlay',
    meta: { shape: 'rectangular', roles: ['scanner'], moods: ['tactical'], bandAffinity: 'high', sizes: ['needs-medium', 'needs-large'] },
  };
  private lines!: THREE.LineSegments;
  private crosshair!: THREE.LineSegments;

  build(): void {
    const variant = this.rng.int(0, 3);
    const presets = [
      { colMin: 4, colMax: 10, rowMin: 4, rowMax: 8, crosshairScale: 0.15 },   // Standard
      { colMin: 10, colMax: 15, rowMin: 8, rowMax: 12, crosshairScale: 0.08 },  // Dense
      { colMin: 3, colMax: 5, rowMin: 3, rowMax: 4, crosshairScale: 0.25 },     // Minimal
      { colMin: 6, colMax: 12, rowMin: 3, rowMax: 6, crosshairScale: 0.2 },     // Exotic (wide cells)
    ];
    const p = presets[variant];

    this.glitchAmount = 3;
    const { x, y, w, h } = this.px;
    const cx = x + w / 2, cy = y + h / 2;

    const hexCell = this.region.hexCell;
    const verts: number[] = [];
    const crossVerts: number[] = [];

    if (hexCell) {
      const hexCorners = hexCornersPixel(hexCell, this.screenWidth, this.screenHeight);
      const hpx = hexCellToPixel(hexCell, this.screenWidth, this.screenHeight);

      // 6 radial lines from center to vertices (6-sector subdivision)
      for (let i = 0; i < 6; i++) {
        verts.push(hpx.cx, hpx.cy, 0, hexCorners[i].x, hexCorners[i].y, 0);
      }
      // Optional concentric hex rings
      const ringCount = Math.min(2, Math.max(1, Math.floor(Math.min(w, h) / 100)));
      for (let r = 1; r <= ringCount; r++) {
        const ringR = hpx.size * (r / (ringCount + 1));
        const pts = hexagonPoints(hpx.cx, hpx.cy, ringR, 1);
        for (let i = 0; i < pts.length; i++) {
          const next = pts[(i + 1) % pts.length];
          verts.push(pts[i].x, pts[i].y, 0, next.x, next.y, 0);
        }
      }

      // 6-spoke crosshair (lines to opposite vertices)
      const cs = Math.min(w, h) * p.crosshairScale;
      for (let i = 0; i < 3; i++) {
        const a = (Math.PI / 3) * i;
        crossVerts.push(
          hpx.cx - Math.cos(a) * cs, hpx.cy - Math.sin(a) * cs, 1,
          hpx.cx + Math.cos(a) * cs, hpx.cy + Math.sin(a) * cs, 1,
        );
      }
    } else {
      const cols = this.rng.int(p.colMin, p.colMax);
      const rows = this.rng.int(p.rowMin, p.rowMax);

      for (let c = 0; c <= cols; c++) {
        const lx = x + (w / cols) * c;
        verts.push(lx, y, 0, lx, y + h, 0);
      }
      for (let r = 0; r <= rows; r++) {
        const ly = y + (h / rows) * r;
        verts.push(x, ly, 0, x + w, ly, 0);
      }

      // 4-spoke crosshair
      const cs = Math.min(w, h) * p.crosshairScale;
      crossVerts.push(
        cx - cs, cy, 1, cx + cs, cy, 1,
        cx, cy - cs, 1, cx, cy + cs, 1,
      );
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    this.lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.lines);

    const crossGeo = new THREE.BufferGeometry();
    crossGeo.setAttribute('position', new THREE.Float32BufferAttribute(crossVerts, 3));
    this.crosshair = new THREE.LineSegments(crossGeo, new THREE.LineBasicMaterial({
      color: this.palette.secondary,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.crosshair);
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);

    (this.lines.material as THREE.LineBasicMaterial).opacity = opacity * 0.5;
    (this.crosshair.material as THREE.LineBasicMaterial).opacity = opacity * 1.0;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'alert') {
      (this.crosshair.material as THREE.LineBasicMaterial).color.copy(this.palette.alert);
    }
  }
}
