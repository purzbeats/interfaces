import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Worley/cellular noise field animation. Distance to nearest feature point
 * creates organic bubble-like patterns that shift over time.
 * Canvas-based rendering at reduced resolution.
 */
export class WorleyNoiseElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'worley-noise',
    meta: {
      shape: 'rectangular',
      roles: ['decorative'],
      moods: ['ambient'],
      bandAffinity: 'sub',
      sizes: ['needs-medium', 'needs-large'],
    } satisfies ElementMeta,
  };

  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private texture!: THREE.CanvasTexture;
  private mesh!: THREE.Mesh;
  private meshMat!: THREE.MeshBasicMaterial;
  private borderLines!: THREE.LineSegments;
  private borderMat!: THREE.LineBasicMaterial;

  private canvasW: number = 0;
  private canvasH: number = 0;
  private pointCount: number = 0;
  private pointsX!: Float32Array;
  private pointsY!: Float32Array;
  private velX!: Float32Array;
  private velY!: Float32Array;
  private distMode: number = 0; // 0=F1, 1=F2-F1, 2=F2, 3=F1*F2
  private colorMode: number = 0;
  private intensityLevel: number = 0;

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;
    const variant = this.rng.int(0, 3);
    const presets = [
      { points: 12, cw: 80, ch: 60, dist: 0, color: 0 },   // Classic F1 cells
      { points: 20, cw: 100, ch: 75, dist: 1, color: 1 },  // F2-F1 veins
      { points: 8,  cw: 64, ch: 48, dist: 2, color: 2 },   // F2 soft blobs
      { points: 16, cw: 90, ch: 68, dist: 3, color: 3 },    // F1*F2 crystals
    ];
    const p = presets[variant];

    this.pointCount = p.points;
    this.canvasW = p.cw;
    this.canvasH = p.ch;
    this.distMode = p.dist;
    this.colorMode = p.color;

    // Initialize feature points
    this.pointsX = new Float32Array(this.pointCount);
    this.pointsY = new Float32Array(this.pointCount);
    this.velX = new Float32Array(this.pointCount);
    this.velY = new Float32Array(this.pointCount);

    for (let i = 0; i < this.pointCount; i++) {
      this.pointsX[i] = this.rng.float(0, this.canvasW);
      this.pointsY[i] = this.rng.float(0, this.canvasH);
      this.velX[i] = this.rng.float(-8, 8);
      this.velY[i] = this.rng.float(-8, 8);
    }

    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvasW;
    this.canvas.height = this.canvasH;
    this.ctx = this.get2DContext(this.canvas);
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.magFilter = THREE.NearestFilter;

    const geo = new THREE.PlaneGeometry(w, h);
    this.meshMat = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(geo, this.meshMat);
    this.mesh.position.set(x + w / 2, y + h / 2, 0);
    this.group.add(this.mesh);

    // Border
    const bv = new Float32Array([
      x, y, 0, x + w, y, 0, x + w, y, 0, x + w, y + h, 0,
      x + w, y + h, 0, x, y + h, 0, x, y + h, 0, x, y, 0,
    ]);
    const bGeo = new THREE.BufferGeometry();
    bGeo.setAttribute('position', new THREE.BufferAttribute(bv, 3));
    this.borderMat = new THREE.LineBasicMaterial({
      color: this.palette.dim, transparent: true, opacity: 0,
    });
    this.borderLines = new THREE.LineSegments(bGeo, this.borderMat);
    this.group.add(this.borderLines);
  }

  private movePoints(dt: number): void {
    for (let i = 0; i < this.pointCount; i++) {
      this.pointsX[i] += this.velX[i] * dt;
      this.pointsY[i] += this.velY[i] * dt;
      // Wrap around
      if (this.pointsX[i] < 0) this.pointsX[i] += this.canvasW;
      if (this.pointsX[i] >= this.canvasW) this.pointsX[i] -= this.canvasW;
      if (this.pointsY[i] < 0) this.pointsY[i] += this.canvasH;
      if (this.pointsY[i] >= this.canvasH) this.pointsY[i] -= this.canvasH;
    }
  }

  private renderNoise(): void {
    const imgData = this.ctx.createImageData(this.canvasW, this.canvasH);
    const data = imgData.data;
    const pr = this.palette.primary.r;
    const pg = this.palette.primary.g;
    const pb = this.palette.primary.b;
    const sr = this.palette.secondary.r;
    const sg = this.palette.secondary.g;
    const sb = this.palette.secondary.b;

    const maxDist = Math.sqrt(this.canvasW * this.canvasW + this.canvasH * this.canvasH) * 0.3;

    for (let py = 0; py < this.canvasH; py++) {
      for (let px = 0; px < this.canvasW; px++) {
        // Find 2 nearest feature points (with wrapping)
        let d1 = Infinity, d2 = Infinity;
        for (let i = 0; i < this.pointCount; i++) {
          let dx = Math.abs(px - this.pointsX[i]);
          let dy = Math.abs(py - this.pointsY[i]);
          if (dx > this.canvasW / 2) dx = this.canvasW - dx;
          if (dy > this.canvasH / 2) dy = this.canvasH - dy;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < d1) { d2 = d1; d1 = d; }
          else if (d < d2) { d2 = d; }
        }

        let value: number;
        switch (this.distMode) {
          case 0: value = d1 / maxDist; break;
          case 1: value = (d2 - d1) / maxDist; break;
          case 2: value = d2 / maxDist; break;
          case 3: value = (d1 * d2) / (maxDist * maxDist) * 4; break;
          default: value = d1 / maxDist;
        }
        value = Math.min(1, Math.max(0, value));

        const off = (py * this.canvasW + px) * 4;
        const t = value;
        data[off]     = Math.round((pr * (1 - t) + sr * t) * 255);
        data[off + 1] = Math.round((pg * (1 - t) + sg * t) * 255);
        data[off + 2] = Math.round((pb * (1 - t) + sb * t) * 255);
        data[off + 3] = Math.round((0.1 + value * 0.9) * 255);
      }
    }
    this.ctx.putImageData(imgData, 0, 0);
    this.texture.needsUpdate = true;
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);
    this.movePoints(dt);
    this.renderNoise();
    this.meshMat.opacity = opacity;
    this.borderMat.opacity = opacity * 0.2;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Scatter points
      for (let i = 0; i < this.pointCount; i++) {
        this.pointsX[i] = this.rng.float(0, this.canvasW);
        this.pointsY[i] = this.rng.float(0, this.canvasH);
      }
    }
    if (action === 'pulse') {
      for (let i = 0; i < this.pointCount; i++) {
        this.velX[i] *= 3;
        this.velY[i] *= 3;
      }
      setTimeout(() => {
        for (let i = 0; i < this.pointCount; i++) {
          this.velX[i] /= 3;
          this.velY[i] /= 3;
        }
      }, 500);
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    this.intensityLevel = level;
    if (level === 0) return;
    const speed = 1 + level * 0.5;
    for (let i = 0; i < this.pointCount; i++) {
      const len = Math.sqrt(this.velX[i] * this.velX[i] + this.velY[i] * this.velY[i]);
      if (len > 0.01) {
        this.velX[i] = (this.velX[i] / len) * 8 * speed;
        this.velY[i] = (this.velY[i] / len) * 8 * speed;
      }
    }
  }
}
