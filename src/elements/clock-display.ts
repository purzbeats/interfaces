import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';
import { applyScanlines, drawGlowText } from '../animation/retro-text';

/**
 * Mission clock with large HH:MM:SS.mmm digits, blinking colon, and sweep indicator.
 * Canvas-based text rendering.
 */
export class ClockDisplayElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'clock-display',
    meta: { shape: 'linear', roles: ['text', 'data-display'], moods: ['tactical', 'diagnostic'], bandAffinity: 'bass', audioSensitivity: 0.6, sizes: ['works-small'] },
  };
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private texture!: THREE.CanvasTexture;
  private mesh!: THREE.Mesh;
  private borderLines!: THREE.LineSegments;
  private sweepLine!: THREE.Line;
  private missionTime: number = 0;
  private colonVisible: boolean = true;
  private colonTimer: number = 0;
  private renderAccum: number = 0;
  private timeScale: number = 1;
  private label: string = '';

  build(): void {
    const variant = this.rng.int(0, 3);
    const presets = [
      { timeMax: 86400, scales: [1, 1, 1, 10, 60], labels: ['MISSION TIME', 'ELAPSED', 'T+', 'SYSTEM CLOCK', 'UTC'], fontScale: 0.45, blinkRate: 0.5, sweepOpacity: 0.6, format: 'full' as const },
      { timeMax: 86400, scales: [10, 60, 60, 100], labels: ['FAST CLOCK', 'ACCEL TIME', 'WARP T+'], fontScale: 0.55, blinkRate: 0.25, sweepOpacity: 0.9, format: 'full' as const },
      { timeMax: 3600, scales: [1, 1], labels: ['ELAPSED', 'T+', 'TIMER'], fontScale: 0.35, blinkRate: 1.0, sweepOpacity: 0.3, format: 'mmss' as const },
      { timeMax: 86400 * 7, scales: [1, 10, 1], labels: ['EPOCH', 'STARDATE', 'SOL'], fontScale: 0.50, blinkRate: 0.15, sweepOpacity: 0.5, format: 'compact' as const },
    ];
    const p = presets[variant];

    this.glitchAmount = 3;
    const { x, y, w, h } = this.px;
    this.missionTime = this.rng.float(0, p.timeMax);
    this.timeScale = this.rng.pick(p.scales);
    this.label = this.rng.pick(p.labels);
    (this as any)._fontScale = p.fontScale + this.rng.float(-0.03, 0.03);
    (this as any)._blinkRate = p.blinkRate;
    (this as any)._sweepOpacity = p.sweepOpacity;
    (this as any)._format = p.format;

    const scale = Math.min(2, window.devicePixelRatio);
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.ceil(w * scale);
    this.canvas.height = Math.ceil(h * scale);
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.LinearFilter;

    const geo = new THREE.PlaneGeometry(w, h);
    this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      opacity: 0,
    }));
    this.mesh.position.set(x + w / 2, y + h / 2, 1);
    this.group.add(this.mesh);

    // Sweep indicator (seconds progress bar at bottom)
    const sweepGeo = new THREE.BufferGeometry();
    const sweepPos = new Float32Array([x, y + 2, 2, x, y + 2, 2]);
    sweepGeo.setAttribute('position', new THREE.BufferAttribute(sweepPos, 3));
    this.sweepLine = new THREE.Line(sweepGeo, new THREE.LineBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.sweepLine);

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
    const opacity = this.applyEffects(dt);
    const { x, y, w, h } = this.px;

    this.missionTime += dt * this.timeScale;

    // Blink colon
    this.colonTimer += dt;
    if (this.colonTimer >= (this as any)._blinkRate) {
      this.colonTimer = 0;
      this.colonVisible = !this.colonVisible;
    }

    // Sweep indicator — fraction of current second
    const secFrac = (this.missionTime % 1);
    const sweepPos = this.sweepLine.geometry.getAttribute('position') as THREE.BufferAttribute;
    sweepPos.setX(1, x + w * secFrac);
    sweepPos.needsUpdate = true;
    (this.sweepLine.material as THREE.LineBasicMaterial).opacity = opacity * (this as any)._sweepOpacity;

    // Render canvas at reduced rate
    this.renderAccum += dt;
    if (this.renderAccum >= 1 / 15) {
      this.renderAccum = 0;
      this.renderCanvas();
    }

    (this.mesh.material as THREE.MeshBasicMaterial).opacity = opacity;
    (this.borderLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.3;
  }

  private renderCanvas(): void {
    const { ctx, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const t = this.missionTime;
    const hours = Math.floor(t / 3600) % 100;
    const mins = Math.floor((t % 3600) / 60);
    const secs = Math.floor(t % 60);
    const ms = Math.floor((t % 1) * 1000);

    const colon = this.colonVisible || this.glitchTimer > 0 ? ':' : ' ';
    const fmt = (this as any)._format;
    let timeStr: string;
    if (fmt === 'mmss') {
      timeStr = `${String(mins).padStart(2, '0')}${colon}${String(secs).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
    } else if (fmt === 'compact') {
      timeStr = `${String(hours).padStart(2, '0')}${colon}${String(mins).padStart(2, '0')}${colon}${String(secs).padStart(2, '0')}`;
    } else {
      timeStr = `${String(hours).padStart(2, '0')}${colon}${String(mins).padStart(2, '0')}${colon}${String(secs).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
    }

    const primaryHex = '#' + this.palette.primary.getHexString();
    const dimHex = '#' + this.palette.dim.getHexString();

    // Time display with phosphor glow — constrain to both height and width
    const fScale = (this as any)._fontScale;
    const heightSize = Math.floor(canvas.height * fScale);
    const widthSize = Math.floor(canvas.width / (timeStr.length * 0.65));
    const bigSize = Math.max(8, Math.min(heightSize, widthSize));
    ctx.font = `bold ${bigSize}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    if (this.glitchTimer > 0) {
      const garbled = timeStr.split('').map((c, i) =>
        Math.sin(i * 17 + this.glitchTimer * 40) > 0.5
          ? String.fromCharCode(33 + ((c.charCodeAt(0) * 7) % 60))
          : c
      ).join('');
      drawGlowText(ctx, garbled, canvas.width / 2, canvas.height * 0.45, '#' + this.palette.secondary.getHexString(), 10);
    } else {
      drawGlowText(ctx, timeStr, canvas.width / 2, canvas.height * 0.45, primaryHex, 8);
    }

    // Label with subtle glow — scale to fit width
    const smallHeight = Math.floor(canvas.height * 0.15);
    const smallWidth = Math.floor(canvas.width / (this.label.length * 0.65));
    const smallSize = Math.max(6, Math.min(smallHeight, smallWidth));
    ctx.font = `${smallSize}px monospace`;
    drawGlowText(ctx, this.label, canvas.width / 2, canvas.height * 0.8, dimHex, 2);

    // Scanline overlay
    applyScanlines(ctx, canvas, 0.08, this.missionTime);

    this.texture.needsUpdate = true;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'alert') {
      this.pulseTimer = 2.0;
      this.missionTime = 0; // Reset timer on alert
    }
  }

  dispose(): void {
    this.texture.dispose();
    super.dispose();
  }
}
