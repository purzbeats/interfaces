import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Quantum tunnelling: wave packet hitting a potential barrier.
 * Shows incident, reflected, and transmitted probability density |psi|^2.
 * Canvas-rendered with animated wave propagation.
 */
export class QuantumTunnelElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'quantum-tunnel',
    meta: { shape: 'rectangular', roles: ['data-display', 'decorative'], moods: ['diagnostic', 'ambient'], bandAffinity: 'high', sizes: ['needs-medium', 'needs-large'] },
  };

  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private texture!: THREE.CanvasTexture;
  private mesh!: THREE.Mesh;

  private nx = 300;
  private barrierStart = 0.45;
  private barrierEnd = 0.55;
  private barrierHeight = 1.0;
  private waveK = 12;
  private waveSpeed = 2.0;
  private packetWidth = 0.08;
  private packetCenter = 0.0;
  private showPotential = true;

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;

    const variant = this.rng.int(0, 3);
    const presets = [
      { k: 12, speed: 2.0, bStart: 0.45, bEnd: 0.55, bHeight: 0.8, pw: 0.08 },
      { k: 20, speed: 3.0, bStart: 0.42, bEnd: 0.48, bHeight: 1.2, pw: 0.06 },
      { k: 8, speed: 1.5, bStart: 0.40, bEnd: 0.60, bHeight: 0.5, pw: 0.12 },
      { k: 16, speed: 2.5, bStart: 0.44, bEnd: 0.56, bHeight: 1.0, pw: 0.07 },
    ];
    const p = presets[variant];
    this.waveK = p.k;
    this.waveSpeed = p.speed;
    this.barrierStart = p.bStart;
    this.barrierEnd = p.bEnd;
    this.barrierHeight = p.bHeight;
    this.packetWidth = p.pw;
    this.packetCenter = 0.2;

    this.canvas = document.createElement('canvas');
    const maxRes = 300;
    const scale = Math.min(1, maxRes / Math.max(w, h));
    this.canvas.width = Math.max(64, Math.floor(w * scale));
    this.canvas.height = Math.max(64, Math.floor(h * scale));
    this.ctx = this.get2DContext(this.canvas);
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.magFilter = THREE.NearestFilter;

    const geo = new THREE.PlaneGeometry(w, h);
    const mat = new THREE.MeshBasicMaterial({ map: this.texture, transparent: true });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.set(x + w / 2, y + h / 2, 0);
    this.group.add(this.mesh);
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    (this.mesh.material as THREE.MeshBasicMaterial).opacity = opacity;

    const cw = this.canvas.width;
    const ch = this.canvas.height;
    const ctx = this.ctx;

    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, cw, ch);

    const midY = ch * 0.5;
    const ampScale = ch * 0.35;

    // Draw potential barrier
    if (this.showPotential) {
      const bx0 = this.barrierStart * cw;
      const bx1 = this.barrierEnd * cw;
      const bh = this.barrierHeight * ampScale * 0.4;
      ctx.fillStyle = `rgba(${Math.round(this.palette.dim.r * 255)}, ${Math.round(this.palette.dim.g * 255)}, ${Math.round(this.palette.dim.b * 255)}, 0.3)`;
      ctx.fillRect(bx0, midY - bh, bx1 - bx0, bh * 2);
    }

    // Compute wave function: Gaussian packet with plane wave, reflected/transmitted
    const packetPos = (this.packetCenter + this.waveSpeed * (time % 4.0) / 4.0) % 1.2 - 0.1;
    const k = this.waveK * Math.PI * 2;
    const sigma = this.packetWidth;

    // Transmission coefficient (simplified WKB approximation)
    const kappa = Math.sqrt(Math.max(0.01, this.barrierHeight - 0.5));
    const barrierW = this.barrierEnd - this.barrierStart;
    const T = Math.exp(-2 * kappa * barrierW * 20);
    const R = 1 - T;

    ctx.beginPath();
    ctx.strokeStyle = `rgb(${Math.round(this.palette.primary.r * 255)}, ${Math.round(this.palette.primary.g * 255)}, ${Math.round(this.palette.primary.b * 255)})`;
    ctx.lineWidth = 1.5;

    for (let i = 0; i < cw; i++) {
      const xNorm = i / cw;
      let psiSq = 0;

      // Incident packet
      const dInc = xNorm - packetPos;
      const envInc = Math.exp(-dInc * dInc / (2 * sigma * sigma));
      const phaseInc = Math.cos(k * xNorm - k * this.waveSpeed * time * 0.5);
      const psiInc = envInc * phaseInc;

      if (xNorm < this.barrierStart) {
        // Incident + reflected
        const reflectPos = 2 * this.barrierStart - packetPos;
        const dRef = xNorm - reflectPos;
        const envRef = Math.exp(-dRef * dRef / (2 * sigma * sigma));
        const phaseRef = Math.cos(-k * xNorm - k * this.waveSpeed * time * 0.5);
        const psiRef = Math.sqrt(R) * envRef * phaseRef;
        const psi = psiInc + psiRef;
        psiSq = psi * psi;
      } else if (xNorm > this.barrierEnd) {
        // Transmitted
        const transPos = packetPos + (this.barrierEnd - this.barrierStart);
        const dTr = xNorm - transPos;
        const envTr = Math.exp(-dTr * dTr / (2 * sigma * sigma));
        const phaseTr = Math.cos(k * xNorm - k * this.waveSpeed * time * 0.5);
        psiSq = T * envTr * envTr * phaseTr * phaseTr;
      } else {
        // Inside barrier: evanescent decay
        const depth = (xNorm - this.barrierStart) / barrierW;
        const decay = Math.exp(-kappa * depth * 10);
        psiSq = psiInc * psiInc * decay * decay;
      }

      const py = midY - psiSq * ampScale;
      if (i === 0) ctx.moveTo(i, py);
      else ctx.lineTo(i, py);
    }
    ctx.stroke();

    // Draw baseline
    ctx.beginPath();
    ctx.strokeStyle = `rgba(${Math.round(this.palette.dim.r * 255)}, ${Math.round(this.palette.dim.g * 255)}, ${Math.round(this.palette.dim.b * 255)}, 0.4)`;
    ctx.lineWidth = 0.5;
    ctx.moveTo(0, midY);
    ctx.lineTo(cw, midY);
    ctx.stroke();

    this.texture.needsUpdate = true;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      this.barrierHeight *= 0.5 + this.rng.float(0, 1.5);
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level >= 2) {
      this.waveSpeed = 2.0 + level * 0.5;
    }
  }
}
