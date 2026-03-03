import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';
import { applyScanlines, drawJitteredText, drawGlowText } from '../animation/retro-text';

const LABELS = [
  'SYSTEM STATUS: NOMINAL', 'CORE TEMP: 2847K', 'MEM ALLOC: 94.7%',
  'SECTOR 7-G ONLINE', 'UPLINK ESTABLISHED', 'SIGNAL LOCKED',
  'AWAITING COMMAND', 'DIAGNOSTICS RUNNING', 'BUFFER OVERFLOW',
  'NODE ALPHA ACTIVE', 'TELEMETRY STREAM', 'QUANTUM SYNC 99.2%',
  'FIREWALL ENGAGED', 'DECRYPT SEQUENCE', 'PRIORITY: ALPHA',
  'SCANNING FREQ 2.4GHZ', 'LAT 34.0522 LON -118.2437', 'UTC 2084.127',
  'POWER GRID STABLE', 'NEURAL LINK ACTIVE', 'PROTOCOL ZETA-9',
];

export class TextLabelElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'text-label',
    meta: { shape: 'linear', roles: ['text'], moods: ['ambient', 'tactical'], bandAffinity: 'bass', audioSensitivity: 0.6, sizes: ['works-small'] },
  };
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private texture!: THREE.CanvasTexture;
  private mesh!: THREE.Mesh;
  private text: string = '';
  private revealIndex: number = 0;
  private revealSpeed: number = 0;
  private cursorBlink: number = 0;
  private isRevealed: boolean = false;
  private renderAccum: number = 0;
  private dirty: boolean = true;
  private blinkMult: number = 1.0;
  private jitterAmt: number = 0.5;

  build(): void {
    const variant = this.rng.int(0, 3);
    const presets = [
      { revealMin: 15, revealMax: 40, blinkMult: 1.0, jitterAmt: 0.5 },    // Standard
      { revealMin: 60, revealMax: 120, blinkMult: 1.5, jitterAmt: 1.2 },   // Dense (fast reveal, more jitter)
      { revealMin: 5, revealMax: 12, blinkMult: 0.5, jitterAmt: 0.15 },    // Minimal (slow, smooth)
      { revealMin: 25, revealMax: 50, blinkMult: 3.0, jitterAmt: 2.0 },    // Exotic (rapid blink, heavy jitter)
    ];
    const p = presets[variant];
    this.blinkMult = p.blinkMult;
    this.jitterAmt = p.jitterAmt;

    this.glitchAmount = 6;
    const { x, y, w, h } = this.px;
    this.text = this.rng.pick(LABELS);
    this.revealSpeed = this.rng.float(p.revealMin, p.revealMax);

    // Higher-res canvas for crisp text
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

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);
    const prevIndex = Math.floor(this.revealIndex);

    if (this.stateMachine.state === 'activating' || this.stateMachine.state === 'active') {
      if (!this.isRevealed) {
        this.revealIndex += dt * this.revealSpeed;
        if (this.revealIndex >= this.text.length) this.isRevealed = true;
      }
    }

    // Dirty flag: only re-render when text changes or cursor blinks
    this.cursorBlink += dt;
    const newIndex = Math.floor(this.revealIndex);
    const cursorState = Math.sin(this.cursorBlink * 6 * this.blinkMult) > 0;

    // Emit keystroke sound when a new character is revealed
    if (newIndex !== prevIndex && newIndex <= this.text.length) {
      const ch = this.text.charCodeAt(Math.max(0, newIndex - 1)) || 65;
      this.emitAudio('keystroke', ch);
    }

    this.renderAccum += dt;
    if (this.renderAccum >= 1 / 15 || newIndex !== prevIndex) {
      this.renderAccum = 0;
      this.renderCanvas(cursorState);
    }

    (this.mesh.material as THREE.MeshBasicMaterial).opacity = opacity;
  }

  private renderCanvas(showCursor: boolean): void {
    const { ctx, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Size to fit: use height-based size but constrain to width for long strings
    const heightSize = Math.floor(canvas.height * 0.5);
    const widthSize = Math.floor(canvas.width / (this.text.length * 0.62));
    const fontSize = Math.max(8, Math.min(heightSize, widthSize));
    ctx.font = `${fontSize}px monospace`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';

    const shown = this.text.slice(0, Math.floor(this.revealIndex));
    const isGlitching = this.glitchTimer > 0;

    // Glitch: corrupt some characters
    let displayText = shown;
    if (isGlitching) {
      displayText = shown.split('').map((ch, i) =>
        Math.sin(i * 7.3 + this.glitchTimer * 40) > 0.5
          ? String.fromCharCode(33 + (ch.charCodeAt(0) * 3 + i) % 60)
          : ch
      ).join('');
    }

    const primaryHex = '#' + this.palette.primary.getHexString();

    // Draw text with per-character jitter and phosphor glow
    if (isGlitching) {
      drawGlowText(ctx, displayText, 6, canvas.height / 2, primaryHex, 12);
    } else {
      drawJitteredText(ctx, displayText, 6, canvas.height / 2, primaryHex, this.cursorBlink, this.jitterAmt, 6);
    }

    // Blinking cursor
    if (!this.isRevealed && showCursor) {
      const cursorX = ctx.measureText(shown).width + 6;
      ctx.shadowColor = primaryHex;
      ctx.shadowBlur = 4;
      ctx.fillStyle = primaryHex;
      ctx.fillRect(cursorX, canvas.height * 0.25, fontSize * 0.55, fontSize);
      ctx.shadowBlur = 0;
    }

    // Scanline overlay
    applyScanlines(ctx, canvas, 0.1, this.cursorBlink);

    this.texture.needsUpdate = true;
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) return;
    if (level >= 5) {
      // Re-trigger the reveal animation
      this.revealIndex = 0;
      this.isRevealed = false;
    }
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'alert') {
      this.revealIndex = 0;
      this.isRevealed = false;
      this.text = '!! ALERT: ' + this.rng.pick(LABELS) + ' !!';
    }
  }

  dispose(): void {
    this.texture.dispose();
    super.dispose();
  }
}
