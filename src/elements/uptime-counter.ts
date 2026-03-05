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
    meta: { shape: 'linear', roles: ['text', 'data-display'], moods: ['diagnostic', 'ambient'], bandAffinity: 'bass', audioSensitivity: 0.6, sizes: ['works-small'] },
  };
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private texture!: THREE.CanvasTexture;
  private mesh!: THREE.Mesh;
  private uptime: number = 0;
  private renderAccum: number = 0;
  private label: string = '';
  private _fontScale: number = 0;
  private _format: string = '';

  build(): void {
    const variant = this.rng.int(0, 3);
    const presets = [
      { uptimeMin: 86400, uptimeMax: 86400 * 730, labels: ['UPTIME', 'SYS UP', 'NODE UPTIME', 'ONLINE'], fontScale: 0.5, format: 'ddhms' as const },
      { uptimeMin: 0, uptimeMax: 86400, labels: ['SESSION', 'ACTIVE', 'CONNECTED', 'LIVE'], fontScale: 0.6, format: 'hms' as const },
      { uptimeMin: 86400 * 365, uptimeMax: 86400 * 365 * 5, labels: ['UPTIME', 'RUNTIME'], fontScale: 0.4, format: 'ddhms' as const },
      { uptimeMin: 0, uptimeMax: 86400 * 30, labels: ['EPOCH+', 'CYCLE', 'PHASE T+', 'MISSION'], fontScale: 0.55, format: 'sec' as const },
    ];
    const p = presets[variant];

    this.glitchAmount = 3;
    const { x, y, w, h } = this.px;
    this.uptime = this.rng.float(p.uptimeMin, p.uptimeMax);
    this.label = this.rng.pick(p.labels);
    this._fontScale = p.fontScale + this.rng.float(-0.03, 0.03);
    this._format = p.format;

    const scale = Math.min(2, window.devicePixelRatio);
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.max(256, Math.ceil(w * scale));
    this.canvas.height = Math.max(48, Math.ceil(h * scale));
    this.ctx = this.get2DContext(this.canvas);
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

    const fmt = this._format;
    let uptimeStr: string;
    if (fmt === 'hms') {
      const totalH = Math.floor(t / 3600);
      uptimeStr = `${String(totalH).padStart(3, '0')}h ${String(mins).padStart(2, '0')}m ${String(secs).padStart(2, '0')}s`;
    } else if (fmt === 'sec') {
      uptimeStr = `${Math.floor(t).toLocaleString()}s`;
    } else {
      uptimeStr = `${String(days).padStart(4, '0')}d ${String(hours).padStart(2, '0')}h ${String(mins).padStart(2, '0')}m ${String(secs).padStart(2, '0')}s`;
    }
    const fullStr = `${this.label}: ${uptimeStr}`;

    const primaryHex = '#' + this.palette.primary.getHexString();

    const heightSize = Math.floor(canvas.height * this._fontScale);
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
