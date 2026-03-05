import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Grid of Lissajous curves with varying frequency ratios.
 * Row i, column j shows x = sin(i*t), y = sin(j*t + phase).
 * Small curves tiled in a grid. Canvas rendered with animated phase.
 */
export class LissajousTableElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'lissajous-table',
    meta: {
      shape: 'rectangular',
      roles: ['data-display', 'decorative'],
      moods: ['diagnostic', 'ambient'],
      bandAffinity: 'high',
      sizes: ['needs-medium', 'needs-large'],
    },
  };

  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private texture!: THREE.CanvasTexture;
  private mesh!: THREE.Mesh;
  private cw = 0;
  private ch = 0;

  private gridSize = 0;
  private trailLength = 0;
  private phaseSpeed = 0;
  private lineWidth = 0;

  build(): void {
    this.glitchAmount = 4;
    const variant = this.rng.int(0, 3);
    const { x, y, w, h } = this.px;

    const presets = [
      { grid: 5, trail: 200, speed: 0.5,  lw: 1.5 },
      { grid: 7, trail: 150, speed: 0.3,  lw: 1.0 },
      { grid: 4, trail: 300, speed: 0.7,  lw: 2.0 },
      { grid: 6, trail: 180, speed: 0.4,  lw: 1.2 },
    ];
    const p = presets[variant];

    this.gridSize = p.grid;
    this.trailLength = p.trail;
    this.phaseSpeed = p.speed;
    this.lineWidth = p.lw;

    const maxRes = 300;
    const aspect = w / h;
    this.cw = Math.min(maxRes, Math.ceil(w));
    this.ch = Math.max(1, Math.ceil(this.cw / aspect));
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.cw;
    this.canvas.height = this.ch;
    this.ctx = this.get2DContext(this.canvas);

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.LinearFilter;
    const geo = new THREE.PlaneGeometry(w, h);
    this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      map: this.texture, transparent: true, opacity: 0,
    }));
    this.mesh.position.set(x + w / 2, y + h / 2, 0);
    this.group.add(this.mesh);
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    const phase = time * this.phaseSpeed;
    const g = this.gridSize;
    const cellW = this.cw / g;
    const cellH = this.ch / g;
    const margin = 3;
    const ampX = (cellW - margin * 2) * 0.42;
    const ampY = (cellH - margin * 2) * 0.42;

    // Background
    const bgr = (this.palette.bg.r * 255) | 0;
    const bgg = (this.palette.bg.g * 255) | 0;
    const bgb = (this.palette.bg.b * 255) | 0;
    this.ctx.fillStyle = `rgb(${bgr},${bgg},${bgb})`;
    this.ctx.fillRect(0, 0, this.cw, this.ch);

    // Grid lines
    const dr = (this.palette.dim.r * 255) | 0;
    const dg = (this.palette.dim.g * 255) | 0;
    const db = (this.palette.dim.b * 255) | 0;
    this.ctx.strokeStyle = `rgba(${dr},${dg},${db},0.3)`;
    this.ctx.lineWidth = 0.5;
    for (let i = 1; i < g; i++) {
      this.ctx.beginPath();
      this.ctx.moveTo(i * cellW, 0);
      this.ctx.lineTo(i * cellW, this.ch);
      this.ctx.stroke();
      this.ctx.beginPath();
      this.ctx.moveTo(0, i * cellH);
      this.ctx.lineTo(this.cw, i * cellH);
      this.ctx.stroke();
    }

    // Draw each Lissajous curve
    const pr = (this.palette.primary.r * 255) | 0;
    const pg = (this.palette.primary.g * 255) | 0;
    const pb = (this.palette.primary.b * 255) | 0;
    const sr = (this.palette.secondary.r * 255) | 0;
    const sg = (this.palette.secondary.g * 255) | 0;
    const sb = (this.palette.secondary.b * 255) | 0;

    for (let row = 0; row < g; row++) {
      for (let col = 0; col < g; col++) {
        const freqX = col + 1;
        const freqY = row + 1;
        const cx = col * cellW + cellW / 2;
        const cy = row * cellH + cellH / 2;

        // Draw trail
        this.ctx.lineWidth = this.lineWidth;
        this.ctx.beginPath();

        for (let i = 0; i <= this.trailLength; i++) {
          const t = phase - (this.trailLength - i) * 0.02;
          const lx = cx + Math.sin(freqX * t) * ampX;
          const ly = cy + Math.sin(freqY * t + phase * 0.5) * ampY;

          if (i === 0) {
            this.ctx.moveTo(lx, ly);
          } else {
            this.ctx.lineTo(lx, ly);
          }
        }

        // Color: mix primary and secondary based on grid position
        const mixT = (row + col) / (g * 2 - 2);
        const cr = (pr + (sr - pr) * mixT) | 0;
        const cg = (pg + (sg - pg) * mixT) | 0;
        const cb = (pb + (sb - pb) * mixT) | 0;
        this.ctx.strokeStyle = `rgba(${cr},${cg},${cb},0.7)`;
        this.ctx.stroke();

        // Draw current point as a dot
        const dotT = phase;
        const dotX = cx + Math.sin(freqX * dotT) * ampX;
        const dotY = cy + Math.sin(freqY * dotT + phase * 0.5) * ampY;
        this.ctx.fillStyle = `rgb(${pr},${pg},${pb})`;
        this.ctx.beginPath();
        this.ctx.arc(dotX, dotY, 2, 0, Math.PI * 2);
        this.ctx.fill();
      }
    }

    // Border
    this.ctx.strokeStyle = `rgb(${dr},${dg},${db})`;
    this.ctx.lineWidth = 1;
    this.ctx.strokeRect(0, 0, this.cw, this.ch);

    this.texture.needsUpdate = true;
    (this.mesh.material as THREE.MeshBasicMaterial).opacity = opacity;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Briefly spike the phase speed
      const saved = this.phaseSpeed;
      this.phaseSpeed = saved * 6;
      setTimeout(() => { this.phaseSpeed = saved; }, 400);
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) {
      this.phaseSpeed = 0.5;
      return;
    }
    this.phaseSpeed = 0.5 + level * 0.15;
  }
}
