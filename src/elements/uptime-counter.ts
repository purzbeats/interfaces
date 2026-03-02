import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';
import { applyScanlines, drawGlowText } from '../animation/retro-text';

/**
 * Incrementing system uptime "UP: 0342d 17h 23m 08s".
 * Canvas text, ticks up in real time from a random start.
 */
export class UptimeCounterElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'uptime-counter',
    meta: { shape: 'linear', roles: ['text', 'data-display'], moods: ['diagnostic', 'ambient'], sizes: ['works-small'] },
  };
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private texture!: THREE.CanvasTexture;
  private mesh!: THREE.Mesh;
  private uptime: number = 0;
  private renderAccum: number = 0;
  private label: string = '';

  build(): void {
    this.glitchAmount = 3;
    const { x, y, w, h } = this.px;
    // Random start: up to ~2 years in seconds
    this.uptime = this.rng.float(86400, 86400 * 730);
    this.label = this.rng.pick(['UPTIME', 'SYS UP', 'NODE UPTIME', 'ONLINE']);

    const scale = Math.min(2, window.devicePixelRatio);
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.max(256, Math.ceil(w * scale));
    this.canvas.height = Math.max(48, Math.ceil(h * scale));
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.LinearFilter;

    const geo = new THREE.PlaneGeometry(w, h);
    this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      opacity: 0,
    }));
    this.mesh.position.set(x + w / 2, y + h / 2, 2);
    this.group.add(this.mesh);
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);

    this.uptime += dt;

    this.renderAccum += dt;
    if (this.renderAccum >= 1 / 10) {
      this.renderAccum = 0;
      this.renderCanvas();
    }

    (this.mesh.material as THREE.MeshBasicMaterial).opacity = opacity;
  }

  private renderCanvas(): void {
    const { ctx, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const t = this.uptime;
    const days = Math.floor(t / 86400);
    const hours = Math.floor((t % 86400) / 3600);
    const mins = Math.floor((t % 3600) / 60);
    const secs = Math.floor(t % 60);

    const uptimeStr = `${String(days).padStart(4, '0')}d ${String(hours).padStart(2, '0')}h ${String(mins).padStart(2, '0')}m ${String(secs).padStart(2, '0')}s`;
    const fullStr = `${this.label}: ${uptimeStr}`;

    const primaryHex = '#' + this.palette.primary.getHexString();

    const heightSize = Math.floor(canvas.height * 0.5);
    const widthSize = Math.floor(canvas.width / (fullStr.length * 0.62));
    const fontSize = Math.max(8, Math.min(heightSize, widthSize));
    ctx.font = `${fontSize}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    if (this.glitchTimer > 0) {
      const garbled = uptimeStr.split('').map((c, i) =>
        Math.sin(i * 11 + this.glitchTimer * 40) > 0.4
          ? String.fromCharCode(33 + ((c.charCodeAt(0) * 5) % 60))
          : c
      ).join('');
      drawGlowText(ctx, `${this.label}: ${garbled}`, canvas.width / 2, canvas.height / 2, '#' + this.palette.secondary.getHexString(), 8);
    } else {
      drawGlowText(ctx, fullStr, canvas.width / 2, canvas.height / 2, primaryHex, 6);
    }

    applyScanlines(ctx, canvas, 0.08, this.uptime);
    this.texture.needsUpdate = true;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'alert') {
      this.uptime = 0; // Reset uptime on alert
    }
  }

  dispose(): void {
    this.texture.dispose();
    super.dispose();
  }
}
