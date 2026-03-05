import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Hexagonal grid — NERV-style honeycomb pattern.
 * Cells activate individually with staggered timing, some pulsing, some solid.
 */
export class HexGridElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'hex-grid',
    meta: { shape: 'radial', roles: ['decorative', 'scanner'], moods: ['tactical'], bandAffinity: 'mid', sizes: ['needs-medium', 'needs-large'] },
  };
  private cellActivation: number[] = [];
  private cellTargetBright: number[] = [];
  private activationSpeed: number = 0;
  /** Per-cell center coords (element-local) and hex radius */
  private cellCenters: { lx: number; ly: number }[] = [];
  private hexR = 0;
  private fillR = 0;
  /** Per-cell color: true = alert, false = primary */
  private cellColors: boolean[] = [];

  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private texture!: THREE.CanvasTexture;
  private mesh!: THREE.Mesh;
  private canvasW = 0;
  private canvasH = 0;
  private renderAccum = 0;
  private readonly renderInterval = 1 / 15;

  build(): void {
    const variant = this.rng.int(0, 3);
    const presets = [
      { hexSizeMin: 0.04, hexSizeMax: 0.08, actSpeed: [2, 6], fillMin: 0.05, fillMax: 0.4, delayFactor: 0.15 },   // Standard
      { hexSizeMin: 0.025, hexSizeMax: 0.045, actSpeed: [5, 10], fillMin: 0.15, fillMax: 0.7, delayFactor: 0.08 }, // Dense
      { hexSizeMin: 0.07, hexSizeMax: 0.12, actSpeed: [1, 3], fillMin: 0.02, fillMax: 0.2, delayFactor: 0.25 },    // Minimal
      { hexSizeMin: 0.03, hexSizeMax: 0.06, actSpeed: [0.5, 2], fillMin: 0.3, fillMax: 0.9, delayFactor: 0.04 },   // Exotic
    ];
    const p = presets[variant];

    const { x, y, w, h } = this.px;
    this.hexR = Math.min(w, h) * this.rng.float(p.hexSizeMin, p.hexSizeMax);
    this.fillR = this.hexR * 0.6;
    const hexW = this.hexR * Math.sqrt(3);
    const hexH = this.hexR * 2;
    const cols = Math.floor(w / hexW);
    const rows = Math.floor(h / (hexH * 0.75));
    this.activationSpeed = this.rng.float(p.actSpeed[0], p.actSpeed[1]);

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const offsetX = (row % 2) * (hexW / 2);
        const cx = col * hexW + offsetX + hexW / 2;
        const cy = row * (hexH * 0.75) + this.hexR;
        if (cx + this.hexR > w || cy + this.hexR > h) continue;

        this.cellCenters.push({ lx: cx, ly: cy });
        this.cellColors.push(false);

        const dist = Math.sqrt((col - cols / 2) ** 2 + (row - rows / 2) ** 2);
        this.cellActivation.push(-dist * p.delayFactor);
        this.cellTargetBright.push(this.rng.float(p.fillMin, p.fillMax));
      }
    }

    // Canvas
    const scale = Math.min(1, 300 / Math.max(w, h));
    this.canvasW = Math.max(32, Math.round(w * scale));
    this.canvasH = Math.max(32, Math.round(h * scale));

    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvasW;
    this.canvas.height = this.canvasH;
    this.ctx = this.get2DContext(this.canvas);

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
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    (this.mesh.material as THREE.MeshBasicMaterial).opacity = opacity;

    // Update activation state (always runs)
    for (let i = 0; i < this.cellCenters.length; i++) {
      this.cellActivation[i] += dt * this.activationSpeed;
    }

    // Throttle canvas rendering to ~15fps
    this.renderAccum += dt;
    if (this.renderAccum < this.renderInterval) return;
    this.renderAccum = 0;

    const { w, h } = this.px;
    const ctx = this.ctx;
    const cw = this.canvasW;
    const ch = this.canvasH;
    const scaleX = cw / w;
    const scaleY = ch / h;

    ctx.clearRect(0, 0, cw, ch);

    const primR = Math.round(this.palette.primary.r * 255);
    const primG = Math.round(this.palette.primary.g * 255);
    const primB = Math.round(this.palette.primary.b * 255);
    const alertR = Math.round(this.palette.alert.r * 255);
    const alertG = Math.round(this.palette.alert.g * 255);
    const alertB = Math.round(this.palette.alert.b * 255);

    const hexRCanvas = this.hexR * Math.min(scaleX, scaleY);
    const fillRCanvas = this.fillR * Math.min(scaleX, scaleY);

    // Precompute hex angles
    const angles: { cos: number; sin: number }[] = [];
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i - Math.PI / 6;
      angles.push({ cos: Math.cos(a), sin: Math.sin(a) });
    }

    for (let i = 0; i < this.cellCenters.length; i++) {
      const t = Math.max(0, Math.min(1, this.cellActivation[i]));
      const elastic = t < 1 ? 1 - Math.pow(1 - t, 3) * Math.cos(t * Math.PI * 2) : 1;
      const cellOpacity = elastic;

      if (cellOpacity <= 0.001) continue;

      const { lx, ly } = this.cellCenters[i];
      const cx = lx * scaleX;
      const cy = ly * scaleY;

      const isAlert = this.cellColors[i];
      const r = isAlert ? alertR : primR;
      const g = isAlert ? alertG : primG;
      const b = isAlert ? alertB : primB;

      // Draw hex outline
      ctx.strokeStyle = `rgba(${r},${g},${b},${cellOpacity * 0.6})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx + angles[0].cos * hexRCanvas, cy + angles[0].sin * hexRCanvas);
      for (let j = 1; j < 6; j++) {
        ctx.lineTo(cx + angles[j].cos * hexRCanvas, cy + angles[j].sin * hexRCanvas);
      }
      ctx.closePath();
      ctx.stroke();

      // Draw fill hexagon
      const fillBright = this.cellTargetBright[i] * (0.7 + Math.sin(time * 2 + i * 0.7) * 0.3);
      ctx.fillStyle = `rgba(${r},${g},${b},${cellOpacity * fillBright})`;
      ctx.beginPath();
      ctx.moveTo(cx + angles[0].cos * fillRCanvas, cy + angles[0].sin * fillRCanvas);
      for (let j = 1; j < 6; j++) {
        ctx.lineTo(cx + angles[j].cos * fillRCanvas, cy + angles[j].sin * fillRCanvas);
      }
      ctx.closePath();
      ctx.fill();
    }

    this.texture.needsUpdate = true;
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) return;
    const count = this.cellTargetBright.length;
    if (level >= 5) {
      for (let i = 0; i < count; i++) {
        if (this.rng.chance(0.5)) {
          this.cellTargetBright[i] = 1.0;
        }
      }
    } else if (level >= 3) {
      for (let i = 0; i < count; i++) {
        if (this.rng.chance(0.3)) {
          this.cellTargetBright[i] = Math.min(1.0, this.cellTargetBright[i] + 0.5);
        }
      }
    }
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      for (let i = 0; i < this.cellCenters.length; i++) {
        if (this.rng.chance(0.3)) {
          this.cellTargetBright[i] = this.rng.float(0.5, 1.0);
        }
      }
    }
    if (action === 'alert') {
      this.pulseTimer = 2.0;
      for (let i = 0; i < this.cellCenters.length; i++) {
        this.cellColors[i] = this.rng.chance(0.4);
      }
    }
  }
}
