import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';
import { applyScanlines, drawGlowText } from '../animation/retro-text';

const STATUS_MESSAGES = [
  'ALL SYSTEMS NOMINAL', 'WARNING: THRESHOLD EXCEEDED', 'STANDBY',
  'PROCESSING...', 'READY', 'ALERT: ANOMALY DETECTED', 'CALIBRATING',
  'SYNC COMPLETE', 'MONITORING', 'LOCKED', 'ACTIVE',
];

export class StatusReadoutElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'status-readout',
    meta: { shape: 'linear', roles: ['text'], moods: ['tactical', 'diagnostic'], bandAffinity: 'bass', audioSensitivity: 0.6, sizes: ['works-small'] },
  };
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private texture!: THREE.CanvasTexture;
  private mesh!: THREE.Mesh;
  private messages: string[] = [];
  private blinkTimer: number = 0;
  private currentMsg: number = 0;
  private switchInterval: number = 0;
  private switchTimer: number = 0;
  private renderAccum: number = 0;
  private isAlert: boolean = false;
  private blinkRate: number = 4;
  private glowScale: number = 1.0;

  build(): void {
    const variant = this.rng.int(0, 3);
    const presets = [
      { msgMin: 2, msgMax: 5, switchMin: 2, switchMax: 6, blinkRate: 4, glowScale: 1.0 },    // Standard
      { msgMin: 5, msgMax: 8, switchMin: 0.8, switchMax: 2, blinkRate: 8, glowScale: 1.5 },   // Dense (rapid switching)
      { msgMin: 1, msgMax: 2, switchMin: 5, switchMax: 12, blinkRate: 2, glowScale: 0.6 },    // Minimal
      { msgMin: 3, msgMax: 6, switchMin: 1.5, switchMax: 4, blinkRate: 12, glowScale: 2.0 },  // Exotic (fast blink, strong glow)
    ];
    const p = presets[variant];
    this.blinkRate = p.blinkRate;
    this.glowScale = p.glowScale;

    const { x, y, w, h } = this.px;
    const msgCount = this.rng.int(p.msgMin, p.msgMax);
    for (let i = 0; i < msgCount; i++) {
      this.messages.push(this.rng.pick(STATUS_MESSAGES));
    }
    this.switchInterval = this.rng.float(p.switchMin, p.switchMax);

    const scale = Math.min(2, window.devicePixelRatio);
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.max(256, Math.ceil(w * scale));
    this.canvas.height = Math.max(48, Math.ceil(h * scale));
    this.ctx = this.get2DContext(this.canvas);
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.magFilter = THREE.NearestFilter;

    const geo = new THREE.PlaneGeometry(w, h);
    const mat = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      opacity: 0,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.set(x + w / 2, y + h / 2, 2);
    this.group.add(this.mesh);
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);

    this.blinkTimer += dt;
    this.switchTimer += dt;
    if (this.switchTimer > this.switchInterval) {
      this.switchTimer = 0;
      this.currentMsg = (this.currentMsg + 1) % this.messages.length;
      this.emitAudio('dataChirp');
    }

    // Render at reduced rate
    this.renderAccum += dt;
    if (this.renderAccum >= 1 / 12) {
      this.renderAccum = 0;
      this.renderCanvas(time);
    }

    (this.mesh.material as THREE.MeshBasicMaterial).opacity = opacity;
  }

  private renderCanvas(time: number): void {
    const { ctx, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Longest message determines max width constraint
    const longestMsg = this.messages.reduce((a, b) => a.length > b.length ? a : b, '');
    const heightSize = Math.floor(canvas.height * 0.35);
    const widthSize = Math.floor(canvas.width / ((longestMsg.length + 3) * 0.62));
    const fontSize = Math.max(8, Math.min(heightSize, widthSize));
    ctx.font = `${fontSize}px monospace`;
    ctx.textBaseline = 'top';

    const primaryHex = '#' + this.palette.primary.getHexString();
    const dimHex = '#' + this.palette.dim.getHexString();
    const alertHex = '#' + this.palette.alert.getHexString();

    // Status indicator dot (blinking) with glow — scale to font
    const dotR = Math.max(2, fontSize * 0.2);
    const dotX = dotR + 2;
    const blink = Math.sin(this.blinkTimer * this.blinkRate) > 0;
    const dotColor = this.isAlert ? alertHex : primaryHex;
    ctx.shadowColor = dotColor;
    ctx.shadowBlur = blink ? dotR * 1.5 : 0;
    ctx.fillStyle = blink ? dotColor : dimHex;
    ctx.beginPath();
    ctx.arc(dotX, fontSize / 2 + fontSize * 0.4, dotR, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // Message with phosphor glow
    const textX = dotX * 2 + dotR;
    const msg = this.messages[this.currentMsg];
    const msgIsAlert = msg.includes('WARNING') || msg.includes('ALERT') || this.isAlert;
    const msgColor = msgIsAlert ? alertHex : primaryHex;
    const textY = Math.max(2, fontSize * 0.4);
    drawGlowText(ctx, msg, textX, textY, msgColor, (msgIsAlert ? 8 : 5) * this.glowScale);

    // Timestamp with dim glow
    const minutes = Math.floor(time / 60);
    const secs = Math.floor(time % 60);
    const ts = `T+${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    drawGlowText(ctx, ts, textY, fontSize + fontSize * 0.8, dimHex, 2);

    // Glitch: draw corrupted overlay
    if (this.glitchTimer > 0) {
      ctx.fillStyle = alertHex;
      ctx.globalAlpha = 0.5;
      const corruptText = msg.split('').map((ch, i) =>
        Math.sin(i * 11 + this.glitchTimer * 30) > 0.3 ? '█' : ch
      ).join('');
      ctx.fillText(corruptText, textX + 2, textY + 1);
      ctx.globalAlpha = 1;
    }

    // Scanline overlay
    applyScanlines(ctx, canvas, 0.08, time);

    this.texture.needsUpdate = true;
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) return;
    if (level >= 5) {
      this.isAlert = true;
      setTimeout(() => { this.isAlert = false; }, 3000);
    }
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'alert') {
      this.isAlert = true;
      this.messages.unshift('!! CRITICAL ALERT !!');
      this.currentMsg = 0;
    }
  }

  dispose(): void {
    this.texture.dispose();
    super.dispose();
  }
}
