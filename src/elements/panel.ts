import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

export class PanelElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'panel',
    meta: { shape: 'rectangular', roles: ['structural'], moods: ['ambient'], sizes: ['works-small', 'needs-medium', 'needs-large'] },
  };
  private borderLines!: THREE.LineSegments;
  private fillMesh!: THREE.Mesh;
  private headerMesh!: THREE.Mesh;
  private hasHeader: boolean = false;
  private cornerSize: number = 0;

  build(): void {
    const { x, y, w, h } = this.px;
    this.hasHeader = this.rng.chance(0.6);
    this.cornerSize = Math.min(w, h) * this.rng.float(0.02, 0.06);

    // Background fill
    const fillGeo = new THREE.PlaneGeometry(w, h);
    const fillMat = new THREE.MeshBasicMaterial({
      color: this.palette.bg,
      transparent: true,
      opacity: 0.3,
    });
    this.fillMesh = new THREE.Mesh(fillGeo, fillMat);
    this.fillMesh.position.set(x + w / 2, y + h / 2, 0);
    this.group.add(this.fillMesh);

    // Border
    const borderGeo = this.createBorderGeometry(x, y, w, h);
    const borderMat = new THREE.LineBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
    });
    this.borderLines = new THREE.LineSegments(borderGeo, borderMat);
    this.group.add(this.borderLines);

    // Header bar
    if (this.hasHeader) {
      const headerH = Math.min(h * 0.08, 12);
      const headerGeo = new THREE.PlaneGeometry(w - 2, headerH);
      const headerMat = new THREE.MeshBasicMaterial({
        color: this.palette.primary,
        transparent: true,
        opacity: 0,
      });
      this.headerMesh = new THREE.Mesh(headerGeo, headerMat);
      this.headerMesh.position.set(x + w / 2, y + h - headerH / 2 - 1, 1);
      this.group.add(this.headerMesh);
    }
  }

  private createBorderGeometry(x: number, y: number, w: number, h: number): THREE.BufferGeometry {
    const c = this.cornerSize;
    const verts = new Float32Array([
      x + c, y, 0, x + w - c, y, 0,
      x + w, y + c, 0, x + w, y + h - c, 0,
      x + w - c, y + h, 0, x + c, y + h, 0,
      x, y + h - c, 0, x, y + c, 0,
      x, y + c, 0, x + c, y, 0,
      x + w - c, y, 0, x + w, y + c, 0,
      x + w, y + h - c, 0, x + w - c, y + h, 0,
      x + c, y + h, 0, x, y + h - c, 0,
    ]);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    return geo;
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);

    const borderMat = this.borderLines.material as THREE.LineBasicMaterial;
    borderMat.opacity = opacity;

    const fillMat = this.fillMesh.material as THREE.MeshBasicMaterial;
    fillMat.opacity = opacity * 0.15;

    if (this.hasHeader && this.headerMesh) {
      (this.headerMesh.material as THREE.MeshBasicMaterial).opacity = opacity * 0.25;
    }
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'alert') {
      (this.borderLines.material as THREE.LineBasicMaterial).color.copy(this.palette.alert);
    }
  }
}
