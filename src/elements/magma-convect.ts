import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

interface MagmaPreset {
  particleCount: number;
  riseSpeed: number;
  sinkSpeed: number;
  coolingRate: number;
}

/**
 * Magma convection plumes rising from bottom. Hot blobs rise, cool and
 * sink at sides. Particle-based convection with temperature coloring.
 * Canvas rendered.
 */
export class MagmaConvectElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'magma-convect',
    meta: {
      shape: 'rectangular',
      roles: ['decorative'],
      moods: ['ambient'],
      sizes: ['needs-medium', 'needs-large'],
      bandAffinity: 'sub',
    } satisfies ElementMeta,
  };

  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private texture!: THREE.CanvasTexture;
  private mesh!: THREE.Mesh;
  private mat!: THREE.MeshBasicMaterial;

  private particleCount = 80;
  private px_arr!: Float32Array;
  private py_arr!: Float32Array;
  private pvx!: Float32Array;
  private pvy!: Float32Array;
  private temp!: Float32Array;  // 0=cold, 1=hot
  private riseSpeed = 60;
  private sinkSpeed = 30;
  private coolingRate = 0.15;
  private intensityLevel = 0;
  private cw = 0;
  private ch = 0;

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;

    const variant = this.rng.int(0, 4);
    const presets: MagmaPreset[] = [
      { particleCount: 80,  riseSpeed: 60, sinkSpeed: 30, coolingRate: 0.15 },
      { particleCount: 150, riseSpeed: 40, sinkSpeed: 20, coolingRate: 0.10 },
      { particleCount: 50,  riseSpeed: 90, sinkSpeed: 50, coolingRate: 0.25 },
      { particleCount: 100, riseSpeed: 70, sinkSpeed: 35, coolingRate: 0.12 },
    ];
    const p = presets[variant];
    this.particleCount = p.particleCount;
    this.riseSpeed = p.riseSpeed;
    this.sinkSpeed = p.sinkSpeed;
    this.coolingRate = p.coolingRate;

    this.canvas = document.createElement('canvas');
    this.cw = Math.min(w, 400);
    this.ch = Math.min(h, 400);
    this.canvas.width = this.cw;
    this.canvas.height = this.ch;
    this.ctx = this.get2DContext(this.canvas);
    this.texture = new THREE.CanvasTexture(this.canvas);

    // Initialize particles
    this.px_arr = new Float32Array(this.particleCount);
    this.py_arr = new Float32Array(this.particleCount);
    this.pvx = new Float32Array(this.particleCount);
    this.pvy = new Float32Array(this.particleCount);
    this.temp = new Float32Array(this.particleCount);

    for (let i = 0; i < this.particleCount; i++) {
      this.respawnParticle(i);
      // Distribute across canvas initially
      this.py_arr[i] = this.rng.float(0, this.ch);
    }

    const planeGeo = new THREE.PlaneGeometry(w, h);
    this.mat = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      opacity: 0,
    });
    this.mesh = new THREE.Mesh(planeGeo, this.mat);
    this.mesh.position.set(x + w / 2, y + h / 2, 0);
    this.group.add(this.mesh);
  }

  private respawnParticle(i: number): void {
    const centerX = this.cw / 2;
    const plumeWidth = this.cw * 0.3;

    // Hot particles spawn at bottom center
    this.px_arr[i] = centerX + this.rng.float(-plumeWidth, plumeWidth);
    this.py_arr[i] = this.ch - this.rng.float(0, this.ch * 0.1);
    this.pvx[i] = this.rng.float(-5, 5);
    this.pvy[i] = -this.riseSpeed * this.rng.float(0.5, 1.5);
    this.temp[i] = this.rng.float(0.8, 1.0);
  }

  private drawMagma(): void {
    const ctx = this.ctx;
    const bg = this.palette.bg;

    // Fade background slightly for trail effect
    ctx.fillStyle = `rgba(${Math.floor(bg.r * 255)},${Math.floor(bg.g * 255)},${Math.floor(bg.b * 255)},0.15)`;
    ctx.fillRect(0, 0, this.cw, this.ch);

    const pri = this.palette.primary;
    const sec = this.palette.secondary;
    const dim = this.palette.dim;

    for (let i = 0; i < this.particleCount; i++) {
      const t = this.temp[i];
      // Hot = primary/bright, cold = dim
      const r = Math.floor((dim.r + (pri.r - dim.r) * t) * 255);
      const g = Math.floor((dim.g + (sec.g - dim.g) * t * 0.6) * 255);
      const b = Math.floor((dim.b + (dim.b) * (1 - t)) * 255);

      const radius = 3 + t * 6;
      ctx.fillStyle = `rgba(${Math.max(0, Math.min(255, r))},${Math.max(0, Math.min(255, g))},${Math.max(0, Math.min(255, b))},${0.3 + t * 0.5})`;
      ctx.beginPath();
      ctx.arc(this.px_arr[i], this.py_arr[i], radius, 0, Math.PI * 2);
      ctx.fill();
    }

    // Draw heat source glow at bottom
    const gradient = ctx.createLinearGradient(0, this.ch, 0, this.ch - this.ch * 0.15);
    gradient.addColorStop(0, `rgba(${Math.floor(pri.r * 255)},${Math.floor(pri.g * 180)},0,0.4)`);
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, this.ch * 0.85, this.cw, this.ch * 0.15);
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    const speedMul = 1 + this.intensityLevel * 0.4;

    for (let i = 0; i < this.particleCount; i++) {
      // Cool down as particle rises
      this.temp[i] -= this.coolingRate * dt;

      // Hot particles rise, cold particles sink at edges
      if (this.temp[i] > 0.3) {
        // Rising — central plume
        this.pvy[i] = -this.riseSpeed * this.temp[i] * speedMul;
        // Slight horizontal wobble
        this.pvx[i] += Math.sin(time * 2 + i) * 10 * dt;
      } else {
        // Cooling — drift to sides and sink
        const sideDir = this.px_arr[i] < this.cw / 2 ? -1 : 1;
        this.pvx[i] += sideDir * 15 * dt;
        this.pvy[i] = this.sinkSpeed * (1 - this.temp[i]) * speedMul;
      }

      this.px_arr[i] += this.pvx[i] * dt;
      this.py_arr[i] += this.pvy[i] * dt;

      // Wrap horizontally
      if (this.px_arr[i] < 0) this.px_arr[i] += this.cw;
      if (this.px_arr[i] > this.cw) this.px_arr[i] -= this.cw;

      // Respawn if off-screen or too cold
      if (this.py_arr[i] < -10 || this.py_arr[i] > this.ch + 10 || this.temp[i] < 0.05) {
        this.respawnParticle(i);
      }
    }

    this.drawMagma();
    this.texture.needsUpdate = true;
    this.mat.opacity = opacity;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Sudden eruption — reheat all particles
      for (let i = 0; i < this.particleCount; i++) {
        this.temp[i] = this.rng.float(0.7, 1.0);
        this.pvy[i] = -this.riseSpeed * 2;
      }
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    this.intensityLevel = level;
  }
}
