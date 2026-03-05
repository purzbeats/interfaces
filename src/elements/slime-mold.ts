import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Physarum slime mold simulation.
 * Agents deposit and follow chemical trails forming organic vein-like networks.
 * The emergent structures resemble real slime mold transport networks.
 */
export class SlimeMoldElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'slime-mold',
    meta: { shape: 'rectangular', roles: ['data-display', 'decorative'], moods: ['diagnostic', 'ambient'], bandAffinity: 'bass', sizes: ['needs-medium', 'needs-large'] },
  };

  private agentCount = 0;
  private agentX!: Float32Array;
  private agentY!: Float32Array;
  private agentAngle!: Float32Array;

  private trailW = 0;
  private trailH = 0;
  private trailMap!: Float32Array;
  private diffusionBuf!: Float32Array;

  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private texture!: THREE.CanvasTexture;
  private mesh!: THREE.Mesh;

  private sensorDist = 9;
  private sensorAngle = 0.5;
  private turnSpeed = 0.4;
  private moveSpeed = 1;
  private depositAmount = 0.15;
  private decayRate = 0.95;
  private renderAccum = 0;

  build(): void {
    const variant = this.rng.int(0, 3);
    const presets = [
      { agents: 5000, res: 150, sensorDist: 9, turnSpeed: 0.4, deposit: 0.15, decay: 0.95 },
      { agents: 12000, res: 200, sensorDist: 7, turnSpeed: 0.5, deposit: 0.12, decay: 0.96 },
      { agents: 2000, res: 100, sensorDist: 12, turnSpeed: 0.3, deposit: 0.2, decay: 0.93 },
      { agents: 8000, res: 180, sensorDist: 5, turnSpeed: 0.6, deposit: 0.1, decay: 0.97 },
    ];
    const p = presets[variant];
    this.glitchAmount = 4;

    const { x, y, w, h } = this.px;
    const aspect = w / h;
    this.trailW = Math.round(p.res * Math.max(1, aspect));
    this.trailH = Math.round(p.res / Math.max(1, 1 / aspect));
    this.trailMap = new Float32Array(this.trailW * this.trailH);
    this.diffusionBuf = new Float32Array(this.trailW * this.trailH);

    this.sensorDist = p.sensorDist;
    this.turnSpeed = p.turnSpeed;
    this.depositAmount = p.deposit;
    this.decayRate = p.decay;

    this.agentCount = Math.min(p.agents, 6000);
    this.agentX = new Float32Array(this.agentCount);
    this.agentY = new Float32Array(this.agentCount);
    this.agentAngle = new Float32Array(this.agentCount);

    // Spawn agents in a ring
    const cx = this.trailW / 2;
    const cy = this.trailH / 2;
    const r = Math.min(this.trailW, this.trailH) * 0.3;
    for (let i = 0; i < this.agentCount; i++) {
      const a = this.rng.float(0, Math.PI * 2);
      const dist = this.rng.float(0, r);
      this.agentX[i] = cx + Math.cos(a) * dist;
      this.agentY[i] = cy + Math.sin(a) * dist;
      this.agentAngle[i] = a + Math.PI + this.rng.float(-0.5, 0.5);
    }

    this.canvas = document.createElement('canvas');
    this.canvas.width = this.trailW;
    this.canvas.height = this.trailH;
    this.ctx = this.get2DContext(this.canvas);

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.magFilter = THREE.NearestFilter;

    const geo = new THREE.PlaneGeometry(w, h);
    this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, opacity: 0 }));
    this.mesh.position.set(x + w / 2, y + h / 2, 0);
    this.group.add(this.mesh);
  }

  private sense(ax: number, ay: number, angle: number): number {
    const sx = Math.round(ax + Math.cos(angle) * this.sensorDist);
    const sy = Math.round(ay + Math.sin(angle) * this.sensorDist);
    if (sx < 0 || sx >= this.trailW || sy < 0 || sy >= this.trailH) return 0;
    return this.trailMap[sy * this.trailW + sx];
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);
    const steps = Math.min(3, Math.max(1, Math.round(dt / 0.016)));

    for (let s = 0; s < steps; s++) {
      // Move agents
      for (let i = 0; i < this.agentCount; i++) {
        const fwd = this.sense(this.agentX[i], this.agentY[i], this.agentAngle[i]);
        const left = this.sense(this.agentX[i], this.agentY[i], this.agentAngle[i] - this.sensorAngle);
        const right = this.sense(this.agentX[i], this.agentY[i], this.agentAngle[i] + this.sensorAngle);

        if (fwd > left && fwd > right) {
          // Go straight
        } else if (fwd < left && fwd < right) {
          this.agentAngle[i] += (this.rng.next() < 0.5 ? -1 : 1) * this.turnSpeed;
        } else if (right > left) {
          this.agentAngle[i] += this.turnSpeed;
        } else {
          this.agentAngle[i] -= this.turnSpeed;
        }

        this.agentX[i] += Math.cos(this.agentAngle[i]) * this.moveSpeed;
        this.agentY[i] += Math.sin(this.agentAngle[i]) * this.moveSpeed;

        // Wrap
        if (this.agentX[i] < 0) this.agentX[i] += this.trailW;
        if (this.agentX[i] >= this.trailW) this.agentX[i] -= this.trailW;
        if (this.agentY[i] < 0) this.agentY[i] += this.trailH;
        if (this.agentY[i] >= this.trailH) this.agentY[i] -= this.trailH;

        // Deposit
        const ix = Math.floor(this.agentX[i]);
        const iy = Math.floor(this.agentY[i]);
        if (ix >= 0 && ix < this.trailW && iy >= 0 && iy < this.trailH) {
          this.trailMap[iy * this.trailW + ix] = Math.min(1, this.trailMap[iy * this.trailW + ix] + this.depositAmount);
        }
      }

      // Diffuse + decay (simple 3x3 box blur) — reuse pre-allocated buffer
      const tmp = this.diffusionBuf;
      tmp.fill(0);
      for (let y2 = 1; y2 < this.trailH - 1; y2++) {
        for (let x2 = 1; x2 < this.trailW - 1; x2++) {
          let sum = 0;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              sum += this.trailMap[(y2 + dy) * this.trailW + (x2 + dx)];
            }
          }
          tmp[y2 * this.trailW + x2] = (sum / 9) * this.decayRate;
        }
      }
      this.trailMap.set(tmp);
    }

    // Render
    this.renderAccum += dt;
    if (this.renderAccum >= 0.05) {
      this.renderAccum = 0;
      const img = this.ctx.getImageData(0, 0, this.trailW, this.trailH);
      const data = img.data;
      const pr = this.palette.primary.r * 255;
      const pg2 = this.palette.primary.g * 255;
      const pb = this.palette.primary.b * 255;
      const sr = this.palette.secondary.r * 255;
      const sg = this.palette.secondary.g * 255;
      const sb = this.palette.secondary.b * 255;

      for (let i = 0; i < this.trailMap.length; i++) {
        const v = this.trailMap[i];
        const idx = i * 4;
        if (v < 0.3) {
          const t = v / 0.3;
          data[idx] = pr * t * 0.5;
          data[idx + 1] = pg2 * t * 0.5;
          data[idx + 2] = pb * t * 0.5;
        } else {
          const t = (v - 0.3) / 0.7;
          data[idx] = pr * (1 - t) + sr * t;
          data[idx + 1] = pg2 * (1 - t) + sg * t;
          data[idx + 2] = pb * (1 - t) + sb * t;
        }
        data[idx + 3] = 255;
      }
      this.ctx.putImageData(img, 0, 0);
      this.texture.needsUpdate = true;
    }

    (this.mesh.material as THREE.MeshBasicMaterial).opacity = opacity * 0.9;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      for (let i = 0; i < this.agentCount; i++) this.agentAngle[i] += this.rng.float(-Math.PI, Math.PI);
    }
    if (action === 'alert') {
      // Scatter from center
      const cx = this.trailW / 2;
      const cy = this.trailH / 2;
      for (let i = 0; i < this.agentCount; i++) {
        this.agentAngle[i] = Math.atan2(this.agentY[i] - cy, this.agentX[i] - cx);
      }
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level >= 3) this.depositAmount = 0.3;
    if (level >= 5) this.trailMap.fill(0);
  }
}
