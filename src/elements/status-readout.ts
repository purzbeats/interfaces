import * as THREE from 'three';
import { BaseElement } from './base-element';
import { pulse, stateOpacity, glitchOffset } from '../animation/fx';
import { applyScanlines, drawGlowText } from '../animation/retro-text';

const STATUS_MESSAGES = [
  'ALL SYSTEMS NOMINAL', 'WARNING: THRESHOLD EXCEEDED', 'STANDBY',
  'PROCESSING...', 'READY', 'ALERT: ANOMALY DETECTED', 'CALIBRATING',
  'SYNC COMPLETE', 'MONITORING', 'LOCKED', 'ACTIVE',
];

export class StatusReadoutElement extends BaseElement {
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private texture!: THREE.CanvasTexture;
  private mesh!: THREE.Mesh;
  private messages: string[] = [];
  private blinkTimer: number = 0;
  private currentMsg: number = 0;
  private switchInterval: number = 0;
  private switchTimer: number = 0;
  private pulseTimer: number = 0;
  private glitchTimer: number = 0;
  private renderAccum: number = 0;
  private isAlert: boolean = false;

  build(): void {
    const { x, y, w, h } = this.px;
    const msgCount = this.rng.int(2, 5);
    for (let i = 0; i < msgCount; i++) {
      this.messages.push(this.rng.pick(STATUS_MESSAGES));
    }
    this.switchInterval = this.rng.float(2, 6);

    const scale = Math.min(2, window.devicePixelRatio);
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.max(256, Math.ceil(w * scale));
    this.canvas.height = Math.max(48, Math.ceil(h * scale));
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;

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
    let opacity = stateOpacity(this.stateMachine.state, this.stateMachine.progress);

    if (this.pulseTimer > 0) {
      this.pulseTimer -= dt;
      opacity *= pulse(this.pulseTimer);
    }

    const gx = this.glitchTimer > 0 ? glitchOffset(this.glitchTimer, 4) : 0;
    if (this.glitchTimer > 0) this.glitchTimer -= dt;
    this.group.position.x = gx;

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

    const fontSize = Math.min(Math.floor(canvas.height * 0.35), 22);
    ctx.font = `${fontSize}px monospace`;
    ctx.textBaseline = 'top';

    const primaryHex = '#' + this.palette.primary.getHexString();
    const dimHex = '#' + this.palette.dim.getHexString();
    const alertHex = '#' + this.palette.alert.getHexString();

    // Status indicator dot (blinking) with glow
    const blink = Math.sin(this.blinkTimer * 4) > 0;
    const dotColor = this.isAlert ? alertHex : primaryHex;
    ctx.shadowColor = dotColor;
    ctx.shadowBlur = blink ? 6 : 0;
    ctx.fillStyle = blink ? dotColor : dimHex;
    ctx.beginPath();
    ctx.arc(10, fontSize / 2 + 6, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // Message with phosphor glow
    const msg = this.messages[this.currentMsg];
    const msgIsAlert = msg.includes('WARNING') || msg.includes('ALERT') || this.isAlert;
    const msgColor = msgIsAlert ? alertHex : primaryHex;
    drawGlowText(ctx, msg, 22, 6, msgColor, msgIsAlert ? 8 : 5);

    // Timestamp with dim glow
    const minutes = Math.floor(time / 60);
    const secs = Math.floor(time % 60);
    const ts = `T+${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    drawGlowText(ctx, ts, 6, fontSize + 12, dimHex, 2);

    // Glitch: draw corrupted overlay
    if (this.glitchTimer > 0) {
      ctx.fillStyle = alertHex;
      ctx.globalAlpha = 0.5;
      const corruptText = msg.split('').map((ch, i) =>
        Math.sin(i * 11 + this.glitchTimer * 30) > 0.3 ? '█' : ch
      ).join('');
      ctx.fillText(corruptText, 22 + 2, 6 + 1);
      ctx.globalAlpha = 1;
    }

    // Scanline overlay
    applyScanlines(ctx, canvas, 0.08, time);

    this.texture.needsUpdate = true;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'pulse') this.pulseTimer = 0.4;
    if (action === 'glitch') this.glitchTimer = 0.5;
    if (action === 'alert') {
      this.isAlert = true;
      this.messages.unshift('!! CRITICAL ALERT !!');
      this.currentMsg = 0;
      this.pulseTimer = 2.0;
    }
  }

  dispose(): void {
    this.texture.dispose();
    super.dispose();
  }
}
