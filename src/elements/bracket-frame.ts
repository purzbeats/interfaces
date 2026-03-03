import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Animated bracket frame — corner brackets that expand outward from center,
 * with data labels and tick marks along edges. Classic sci-fi targeting overlay.
 */
export class BracketFrameElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'bracket-frame',
    meta: { shape: 'rectangular', roles: ['structural', 'scanner'], moods: ['tactical'], bandAffinity: 'bass', sizes: ['needs-medium', 'needs-large'] },
  };
  private corners: THREE.LineSegments[] = [];
  private edgeLines!: THREE.LineSegments;
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private texture!: THREE.CanvasTexture;
  private labelMesh!: THREE.Mesh;
  private expandProgress: number = 0;
  private expandTarget: number = 1;
  private renderAccum: number = 0;
  private coordText: string = '';

  build(): void {
    const variant = this.rng.int(0, 3);
    const presets = [
      { bracketScale: 0.2, tickMin: 8, tickMax: 16, overshoot: 0.05, labelRate: 10 },
      { bracketScale: 0.3, tickMin: 16, tickMax: 32, overshoot: 0.12, labelRate: 20 },
      { bracketScale: 0.12, tickMin: 4, tickMax: 8, overshoot: 0.02, labelRate: 5 },
      { bracketScale: 0.35, tickMin: 6, tickMax: 12, overshoot: 0.18, labelRate: 15 },
    ];
    const p = presets[variant];

    const { x, y, w, h } = this.px;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const bracketLen = Math.min(w, h) * p.bracketScale;
    const bracketThick = 2;
    (this as any)._overshootAmount = p.overshoot + this.rng.float(-0.01, 0.01);
    (this as any)._labelRate = p.labelRate;

    // Generate fake coordinates
    this.coordText = `X:${this.rng.int(100, 999)} Y:${this.rng.int(100, 999)}`;

    // Four corners — each is a LineSegments that will animate from center
    const cornerPositions = [
      { ox: x, oy: y, dx: 1, dy: 1 },           // top-left
      { ox: x + w, oy: y, dx: -1, dy: 1 },       // top-right
      { ox: x + w, oy: y + h, dx: -1, dy: -1 },  // bottom-right
      { ox: x, oy: y + h, dx: 1, dy: -1 },       // bottom-left
    ];

    for (const cp of cornerPositions) {
      const verts = new Float32Array([
        // Horizontal arm
        cp.ox, cp.oy, 1,
        cp.ox + cp.dx * bracketLen, cp.oy, 1,
        // Vertical arm
        cp.ox, cp.oy, 1,
        cp.ox, cp.oy + cp.dy * bracketLen, 1,
        // Small inner tick
        cp.ox + cp.dx * bracketLen * 0.3, cp.oy, 1,
        cp.ox + cp.dx * bracketLen * 0.3, cp.oy + cp.dy * bracketLen * 0.15, 1,
      ]);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
      const corner = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
        color: this.palette.primary,
        transparent: true,
        opacity: 0,
      }));
      this.corners.push(corner);
      this.group.add(corner);
    }

    // Edge tick marks along top and right
    const edgeVerts: number[] = [];
    const tickCount = this.rng.int(p.tickMin, p.tickMax);
    const tickBase = Math.max(4, Math.min(w, h) * 0.015);
    for (let i = 0; i <= tickCount; i++) {
      const t = i / tickCount;
      // Top edge ticks
      const tx = x + w * t;
      const tickH = (i % 4 === 0) ? tickBase * 2 : tickBase;
      edgeVerts.push(tx, y, 0.5, tx, y + tickH, 0.5);
      // Bottom edge ticks
      edgeVerts.push(tx, y + h, 0.5, tx, y + h - tickH, 0.5);
    }
    const edgeGeo = new THREE.BufferGeometry();
    edgeGeo.setAttribute('position', new THREE.Float32BufferAttribute(edgeVerts, 3));
    this.edgeLines = new THREE.LineSegments(edgeGeo, new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.edgeLines);

    // Label canvas in corner — scale to region
    const scale = Math.min(2, window.devicePixelRatio);
    const labelW = w * 0.5;
    const labelH = Math.max(16, h * 0.06);
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.ceil(labelW * scale);
    this.canvas.height = Math.ceil(labelH * scale);
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    const labelGeo = new THREE.PlaneGeometry(labelW, labelH);
    this.labelMesh = new THREE.Mesh(labelGeo, new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      opacity: 0,
    }));
    this.labelMesh.position.set(x + labelW / 2 + 10, y + h - labelH / 2 - 4, 2);
    this.group.add(this.labelMesh);
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);

    // Corners expand from center with overshoot
    const diff = this.expandTarget - this.expandProgress;
    this.expandProgress += diff * dt * 5;
    const overshoot = this.expandProgress + Math.sin(this.expandProgress * Math.PI) * (this as any)._overshootAmount;

    for (let i = 0; i < this.corners.length; i++) {
      const s = Math.max(0.01, overshoot);
      this.corners[i].scale.set(s, s, 1);
      (this.corners[i].material as THREE.LineBasicMaterial).opacity = opacity * 0.8;
    }

    (this.edgeLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.4;

    // Render label
    this.renderAccum += dt;
    if (this.renderAccum >= 1 / (this as any)._labelRate) {
      this.renderAccum = 0;
      const { ctx, canvas } = this;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const timeText = `T+${time.toFixed(1)}`;
      const fullText = this.coordText + '  ' + timeText;
      const heightSize = Math.floor(canvas.height * 0.6);
      const widthSize = Math.floor(canvas.width / (fullText.length * 0.62));
      const fontSize = Math.max(6, Math.min(heightSize, widthSize));
      ctx.font = `${fontSize}px monospace`;
      ctx.fillStyle = '#' + this.palette.dim.getHexString();
      ctx.textBaseline = 'middle';
      ctx.fillText(this.coordText, 4, canvas.height / 2);
      ctx.fillText(timeText, canvas.width * 0.55, canvas.height / 2);
      this.texture.needsUpdate = true;
    }
    (this.labelMesh.material as THREE.MeshBasicMaterial).opacity = opacity * 0.6;
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) return;
    if (level >= 5) {
      for (const c of this.corners) {
        (c.material as THREE.LineBasicMaterial).color.copy(this.palette.alert);
      }
      setTimeout(() => {
        for (const c of this.corners) {
          (c.material as THREE.LineBasicMaterial).color.copy(this.palette.primary);
        }
      }, 2000);
    }
    this.expandTarget = level >= 3 ? 0.7 : 0.85;
    setTimeout(() => { this.expandTarget = 1; }, 500);
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'activate') {
      this.expandProgress = 0;
      this.expandTarget = 1;
    }
    if (action === 'pulse') {
      this.expandTarget = 0.8;
      setTimeout(() => { this.expandTarget = 1; }, 200);
    }
    if (action === 'alert') {
      this.pulseTimer = 1.5;
      for (const c of this.corners) {
        (c.material as THREE.LineBasicMaterial).color.copy(this.palette.alert);
      }
    }
  }

  dispose(): void {
    this.texture.dispose();
    super.dispose();
  }
}
