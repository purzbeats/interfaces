import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

interface CellPreset {
  cellCount: number;
  shiftSpeed: number;
  edgeBrightness: number;
  turbulence: number;
}

interface ConvectionCell {
  cx: number;
  cy: number;
  vx: number;
  vy: number;
  radius: number;
}

/**
 * Cloud convection cell patterns (Benard cells viewed from above).
 * Polygonal cells with bright edges (updrafts) and dark centers (downdrafts).
 * Canvas rendered, cells slowly shift.
 */
export class CloudCellElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'cloud-cell',
    meta: {
      shape: 'rectangular',
      roles: ['decorative'],
      moods: ['ambient'],
      sizes: ['needs-medium', 'needs-large'],
      bandAffinity: 'sub',
    } satisfies ElementMeta,
  };

  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private texture!: THREE.CanvasTexture;
  private mesh!: THREE.Mesh;
  private mat!: THREE.MeshBasicMaterial;

  private cells: ConvectionCell[] = [];
  private cellCount = 12;
  private shiftSpeed = 8;
  private edgeBrightness = 0.9;
  private turbulence = 0.3;
  private intensityLevel = 0;
  private cw = 0;
  private ch = 0;
  private renderAccum = 0;

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;

    const variant = this.rng.int(0, 4);
    const presets: CellPreset[] = [
      { cellCount: 12, shiftSpeed: 8, edgeBrightness: 0.9, turbulence: 0.3 },
      { cellCount: 20, shiftSpeed: 5, edgeBrightness: 0.7, turbulence: 0.2 },
      { cellCount: 8,  shiftSpeed: 12, edgeBrightness: 1.0, turbulence: 0.5 },
      { cellCount: 15, shiftSpeed: 6, edgeBrightness: 0.8, turbulence: 0.4 },
    ];
    const p = presets[variant];
    this.cellCount = p.cellCount;
    this.shiftSpeed = p.shiftSpeed;
    this.edgeBrightness = p.edgeBrightness;
    this.turbulence = p.turbulence;

    this.canvas = document.createElement('canvas');
    this.cw = Math.min(w, 160);
    this.ch = Math.min(h, 160);
    this.canvas.width = this.cw;
    this.canvas.height = this.ch;
    this.ctx = this.get2DContext(this.canvas);
    this.texture = new THREE.CanvasTexture(this.canvas);

    // Initialize cells
    for (let i = 0; i < this.cellCount; i++) {
      this.cells.push({
        cx: this.rng.float(0, this.cw),
        cy: this.rng.float(0, this.ch),
        vx: this.rng.float(-1, 1) * this.shiftSpeed,
        vy: this.rng.float(-1, 1) * this.shiftSpeed,
        radius: this.rng.float(0.7, 1.3),
      });
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

  private drawCells(time: number): void {
    const ctx = this.ctx;
    const pri = this.palette.primary;
    const dim = this.palette.dim;
    const bg = this.palette.bg;

    // Fill background (dark downdraft areas)
    ctx.fillStyle = `rgb(${Math.floor(bg.r * 255)},${Math.floor(bg.g * 255)},${Math.floor(bg.b * 255)})`;
    ctx.fillRect(0, 0, this.cw, this.ch);

    // Use a pixel-based Voronoi approach: for each pixel, find nearest cell
    // Use a lower-resolution approach for performance
    const step = 4;
    for (let py = 0; py < this.ch; py += step) {
      for (let px = 0; px < this.cw; px += step) {
        let minDist = Infinity;
        let secondDist = Infinity;

        for (const cell of this.cells) {
          // Wrap-around distance for seamless tiling
          let dx = Math.abs(px - cell.cx);
          let dy = Math.abs(py - cell.cy);
          if (dx > this.cw / 2) dx = this.cw - dx;
          if (dy > this.ch / 2) dy = this.ch - dy;
          const dist = Math.sqrt(dx * dx + dy * dy) / cell.radius;
          if (dist < minDist) {
            secondDist = minDist;
            minDist = dist;
          } else if (dist < secondDist) {
            secondDist = dist;
          }
        }

        // Edge proximity: difference between nearest and second-nearest
        const edgeDist = secondDist - minDist;
        const avgDist = (this.cw + this.ch) / (2 * Math.sqrt(this.cellCount));
        const edgeFactor = 1 - Math.min(edgeDist / (avgDist * 0.5), 1);
        const brightness = edgeFactor * this.edgeBrightness;

        // Turbulence modulation
        const turb = this.turbulence * Math.sin(px * 0.05 + time) * Math.cos(py * 0.05 + time * 0.7);

        const r = Math.floor((dim.r + (pri.r - dim.r) * (brightness + turb)) * 255);
        const g = Math.floor((dim.g + (pri.g - dim.g) * (brightness + turb)) * 255);
        const b = Math.floor((dim.b + (pri.b - dim.b) * (brightness + turb)) * 255);

        ctx.fillStyle = `rgb(${Math.max(0, Math.min(255, r))},${Math.max(0, Math.min(255, g))},${Math.max(0, Math.min(255, b))})`;
        ctx.fillRect(px, py, step, step);
      }
    }
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);

    // Move cells slowly
    const speedMul = 1 + this.intensityLevel * 0.3;
    for (const cell of this.cells) {
      cell.cx += cell.vx * dt * speedMul;
      cell.cy += cell.vy * dt * speedMul;
      // Wrap around
      if (cell.cx < 0) cell.cx += this.cw;
      if (cell.cx > this.cw) cell.cx -= this.cw;
      if (cell.cy < 0) cell.cy += this.ch;
      if (cell.cy > this.ch) cell.cy -= this.ch;
    }

    this.mat.opacity = opacity;

    this.renderAccum += dt;
    if (this.renderAccum < 0.083) return;
    this.renderAccum = 0;

    this.drawCells(time);
    this.texture.needsUpdate = true;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Scatter cells randomly
      for (const cell of this.cells) {
        cell.cx = this.rng.float(0, this.cw);
        cell.cy = this.rng.float(0, this.ch);
      }
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    this.intensityLevel = level;
  }
}
