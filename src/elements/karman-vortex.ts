import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Simplified Karman vortex street: alternating vortices shed behind an
 * obstacle with particle tracers showing the flow pattern. Canvas rendered.
 */
export class KarmanVortexElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'karman-vortex',
    meta: { shape: 'rectangular', roles: ['data-display', 'decorative'], moods: ['ambient', 'diagnostic'], bandAffinity: 'mid', sizes: ['needs-medium', 'needs-large'] },
  };

  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private texture!: THREE.CanvasTexture;
  private mesh!: THREE.Mesh;

  // Particle tracers
  private particleCount = 0;
  private ptX!: Float32Array;  // particle positions (0..cw)
  private ptY!: Float32Array;
  private flowSpeed = 0;
  private vortexStrength = 0;
  private shedFreq = 0;
  private obstacleX = 0;
  private obstacleY = 0;
  private obstacleR = 0;
  private cw = 0;
  private ch = 0;

  // Vortex storage
  private maxVortices = 20;
  private vortexX!: Float32Array;
  private vortexY!: Float32Array;
  private vortexSign!: Float32Array; // +1 or -1 rotation
  private vortexAge!: Float32Array;
  private vortexCount = 0;
  private shedAccum = 0;
  private shedSide = 1;

  build(): void {
    this.glitchAmount = 4;
    const variant = this.rng.int(0, 4);
    const { x, y, w, h } = this.px;
    const presets = [
      { particles: 400, flow: 80, strength: 25, freq: 0.4 },
      { particles: 600, flow: 60, strength: 35, freq: 0.3 },
      { particles: 250, flow: 100, strength: 20, freq: 0.5 },
      { particles: 500, flow: 70, strength: 40, freq: 0.25 },
    ];
    const p = presets[variant];

    const scale = Math.min(w, h) / 200;
    this.flowSpeed = p.flow * scale;
    this.vortexStrength = p.strength * scale;
    this.shedFreq = p.freq;
    this.particleCount = p.particles;

    // Canvas setup
    const maxRes = 512;
    const aspect = w / h;
    this.cw = Math.min(maxRes, Math.ceil(w));
    this.ch = Math.ceil(this.cw / aspect);
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.cw;
    this.canvas.height = this.ch;
    this.ctx = this.get2DContext(this.canvas);

    // Obstacle at ~25% from left, centered vertically
    this.obstacleX = this.cw * 0.25;
    this.obstacleY = this.ch * 0.5;
    this.obstacleR = Math.min(this.cw, this.ch) * 0.06;

    // Particles
    this.ptX = new Float32Array(this.particleCount);
    this.ptY = new Float32Array(this.particleCount);
    for (let i = 0; i < this.particleCount; i++) {
      this.ptX[i] = this.rng.float(0, this.cw);
      this.ptY[i] = this.rng.float(0, this.ch);
    }

    // Vortex arrays
    this.vortexX = new Float32Array(this.maxVortices);
    this.vortexY = new Float32Array(this.maxVortices);
    this.vortexSign = new Float32Array(this.maxVortices);
    this.vortexAge = new Float32Array(this.maxVortices);
    this.vortexAge.fill(999);
    this.vortexCount = 0;

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.LinearFilter;
    const geo = new THREE.PlaneGeometry(w, h);
    this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      map: this.texture, transparent: true, opacity: 0,
    }));
    this.mesh.position.set(x + w / 2, y + h / 2, 0);
    this.group.add(this.mesh);
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    const clampDt = Math.min(dt, 0.033);

    // Shed new vortices alternately
    this.shedAccum += clampDt;
    if (this.shedAccum >= this.shedFreq) {
      this.shedAccum -= this.shedFreq;
      const idx = this.vortexCount % this.maxVortices;
      this.vortexX[idx] = this.obstacleX + this.obstacleR * 1.5;
      this.vortexY[idx] = this.obstacleY + this.shedSide * this.obstacleR * 0.8;
      this.vortexSign[idx] = this.shedSide;
      this.vortexAge[idx] = 0;
      this.shedSide *= -1;
      this.vortexCount++;
    }

    // Advect vortices downstream and age them
    for (let v = 0; v < this.maxVortices; v++) {
      if (this.vortexAge[v] < 50) {
        this.vortexX[v] += this.flowSpeed * clampDt * 0.7;
        this.vortexAge[v] += clampDt;
      }
    }

    // Move particles
    for (let i = 0; i < this.particleCount; i++) {
      let vx = this.flowSpeed;
      let vy = 0;

      // Obstacle deflection
      const odx = this.ptX[i] - this.obstacleX;
      const ody = this.ptY[i] - this.obstacleY;
      const od2 = odx * odx + ody * ody;
      const oR2 = this.obstacleR * this.obstacleR;
      if (od2 < oR2 * 9 && od2 > 1) {
        const factor = oR2 / od2;
        vx += odx * this.flowSpeed * factor * 0.5;
        vy += ody * this.flowSpeed * factor * 0.5;
      }

      // Vortex influence
      for (let v = 0; v < this.maxVortices; v++) {
        if (this.vortexAge[v] > 20) continue;
        const vdx = this.ptX[i] - this.vortexX[v];
        const vdy = this.ptY[i] - this.vortexY[v];
        const vd2 = vdx * vdx + vdy * vdy + 100;
        const decay = Math.exp(-this.vortexAge[v] * 0.3);
        const strength = this.vortexStrength * this.vortexSign[v] * decay / vd2;
        vx += -vdy * strength;
        vy += vdx * strength;
      }

      this.ptX[i] += vx * clampDt;
      this.ptY[i] += vy * clampDt;

      // Wrap around
      if (this.ptX[i] > this.cw) { this.ptX[i] = 0; this.ptY[i] = this.rng.float(0, this.ch); }
      if (this.ptX[i] < 0) this.ptX[i] = this.cw;
      if (this.ptY[i] < 0) this.ptY[i] = this.ch;
      if (this.ptY[i] > this.ch) this.ptY[i] = 0;
    }

    // Render
    this.ctx.fillStyle = 'rgba(0,0,0,0.15)';
    this.ctx.fillRect(0, 0, this.cw, this.ch);

    // Draw obstacle
    const or = ((this.palette.dim.r * 255) | 0);
    const og = ((this.palette.dim.g * 255) | 0);
    const ob = ((this.palette.dim.b * 255) | 0);
    this.ctx.fillStyle = `rgb(${or},${og},${ob})`;
    this.ctx.beginPath();
    this.ctx.arc(this.obstacleX, this.obstacleY, this.obstacleR, 0, Math.PI * 2);
    this.ctx.fill();

    // Draw particles
    const pr = ((this.palette.primary.r * 255) | 0);
    const pg = ((this.palette.primary.g * 255) | 0);
    const pb = ((this.palette.primary.b * 255) | 0);
    this.ctx.fillStyle = `rgba(${pr},${pg},${pb},0.7)`;
    for (let i = 0; i < this.particleCount; i++) {
      this.ctx.fillRect(this.ptX[i] - 0.5, this.ptY[i] - 0.5, 1.2, 1.2);
    }

    this.texture.needsUpdate = true;
    (this.mesh.material as THREE.MeshBasicMaterial).opacity = opacity;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Spawn burst of extra vortices
      for (let i = 0; i < 4; i++) {
        const idx = this.vortexCount % this.maxVortices;
        this.vortexX[idx] = this.obstacleX + this.rng.float(0, this.obstacleR * 3);
        this.vortexY[idx] = this.obstacleY + this.rng.float(-this.obstacleR * 2, this.obstacleR * 2);
        this.vortexSign[idx] = this.rng.chance(0.5) ? 1 : -1;
        this.vortexAge[idx] = 0;
        this.vortexCount++;
      }
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    this.flowSpeed *= (1 + level * 0.05);
    this.vortexStrength *= (1 + level * 0.08);
  }
}
