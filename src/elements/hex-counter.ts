import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Large hexadecimal number display that counts/cycles.
 * Canvas-based rendering with monospace font, occasional digit glitches.
 */
export class HexCounterElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'hex-counter',
    meta: { shape: 'linear', roles: ['text', 'data-display'], moods: ['diagnostic', 'tactical'], bandAffinity: 'bass', audioSensitivity: 0.6, sizes: ['works-small'] },
  };
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private texture!: THREE.CanvasTexture;
  private mesh!: THREE.Mesh;
  private borderLines!: THREE.LineSegments;
  private counter: number = 0;
  private speed: number = 0;
  private digits: number = 0;
  private renderAccum: number = 0;
  private readonly RENDER_INTERVAL = 1 / 10;
  private label: string = '';
  private glitchThreshold: number = 80;

  build(): void {
    const variant = this.rng.int(0, 3);
    const presets = [
      { digitPicks: [4, 6, 8], speedMin: 20, speedMax: 200, glitchProb: 80, labels: ['ADDR', 'REG', 'PTR', 'HEX', '0x'] },     // Standard
      { digitPicks: [8, 10, 12], speedMin: 200, speedMax: 800, glitchProb: 40, labels: ['ADDR', 'PTR', '0x'] },                  // Dense (many digits, fast)
      { digitPicks: [2, 3, 4], speedMin: 5, speedMax: 40, glitchProb: 120, labels: ['REG', 'HEX'] },                             // Minimal (few digits, slow)
      { digitPicks: [4, 6], speedMin: 50, speedMax: 150, glitchProb: 20, labels: ['FLUX', 'SYNC', 'HASH'] },                     // Exotic (frequent glitches)
    ];
    const p = presets[variant];
    this.glitchThreshold = p.glitchProb;

    this.glitchAmount = 3;
    const { x, y, w, h } = this.px;

    this.counter = this.rng.int(0, 0xFFFF);
    this.speed = this.rng.float(p.speedMin, p.speedMax);
    this.digits = this.rng.pick(p.digitPicks);
    this.label = this.rng.pick(p.labels);

    const scale = Math.min(2, window.devicePixelRatio);
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.ceil(w * scale);
    this.canvas.height = Math.ceil(h * scale);
    this.ctx = this.get2DContext(this.canvas);
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.NearestFilter;

    const geo = new THREE.PlaneGeometry(w, h);
    this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      opacity: 0,
    }));
    this.mesh.position.set(x + w / 2, y + h / 2, 1);
    this.group.add(this.mesh);

    // Border
    const bv = new Float32Array([
      x, y, 0, x + w, y, 0,
      x + w, y, 0, x + w, y + h, 0,
      x + w, y + h, 0, x, y + h, 0,
      x, y + h, 0, x, y, 0,
    ]);
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.BufferAttribute(bv, 3));
    this.borderLines = new THREE.LineSegments(bg, new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.borderLines);
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);

    this.counter += dt * this.speed;
    const maxVal = Math.pow(16, this.digits);
    if (this.counter >= maxVal) this.counter -= maxVal;

    this.renderAccum += dt;
    if (this.renderAccum >= this.RENDER_INTERVAL) {
      this.renderAccum = 0;
      this.renderCanvas();
    }

    (this.mesh.material as THREE.MeshBasicMaterial).opacity = opacity;
    (this.borderLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.3;
  }

  private renderCanvas(): void {
    const { ctx, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const val = Math.floor(this.counter);
    let hexStr = val.toString(16).toUpperCase().padStart(this.digits, '0');

    // Occasional glitch: replace random digit
    const isGlitching = this.glitchTimer > 0;
    if (isGlitching) {
      const chars = hexStr.split('');
      for (let i = 0; i < chars.length; i++) {
        const hash = ((i * 2654435761 + val) >>> 0) & 0xFF;
        if (hash < this.glitchThreshold) {
          chars[i] = String.fromCharCode(33 + (hash % 60));
        }
      }
      hexStr = chars.join('');
    }

    const primaryHex = '#' + this.palette.primary.getHexString();
    const dimHex = '#' + this.palette.dim.getHexString();
    const secondaryHex = '#' + this.palette.secondary.getHexString();

    // Label
    const labelSize = Math.max(6, Math.floor(canvas.height * 0.18));
    ctx.font = `${labelSize}px monospace`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = dimHex;
    ctx.fillText(this.label, canvas.width * 0.05, canvas.height * 0.08);

    // Hex digits — scale to fit
    const digitStr = hexStr;
    const heightSize = Math.floor(canvas.height * 0.5);
    const widthSize = Math.floor(canvas.width / (digitStr.length * 0.65));
    const bigSize = Math.max(8, Math.min(heightSize, widthSize));
    ctx.font = `bold ${bigSize}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = isGlitching ? secondaryHex : primaryHex;
    ctx.fillText(digitStr, canvas.width / 2, canvas.height * 0.55);

    this.texture.needsUpdate = true;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      this.speed *= 10;
      setTimeout(() => { this.speed /= 10; }, 400);
    }
    if (action === 'alert') {
      this.pulseTimer = 1.5;
      this.counter = 0;
    }
  }

  dispose(): void {
    this.texture.dispose();
    super.dispose();
  }
}
