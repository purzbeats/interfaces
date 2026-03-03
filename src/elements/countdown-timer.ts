import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';
import { applyScanlines, drawGlowText } from '../animation/retro-text';

/**
 * Large digital countdown in HH:MM:SS with blinking colons.
 * Counts down from a random value and resets at zero.
 */
export class CountdownTimerElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'countdown-timer',
    meta: { shape: 'rectangular', roles: ['text', 'gauge'], moods: ['tactical'], bandAffinity: 'bass', audioSensitivity: 0.6, sizes: ['works-small', 'needs-medium'] },
  };
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private texture!: THREE.CanvasTexture;
  private mesh!: THREE.Mesh;
  private remaining: number = 0;
  private startValue: number = 0;
  private colonVisible: boolean = true;
  private colonTimer: number = 0;
  private renderAccum: number = 0;
  private label: string = '';
  private urgentThreshold: number = 60;

  build(): void {
    this.glitchAmount = 3;
    const { x, y, w, h } = this.px;
    this.startValue = this.rng.int(120, 36000);
    this.remaining = this.startValue;
    this.label = this.rng.pick(['COUNTDOWN', 'T-MINUS', 'TIME REMAINING', 'DETONATION', 'LAUNCH SEQ']);
    this.urgentThreshold = this.rng.float(30, 120);

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
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);

    // Count down
    this.remaining -= dt;
    if (this.remaining <= 0) {
      this.remaining = this.startValue;
    }

    // Blink colons
    this.colonTimer += dt;
    if (this.colonTimer >= 0.5) {
      this.colonTimer = 0;
      this.colonVisible = !this.colonVisible;
    }

    this.renderAccum += dt;
    if (this.renderAccum >= 1 / 15) {
      this.renderAccum = 0;
      this.renderCanvas();
    }

    (this.mesh.material as THREE.MeshBasicMaterial).opacity = opacity;
  }

  private renderCanvas(): void {
    const { ctx, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const t = Math.max(0, this.remaining);
    const hours = Math.floor(t / 3600);
    const mins = Math.floor((t % 3600) / 60);
    const secs = Math.floor(t % 60);

    const colon = this.colonVisible ? ':' : ' ';
    const timeStr = `${String(hours).padStart(2, '0')}${colon}${String(mins).padStart(2, '0')}${colon}${String(secs).padStart(2, '0')}`;

    const isUrgent = t < this.urgentThreshold;
    const primaryHex = '#' + (isUrgent ? this.palette.alert : this.palette.primary).getHexString();
    const dimHex = '#' + this.palette.dim.getHexString();

    // Time digits
    const heightSize = Math.floor(canvas.height * 0.45);
    const widthSize = Math.floor(canvas.width / (timeStr.length * 0.65));
    const bigSize = Math.max(8, Math.min(heightSize, widthSize));
    ctx.font = `bold ${bigSize}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    if (this.glitchTimer > 0) {
      const garbled = timeStr.split('').map((c, i) =>
        Math.sin(i * 13 + this.glitchTimer * 40) > 0.5
          ? String.fromCharCode(33 + ((c.charCodeAt(0) * 7) % 60))
          : c
      ).join('');
      drawGlowText(ctx, garbled, canvas.width / 2, canvas.height * 0.4, '#' + this.palette.secondary.getHexString(), 10);
    } else {
      drawGlowText(ctx, timeStr, canvas.width / 2, canvas.height * 0.4, primaryHex, isUrgent ? 12 : 8);
    }

    // Label
    const smallSize = Math.max(6, Math.floor(canvas.height * 0.12));
    ctx.font = `${smallSize}px monospace`;
    drawGlowText(ctx, this.label, canvas.width / 2, canvas.height * 0.78, dimHex, 2);

    // Progress bar at bottom
    const progress = this.remaining / this.startValue;
    ctx.fillStyle = primaryHex;
    ctx.globalAlpha = 0.3;
    ctx.fillRect(0, canvas.height - 4, canvas.width * progress, 4);
    ctx.globalAlpha = 1;

    applyScanlines(ctx, canvas, 0.08, this.remaining);
    this.texture.needsUpdate = true;
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) return;
    if (level >= 5) {
      this.remaining = this.urgentThreshold * 0.5;
    } else if (level >= 3) {
      this.remaining = Math.max(0, this.remaining - 10);
    }
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'alert') {
      this.remaining = this.urgentThreshold * 0.5;
    }
  }

  dispose(): void {
    this.texture.dispose();
    super.dispose();
  }
}
