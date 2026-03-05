import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

interface MarkovPreset {
  stateCount: number;
  particleCount: number;
  transitionSpeed: number;
  edgeOpacity: number;
}

/**
 * Markov chain state transition visualization.
 * N states arranged on a circle with weighted transition edges.
 * Particles jump between states following the chain probabilities.
 */
export class MarkovChainElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'markov-chain',
    meta: {
      shape: 'radial',
      roles: ['data-display', 'decorative'],
      moods: ['diagnostic', 'ambient'],
      sizes: ['needs-medium', 'needs-large'],
      bandAffinity: 'mid',
    } satisfies ElementMeta,
  };

  private statePoints!: THREE.Points;
  private edgeLines!: THREE.LineSegments;
  private particlePoints!: THREE.Points;

  private stateCount = 6;
  private stateX: number[] = [];
  private stateY: number[] = [];
  private transitionMatrix: number[][] = [];

  private particles: Array<{
    current: number;
    target: number;
    t: number;
    speed: number;
  }> = [];
  private particleCount = 8;
  private transitionSpeed = 1.0;
  private cx = 0;
  private cy = 0;
  private radius = 0;

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;
    this.cx = x + w / 2;
    this.cy = y + h / 2;
    this.radius = Math.min(w, h) * 0.38;

    const variant = this.rng.int(0, 3);
    const presets: MarkovPreset[] = [
      { stateCount: 6,  particleCount: 8,  transitionSpeed: 1.0, edgeOpacity: 0.3 },
      { stateCount: 10, particleCount: 16, transitionSpeed: 1.5, edgeOpacity: 0.2 },
      { stateCount: 4,  particleCount: 4,  transitionSpeed: 0.6, edgeOpacity: 0.5 },
      { stateCount: 8,  particleCount: 12, transitionSpeed: 2.0, edgeOpacity: 0.25 },
    ];
    const p = presets[variant];
    this.stateCount = p.stateCount;
    this.particleCount = p.particleCount;
    this.transitionSpeed = p.transitionSpeed;

    // Arrange states on a circle
    for (let i = 0; i < this.stateCount; i++) {
      const angle = (i / this.stateCount) * Math.PI * 2 - Math.PI / 2;
      this.stateX.push(this.cx + Math.cos(angle) * this.radius);
      this.stateY.push(this.cy + Math.sin(angle) * this.radius);
    }

    // Build transition probability matrix (row-stochastic)
    for (let i = 0; i < this.stateCount; i++) {
      const row: number[] = [];
      let sum = 0;
      for (let j = 0; j < this.stateCount; j++) {
        const val = i === j ? 0 : this.rng.float(0.1, 1.0);
        row.push(val);
        sum += val;
      }
      // Normalize
      for (let j = 0; j < this.stateCount; j++) {
        row[j] /= sum;
      }
      this.transitionMatrix.push(row);
    }

    // State points
    const statePos = new Float32Array(this.stateCount * 3);
    for (let i = 0; i < this.stateCount; i++) {
      statePos[i * 3] = this.stateX[i];
      statePos[i * 3 + 1] = this.stateY[i];
      statePos[i * 3 + 2] = 1;
    }
    const stateGeo = new THREE.BufferGeometry();
    stateGeo.setAttribute('position', new THREE.BufferAttribute(statePos, 3));
    this.statePoints = new THREE.Points(stateGeo, new THREE.PointsMaterial({
      color: this.palette.secondary,
      size: Math.max(6, Math.min(w, h) * 0.02),
      transparent: true,
      opacity: 0,
      sizeAttenuation: false,
    }));
    this.group.add(this.statePoints);

    // Edge lines: draw all non-zero transitions
    const edgeVerts: number[] = [];
    for (let i = 0; i < this.stateCount; i++) {
      for (let j = i + 1; j < this.stateCount; j++) {
        if (this.transitionMatrix[i][j] > 0.05 || this.transitionMatrix[j][i] > 0.05) {
          edgeVerts.push(
            this.stateX[i], this.stateY[i], 0,
            this.stateX[j], this.stateY[j], 0,
          );
        }
      }
    }
    const edgeArr = new Float32Array(edgeVerts);
    const edgeGeo = new THREE.BufferGeometry();
    edgeGeo.setAttribute('position', new THREE.BufferAttribute(edgeArr, 3));
    this.edgeLines = new THREE.LineSegments(edgeGeo, new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.edgeLines);

    // Initialize particles
    for (let i = 0; i < this.particleCount; i++) {
      const current = this.rng.int(0, this.stateCount - 1);
      this.particles.push({
        current,
        target: this.pickNextState(current),
        t: 0,
        speed: this.rng.float(0.5, 1.5) * this.transitionSpeed,
      });
    }

    const particlePos = new Float32Array(this.particleCount * 3);
    for (let i = 0; i < this.particleCount; i++) {
      particlePos[i * 3] = this.stateX[this.particles[i].current];
      particlePos[i * 3 + 1] = this.stateY[this.particles[i].current];
      particlePos[i * 3 + 2] = 2;
    }
    const particleGeo = new THREE.BufferGeometry();
    particleGeo.setAttribute('position', new THREE.BufferAttribute(particlePos, 3));
    this.particlePoints = new THREE.Points(particleGeo, new THREE.PointsMaterial({
      color: this.palette.primary,
      size: Math.max(4, Math.min(w, h) * 0.012),
      transparent: true,
      opacity: 0,
      sizeAttenuation: false,
    }));
    this.group.add(this.particlePoints);
  }

  private pickNextState(current: number): number {
    const row = this.transitionMatrix[current];
    let r = this.rng.float(0, 1);
    for (let j = 0; j < this.stateCount; j++) {
      r -= row[j];
      if (r <= 0) return j;
    }
    return (current + 1) % this.stateCount;
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);

    const particlePos = this.particlePoints.geometry.getAttribute('position') as THREE.BufferAttribute;

    for (let i = 0; i < this.particleCount; i++) {
      const p = this.particles[i];
      p.t += p.speed * dt;

      if (p.t >= 1) {
        p.current = p.target;
        p.target = this.pickNextState(p.current);
        p.t = 0;
        p.speed = this.rng.float(0.5, 1.5) * this.transitionSpeed;
      }

      // Interpolate position with slight arc
      const sx = this.stateX[p.current];
      const sy = this.stateY[p.current];
      const ex = this.stateX[p.target];
      const ey = this.stateY[p.target];
      const t = p.t;
      const arcHeight = Math.sin(t * Math.PI) * this.radius * 0.15;
      const mx = (sx + ex) / 2 - (ey - sy) * 0.1;
      const my = (sy + ey) / 2 + (ex - sx) * 0.1;

      const px = sx * (1 - t) * (1 - t) + mx * 2 * t * (1 - t) + ex * t * t;
      const py = sy * (1 - t) * (1 - t) + my * 2 * t * (1 - t) + ey * t * t;
      particlePos.setXYZ(i, px, py + arcHeight * 0.01, 2);
    }
    particlePos.needsUpdate = true;

    (this.statePoints.material as THREE.PointsMaterial).opacity = opacity * 0.8;
    (this.edgeLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.25;
    (this.particlePoints.material as THREE.PointsMaterial).opacity = opacity;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Randomize all particle states
      for (const p of this.particles) {
        p.current = this.rng.int(0, this.stateCount - 1);
        p.target = this.pickNextState(p.current);
        p.t = 0;
        p.speed = this.rng.float(2.0, 4.0);
      }
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) return;
    for (const p of this.particles) {
      p.speed = this.rng.float(0.5, 1.5) * this.transitionSpeed * (1 + level * 0.3);
    }
  }
}
