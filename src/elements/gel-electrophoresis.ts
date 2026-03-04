import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Gel electrophoresis display — 3-8 lanes with migrating bands.
 * Canvas-based rendering with soft gaussian-like band edges.
 */
export class GelElectrophoresisElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'gel-electrophoresis',
    meta: {
      shape: 'rectangular',
      roles: ['data-display'],
      moods: ['diagnostic'],
      sizes: ['works-small', 'needs-medium', 'needs-large'],
      bandAffinity: 'mid',
    } satisfies ElementMeta,
  };

  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private texture!: THREE.CanvasTexture;
  private mesh!: THREE.Mesh;
  private borderLines!: THREE.LineSegments;
  private laneLines!: THREE.LineSegments;
  private wellMarkers!: THREE.LineSegments;
  private rulerLines!: THREE.LineSegments;

  private laneCount: number = 4;
  private bandsPerLane: number = 6;
  private bandWidth: number = 0.7; // fraction of lane width
  private blurPasses: number = 2;
  private migrationSpeed: number = 0.04;

  /** Per-lane array of band positions (0 = top, 1 = bottom). */
  private bands: { y: number; color: 'primary' | 'secondary'; width: number }[][] = [];
  /** Whether a lane is the reference ladder lane (-1 = none). */
  private ladderLane: number = -1;

  private renderAccum: number = 0;
  private RENDER_INTERVAL = 1 / 12;

  private canvasW: number = 0;
  private canvasH: number = 0;

  build(): void {
    const variant = this.rng.int(0, 3);
    const presets = [
      { lanes: 4, bands: 6, bandWidth: 0.7, blur: 2, speed: 0.04, ladder: false },   // Standard
      { lanes: 8, bands: 10, bandWidth: 0.45, blur: 1, speed: 0.03, ladder: false },  // High-res
      { lanes: 3, bands: 5, bandWidth: 0.9, blur: 5, speed: 0.05, ladder: false },    // Smeared
      { lanes: 4, bands: 6, bandWidth: 0.7, blur: 2, speed: 0.04, ladder: true },     // Ladder
    ];
    const p = presets[variant];

    this.laneCount = p.lanes;
    this.bandsPerLane = p.bands;
    this.bandWidth = p.bandWidth;
    this.blurPasses = p.blur;
    this.migrationSpeed = p.speed;

    const { x, y, w, h } = this.px;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvasW = Math.floor(w * dpr);
    this.canvasH = Math.floor(h * dpr);

    // Initialize bands for each lane
    this.bands = [];
    if (p.ladder) {
      this.ladderLane = 0; // first lane is the reference ladder
    }
    for (let lane = 0; lane < this.laneCount; lane++) {
      const laneBands: { y: number; color: 'primary' | 'secondary'; width: number }[] = [];
      const count = (lane === this.ladderLane) ? this.bandsPerLane : this.rng.int(4, this.bandsPerLane);
      for (let b = 0; b < count; b++) {
        const yPos = (lane === this.ladderLane)
          ? (b + 1) / (count + 1) // evenly spaced for ladder
          : this.rng.float(0.05, 0.95);
        laneBands.push({
          y: yPos,
          color: this.rng.float(0, 1) < 0.5 ? 'primary' : 'secondary',
          width: this.bandWidth * this.rng.float(0.8, 1.2),
        });
      }
      laneBands.sort((a, b) => a.y - b.y);
      this.bands.push(laneBands);
    }

    // Canvas + texture
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvasW;
    this.canvas.height = this.canvasH;
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;

    // Mesh for gel image
    const geo = new THREE.PlaneGeometry(w, h);
    this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      opacity: 0,
    }));
    this.mesh.position.set(x + w / 2, y + h / 2, 1);
    this.group.add(this.mesh);

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

    // Lane dividers
    const laneVerts: number[] = [];
    for (let i = 1; i < this.laneCount; i++) {
      const lx = x + (w * i) / this.laneCount;
      laneVerts.push(lx, y, 0, lx, y + h, 0);
    }
    if (laneVerts.length > 0) {
      const lg = new THREE.BufferGeometry();
      lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(laneVerts), 3));
      this.laneLines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({
        color: this.palette.dim,
        transparent: true,
        opacity: 0,
      }));
      this.group.add(this.laneLines);
    }

    // Well markers at top (small horizontal lines per lane)
    const wellVerts: number[] = [];
    const wellH = h * 0.02;
    for (let i = 0; i < this.laneCount; i++) {
      const laneX = x + (w * i) / this.laneCount;
      const laneW = w / this.laneCount;
      const wlx = laneX + laneW * 0.2;
      const wrx = laneX + laneW * 0.8;
      const wy = y + h - wellH;
      // Well rectangle (top of region, since y increases upward in Three.js)
      wellVerts.push(wlx, wy, 0, wrx, wy, 0);
      wellVerts.push(wrx, wy, 0, wrx, y + h, 0);
      wellVerts.push(wrx, y + h, 0, wlx, y + h, 0);
      wellVerts.push(wlx, y + h, 0, wlx, wy, 0);
    }
    const wg = new THREE.BufferGeometry();
    wg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(wellVerts), 3));
    this.wellMarkers = new THREE.LineSegments(wg, new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.wellMarkers);

    // Molecular weight ruler on left side (tick marks)
    const rulerVerts: number[] = [];
    const tickCount = 8;
    const tickLen = w * 0.03;
    for (let i = 0; i <= tickCount; i++) {
      const ty = y + (h * i) / tickCount;
      rulerVerts.push(x, ty, 0, x + tickLen, ty, 0);
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(rulerVerts), 3));
    this.rulerLines = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.rulerLines);

    // Initial canvas render
    this.renderCanvas();
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);

    // Migrate bands downward (in canvas space, downward = increasing y = decreasing Three.js y)
    for (let lane = 0; lane < this.laneCount; lane++) {
      const laneBands = this.bands[lane];
      for (let b = laneBands.length - 1; b >= 0; b--) {
        laneBands[b].y += this.migrationSpeed * dt;
        if (laneBands[b].y > 1.05) {
          // Band reached bottom — replace with new band at top
          laneBands[b].y = -0.02;
          laneBands[b].color = this.rng.float(0, 1) < 0.5 ? 'primary' : 'secondary';
          laneBands[b].width = this.bandWidth * this.rng.float(0.8, 1.2);
        }
      }
    }

    // Render canvas at reduced framerate
    this.renderAccum += dt;
    if (this.renderAccum >= this.RENDER_INTERVAL) {
      this.renderAccum = 0;
      this.renderCanvas();
    }

    (this.mesh.material as THREE.MeshBasicMaterial).opacity = opacity * 0.9;
    (this.borderLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.3;
    if (this.laneLines) {
      (this.laneLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.2;
    }
    (this.wellMarkers.material as THREE.LineBasicMaterial).opacity = opacity * 0.25;
    (this.rulerLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.25;
  }

  private renderCanvas(): void {
    const { ctx, canvasW, canvasH } = this;
    const bgHex = '#' + this.palette.bg.getHexString();
    const primaryHex = '#' + this.palette.primary.getHexString();
    const secondaryHex = '#' + this.palette.secondary.getHexString();
    const dimHex = '#' + this.palette.dim.getHexString();

    // Clear to transparent
    ctx.clearRect(0, 0, canvasW, canvasH);

    const laneW = canvasW / this.laneCount;

    // Draw bands per lane
    for (let lane = 0; lane < this.laneCount; lane++) {
      const laneX = lane * laneW;
      const laneBands = this.bands[lane];

      for (const band of laneBands) {
        if (band.y < -0.05 || band.y > 1.05) continue;

        const bandColor = band.color === 'primary' ? primaryHex : secondaryHex;
        const bandH = canvasH * 0.015 * (this.blurPasses > 3 ? 2.5 : 1);
        const bandW = laneW * band.width;
        const bx = laneX + (laneW - bandW) / 2;
        const by = band.y * canvasH;

        // Soft gaussian-like edges: draw multiple rects with decreasing alpha
        const passes = this.blurPasses + 2;
        for (let p = passes; p >= 0; p--) {
          const expand = p * 2;
          const alpha = p === 0 ? 0.85 : 0.15 / p;
          ctx.fillStyle = bandColor;
          ctx.globalAlpha = alpha;
          ctx.fillRect(
            bx - expand,
            by - bandH / 2 - expand,
            bandW + expand * 2,
            bandH + expand * 2,
          );
        }
        ctx.globalAlpha = 1.0;
      }
    }

    // Draw wells at top (canvas top = y 0)
    ctx.fillStyle = dimHex;
    ctx.globalAlpha = 0.4;
    const wellHeight = canvasH * 0.025;
    for (let lane = 0; lane < this.laneCount; lane++) {
      const laneX = lane * laneW;
      const wlx = laneX + laneW * 0.2;
      const ww = laneW * 0.6;
      ctx.fillRect(wlx, 0, ww, wellHeight);
    }

    // Draw ruler ticks on left side
    ctx.globalAlpha = 0.35;
    const tickCount = 8;
    const tickLen = canvasW * 0.03;
    for (let i = 0; i <= tickCount; i++) {
      const ty = (canvasH * i) / tickCount;
      ctx.fillRect(0, ty - 0.5, tickLen, 1);
    }
    ctx.globalAlpha = 1.0;

    this.texture.needsUpdate = true;
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) return;

    // Migration speed increases with level
    this.migrationSpeed = 0.04 + level * 0.02;

    if (level >= 5) {
      // All bands rush to bottom then reset
      for (const laneBands of this.bands) {
        for (const band of laneBands) {
          band.y = 1.1; // will be reset on next update cycle
        }
      }
    }
  }

  dispose(): void {
    this.texture.dispose();
    super.dispose();
  }
}
