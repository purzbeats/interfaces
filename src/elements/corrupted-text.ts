import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import { drawGlowText, applyScanlines } from '../animation/retro-text';

/**
 * Glitching unsettling text with Zalgo diacritical corruption,
 * horizontal jitter, vertical ghosting, and periodic phrase swaps.
 */
export class CorruptedTextElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'corrupted-text',
    meta: { shape: 'rectangular', roles: ['text', 'decorative'], moods: ['ambient', 'tactical'], sizes: ['works-small', 'needs-medium'], bandAffinity: 'high' },
  };
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private texture!: THREE.CanvasTexture;
  private mesh!: THREE.Mesh;
  private renderAccum: number = 0;
  private readonly RENDER_INTERVAL = 1 / 12;
  private phrases: string[] = [];
  private activeLines: string[] = [];
  private lineCount: number = 0;
  private corruptionLevel: number = 0;
  private swapTimer: number = 0;
  private swapInterval: number = 0;
  private ghostAlpha: number = 0;
  private jitterScale: number = 0;
  // Variant type for subliminal
  private isSubliminal: boolean = false;
  private subliminalTimer: number = 0;
  private subliminalActive: boolean = false;

  private static readonly PHRASE_POOL = [
    'DO YOU REMEMBER', 'IT WAS NEVER REAL', 'LOOK BEHIND YOU',
    'NOTHING IS WRONG', 'YOU HAVE BEEN HERE BEFORE', 'THIS IS FAMILIAR',
    'WAKE UP', "DON'T LOOK", 'WHY ARE YOU HERE', 'IT SEES YOU',
    'NOT YOUR FACE', 'THIS ALREADY HAPPENED', 'THERE IS NO EXIT',
    'YOU FORGOT', 'ALMOST REAL', 'BETWEEN THE WALLS',
  ];

  build(): void {
    const variant = this.rng.int(0, 4);
    const presets = [
      { lines: 2, corruption: 0.3, jitter: 2, ghost: 0.15, swapMin: 3, swapMax: 8, subliminal: false },    // Whisper
      { lines: 4, corruption: 0.7, jitter: 5, ghost: 0.3, swapMin: 1, swapMax: 4, subliminal: false },     // Scream
      { lines: 5, corruption: 0.5, jitter: 3, ghost: 0.2, swapMin: 2, swapMax: 5, subliminal: false },     // Glitch Wall
      { lines: 2, corruption: 0.05, jitter: 0.5, ghost: 0.05, swapMin: 4, swapMax: 10, subliminal: true }, // Subliminal
    ];
    const p = presets[variant];

    this.glitchAmount = 6;
    const { x, y, w, h } = this.px;
    this.lineCount = p.lines;
    this.corruptionLevel = p.corruption;
    this.jitterScale = p.jitter;
    this.ghostAlpha = p.ghost;
    this.isSubliminal = p.subliminal;
    this.swapInterval = this.rng.float(p.swapMin, p.swapMax);
    this.swapTimer = this.swapInterval;

    // Shuffle and pick initial lines
    this.phrases = [...CorruptedTextElement.PHRASE_POOL];
    this.rng.shuffle(this.phrases);
    this.activeLines = [];
    for (let i = 0; i < this.lineCount; i++) {
      this.activeLines.push(this.phrases[i % this.phrases.length]);
    }

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

  private zalgo(text: string, intensity: number): string {
    let result = '';
    for (const ch of text) {
      result += ch;
      if (ch === ' ') continue;
      // Add combining diacriticals (U+0300-U+036F)
      const count = Math.floor(this.rng.next() * intensity * 6);
      for (let i = 0; i < count; i++) {
        result += String.fromCharCode(0x0300 + Math.floor(this.rng.next() * 112));
      }
    }
    return result;
  }

  private renderCanvas(time: number): void {
    const { ctx, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const primaryHex = '#' + this.palette.primary.getHexString();
    const dimHex = '#' + this.palette.dim.getHexString();
    const alertHex = '#' + this.palette.alert.getHexString();

    let corruption = this.corruptionLevel;
    let jitter = this.jitterScale;
    let ghost = this.ghostAlpha;

    // Subliminal: mostly clean, brief corruption bursts
    if (this.isSubliminal) {
      if (this.subliminalActive) {
        corruption = 0.8;
        jitter = 6;
        ghost = 0.4;
      } else {
        corruption = 0;
        jitter = 0;
        ghost = 0;
      }
    }

    const lineH = canvas.height / (this.lineCount + 1);
    const maxFontSize = Math.floor(lineH * 0.7);

    for (let i = 0; i < this.lineCount; i++) {
      let text = this.activeLines[i];

      // Apply corruption
      if (corruption > 0 && this.rng.next() < corruption) {
        text = this.zalgo(text, corruption);
      }

      // Character substitution
      if (corruption > 0.3) {
        text = text.split('').map(ch => {
          if (this.rng.next() < corruption * 0.3) {
            return String.fromCharCode(0x2580 + Math.floor(this.rng.next() * 32));
          }
          return ch;
        }).join('');
      }

      const widthSize = Math.floor(canvas.width / (text.length * 0.55));
      const fontSize = Math.max(8, Math.min(maxFontSize, widthSize));
      ctx.font = `bold ${fontSize}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      const cx = canvas.width / 2;
      const cy = lineH * (i + 1);

      // Horizontal jitter
      const jx = (this.rng.next() - 0.5) * jitter * (canvas.width / 200);

      // Ghost/shadow layer
      if (ghost > 0) {
        ctx.globalAlpha = ghost;
        ctx.fillStyle = dimHex;
        ctx.fillText(text, cx + jx + 2, cy + 2);
        ctx.globalAlpha = ghost * 0.5;
        ctx.fillText(text, cx - jx * 0.5, cy - 3);
        ctx.globalAlpha = 1;
      }

      // Main text
      const color = corruption > 0.5 && this.rng.next() < 0.2 ? alertHex : primaryHex;
      drawGlowText(ctx, text, cx + jx, cy, color, corruption > 0.3 ? 12 : 6);
    }

    // Scanline overlay
    applyScanlines(ctx, canvas, 0.1, time);

    // Horizontal tear artifact
    if (this.rng.next() < 0.05) {
      const tearY = Math.floor(this.rng.next() * canvas.height);
      const tearH = 2 + Math.floor(this.rng.next() * 4);
      const tearShift = (this.rng.next() - 0.5) * canvas.width * 0.15;
      const imgData = ctx.getImageData(0, tearY, canvas.width, tearH);
      ctx.putImageData(imgData, tearShift, tearY);
    }

    this.texture.needsUpdate = true;
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);

    // Phrase swap timer
    this.swapTimer -= dt;
    if (this.swapTimer <= 0) {
      const idx = Math.floor(this.rng.next() * this.lineCount);
      this.activeLines[idx] = this.rng.pick(CorruptedTextElement.PHRASE_POOL);
      this.swapTimer = this.swapInterval;
    }

    // Subliminal flash timer
    if (this.isSubliminal) {
      this.subliminalTimer -= dt;
      if (this.subliminalTimer <= 0) {
        if (this.subliminalActive) {
          this.subliminalActive = false;
          this.subliminalTimer = this.rng.float(3, 8);
        } else {
          this.subliminalActive = true;
          this.subliminalTimer = this.rng.float(0.08, 0.25);
        }
      }
    }

    this.renderAccum += dt;
    if (this.renderAccum >= this.RENDER_INTERVAL) {
      this.renderAccum = 0;
      this.renderCanvas(time);
    }

    (this.mesh.material as THREE.MeshBasicMaterial).opacity = opacity * 0.9;
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) return;
    this.corruptionLevel = Math.min(1, this.corruptionLevel + level * 0.15);
    if (level >= 3) {
      this.swapTimer = 0; // Force swap
      this.jitterScale += level * 2;
    }
    if (level >= 5) {
      // Maximum corruption
      this.corruptionLevel = 1;
      this.jitterScale = 10;
      setTimeout(() => {
        this.corruptionLevel = 0.3;
        this.jitterScale = 2;
      }, 2000);
    }
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      this.corruptionLevel = Math.min(1, this.corruptionLevel + 0.4);
      setTimeout(() => { this.corruptionLevel = Math.max(0.05, this.corruptionLevel - 0.4); }, 600);
    }
    if (action === 'alert') {
      this.swapTimer = 0;
      this.pulseTimer = 2.0;
    }
  }

  dispose(): void {
    this.texture.dispose();
    super.dispose();
  }
}
