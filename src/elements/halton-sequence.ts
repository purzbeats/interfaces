import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Halton quasi-random sequence. Points placed using Halton(2) and
 * Halton(3) for x,y coordinates. Shows low-discrepancy space filling
 * compared to random placement. Progressive reveal with points geometry
 * and vertex colors.
 */
export class HaltonSequenceElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'halton-sequence',
    meta: {
      shape: 'rectangular',
      roles: ['data-display', 'decorative'],
      moods: ['diagnostic', 'ambient'],
      bandAffinity: 'high',
      sizes: ['works-small', 'needs-medium', 'needs-large'],
    } satisfies ElementMeta,
  };

  private haltonPoints!: THREE.Points;
  private randomPoints!: THREE.Points;
  private haltonMat!: THREE.PointsMaterial;
  private randomMat!: THREE.PointsMaterial;
  private borderLines!: THREE.LineSegments;
  private borderMat!: THREE.LineBasicMaterial;
  private dividerMat!: THREE.LineBasicMaterial;
  private maxPoints: number = 1500;
  private pointSize: number = 2;
  private pointsPerSecond: number = 30;
  private currentCount: number = 0;
  private haltonIndex: number = 1;
  private speedMult: number = 1;
  private accumulator: number = 0;
  private showComparison: boolean = true;
  private hx = 0; private hy = 0; private hw = 0; private hh = 0;
  private rx2 = 0; private ry2 = 0; private rw2 = 0; private rh2 = 0;
  private labelCanvas!: HTMLCanvasElement;
  private labelCtx!: CanvasRenderingContext2D;
  private labelTexture!: THREE.CanvasTexture;
  private labelMesh!: THREE.Mesh;

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;

    const variant = this.rng.int(0, 3);
    const presets = [
      { maxPoints: 1500, pointSize: 2, pps: 30, comparison: true },
      { maxPoints: 3000, pointSize: 1.5, pps: 60, comparison: true },
      { maxPoints: 800, pointSize: 3, pps: 20, comparison: false },
      { maxPoints: 2000, pointSize: 2, pps: 45, comparison: true },
    ];
    const p = presets[variant];
    this.maxPoints = p.maxPoints;
    this.pointSize = p.pointSize;
    this.pointsPerSecond = p.pps;
    this.showComparison = p.comparison;

    if (this.showComparison) {
      const halfW = w * 0.48;
      this.hx = x + w * 0.01; this.hy = y + h * 0.1; this.hw = halfW; this.hh = h * 0.85;
      this.rx2 = x + w * 0.51; this.ry2 = y + h * 0.1; this.rw2 = halfW; this.rh2 = h * 0.85;
    } else {
      this.hx = x + w * 0.05; this.hy = y + h * 0.1; this.hw = w * 0.9; this.hh = h * 0.85;
    }

    this.haltonPoints = this.createPointsMesh(this.maxPoints, this.palette.primary);
    this.haltonMat = this.haltonPoints.material as THREE.PointsMaterial;
    this.group.add(this.haltonPoints);
    if (this.showComparison) {
      this.randomPoints = this.createPointsMesh(this.maxPoints, this.palette.secondary);
      this.randomMat = this.randomPoints.material as THREE.PointsMaterial;
      this.group.add(this.randomPoints);
    }

    const borders: number[] = [];
    this.addBorderVerts(borders, this.hx, this.hy, this.hw, this.hh);
    if (this.showComparison) this.addBorderVerts(borders, this.rx2, this.ry2, this.rw2, this.rh2);
    const borderGeo = new THREE.BufferGeometry();
    borderGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(borders), 3));
    this.borderMat = new THREE.LineBasicMaterial({ color: this.palette.dim, transparent: true, opacity: 0 });
    this.borderLines = new THREE.LineSegments(borderGeo, this.borderMat);
    this.group.add(this.borderLines);
    if (this.showComparison) {
      const dv = new Float32Array([x + w * 0.5, y + h * 0.05, 0, x + w * 0.5, y + h * 0.95, 0]);
      const dGeo = new THREE.BufferGeometry();
      dGeo.setAttribute('position', new THREE.BufferAttribute(dv, 3));
      this.dividerMat = new THREE.LineBasicMaterial({ color: this.palette.dim, transparent: true, opacity: 0 });
      this.group.add(new THREE.Line(dGeo, this.dividerMat));
    }
    this.labelCanvas = document.createElement('canvas');
    this.labelCanvas.width = 256;
    this.labelCanvas.height = 24;
    this.labelCtx = this.get2DContext(this.labelCanvas);
    this.labelTexture = new THREE.CanvasTexture(this.labelCanvas);
    this.labelTexture.minFilter = THREE.LinearFilter;
    const labelGeo = new THREE.PlaneGeometry(w * 0.8, h * 0.06);
    const labelMat = new THREE.MeshBasicMaterial({
      map: this.labelTexture, transparent: true, opacity: 0,
    });
    this.labelMesh = new THREE.Mesh(labelGeo, labelMat);
    this.labelMesh.position.set(x + w / 2, y + h * 0.03, 1);
    this.group.add(this.labelMesh);
  }

  private createPointsMesh(count: number, color: THREE.Color): THREE.Points {
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) { colors[i * 3] = color.r; colors[i * 3 + 1] = color.g; colors[i * 3 + 2] = color.b; }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setDrawRange(0, 0);
    return new THREE.Points(geo, new THREE.PointsMaterial({ vertexColors: true, transparent: true, opacity: 0, size: this.pointSize, sizeAttenuation: false }));
  }

  private addBorderVerts(arr: number[], bx: number, by: number, bw: number, bh: number): void {
    arr.push(
      bx, by, 0, bx + bw, by, 0,
      bx + bw, by, 0, bx + bw, by + bh, 0,
      bx + bw, by + bh, 0, bx, by + bh, 0,
      bx, by + bh, 0, bx, by, 0,
    );
  }

  /** Halton sequence value for index n with given base */
  private halton(n: number, base: number): number {
    let result = 0;
    let f = 1 / base;
    let i = n;
    while (i > 0) {
      result += f * (i % base);
      i = Math.floor(i / base);
      f /= base;
    }
    return result;
  }

  private addPoints(): void {
    if (this.currentCount >= this.maxPoints) {
      this.resetPoints();
      return;
    }

    // Add Halton point
    const hx = this.halton(this.haltonIndex, 2);
    const hy = this.halton(this.haltonIndex, 3);
    this.haltonIndex++;

    const hPosAttr = this.haltonPoints.geometry.getAttribute('position') as THREE.BufferAttribute;
    hPosAttr.setXYZ(this.currentCount,
      this.hx + hx * this.hw,
      this.hy + hy * this.hh,
      0.5,
    );
    hPosAttr.needsUpdate = true;

    // Add random point
    if (this.showComparison) {
      const rPosAttr = this.randomPoints.geometry.getAttribute('position') as THREE.BufferAttribute;
      rPosAttr.setXYZ(this.currentCount,
        this.rx2 + this.rng.float(0, 1) * this.rw2,
        this.ry2 + this.rng.float(0, 1) * this.rh2,
        0.5,
      );
      rPosAttr.needsUpdate = true;
    }

    this.currentCount++;
    this.haltonPoints.geometry.setDrawRange(0, this.currentCount);
    if (this.showComparison) {
      this.randomPoints.geometry.setDrawRange(0, this.currentCount);
    }
  }

  private resetPoints(): void {
    this.currentCount = 0;
    this.haltonIndex = 1;
    this.haltonPoints.geometry.setDrawRange(0, 0);
    if (this.showComparison) {
      this.randomPoints.geometry.setDrawRange(0, 0);
    }
  }

  private updateLabel(): void {
    const lw = this.labelCanvas.width;
    const lh = this.labelCanvas.height;
    this.labelCtx.clearRect(0, 0, lw, lh);
    this.labelCtx.fillStyle = '#' + this.palette.dim.getHexString();
    this.labelCtx.font = '11px monospace';
    this.labelCtx.textAlign = 'center';
    if (this.showComparison) {
      this.labelCtx.fillText(`HALTON(2,3)  n=${this.currentCount}  |  PSEUDO-RANDOM`, lw / 2, lh * 0.7);
    } else {
      this.labelCtx.fillText(`HALTON(2,3)  n=${this.currentCount}`, lw / 2, lh * 0.7);
    }
    this.labelTexture.needsUpdate = true;
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);

    this.accumulator += dt * this.pointsPerSecond * this.speedMult;
    const count = Math.floor(this.accumulator);
    this.accumulator -= count;
    for (let i = 0; i < count; i++) {
      this.addPoints();
    }

    this.updateLabel();

    this.haltonMat.opacity = opacity;
    if (this.showComparison) this.randomMat.opacity = opacity;
    this.borderMat.opacity = opacity * 0.25;
    if (this.dividerMat) this.dividerMat.opacity = opacity * 0.2;
    (this.labelMesh.material as THREE.MeshBasicMaterial).opacity = opacity * 0.7;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Burst of points
      for (let i = 0; i < 40; i++) {
        this.addPoints();
      }
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) {
      this.speedMult = 1;
      return;
    }
    this.speedMult = 1 + level * 0.7;
    if (level >= 5) {
      this.resetPoints();
    }
  }
}
