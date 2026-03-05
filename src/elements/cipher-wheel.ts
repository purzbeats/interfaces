import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';
import { applyScanlines, drawGlowText } from '../animation/retro-text';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

/**
 * Concentric rotating rings of characters like an encryption machine.
 * Canvas concentric character rings rotating at different speeds.
 * Top-aligned chars get brighter; no full-screen flash.
 */
export class CipherWheelElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'cipher-wheel',
    meta: { shape: 'radial', roles: ['data-display', 'decorative'], moods: ['tactical', 'ambient'], bandAffinity: 'mid', sizes: ['needs-medium', 'needs-large'] },
  };
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private texture!: THREE.CanvasTexture;
  private mesh!: THREE.Mesh;
  private ringCount: number = 0;
  private ringAngles: number[] = [];
  private ringSpeeds: number[] = [];
  private ringChars: string[][] = [];
  private renderAccum: number = 0;

  build(): void {
    const variant = this.rng.int(0, 3);
    const DIGITS = '0123456789';
    const HEX = '0123456789ABCDEF';
    const RUNES = 'FUTHARKWNISJEPBMLTDOGXYZQV';
    const presets = [
      { ringMin: 3, ringMax: 5, speedMin: 0.4, speedMax: 1.5, charsPerRing: 6, baseChars: 12, charset: ALPHABET },
      { ringMin: 5, ringMax: 7, speedMin: 1.0, speedMax: 3.0, charsPerRing: 8, baseChars: 16, charset: ALPHABET },
      { ringMin: 2, ringMax: 3, speedMin: 0.15, speedMax: 0.5, charsPerRing: 4, baseChars: 8, charset: DIGITS + ALPHABET.slice(0, 6) },
      { ringMin: 4, ringMax: 6, speedMin: 0.8, speedMax: 2.5, charsPerRing: 5, baseChars: 10, charset: HEX + RUNES.slice(0, 10) },
    ];
    const p = presets[variant];

    const { x, y, w, h } = this.px;
    this.ringCount = this.rng.int(p.ringMin, p.ringMax);

    for (let r = 0; r < this.ringCount; r++) {
      this.ringAngles.push(this.rng.float(0, Math.PI * 2));
      this.ringSpeeds.push(this.rng.float(p.speedMin, p.speedMax) * (this.rng.chance(0.5) ? 1 : -1));
      const chars: string[] = [];
      const count = p.baseChars + r * p.charsPerRing;
      for (let i = 0; i < count; i++) {
        chars.push(p.charset[this.rng.int(0, p.charset.length - 1)]);
      }
      this.ringChars.push(chars);
    }

    const scale = Math.min(2, window.devicePixelRatio);
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.ceil(w * scale);
    this.canvas.height = Math.ceil(h * scale);
    this.ctx = this.get2DContext(this.canvas);
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

    // Rotate rings
    for (let r = 0; r < this.ringCount; r++) {
      this.ringAngles[r] += this.ringSpeeds[r] * dt;
    }

    // Render at higher rate for smoother rotation
    this.renderAccum += dt;
    if (this.renderAccum >= 1 / 24) {
      this.renderAccum = 0;
      this.renderCanvas();
    }

    (this.mesh.material as THREE.MeshBasicMaterial).opacity = opacity;
  }

  private renderCanvas(): void {
    const { ctx, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const maxR = Math.min(cx, cy) * 0.9;
    const primaryHex = '#' + this.palette.primary.getHexString();
    const dimHex = '#' + this.palette.dim.getHexString();
    const secondaryHex = '#' + this.palette.secondary.getHexString();

    for (let r = 0; r < this.ringCount; r++) {
      const ringRadius = maxR * (0.3 + (r / this.ringCount) * 0.65);
      const chars = this.ringChars[r];
      const angle = this.ringAngles[r];

      // Draw ring circle
      ctx.strokeStyle = dimHex;
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.3;
      ctx.beginPath();
      ctx.arc(cx, cy, ringRadius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;

      // Draw characters along ring
      const fontSize = Math.max(8, Math.floor(maxR * 0.09));
      ctx.font = `${fontSize}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      for (let i = 0; i < chars.length; i++) {
        const charAngle = angle + (i / chars.length) * Math.PI * 2;
        const charX = cx + Math.cos(charAngle) * ringRadius;
        const charY = cy + Math.sin(charAngle) * ringRadius;

        // Top position (near 270° / -90°) gets highlighted — smooth gradient
        const normalizedAngle = ((charAngle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
        const distFromTop = Math.abs(normalizedAngle - Math.PI * 1.5);
        const proximity = Math.max(0, 1 - distFromTop / 0.4); // 0..1 as it nears top

        let color: string;
        let glow: number;
        if (proximity > 0.8) {
          color = secondaryHex;
          glow = 6;
        } else if (proximity > 0.3) {
          color = primaryHex;
          glow = 4;
        } else {
          color = dimHex;
          glow = 1;
        }

        drawGlowText(ctx, chars[i], charX, charY, color, glow);
      }
    }

    // Center marker — subtle triangle
    const markerSize = maxR * 0.05;
    ctx.beginPath();
    ctx.moveTo(cx, cy - maxR * 0.28);
    ctx.lineTo(cx - markerSize, cy - maxR * 0.28 - markerSize * 1.5);
    ctx.lineTo(cx + markerSize, cy - maxR * 0.28 - markerSize * 1.5);
    ctx.closePath();
    ctx.fillStyle = primaryHex;
    ctx.shadowColor = primaryHex;
    ctx.shadowBlur = 4;
    ctx.fill();
    ctx.shadowBlur = 0;

    // Inner label
    const labelSize = Math.max(6, Math.floor(maxR * 0.07));
    ctx.font = `${labelSize}px monospace`;
    drawGlowText(ctx, 'CIPHER', cx, cy, dimHex, 2);

    applyScanlines(ctx, canvas, 0.04, this.ringAngles[0]);
    this.texture.needsUpdate = true;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      for (let r = 0; r < this.ringCount; r++) {
        this.ringSpeeds[r] = this.rng.float(2, 5) * (this.rng.chance(0.5) ? 1 : -1);
      }
    }
    if (action === 'alert') {
      this.pulseTimer = 2.0;
      // Spin all rings fast in same direction briefly
      for (let r = 0; r < this.ringCount; r++) {
        this.ringSpeeds[r] = 4 + r * 0.5;
      }
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) return;
    if (level >= 3) {
      // Reverse a ring (one-shot, toggles back on next tap)
      this.ringSpeeds[0] *= -1;
    }
    if (level >= 5) {
      // Scramble all — randomize characters and spin fast
      for (let r = 0; r < this.ringCount; r++) {
        this.ringSpeeds[r] = this.rng.float(3, 6) * (this.rng.chance(0.5) ? 1 : -1);
        for (let i = 0; i < this.ringChars[r].length; i++) {
          this.ringChars[r][i] = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'[this.rng.int(0, 35)];
        }
      }
    }
  }

  dispose(): void {
    this.texture.dispose();
    super.dispose();
  }
}
