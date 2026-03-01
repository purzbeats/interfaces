import * as THREE from 'three';
import { BaseElement } from './base-element';
import { applyScanlines } from '../animation/retro-text';

/**
 * Classic Matrix-style digital rain — columns of falling characters with
 * glowing leading heads, fading trails, and random character mutation.
 * Canvas-based rendering at a stuttery 15fps for authentic feel.
 */

interface Column {
  y: number;          // current head position (in char rows)
  speed: number;      // rows per second
  trailLen: number;   // how many chars in the trail
  active: boolean;    // whether this column is currently dropping
  delay: number;      // seconds until next activation
  chars: number[];    // character indices for the trail (mutate over time)
  mutateTimer: number; // accumulator for mutation ticks
}

const CHAR_SET = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン0123456789ABCDEF';

export class MatrixRainElement extends BaseElement {
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private texture!: THREE.CanvasTexture;
  private mesh!: THREE.Mesh;

  private columns: Column[] = [];
  private colCount: number = 0;
  private rowCount: number = 0;
  private charW: number = 0;
  private charH: number = 0;

  private renderAccum: number = 0;
  private readonly RENDER_INTERVAL = 1 / 15;

  // Action state
  private speedMultiplier: number = 1;
  private freezeTimer: number = 0;
  private cascadeRestartCol: number = -1;
  private cascadeTimer: number = 0;
  private brightFlash: number = 0;

