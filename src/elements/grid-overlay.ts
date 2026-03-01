import * as THREE from 'three';
import { BaseElement } from './base-element';

export class GridOverlayElement extends BaseElement {
  private lines!: THREE.LineSegments;
  private crosshair!: THREE.LineSegments;

  build(): void {
    this.glitchAmount = 3;
    const { x, y, w, h } = this.px;
    const cols = this.rng.int(4, 10);
    const rows = this.rng.int(4, 8);

    const verts: number[] = [];
    for (let c = 0; c <= cols; c++) {
      const lx = x + (w / cols) * c;
      verts.push(lx, y, 0, lx, y + h, 0);
    }
    for (let r = 0; r <= rows; r++) {
      const ly = y + (h / rows) * r;
      verts.push(x, ly, 0, x + w, ly, 0);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    this.lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.lines);

    // Center crosshair
    const cx = x + w / 2, cy = y + h / 2;
    const cs = Math.min(w, h) * 0.15;
    const crossVerts = new Float32Array([
      cx - cs, cy, 1, cx + cs, cy, 1,
      cx, cy - cs, 1, cx, cy + cs, 1,
    ]);
    const crossGeo = new THREE.BufferGeometry();
    crossGeo.setAttribute('position', new THREE.BufferAttribute(crossVerts, 3));
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
