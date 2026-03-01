import * as THREE from 'three';
import { BaseElement } from './base-element';

/**
 * Horizontal line sweeping top-to-bottom with fading trail.
 * Static scatter points brighten as the line passes over them.
 */
export class ScanLineElement extends BaseElement {
  private scanLine!: THREE.Line;
  private trailMesh!: THREE.Mesh;
  private trailMat!: THREE.MeshBasicMaterial;
  private scatterPoints!: THREE.Points;
  private scatterBrightness: number[] = [];
  private pointCount: number = 0;
  private borderLines!: THREE.LineSegments;
  private scanY: number = 0;
  private scanSpeed: number = 0;

  build(): void {
    const { x, y, w, h } = this.px;
    this.scanSpeed = this.rng.float(0.15, 0.4) * h;

    // Scan line (horizontal)
    const lineGeo = new THREE.BufferGeometry();
    const linePos = new Float32Array([x, y, 2, x + w, y, 2]);
    lineGeo.setAttribute('position', new THREE.BufferAttribute(linePos, 3));
    this.scanLine = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.scanLine);

    // Trail (a thin rectangle behind the scan line)
    const trailGeo = new THREE.PlaneGeometry(w, 1);
    this.trailMat = new THREE.MeshBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
    });
    this.trailMesh = new THREE.Mesh(trailGeo, this.trailMat);
    this.trailMesh.position.set(x + w / 2, y, 1);
    this.group.add(this.trailMesh);

    // Scatter points
    this.pointCount = this.rng.int(30, 80);
    const pointPositions = new Float32Array(this.pointCount * 3);
    const pointColors = new Float32Array(this.pointCount * 3);
    for (let i = 0; i < this.pointCount; i++) {
      pointPositions[i * 3] = x + this.rng.float(4, w - 4);
      pointPositions[i * 3 + 1] = y + this.rng.float(4, h - 4);
      pointPositions[i * 3 + 2] = 1;
      const c = this.palette.dim;
      pointColors[i * 3] = c.r;
      pointColors[i * 3 + 1] = c.g;
      pointColors[i * 3 + 2] = c.b;
      this.scatterBrightness.push(0);
    }
    const ptGeo = new THREE.BufferGeometry();
    ptGeo.setAttribute('position', new THREE.BufferAttribute(pointPositions, 3));
    ptGeo.setAttribute('color', new THREE.BufferAttribute(pointColors, 3));
    this.scatterPoints = new THREE.Points(ptGeo, new THREE.PointsMaterial({
      size: Math.max(3, Math.min(w, h) * 0.006),
      vertexColors: true,
      transparent: true,
      opacity: 0,
      sizeAttenuation: false,
    }));
    this.group.add(this.scatterPoints);

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

    this.scanY = 0;
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);
    const { x, y, w, h } = this.px;

    // Advance scan line
    this.scanY += this.scanSpeed * dt;
    if (this.scanY > h) this.scanY = 0;

    const lineY = y + this.scanY;

    // Update scan line position
    const linePos = this.scanLine.geometry.getAttribute('position') as THREE.BufferAttribute;
    linePos.setY(0, lineY);
    linePos.setY(1, lineY);
    linePos.needsUpdate = true;

    // Trail behind scan line
    const trailH = Math.min(this.scanY, h * 0.15);
    this.trailMesh.scale.y = trailH;
    this.trailMesh.position.set(x + w / 2, lineY - trailH / 2, 1);
    this.trailMat.opacity = opacity * 0.15;

    (this.scanLine.material as THREE.LineBasicMaterial).opacity = opacity * 0.9;

    // Update scatter points brightness
    const colors = this.scatterPoints.geometry.getAttribute('color') as THREE.BufferAttribute;
    const positions = this.scatterPoints.geometry.getAttribute('position') as THREE.BufferAttribute;
    const primary = this.palette.primary;
    const dim = this.palette.dim;

    for (let i = 0; i < this.pointCount; i++) {
      const py = positions.getY(i);
      const dist = Math.abs(py - lineY);

      // Brighten when scan line passes
      if (dist < h * 0.03) {
        this.scatterBrightness[i] = 1;
      } else {
        this.scatterBrightness[i] *= Math.exp(-2 * dt);
      }

      const b = this.scatterBrightness[i];
      colors.setXYZ(i,
        dim.r + (primary.r - dim.r) * b,
        dim.g + (primary.g - dim.g) * b,
        dim.b + (primary.b - dim.b) * b,
      );
    }
    colors.needsUpdate = true;
    (this.scatterPoints.material as THREE.PointsMaterial).opacity = opacity * 0.8;
    (this.borderLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.5;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      this.scanSpeed *= 3;
      setTimeout(() => { this.scanSpeed /= 3; }, 400);
    }
    if (action === 'alert') {
      this.pulseTimer = 1.5;
      // Brighten all points
      for (let i = 0; i < this.pointCount; i++) {
        this.scatterBrightness[i] = 1;
      }
    }
  }
}
