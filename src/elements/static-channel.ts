import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';

/**
 * CRT static noise with palette-tinted pixels, vertical roll, ghost shapes,
 * and horizontal tear artifacts. Low-res canvas upscaled with NearestFilter
 * for authentic blocky pixel look.
 */
export class StaticChannelElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'static-channel',
    meta: { shape: 'rectangular', roles: ['decorative', 'data-display'], moods: ['ambient'], sizes: ['works-small', 'needs-medium'], bandAffinity: 'high' },
  };
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private texture!: THREE.CanvasTexture;
  private mesh!: THREE.Mesh;
  private renderAccum: number = 0;
  private renderInterval: number = 0;
  private gridW: number = 0;
  private gridH: number = 0;
  private rollOffset: number = 0;
  private rollSpeed: number = 0;
  private ghostChance: number = 0;
  private ghostShapes: Array<{ type: string; x: number; y: number; size: number; alpha: number; fade: number }> = [];
  private tearCounter: number = 0;

  build(): void {
    const variant = this.rng.int(0, 4);
    const presets = [
      { gridScale: 80,  fps: 15, rollSpeed: 0.5, ghostChance: 0.08 },   // Standard
      { gridScale: 120, fps: 20, rollSpeed: 0.8, ghostChance: 0.05 },   // High-res
      { gridScale: 60,  fps: 12, rollSpeed: 0.3, ghostChance: 0.15 },   // Haunted
      { gridScale: 90,  fps: 18, rollSpeed: 1.2, ghostChance: 0.03 },   // Fast
    ];
    const p = presets[variant];

    this.glitchAmount = 8;
    const { x, y, w, h } = this.px;
    const aspect = w / h;
    this.gridW = Math.max(40, Math.min(120, Math.floor(p.gridScale * Math.sqrt(aspect))));
    this.gridH = Math.max(30, Math.min(90, Math.floor(this.gridW / aspect)));
    this.renderInterval = 1 / p.fps;
    this.rollSpeed = p.rollSpeed;
    this.ghostChance = p.ghostChance;

    this.canvas = document.createElement('canvas');
    this.canvas.width = this.gridW;
    this.canvas.height = this.gridH;
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.magFilter = THREE.NearestFilter;

    const geo = new THREE.PlaneGeometry(w, h);
    this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      opacity: 0,
    }));
    this.mesh.position.set(x + w / 2, y + h / 2, 1);
    this.group.add(this.mesh);
  }

  private renderCanvas(time: number): void {
    const { ctx, canvas, gridW, gridH } = this;
    const imgData = ctx.createImageData(gridW, gridH);
    const data = imgData.data;

    const pr = this.palette.primary;
    const bgr = this.palette.bg;
    const tintR = pr.r * 255;
    const tintG = pr.g * 255;
    const tintB = pr.b * 255;
    const bgR = bgr.r * 255;
    const bgG = bgr.g * 255;
    const bgB = bgr.b * 255;

    // Vertical roll offset
    this.rollOffset += this.rollSpeed;
    const rollY = Math.floor(this.rollOffset) % gridH;

    for (let y = 0; y < gridH; y++) {
      const srcY = (y + rollY) % gridH;
      for (let x = 0; x < gridW; x++) {
        const idx = (srcY * gridW + x) * 4;

        // Random noise with palette tint
        const noise = Math.random();
        const brightness = noise * noise; // bias toward darker
        data[idx]     = Math.floor(bgR + (tintR - bgR) * brightness);
        data[idx + 1] = Math.floor(bgG + (tintG - bgG) * brightness);
        data[idx + 2] = Math.floor(bgB + (tintB - bgB) * brightness);
        data[idx + 3] = 255;
      }
    }

    // Ghost shapes — appear then fade
    this.ghostShapes = this.ghostShapes.filter(g => g.alpha > 0.01);
    for (const g of this.ghostShapes) {
      g.alpha *= g.fade;
      this.drawGhost(data, g);
    }
    // Spawn new ghosts
    if (Math.random() < this.ghostChance) {
      const types = ['circle', 'rect', 'face', 'triangle'];
      this.ghostShapes.push({
        type: types[Math.floor(Math.random() * types.length)],
        x: Math.floor(Math.random() * gridW),
        y: Math.floor(Math.random() * gridH),
        size: 3 + Math.floor(Math.random() * Math.min(gridW, gridH) * 0.15),
        alpha: 0.3 + Math.random() * 0.4,
        fade: 0.92 + Math.random() * 0.06,
      });
    }

    // Horizontal tear artifacts
    this.tearCounter++;
    if (this.tearCounter >= 20) {
      this.tearCounter = 0;
      const tearY = Math.floor(Math.random() * gridH);
      const tearH = 1 + Math.floor(Math.random() * 3);
      const shift = Math.floor((Math.random() - 0.5) * gridW * 0.2);
      for (let ty = tearY; ty < Math.min(gridH, tearY + tearH); ty++) {
        for (let tx = 0; tx < gridW; tx++) {
          const srcX = tx - shift;
          if (srcX >= 0 && srcX < gridW) {
            const dstIdx = (ty * gridW + tx) * 4;
            const srcIdx = (ty * gridW + srcX) * 4;
            data[dstIdx] = data[srcIdx];
            data[dstIdx + 1] = data[srcIdx + 1];
            data[dstIdx + 2] = data[srcIdx + 2];
          }
        }
      }
    }

    ctx.putImageData(imgData, 0, 0);
    this.texture.needsUpdate = true;
  }

  private drawGhost(data: Uint8ClampedArray, g: { type: string; x: number; y: number; size: number; alpha: number }): void {
    const { gridW, gridH } = this;
    const sr = this.palette.secondary;
    const ghostR = Math.floor(sr.r * 255);
    const ghostG = Math.floor(sr.g * 255);
    const ghostB = Math.floor(sr.b * 255);

    const setPixel = (px: number, py: number, a: number) => {
      if (px < 0 || px >= gridW || py < 0 || py >= gridH) return;
      const idx = (py * gridW + px) * 4;
      const blend = a * g.alpha;
      data[idx]     = Math.min(255, data[idx] + ghostR * blend);
      data[idx + 1] = Math.min(255, data[idx + 1] + ghostG * blend);
      data[idx + 2] = Math.min(255, data[idx + 2] + ghostB * blend);
    };

    const s = g.size;
    switch (g.type) {
      case 'circle':
        for (let dy = -s; dy <= s; dy++) {
          for (let dx = -s; dx <= s; dx++) {
            if (dx * dx + dy * dy <= s * s) {
              setPixel(g.x + dx, g.y + dy, 0.5);
            }
          }
        }
        break;
      case 'rect':
        for (let dy = -s; dy <= s; dy++) {
          for (let dx = -s; dx <= s; dx++) {
            if (Math.abs(dx) === s || Math.abs(dy) === s) {
              setPixel(g.x + dx, g.y + dy, 0.6);
            }
          }
        }
        break;
      case 'face': {
        // Simple face outline — circle + 2 eye dots + mouth line
        for (let a = 0; a < 32; a++) {
          const angle = (a / 32) * Math.PI * 2;
          setPixel(g.x + Math.round(Math.cos(angle) * s), g.y + Math.round(Math.sin(angle) * s), 0.5);
        }
        const eyeOff = Math.floor(s * 0.35);
        const eyeY = g.y - Math.floor(s * 0.25);
        setPixel(g.x - eyeOff, eyeY, 0.8);
        setPixel(g.x + eyeOff, eyeY, 0.8);
        const mouthY = g.y + Math.floor(s * 0.35);
        for (let mx = -eyeOff; mx <= eyeOff; mx++) {
          setPixel(g.x + mx, mouthY, 0.4);
        }
        break;
      }
      case 'triangle':
        for (let row = 0; row < s * 2; row++) {
          const halfW = Math.floor((row / (s * 2)) * s);
          setPixel(g.x - halfW, g.y - s + row, 0.5);
          setPixel(g.x + halfW, g.y - s + row, 0.5);
          if (row === s * 2 - 1) {
            for (let tx = -halfW; tx <= halfW; tx++) {
              setPixel(g.x + tx, g.y - s + row, 0.4);
            }
          }
        }
        break;
    }
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);

    this.renderAccum += dt;
    if (this.renderAccum >= this.renderInterval) {
      this.renderAccum = 0;
      this.renderCanvas(time);
    }

    (this.mesh.material as THREE.MeshBasicMaterial).opacity = opacity * 0.85;
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) return;
    this.rollSpeed += level * 0.3;
    if (level >= 3) {
      this.ghostChance = Math.min(0.3, this.ghostChance + level * 0.05);
    }
    if (level >= 5) {
      // Fill with ghosts
      for (let i = 0; i < 5; i++) {
        this.ghostShapes.push({
          type: 'face',
          x: Math.floor(Math.random() * this.gridW),
          y: Math.floor(Math.random() * this.gridH),
          size: 5 + Math.floor(Math.random() * 8),
          alpha: 0.6,
          fade: 0.95,
        });
      }
    }
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      this.rollSpeed *= 5;
      setTimeout(() => { this.rollSpeed /= 5; }, 400);
    }
  }

  dispose(): void {
    this.texture.dispose();
    super.dispose();
  }
}
