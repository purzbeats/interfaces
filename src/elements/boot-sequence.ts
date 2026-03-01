import * as THREE from 'three';
import { BaseElement } from './base-element';
import { applyScanlines, drawGlowText } from '../animation/retro-text';

const BOOT_LINES = [
  { text: 'BIOS v4.7.2 ... INITIALIZING', delay: 0.1 },
  { text: 'MEMORY TEST: 65536K OK', delay: 0.3 },
  { text: 'CPU: QUANTUM CORE x16 @ 4.7THz', delay: 0.2 },
  { text: 'GPU: HOLOMATRIX 9800 ... DETECTED', delay: 0.15 },
  { text: 'STORAGE: 256PB CRYSTAL ARRAY', delay: 0.1 },
  { text: 'NETWORK: SUBSPACE LINK v3.2', delay: 0.2 },
  { text: 'LOADING KERNEL MODULE: CORE.SYS', delay: 0.4 },
  { text: 'LOADING KERNEL MODULE: NET.SYS', delay: 0.3 },
  { text: 'LOADING KERNEL MODULE: SEC.SYS', delay: 0.25 },
  { text: 'INITIALIZING FIREWALL ... ARMED', delay: 0.1 },
  { text: 'SYNCING TEMPORAL BUFFER', delay: 0.35 },
  { text: 'CALIBRATING SENSORS', delay: 0.2 },
  { text: 'ESTABLISHING UPLINK', delay: 0.5 },
  { text: 'VERIFYING ENCRYPTION KEYS', delay: 0.3 },
  { text: 'ALL SYSTEMS NOMINAL', delay: 0.1 },
  { text: 'READY.', delay: 0 },
];

/**
 * Terminal boot text with typewriter effect and [OK]/[FAIL] status.
 * Canvas typewriter, lines appear one at a time with delay before status tag.
 */
export class BootSequenceElement extends BaseElement {
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private texture!: THREE.CanvasTexture;
  private mesh!: THREE.Mesh;
  private currentLine: number = 0;
  private charIndex: number = 0;
  private charSpeed: number = 0;
  private lineDelay: number = 0;
  private lineDelayTimer: number = 0;
  private completedLines: Array<{ text: string; status: string }> = [];
  private renderAccum: number = 0;
  private loopCount: number = 0;

  build(): void {
    this.glitchAmount = 3;
    const { x, y, w, h } = this.px;
    this.charSpeed = this.rng.float(30, 60);

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

    // Advance typewriter
    if (this.currentLine < BOOT_LINES.length) {
      if (this.lineDelay > 0) {
        this.lineDelayTimer += dt;
        if (this.lineDelayTimer >= this.lineDelay) {
          this.lineDelayTimer = 0;
          this.lineDelay = 0;
          // Complete the line
          const status = this.rng.chance(0.9) ? '[OK]' : '[FAIL]';
          this.completedLines.push({ text: BOOT_LINES[this.currentLine].text, status });
          this.currentLine++;
          this.charIndex = 0;
        }
      } else {
        this.charIndex += dt * this.charSpeed;
        const line = BOOT_LINES[this.currentLine];
        if (this.charIndex >= line.text.length) {
          this.lineDelay = line.delay;
          this.lineDelayTimer = 0;
        }
      }
    } else {
      // Reset after a delay for looping
      this.lineDelayTimer += dt;
      if (this.lineDelayTimer > 3) {
        this.currentLine = 0;
        this.charIndex = 0;
        this.completedLines = [];
        this.lineDelay = 0;
        this.lineDelayTimer = 0;
        this.loopCount++;
      }
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

    const primaryHex = '#' + this.palette.primary.getHexString();
    const dimHex = '#' + this.palette.dim.getHexString();
    const alertHex = '#' + this.palette.alert.getHexString();
    const secondaryHex = '#' + this.palette.secondary.getHexString();

    const fontSize = Math.max(8, Math.floor(canvas.height * 0.055));
    ctx.font = `${fontSize}px monospace`;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    const lineH = fontSize * 1.5;
    const maxVisible = Math.floor(canvas.height / lineH) - 1;

    // Draw completed lines (scroll if needed)
    const startLine = Math.max(0, this.completedLines.length - maxVisible);
    let py = 4;

    for (let i = startLine; i < this.completedLines.length; i++) {
      const line = this.completedLines[i];
      drawGlowText(ctx, line.text, 4, py, dimHex, 2);
      const statusColor = line.status === '[OK]' ? secondaryHex : alertHex;
      const textWidth = ctx.measureText(line.text + ' ').width;
      drawGlowText(ctx, line.status, 4 + textWidth, py, statusColor, 4);
      py += lineH;
    }

    // Draw current line being typed
    if (this.currentLine < BOOT_LINES.length) {
      const shown = BOOT_LINES[this.currentLine].text.slice(0, Math.floor(this.charIndex));
      drawGlowText(ctx, shown, 4, py, primaryHex, 5);

      // Blinking cursor
      if (Math.sin(Date.now() * 0.006) > 0) {
        const cursorX = ctx.measureText(shown).width + 4;
        ctx.fillStyle = primaryHex;
        ctx.fillRect(cursorX, py, fontSize * 0.55, fontSize);
      }

      // Show [....] progress during delay
      if (this.lineDelay > 0) {
        const dots = '.'.repeat(Math.floor((this.lineDelayTimer / this.lineDelay) * 4));
        const tw = ctx.measureText(BOOT_LINES[this.currentLine].text + ' ').width;
        drawGlowText(ctx, `[${dots}]`, 4 + tw, py, dimHex, 2);
      }
    }

    applyScanlines(ctx, canvas, 0.1, this.loopCount + this.currentLine * 0.1);
    this.texture.needsUpdate = true;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'alert') {
      this.pulseTimer = 2.0;
      // Force restart
      this.currentLine = 0;
      this.charIndex = 0;
      this.completedLines = [];
    }
  }

  dispose(): void {
    this.texture.dispose();
    super.dispose();
  }
}
