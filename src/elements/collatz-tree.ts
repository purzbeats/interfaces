import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Collatz conjecture tree visualization. Numbers branch according to the
 * 3n+1 / n/2 rules, rendered as a growing fractal tree with angle encoding.
 * Each number's path to 1 is drawn as a series of line segments that turn
 * left (even) or right (odd).
 */
export class CollatzTreeElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'collatz-tree',
    meta: {
      shape: 'rectangular',
      roles: ['data-display', 'decorative'],
      moods: ['ambient', 'diagnostic'],
      bandAffinity: 'mid',
      sizes: ['needs-medium', 'needs-large'],
    },
  };

  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private texture!: THREE.CanvasTexture;
  private mesh!: THREE.Mesh;
  private material!: THREE.MeshBasicMaterial;

  private cw: number = 0;
  private ch: number = 0;
  private currentNumber: number = 2;
  private maxNumber: number = 500;
  private segmentLength: number = 4;
  private evenAngle: number = 0.13;
  private oddAngle: number = -0.13;
  private drawSpeed: number = 3; // numbers per frame
  private fadeAlpha: number = 0.002;
  private intensityLevel: number = 0;

  build(): void {
    const variant = this.rng.int(0, 3);
    const presets = [
      { maxNum: 500, segLen: 4, eAngle: 0.13, oAngle: -0.13, speed: 3, fade: 0.002 },  // Classic tree
      { maxNum: 800, segLen: 3, eAngle: 0.08, oAngle: -0.15, speed: 5, fade: 0.001 },  // Dense asymmetric
      { maxNum: 300, segLen: 6, eAngle: 0.2, oAngle: -0.1, speed: 2, fade: 0.003 },    // Sparse wide
      { maxNum: 1000, segLen: 2, eAngle: 0.1, oAngle: -0.2, speed: 8, fade: 0.0005 },  // Ultra-dense
    ];
    const p = presets[variant];

    this.maxNumber = p.maxNum;
    this.segmentLength = p.segLen;
    this.evenAngle = p.eAngle;
    this.oddAngle = p.oAngle;
    this.drawSpeed = p.speed;
    this.fadeAlpha = p.fade;
    this.currentNumber = 2;
    this.glitchAmount = 4;

    const { x, y, w, h } = this.px;
    this.cw = Math.max(64, Math.floor(w * 0.7));
    this.ch = Math.max(64, Math.floor(h * 0.7));

    this.canvas = document.createElement('canvas');
    this.canvas.width = this.cw;
    this.canvas.height = this.ch;
    this.ctx = this.get2DContext(this.canvas);

    // Fill with background
    this.ctx.fillStyle = `rgb(${Math.floor(this.palette.bg.r * 255)},${Math.floor(this.palette.bg.g * 255)},${Math.floor(this.palette.bg.b * 255)})`;
    this.ctx.fillRect(0, 0, this.cw, this.ch);

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.magFilter = THREE.NearestFilter;

    this.material = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      opacity: 0,
    });

    const geo = new THREE.PlaneGeometry(w, h);
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.position.set(x + w / 2, y + h / 2, 0);
    this.group.add(this.mesh);
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);
    this.material.opacity = opacity;

    // Gentle fade
    const bgr = Math.floor(this.palette.bg.r * 255);
    const bgg = Math.floor(this.palette.bg.g * 255);
    const bgb = Math.floor(this.palette.bg.b * 255);
    this.ctx.fillStyle = `rgba(${bgr},${bgg},${bgb},${this.fadeAlpha})`;
    this.ctx.fillRect(0, 0, this.cw, this.ch);

    // Draw a batch of sequences per frame
    const speed = this.drawSpeed + this.intensityLevel;
    for (let i = 0; i < speed; i++) {
      this.drawCollatzPath(this.currentNumber);
      this.currentNumber++;
      if (this.currentNumber > this.maxNumber) {
        this.currentNumber = 2;
      }
    }

    this.texture.needsUpdate = true;
  }

  private drawCollatzPath(n: number): void {
    // Compute the Collatz sequence for n (reversed so we draw from root)
    const sequence: boolean[] = []; // true = even step, false = odd step
    let val = n;
    while (val > 1 && sequence.length < 200) {
      if (val % 2 === 0) {
        sequence.push(true);
        val = val / 2;
      } else {
        sequence.push(false);
        val = 3 * val + 1;
      }
    }
    sequence.reverse();

    // Start from bottom center, draw upward
    let px = this.cw / 2;
    let py = this.ch - 10;
    let angle = -Math.PI / 2; // pointing up

    const ctx = this.ctx;
    const pr = this.palette.primary;
    const sr = this.palette.secondary;

    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(px, py);

    for (let i = 0; i < sequence.length; i++) {
      if (sequence[i]) {
        angle += this.evenAngle;
      } else {
        angle += this.oddAngle;
      }
      px += Math.cos(angle) * this.segmentLength;
      py += Math.sin(angle) * this.segmentLength;
      ctx.lineTo(px, py);
    }

    // Color based on starting number
    const t = (n % 100) / 100;
    const r = Math.floor((pr.r * t + sr.r * (1 - t)) * 255);
    const g = Math.floor((pr.g * t + sr.g * (1 - t)) * 255);
    const b = Math.floor((pr.b * t + sr.b * (1 - t)) * 255);
    ctx.strokeStyle = `rgba(${r},${g},${b},0.4)`;
    ctx.stroke();
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      this.evenAngle += this.rng.float(-0.05, 0.05);
      this.oddAngle += this.rng.float(-0.05, 0.05);
    }
    if (action === 'pulse') {
      // Clear and restart
      const bgr = Math.floor(this.palette.bg.r * 255);
      const bgg = Math.floor(this.palette.bg.g * 255);
      const bgb = Math.floor(this.palette.bg.b * 255);
      this.ctx.fillStyle = `rgb(${bgr},${bgg},${bgb})`;
      this.ctx.fillRect(0, 0, this.cw, this.ch);
      this.currentNumber = 2;
    }
    if (action === 'alert') {
      // Jump to high numbers for interesting patterns
      this.currentNumber = this.rng.int(500, 5000);
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    this.intensityLevel = level;
  }
}
