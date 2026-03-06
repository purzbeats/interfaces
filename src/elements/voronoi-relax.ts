import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

interface VoronoiPreset {
  pointCount: number;
  relaxSpeed: number;
  showPoints: boolean;
  cellOutlineAlpha: number;
}

/**
 * Lloyd's Voronoi relaxation. Random seed points converge toward
 * centroidal Voronoi tessellation. Canvas-rendered cells with palette colors.
 */
export class VoronoiRelaxElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'voronoi-relax',
    meta: {
      shape: 'rectangular',
      roles: ['data-display', 'decorative'],
      moods: ['ambient', 'diagnostic'],
      sizes: ['needs-medium', 'needs-large'],
      bandAffinity: 'mid',
    } satisfies ElementMeta,
  };

  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private texture!: THREE.CanvasTexture;
  private mesh!: THREE.Mesh;
  private mat!: THREE.MeshBasicMaterial;

  private pointCount = 30;
  private seedX!: Float32Array;
  private seedY!: Float32Array;
  private centroidX!: Float32Array;
  private centroidY!: Float32Array;
  private cellArea!: Float32Array;
  private ownerGrid!: Uint16Array;
  private cw = 0;
  private ch = 0;
  private relaxSpeed = 2.0;
  private showPoints = true;
  private cellOutlineAlpha = 0.6;
  private intensityLevel = 0;
  private relaxTimer = 0;

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;

    const variant = this.rng.int(0, 3);
    const presets: VoronoiPreset[] = [
      { pointCount: 30,  relaxSpeed: 2.0, showPoints: true,  cellOutlineAlpha: 0.6 },
      { pointCount: 60,  relaxSpeed: 3.0, showPoints: false, cellOutlineAlpha: 0.4 },
      { pointCount: 15,  relaxSpeed: 1.0, showPoints: true,  cellOutlineAlpha: 0.8 },
      { pointCount: 45,  relaxSpeed: 4.0, showPoints: true,  cellOutlineAlpha: 0.5 },
    ];
    const p = presets[variant];
    this.pointCount = p.pointCount;
    this.relaxSpeed = p.relaxSpeed;
    this.showPoints = p.showPoints;
    this.cellOutlineAlpha = p.cellOutlineAlpha;

    this.cw = Math.min(Math.round(w), 256);
    this.ch = Math.min(Math.round(h), 256);
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.cw;
    this.canvas.height = this.ch;
    this.ctx = this.get2DContext(this.canvas);
    this.texture = new THREE.CanvasTexture(this.canvas);

    // Initialize seed points
    this.seedX = new Float32Array(this.pointCount);
    this.seedY = new Float32Array(this.pointCount);
    this.centroidX = new Float32Array(this.pointCount);
    this.centroidY = new Float32Array(this.pointCount);
    this.cellArea = new Float32Array(this.pointCount);
    this.ownerGrid = new Uint16Array(this.cw * this.ch);

    for (let i = 0; i < this.pointCount; i++) {
      this.seedX[i] = this.rng.float(2, this.cw - 2);
      this.seedY[i] = this.rng.float(2, this.ch - 2);
    }

    const planeGeo = new THREE.PlaneGeometry(w, h);
    this.mat = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      opacity: 0,
    });
    this.mesh = new THREE.Mesh(planeGeo, this.mat);
    this.mesh.position.set(x + w / 2, y + h / 2, 0);
    this.group.add(this.mesh);
  }

  private computeVoronoi(): void {
    // Assign each pixel to nearest seed (brute force for small res)
    this.centroidX.fill(0);
    this.centroidY.fill(0);
    this.cellArea.fill(0);

    for (let py = 0; py < this.ch; py++) {
      for (let px = 0; px < this.cw; px++) {
        let minDist = Infinity;
        let owner = 0;
        for (let s = 0; s < this.pointCount; s++) {
          const dx = px - this.seedX[s];
          const dy = py - this.seedY[s];
          const d = dx * dx + dy * dy;
          if (d < minDist) {
            minDist = d;
            owner = s;
          }
        }
        const idx = py * this.cw + px;
        this.ownerGrid[idx] = owner;
        this.centroidX[owner] += px;
        this.centroidY[owner] += py;
        this.cellArea[owner] += 1;
      }
    }

    // Compute centroids
    for (let i = 0; i < this.pointCount; i++) {
      if (this.cellArea[i] > 0) {
        this.centroidX[i] /= this.cellArea[i];
        this.centroidY[i] /= this.cellArea[i];
      } else {
        this.centroidX[i] = this.seedX[i];
        this.centroidY[i] = this.seedY[i];
      }
    }
  }

  private relaxStep(dt: number): void {
    const speed = this.relaxSpeed * (1 + this.intensityLevel * 0.4);
    for (let i = 0; i < this.pointCount; i++) {
      this.seedX[i] += (this.centroidX[i] - this.seedX[i]) * speed * dt;
      this.seedY[i] += (this.centroidY[i] - this.seedY[i]) * speed * dt;
      // Clamp
      this.seedX[i] = Math.max(1, Math.min(this.cw - 1, this.seedX[i]));
      this.seedY[i] = Math.max(1, Math.min(this.ch - 1, this.seedY[i]));
    }
  }

  private drawCells(): void {
    const ctx = this.ctx;
    const imgData = ctx.createImageData(this.cw, this.ch);
    const data = imgData.data;

    const bg = this.palette.bg;
    const pri = this.palette.primary;
    const sec = this.palette.secondary;
    const dim = this.palette.dim;

    // Assign a palette color to each cell
    for (let py = 0; py < this.ch; py++) {
      for (let px = 0; px < this.cw; px++) {
        const idx = py * this.cw + px;
        const owner = this.ownerGrid[idx];
        const pixIdx = idx * 4;

        // Check if cell boundary (neighbor has different owner)
        let isBorder = false;
        if (px > 0 && this.ownerGrid[idx - 1] !== owner) isBorder = true;
        if (px < this.cw - 1 && this.ownerGrid[idx + 1] !== owner) isBorder = true;
        if (py > 0 && this.ownerGrid[idx - this.cw] !== owner) isBorder = true;
        if (py < this.ch - 1 && this.ownerGrid[idx + this.cw] !== owner) isBorder = true;

        if (isBorder) {
          data[pixIdx] = Math.floor(sec.r * 255);
          data[pixIdx + 1] = Math.floor(sec.g * 255);
          data[pixIdx + 2] = Math.floor(sec.b * 255);
          data[pixIdx + 3] = Math.floor(this.cellOutlineAlpha * 255);
        } else {
          // Interior: subtle fill based on cell index
          const blend = (owner % 3) / 3;
          data[pixIdx] = Math.floor((bg.r + (dim.r - bg.r) * blend * 0.5) * 255);
          data[pixIdx + 1] = Math.floor((bg.g + (dim.g - bg.g) * blend * 0.5) * 255);
          data[pixIdx + 2] = Math.floor((bg.b + (dim.b - bg.b) * blend * 0.5) * 255);
          data[pixIdx + 3] = 180;
        }
      }
    }

    ctx.putImageData(imgData, 0, 0);

    // Draw seed points
    if (this.showPoints) {
      ctx.fillStyle = `rgb(${Math.floor(pri.r * 255)},${Math.floor(pri.g * 255)},${Math.floor(pri.b * 255)})`;
      for (let i = 0; i < this.pointCount; i++) {
        ctx.beginPath();
        ctx.arc(this.seedX[i], this.seedY[i], Math.max(1, Math.min(this.cw, this.ch) * 0.008), 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);

    this.relaxTimer += dt;
    if (this.relaxTimer >= 0.05) {
      this.relaxTimer = 0;
      this.computeVoronoi();
      this.relaxStep(dt);
      this.drawCells();
      this.texture.needsUpdate = true;
    }

    this.mat.opacity = opacity;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Scatter seeds randomly
      for (let i = 0; i < this.pointCount; i++) {
        this.seedX[i] = this.rng.float(2, this.cw - 2);
        this.seedY[i] = this.rng.float(2, this.ch - 2);
      }
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    this.intensityLevel = level;
  }
}
