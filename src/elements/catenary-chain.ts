import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Multiple hanging chains (catenary curves) swinging with physics.
 * Wind and gravity create organic motion. Each chain is a series
 * of connected line segments solved via Verlet integration.
 */
export class CatenaryChainElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'catenary-chain',
    meta: {
      shape: 'rectangular',
      roles: ['decorative'],
      moods: ['ambient', 'tactical'],
      bandAffinity: 'bass',
      sizes: ['works-small', 'needs-medium', 'needs-large'],
    },
  };

  private lineMesh!: THREE.LineSegments;
  private anchorMesh!: THREE.Points;
  private borderLines!: THREE.LineSegments;

  private chainCount: number = 0;
  private segmentsPerChain: number = 20;
  private segLength: number = 5;

  // Verlet particles: chainCount * (segmentsPerChain+1) particles
  private posX!: Float32Array;
  private posY!: Float32Array;
  private prevX!: Float32Array;
  private prevY!: Float32Array;
  private pinned!: Uint8Array; // which particles are pinned

  private gravity: number = 200;
  private damping: number = 0.99;
  private windStrength: number = 30;
  private windFreq: number = 0.5;
  private constraintIters: number = 5;
  private intensityLevel: number = 0;

  private particleCount: number = 0;
  private totalSegments: number = 0;

  build(): void {
    const variant = this.rng.int(0, 3);
    const presets = [
      { chains: 5, segs: 20, segLen: 5, gravity: 200, wind: 30, windF: 0.5, iters: 5 },    // Standard
      { chains: 8, segs: 15, segLen: 3, gravity: 250, wind: 50, windF: 0.8, iters: 4 },    // Dense windy
      { chains: 3, segs: 30, segLen: 6, gravity: 150, wind: 15, windF: 0.3, iters: 6 },    // Long gentle
      { chains: 12, segs: 10, segLen: 4, gravity: 300, wind: 40, windF: 1.0, iters: 3 },   // Many short
    ];
    const p = presets[variant];

    this.chainCount = p.chains;
    this.segmentsPerChain = p.segs;
    this.segLength = p.segLen;
    this.gravity = p.gravity;
    this.windStrength = p.wind;
    this.windFreq = p.windF;
    this.constraintIters = p.iters;
    this.glitchAmount = 4;

    const { x, y, w, h } = this.px;
    const ptsPerChain = this.segmentsPerChain + 1;
    this.particleCount = this.chainCount * ptsPerChain;
    this.totalSegments = this.chainCount * this.segmentsPerChain;

    // Scale segment length to region
    const scale = Math.min(w, h) / 200;
    this.segLength *= scale;
    this.gravity *= scale;
    this.windStrength *= scale;

    // Allocate arrays
    this.posX = new Float32Array(this.particleCount);
    this.posY = new Float32Array(this.particleCount);
    this.prevX = new Float32Array(this.particleCount);
    this.prevY = new Float32Array(this.particleCount);
    this.pinned = new Uint8Array(this.particleCount);

    // Initialize chains hanging from top edge
    for (let c = 0; c < this.chainCount; c++) {
      const anchorX = x + (c + 0.5) / this.chainCount * w + this.rng.float(-w * 0.02, w * 0.02);
      const anchorY = y + this.rng.float(5, h * 0.15);

      for (let s = 0; s < ptsPerChain; s++) {
        const idx = c * ptsPerChain + s;
        this.posX[idx] = anchorX + this.rng.float(-2, 2);
        this.posY[idx] = anchorY + s * this.segLength;
        this.prevX[idx] = this.posX[idx];
        this.prevY[idx] = this.posY[idx];

        // Pin first particle of each chain
        if (s === 0) this.pinned[idx] = 1;
      }
    }

    // Line segments for chains
    const linePositions = new Float32Array(this.totalSegments * 6);
    const lineColors = new Float32Array(this.totalSegments * 6);
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.BufferAttribute(linePositions, 3));
    lineGeo.setAttribute('color', new THREE.BufferAttribute(lineColors, 3));

    this.lineMesh = new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.lineMesh);

    // Anchor points
    const anchorPos = new Float32Array(this.chainCount * 3);
    for (let c = 0; c < this.chainCount; c++) {
      const idx = c * ptsPerChain;
      anchorPos[c * 3] = this.posX[idx];
      anchorPos[c * 3 + 1] = this.posY[idx];
      anchorPos[c * 3 + 2] = 0.5;
    }
    const anchorGeo = new THREE.BufferGeometry();
    anchorGeo.setAttribute('position', new THREE.BufferAttribute(anchorPos, 3));
    this.anchorMesh = new THREE.Points(anchorGeo, new THREE.PointsMaterial({
      color: this.palette.secondary,
      transparent: true,
      opacity: 0,
      size: 3,
      sizeAttenuation: false,
    }));
    this.group.add(this.anchorMesh);

    // Border
    const bv = new Float32Array([
      x, y, 0, x + w, y, 0,
      x + w, y, 0, x + w, y + h, 0,
      x + w, y + h, 0, x, y + h, 0,
      x, y + h, 0, x, y, 0,
    ]);
    const borderGeo = new THREE.BufferGeometry();
    borderGeo.setAttribute('position', new THREE.BufferAttribute(bv, 3));
    this.borderLines = new THREE.LineSegments(borderGeo, new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.borderLines);
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);

    // Clamp dt for stability
    const cdt = Math.min(dt, 0.033);
    const ptsPerChain = this.segmentsPerChain + 1;

    // Wind force (varies by position and time)
    const windX = Math.sin(time * this.windFreq) * this.windStrength * (1 + this.intensityLevel * 0.3);
    const windY = Math.cos(time * this.windFreq * 0.7) * this.windStrength * 0.2;

    // Verlet integration
    for (let i = 0; i < this.particleCount; i++) {
      if (this.pinned[i]) continue;

      const vx = (this.posX[i] - this.prevX[i]) * this.damping;
      const vy = (this.posY[i] - this.prevY[i]) * this.damping;

      this.prevX[i] = this.posX[i];
      this.prevY[i] = this.posY[i];

      // Add gravity + wind
      const chainIdx = Math.floor(i / ptsPerChain);
      const segIdx = i % ptsPerChain;
      const windScale = segIdx / ptsPerChain; // More wind effect further from anchor

      this.posX[i] += vx + windX * windScale * cdt * cdt;
      this.posY[i] += vy + this.gravity * cdt * cdt + windY * windScale * cdt * cdt;
    }

    // Distance constraints
    for (let iter = 0; iter < this.constraintIters; iter++) {
      for (let c = 0; c < this.chainCount; c++) {
        for (let s = 0; s < this.segmentsPerChain; s++) {
          const i1 = c * ptsPerChain + s;
          const i2 = i1 + 1;

          const dx = this.posX[i2] - this.posX[i1];
          const dy = this.posY[i2] - this.posY[i1];
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 0.001) continue;

          const diff = (dist - this.segLength) / dist;
          const halfDiff = diff * 0.5;

          if (!this.pinned[i1]) {
            this.posX[i1] += dx * halfDiff;
            this.posY[i1] += dy * halfDiff;
          }
          if (!this.pinned[i2]) {
            this.posX[i2] -= dx * halfDiff;
            this.posY[i2] -= dy * halfDiff;
          }
        }
      }
    }

    // Update GPU buffers
    const pos = this.lineMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const col = this.lineMesh.geometry.getAttribute('color') as THREE.BufferAttribute;
    const pr = this.palette.primary;
    const dm = this.palette.dim;

    for (let c = 0; c < this.chainCount; c++) {
      for (let s = 0; s < this.segmentsPerChain; s++) {
        const i1 = c * ptsPerChain + s;
        const i2 = i1 + 1;
        const lineIdx = (c * this.segmentsPerChain + s) * 2;

        pos.setXYZ(lineIdx, this.posX[i1], this.posY[i1], 0.3);
        pos.setXYZ(lineIdx + 1, this.posX[i2], this.posY[i2], 0.3);

        // Color gradient along chain
        const t = s / this.segmentsPerChain;
        col.setXYZ(lineIdx, pr.r, pr.g, pr.b);
        col.setXYZ(lineIdx + 1,
          pr.r * (1 - t) + dm.r * t,
          pr.g * (1 - t) + dm.g * t,
          pr.b * (1 - t) + dm.b * t,
        );
      }
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;

    (this.lineMesh.material as THREE.LineBasicMaterial).opacity = opacity;
    (this.anchorMesh.material as THREE.PointsMaterial).opacity = opacity;
    (this.borderLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.2;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Sudden wind blast
      const ptsPerChain = this.segmentsPerChain + 1;
      for (let i = 0; i < this.particleCount; i++) {
        if (!this.pinned[i]) {
          this.posX[i] += this.rng.float(-20, 20);
          this.posY[i] += this.rng.float(-10, 10);
        }
      }
    }
    if (action === 'pulse') {
      // Upward impulse
      for (let i = 0; i < this.particleCount; i++) {
        if (!this.pinned[i]) {
          this.prevY[i] = this.posY[i] + 10; // upward velocity via Verlet
        }
      }
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    this.intensityLevel = level;
    this.windStrength = 30 * (Math.min(this.px.w, this.px.h) / 200) * (1 + level * 0.4);
  }
}
