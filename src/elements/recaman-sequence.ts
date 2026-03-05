import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Recaman's sequence rendered as nested semicircular arcs. Each jump in the
 * sequence is visualized as an arc above or below the axis, alternating
 * direction. Arcs accumulate over time creating an intricate layered pattern.
 */
export class RecamanSequenceElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'recaman-sequence',
    meta: {
      shape: 'rectangular',
      roles: ['data-display', 'decorative'],
      moods: ['ambient', 'diagnostic'],
      bandAffinity: 'mid',
      sizes: ['needs-medium', 'needs-large'],
    },
  };

  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private texture!: THREE.CanvasTexture;
  private mesh!: THREE.Mesh;
  private material!: THREE.MeshBasicMaterial;

  private cw: number = 0;
  private ch: number = 0;
  private sequence: number[] = [];
  private visited: Set<number> = new Set();
  private currentStep: number = 0;
  private maxSteps: number = 80;
  private addRate: number = 1;
  private scale: number = 1;
  private lineWidth: number = 1.2;
  private accum: number = 0;
  private stepInterval: number = 0.15;
  private intensityLevel: number = 0;

  build(): void {
    const variant = this.rng.int(0, 3);
    const presets = [
      { maxSteps: 80, interval: 0.15, lineW: 1.2 },  // Standard
      { maxSteps: 150, interval: 0.08, lineW: 0.8 },  // Dense fast
      { maxSteps: 50, interval: 0.3, lineW: 2.0 },    // Sparse slow
      { maxSteps: 120, interval: 0.1, lineW: 1.0 },   // Medium dense
    ];
    const p = presets[variant];

    this.maxSteps = p.maxSteps;
    this.stepInterval = p.interval;
    this.lineWidth = p.lineW;
    this.currentStep = 0;
    this.glitchAmount = 4;

    // Build the Recaman sequence
    this.sequence = [0];
    this.visited = new Set([0]);
    let current = 0;
    for (let n = 1; n <= this.maxSteps; n++) {
      const back = current - n;
      if (back > 0 && !this.visited.has(back)) {
        current = back;
      } else {
        current = current + n;
      }
      this.sequence.push(current);
      this.visited.add(current);
    }

    const { x, y, w, h } = this.px;
    this.cw = Math.max(128, Math.floor(w * 0.8));
    this.ch = Math.max(64, Math.floor(h * 0.8));

    // Scale to fit largest value
    const maxVal = Math.max(...this.sequence);
    this.scale = (this.cw - 20) / maxVal;

    this.canvas = document.createElement('canvas');
    this.canvas.width = this.cw;
    this.canvas.height = this.ch;
    this.ctx = this.get2DContext(this.canvas);

    // Clear
    this.ctx.fillStyle = `rgb(${Math.floor(this.palette.bg.r * 255)},${Math.floor(this.palette.bg.g * 255)},${Math.floor(this.palette.bg.b * 255)})`;
    this.ctx.fillRect(0, 0, this.cw, this.ch);

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.magFilter = THREE.NearestFilter;

    this.material = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      opacity: 0,
    });

    const geo = new THREE.PlaneGeometry(w, h);
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.position.set(x + w / 2, y + h / 2, 0);
    this.group.add(this.mesh);
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);
    this.material.opacity = opacity;

    this.accum += dt;
    const interval = this.stepInterval / (1 + this.intensityLevel * 0.5);
    if (this.accum < interval) return;
    this.accum = 0;

    if (this.currentStep >= this.maxSteps) {
      // Reset after a pause
      this.currentStep = 0;
      this.ctx.fillStyle = `rgb(${Math.floor(this.palette.bg.r * 255)},${Math.floor(this.palette.bg.g * 255)},${Math.floor(this.palette.bg.b * 255)})`;
      this.ctx.fillRect(0, 0, this.cw, this.ch);
      // Draw axis line
      this.ctx.strokeStyle = `rgba(${Math.floor(this.palette.dim.r * 255)},${Math.floor(this.palette.dim.g * 255)},${Math.floor(this.palette.dim.b * 255)},0.3)`;
      this.ctx.lineWidth = 0.5;
      this.ctx.beginPath();
      this.ctx.moveTo(10, this.ch / 2);
      this.ctx.lineTo(this.cw - 10, this.ch / 2);
      this.ctx.stroke();
    }

    if (this.currentStep < this.maxSteps) {
      this.drawArc(this.currentStep);
      this.currentStep++;
      this.texture.needsUpdate = true;
    }
  }

  private drawArc(step: number): void {
    const from = this.sequence[step];
    const to = this.sequence[step + 1];
    if (to === undefined) return;

    const ctx = this.ctx;
    const midY = this.ch / 2;
    const offset = 10;

    const x1 = offset + from * this.scale;
    const x2 = offset + to * this.scale;
    const centerX = (x1 + x2) / 2;
    const radius = Math.abs(x2 - x1) / 2;

    // Alternate above/below
    const above = step % 2 === 0;
    const startAngle = above ? Math.PI : 0;
    const endAngle = above ? 0 : Math.PI;

    // Color based on step
    const t = step / this.maxSteps;
    const pr = this.palette.primary;
    const sr = this.palette.secondary;
    const r = Math.floor((pr.r * (1 - t) + sr.r * t) * 255);
    const g = Math.floor((pr.g * (1 - t) + sr.g * t) * 255);
    const b = Math.floor((pr.b * (1 - t) + sr.b * t) * 255);

    ctx.strokeStyle = `rgba(${r},${g},${b},0.6)`;
    ctx.lineWidth = this.lineWidth;
    ctx.beginPath();
    ctx.arc(centerX, midY, radius, startAngle, endAngle, above);
    ctx.stroke();
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Add random noise arcs
      for (let i = 0; i < 5; i++) {
        const r = this.rng.float(5, this.ch / 4);
        const cx = this.rng.float(10, this.cw - 10);
        this.ctx.strokeStyle = `rgba(${Math.floor(this.palette.secondary.r * 255)},${Math.floor(this.palette.secondary.g * 255)},${Math.floor(this.palette.secondary.b * 255)},0.3)`;
        this.ctx.lineWidth = 0.5;
        this.ctx.beginPath();
        this.ctx.arc(cx, this.ch / 2, r, 0, Math.PI * 2);
        this.ctx.stroke();
      }
      this.texture.needsUpdate = true;
    }
    if (action === 'pulse') {
      this.currentStep = 0;
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    this.intensityLevel = level;
  }
}
