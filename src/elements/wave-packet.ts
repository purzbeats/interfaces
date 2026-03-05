import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Quantum wave packet simulation. A Gaussian envelope modulates a carrier wave,
 * with dispersion causing the packet to spread over time. Shows probability
 * density |psi|^2 as a filled area, with phase information in a line overlay.
 */
export class WavePacketElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'wave-packet',
    meta: {
      shape: 'rectangular',
      roles: ['data-display', 'decorative'],
      moods: ['diagnostic', 'ambient'],
      bandAffinity: 'mid',
      sizes: ['needs-medium', 'needs-large'],
    } satisfies ElementMeta,
  };

  private resolution: number = 0;
  private fillMesh!: THREE.Mesh;
  private fillPositions!: Float32Array;
  private phaseLine!: THREE.Line;
  private phasePositions!: Float32Array;
  private borderLines!: THREE.LineSegments;
  private fillMat!: THREE.MeshBasicMaterial;
  private phaseMat!: THREE.LineBasicMaterial;
  private borderMat!: THREE.LineBasicMaterial;

  // Wave parameters
  private k0: number = 0;          // central wave number
  private sigma0: number = 0;      // initial width
  private dispersion: number = 0;  // dispersion coefficient
  private groupVelocity: number = 0;
  private packetCount: number = 1;
  private baseY: number = 0;
  private ampScale: number = 0;
  private intensityLevel: number = 0;

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;
    const variant = this.rng.int(0, 3);
    const presets = [
      { res: 200, k0: 12, sigma: 0.08, disp: 0.015, vel: 0.3, packets: 1 },
      { res: 300, k0: 20, sigma: 0.05, disp: 0.025, vel: 0.2, packets: 2 },
      { res: 250, k0: 8,  sigma: 0.12, disp: 0.008, vel: 0.4, packets: 1 },
      { res: 280, k0: 16, sigma: 0.06, disp: 0.020, vel: -0.25, packets: 3 },
    ];
    const p = presets[variant];

    this.resolution = p.res;
    this.k0 = p.k0;
    this.sigma0 = p.sigma;
    this.dispersion = p.disp;
    this.groupVelocity = p.vel;
    this.packetCount = p.packets;
    this.baseY = y + h * 0.7;
    this.ampScale = h * 0.55;

    // Fill mesh: triangle strip for |psi|^2
    const fillVerts = this.resolution * 2 * 3;
    this.fillPositions = new Float32Array(fillVerts);
    const indices: number[] = [];
    for (let i = 0; i < this.resolution - 1; i++) {
      const a = i * 2, b = i * 2 + 1, c = (i + 1) * 2, d = (i + 1) * 2 + 1;
      indices.push(a, b, c, b, d, c);
    }
    const fillGeo = new THREE.BufferGeometry();
    fillGeo.setAttribute('position', new THREE.BufferAttribute(this.fillPositions, 3));
    fillGeo.setIndex(indices);
    this.fillMat = new THREE.MeshBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.fillMesh = new THREE.Mesh(fillGeo, this.fillMat);
    this.group.add(this.fillMesh);

    // Phase line
    this.phasePositions = new Float32Array(this.resolution * 3);
    const phaseGeo = new THREE.BufferGeometry();
    phaseGeo.setAttribute('position', new THREE.BufferAttribute(this.phasePositions, 3));
    this.phaseMat = new THREE.LineBasicMaterial({
      color: this.palette.secondary,
      transparent: true,
      opacity: 0,
    });
    this.phaseLine = new THREE.Line(phaseGeo, this.phaseMat);
    this.group.add(this.phaseLine);

    // Border
    const bv = new Float32Array([
      x, y, 0, x + w, y, 0, x + w, y, 0, x + w, y + h, 0,
      x + w, y + h, 0, x, y + h, 0, x, y + h, 0, x, y, 0,
    ]);
    const borderGeo = new THREE.BufferGeometry();
    borderGeo.setAttribute('position', new THREE.BufferAttribute(bv, 3));
    this.borderMat = new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    });
    this.borderLines = new THREE.LineSegments(borderGeo, this.borderMat);
    this.group.add(this.borderLines);
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    const { x, w } = this.px;

    const fillPos = this.fillMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const phasePos = this.phaseLine.geometry.getAttribute('position') as THREE.BufferAttribute;

    for (let i = 0; i < this.resolution; i++) {
      const t = i / (this.resolution - 1);
      const xp = x + t * w;
      let probDensity = 0;
      let realPart = 0;

      for (let pkt = 0; pkt < this.packetCount; pkt++) {
        const center = 0.5 + this.groupVelocity * time * (1 + pkt * 0.3);
        const wrapped = ((center % 2) + 2) % 2;
        const cx = wrapped > 1 ? 2 - wrapped : wrapped;

        const sigmaT = this.sigma0 * Math.sqrt(1 + (this.dispersion * time) * (this.dispersion * time));
        const dx = t - cx;
        const envelope = Math.exp(-(dx * dx) / (2 * sigmaT * sigmaT));

        const phase = this.k0 * dx - 0.5 * this.k0 * this.k0 * this.dispersion * time;
        const re = envelope * Math.cos(phase);
        const im = envelope * Math.sin(phase);

        probDensity += re * re + im * im;
        realPart += re;
      }

      const amplitude = Math.sqrt(probDensity) * this.ampScale;
      const fy = this.baseY - amplitude;

      // Fill: top vertex and bottom vertex
      this.fillPositions[i * 6]     = xp;
      this.fillPositions[i * 6 + 1] = fy;
      this.fillPositions[i * 6 + 2] = 0;
      this.fillPositions[i * 6 + 3] = xp;
      this.fillPositions[i * 6 + 4] = this.baseY;
      this.fillPositions[i * 6 + 5] = 0;

      // Phase line
      const phaseY = this.baseY - realPart * this.ampScale * 0.6;
      this.phasePositions[i * 3]     = xp;
      this.phasePositions[i * 3 + 1] = phaseY;
      this.phasePositions[i * 3 + 2] = 0.1;
    }

    fillPos.needsUpdate = true;
    phasePos.needsUpdate = true;
    this.fillMesh.geometry.computeBoundingSphere();

    this.fillMat.opacity = opacity * 0.4;
    this.phaseMat.opacity = opacity * 0.8;
    this.borderMat.opacity = opacity * 0.25;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      this.k0 *= -1;
    }
    if (action === 'pulse') {
      this.sigma0 *= 0.5;
      setTimeout(() => { this.sigma0 *= 2; }, 500);
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    this.intensityLevel = level;
    if (level === 0) {
      this.dispersion = Math.abs(this.dispersion);
      return;
    }
    this.dispersion = Math.abs(this.dispersion) * (1 + level * 0.3);
  }
}
