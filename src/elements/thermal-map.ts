import * as THREE from 'three';
import { BaseElement } from './base-element';
import { stateOpacity, pulse, glitchOffset } from '../animation/fx';

/**
 * Heat-map grid of color-interpolated cells with wandering hotspot and heat diffusion.
 * Canvas-based rendering.
 */
export class ThermalMapElement extends BaseElement {
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private texture!: THREE.CanvasTexture;
  private mesh!: THREE.Mesh;
  private borderLines!: THREE.LineSegments;
  private gridW: number = 0;
  private gridH: number = 0;
  private heatGrid: number[] = [];
  private hotspotX: number = 0;
  private hotspotY: number = 0;
  private hotspotVx: number = 0;
  private hotspotVy: number = 0;
  private pulseTimer: number = 0;
  private glitchTimer: number = 0;
  private renderAccum: number = 0;
  private readonly RENDER_INTERVAL = 1 / 12;

  build(): void {
    const { x, y, w, h } = this.px;
    const cellSize = this.rng.pick([8, 10, 12]);
    this.gridW = Math.max(4, Math.floor(w / cellSize));
    this.gridH = Math.max(4, Math.floor(h / cellSize));
    this.heatGrid = new Array(this.gridW * this.gridH).fill(0);

    this.hotspotX = this.rng.float(0, this.gridW);
    this.hotspotY = this.rng.float(0, this.gridH);
    this.hotspotVx = this.rng.float(-2, 2);
    this.hotspotVy = this.rng.float(-2, 2);

    this.canvas = document.createElement('canvas');
    this.canvas.width = this.gridW;
    this.canvas.height = this.gridH;
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.magFilter = THREE.NearestFilter;

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
  }

  update(dt: number, _time: number): void {
    let opacity = stateOpacity(this.stateMachine.state, this.stateMachine.progress);

    if (this.pulseTimer > 0) {
      this.pulseTimer -= dt;
      opacity *= pulse(this.pulseTimer);
    }

    const gx = this.glitchTimer > 0 ? glitchOffset(this.glitchTimer, 4) : 0;
    if (this.glitchTimer > 0) this.glitchTimer -= dt;
    this.group.position.x = gx;

    // Move hotspot
    this.hotspotX += this.hotspotVx * dt;
    this.hotspotY += this.hotspotVy * dt;

    // Bounce off walls
    if (this.hotspotX < 0 || this.hotspotX >= this.gridW) {
      this.hotspotVx *= -1;
      this.hotspotX = Math.max(0, Math.min(this.gridW - 1, this.hotspotX));
    }
    if (this.hotspotY < 0 || this.hotspotY >= this.gridH) {
      this.hotspotVy *= -1;
      this.hotspotY = Math.max(0, Math.min(this.gridH - 1, this.hotspotY));
    }

    // Random velocity changes
    this.hotspotVx += (this.rng.float(-1, 1)) * dt * 2;
    this.hotspotVy += (this.rng.float(-1, 1)) * dt * 2;
    this.hotspotVx = Math.max(-3, Math.min(3, this.hotspotVx));
    this.hotspotVy = Math.max(-3, Math.min(3, this.hotspotVy));

    // Heat source at hotspot
    const hx = Math.floor(this.hotspotX);
    const hy = Math.floor(this.hotspotY);
    if (hx >= 0 && hx < this.gridW && hy >= 0 && hy < this.gridH) {
      this.heatGrid[hy * this.gridW + hx] = 1;
    }

    // Diffusion step
    const newGrid = new Array(this.gridW * this.gridH);
    for (let gy = 0; gy < this.gridH; gy++) {
      for (let gx2 = 0; gx2 < this.gridW; gx2++) {
        const idx = gy * this.gridW + gx2;
        let sum = this.heatGrid[idx] * 4;
        let count = 4;
        if (gx2 > 0) { sum += this.heatGrid[idx - 1]; count++; }
        if (gx2 < this.gridW - 1) { sum += this.heatGrid[idx + 1]; count++; }
        if (gy > 0) { sum += this.heatGrid[idx - this.gridW]; count++; }
        if (gy < this.gridH - 1) { sum += this.heatGrid[idx + this.gridW]; count++; }
        newGrid[idx] = (sum / count) * 0.98; // slight decay
      }
    }
    this.heatGrid = newGrid;

    // Render canvas at reduced rate
    this.renderAccum += dt;
    if (this.renderAccum >= this.RENDER_INTERVAL) {
      this.renderAccum = 0;
      this.renderCanvas();
    }

    (this.mesh.material as THREE.MeshBasicMaterial).opacity = opacity * 0.9;
    (this.borderLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.3;
  }

  private renderCanvas(): void {
    const { ctx, canvas } = this;
    const imgData = ctx.createImageData(canvas.width, canvas.height);
    const data = imgData.data;

    const primary = this.palette.primary;
    const secondary = this.palette.secondary;
    const alert = this.palette.alert;
    const bg = this.palette.bg;

    for (let i = 0; i < this.heatGrid.length; i++) {
      const v = Math.min(1, this.heatGrid[i]);
      let r: number, g: number, b: number;

      if (v < 0.5) {
        // bg -> primary
        const t = v * 2;
        r = bg.r + (primary.r - bg.r) * t;
        g = bg.g + (primary.g - bg.g) * t;
        b = bg.b + (primary.b - bg.b) * t;
      } else if (v < 0.8) {
        // primary -> secondary
        const t = (v - 0.5) / 0.3;
        r = primary.r + (secondary.r - primary.r) * t;
        g = primary.g + (secondary.g - primary.g) * t;
        b = primary.b + (secondary.b - primary.b) * t;
      } else {
        // secondary -> alert
        const t = (v - 0.8) / 0.2;
        r = secondary.r + (alert.r - secondary.r) * t;
        g = secondary.g + (alert.g - secondary.g) * t;
        b = secondary.b + (alert.b - secondary.b) * t;
      }

      data[i * 4] = Math.floor(r * 255);
      data[i * 4 + 1] = Math.floor(g * 255);
      data[i * 4 + 2] = Math.floor(b * 255);
      data[i * 4 + 3] = 255;
    }

    ctx.putImageData(imgData, 0, 0);
    this.texture.needsUpdate = true;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'pulse') this.pulseTimer = 0.5;
    if (action === 'glitch') {
      this.glitchTimer = 0.5;
      // Scramble heat values
      for (let i = 0; i < this.heatGrid.length; i++) {
        this.heatGrid[i] = this.rng.float(0, 1);
      }
    }
    if (action === 'alert') {
      this.pulseTimer = 1.5;
      // Max heat everywhere
      for (let i = 0; i < this.heatGrid.length; i++) {
        this.heatGrid[i] = 1;
      }
    }
  }

  dispose(): void {
    this.texture.dispose();
    super.dispose();
  }
}