  build(): void {
    this.glitchAmount = 3;
    const { x, y, w, h } = this.px;

    // Character sizing — aim for 10-14px per char
    this.charW = Math.max(10, Math.min(14, Math.floor(w / 30)));
    this.charH = Math.floor(this.charW * 1.6);
    this.colCount = Math.max(4, Math.floor(w / this.charW));
    this.rowCount = Math.max(4, Math.floor(h / this.charH));

    // Canvas at exact character grid resolution
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.colCount * this.charW;
    this.canvas.height = this.rowCount * this.charH;
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;

    const geo = new THREE.PlaneGeometry(w, h);
    this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      opacity: 0,
    }));
    this.mesh.position.set(x + w / 2, y + h / 2, 1);
    this.group.add(this.mesh);

    // Initialize columns with staggered starts
    for (let c = 0; c < this.colCount; c++) {
      const trailLen = this.rng.int(5, 20);
      const chars: number[] = [];
      for (let i = 0; i < trailLen; i++) {
        chars.push(this.rng.int(0, CHAR_SET.length - 1));
      }
      this.columns.push({
        y: -this.rng.float(0, this.rowCount),
        speed: this.rng.float(4, 14),
        trailLen,
        active: this.rng.chance(0.3), // only some start immediately
        delay: this.rng.float(0, 3),
        chars,
        mutateTimer: 0,
      });
    }
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    const isGlitching = this.glitchTimer > 0;
    const effectiveDt = dt * this.speedMultiplier * (isGlitching ? 3 : 1);

    // Handle freeze from alert
    if (this.freezeTimer > 0) {
      this.freezeTimer -= dt;
      // During freeze, just render but don't advance columns
      this.renderAccum += dt;
      if (this.renderAccum >= this.RENDER_INTERVAL) {
        this.renderAccum = 0;
        this.renderCanvas(time, opacity);
      }
      (this.mesh.material as THREE.MeshBasicMaterial).opacity = opacity;
      return;
    }

    // Handle cascade restart from alert
    if (this.cascadeRestartCol >= 0) {
      this.cascadeTimer += dt;
      const colsPerSecond = this.colCount * 3; // cascade across in ~0.33s
      const targetCol = Math.floor(this.cascadeTimer * colsPerSecond);
      while (this.cascadeRestartCol < Math.min(targetCol, this.colCount)) {
        const col = this.columns[this.cascadeRestartCol];
        col.y = -this.rng.float(0, 5);
        col.active = true;
        col.delay = 0;
        col.speed = this.rng.float(6, 16);
        this.cascadeRestartCol++;
      }
      if (this.cascadeRestartCol >= this.colCount) {
        this.cascadeRestartCol = -1;
        this.cascadeTimer = 0;
      }
    }

    // Advance bright flash decay
    if (this.brightFlash > 0) {
      this.brightFlash -= dt * 4;
      if (this.brightFlash < 0) this.brightFlash = 0;
    }

    // Update each column
    for (const col of this.columns) {
      if (!col.active) {
        col.delay -= dt;
        if (col.delay <= 0) {
          col.active = true;
          col.y = -this.rng.float(0, 3);
          col.speed = this.rng.float(4, 14);
          col.trailLen = this.rng.int(5, 20);
          // Refresh chars array to match new trail length
          while (col.chars.length < col.trailLen) {
            col.chars.push(this.rng.int(0, CHAR_SET.length - 1));
          }
        }
        continue;
      }

      col.y += col.speed * effectiveDt;

      // Mutate trail characters periodically
      col.mutateTimer += effectiveDt;
      const mutateInterval = isGlitching ? 0.03 : 0.15;
      if (col.mutateTimer >= mutateInterval) {
        col.mutateTimer = 0;
        // Mutate 1-3 random chars in the trail
        const mutations = isGlitching ? 3 : 1;
        for (let m = 0; m < mutations; m++) {
          const idx = this.rng.int(0, col.chars.length - 1);
          col.chars[idx] = this.rng.int(0, CHAR_SET.length - 1);
        }
      }

      // Reset if fully past bottom
      if (col.y - col.trailLen > this.rowCount) {
        col.active = false;
        col.delay = this.rng.float(0.2, 3);
      }
    }

    // Render at fixed rate
    this.renderAccum += dt;
    if (this.renderAccum >= this.RENDER_INTERVAL) {
      this.renderAccum = 0;
      this.renderCanvas(time, opacity);
    }

    (this.mesh.material as THREE.MeshBasicMaterial).opacity = opacity;
  }

  private renderCanvas(time: number, _opacity: number): void {
    const { ctx, canvas, charW, charH, colCount, rowCount } = this;

    // Clear to near-black (slight background tint for CRT feel)
    const bg = this.palette.bg;
    ctx.fillStyle = `rgb(${Math.floor(bg.r * 255)},${Math.floor(bg.g * 255)},${Math.floor(bg.b * 255)})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const fontSize = Math.floor(charH * 0.7);
    ctx.font = `bold ${fontSize}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const primaryR = Math.floor(this.palette.primary.r * 255);
    const primaryG = Math.floor(this.palette.primary.g * 255);
    const primaryB = Math.floor(this.palette.primary.b * 255);
    const secR = Math.floor(this.palette.secondary.r * 255);
    const secG = Math.floor(this.palette.secondary.g * 255);
    const secB = Math.floor(this.palette.secondary.b * 255);
    const dimR = Math.floor(this.palette.dim.r * 255);
    const dimG = Math.floor(this.palette.dim.g * 255);
    const dimB = Math.floor(this.palette.dim.b * 255);

    for (let c = 0; c < colCount; c++) {
      const col = this.columns[c];
      if (!col.active) continue;

      const headRow = Math.floor(col.y);
      const cx = c * charW + charW / 2;

      for (let t = 0; t < col.trailLen; t++) {
        const row = headRow - t;
        if (row < 0 || row >= rowCount) continue;

        const cy = row * charH + charH / 2;
        const charIdx = col.chars[t % col.chars.length];
        const ch = CHAR_SET[charIdx];

        if (t === 0) {
          // Leading character — bright white/secondary with strong glow
          const flash = this.brightFlash > 0 ? this.brightFlash : 0;
          const bright = Math.min(255, secR + 80 + flash * 100);
          const brightG = Math.min(255, secG + 80 + flash * 100);
          const brightB = Math.min(255, secB + 80 + flash * 100);

          ctx.save();
          ctx.shadowColor = `rgb(${secR},${secG},${secB})`;
          ctx.shadowBlur = 12;
          ctx.fillStyle = `rgb(${Math.floor(bright)},${Math.floor(brightG)},${Math.floor(brightB)})`;
          ctx.fillText(ch, cx, cy);
          // Second pass for extra glow
          ctx.shadowBlur = 6;
          ctx.fillText(ch, cx, cy);
          ctx.restore();
        } else if (t <= 2) {
          // Near-head chars: bright primary
          const fade = 1 - t / 3;
          ctx.save();
          ctx.shadowColor = `rgba(${primaryR},${primaryG},${primaryB},${fade})`;
          ctx.shadowBlur = 8 * fade;
          ctx.fillStyle = `rgba(${primaryR},${primaryG},${primaryB},${0.8 + fade * 0.2})`;
          ctx.fillText(ch, cx, cy);
          ctx.restore();
        } else {
          // Trail: fade from primary to dim
          const progress = (t - 2) / (col.trailLen - 2);
          const fade = 1 - progress;
          const r = Math.floor(dimR + (primaryR - dimR) * fade);
          const g = Math.floor(dimG + (primaryG - dimG) * fade);
          const b = Math.floor(dimB + (primaryB - dimB) * fade);
          const alpha = Math.max(0.15, fade * 0.9);

          ctx.fillStyle = `rgba(${r},${g},${b},${alpha})`;
          ctx.fillText(ch, cx, cy);
        }
      }
    }

    // Apply scanlines for CRT authenticity
    applyScanlines(ctx, canvas, 0.08, time);

    this.texture.needsUpdate = true;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Speed boost handled in update via glitchTimer check
      // Also scramble some characters immediately
      for (const col of this.columns) {
        for (let i = 0; i < col.chars.length; i++) {
          col.chars[i] = this.rng.int(0, CHAR_SET.length - 1);
        }
      }
    }
    if (action === 'alert') {
      // Freeze, then cascade restart
      this.freezeTimer = 0.4;
      setTimeout(() => {
        this.cascadeRestartCol = 0;
        this.cascadeTimer = 0;
      }, 400);
    }
    if (action === 'pulse') {
      this.brightFlash = 1;
    }
  }

  dispose(): void {
    this.texture.dispose();
    super.dispose();
  }
}
