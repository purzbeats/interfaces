import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Discrete quantum walk on a 1D lattice. Shows probability amplitude
 * distribution evolving over time with the characteristic asymmetric spread.
 * Uses Hadamard coin operator and conditional shift.
 * Bars show |amplitude|^2 probability; color encodes coin state.
 */
export class QuantumWalkElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'quantum-walk',
    meta: { shape: 'rectangular', roles: ['data-display'], moods: ['diagnostic', 'ambient'], bandAffinity: 'high', sizes: ['works-small', 'needs-medium', 'needs-large'] },
  };

  private barMesh!: THREE.InstancedMesh;
  private barMat!: THREE.MeshBasicMaterial;
  private dummy = new THREE.Matrix4();
  private latticeSize: number = 0;
  // Coin state: [left_real, left_imag, right_real, right_imag] per site
  private ampLeft!: Float64Array;   // real, imag interleaved
  private ampRight!: Float64Array;
  private step: number = 0;
  private maxSteps: number = 0;
  private stepTimer: number = 0;
  private stepInterval: number = 0.1;
  private originX: number = 0;
  private originY: number = 0;
  private barWidth: number = 0;
  private barMaxH: number = 0;
  private coinAngle: number = 0; // Hadamard = pi/4

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;

    const variant = this.rng.int(0, 3);
    const presets = [
      { size: 101, maxSteps: 50, interval: 0.1, coin: Math.PI / 4 },
      { size: 151, maxSteps: 75, interval: 0.08, coin: Math.PI / 4 },
      { size: 81, maxSteps: 40, interval: 0.12, coin: Math.PI / 3 },  // biased coin
      { size: 121, maxSteps: 60, interval: 0.06, coin: Math.PI / 6 },  // different bias
    ];
    const pr = presets[variant];
    this.latticeSize = pr.size;
    this.maxSteps = pr.maxSteps;
    this.stepInterval = pr.interval;
    this.coinAngle = pr.coin;

    this.barWidth = Math.max(1, w / this.latticeSize);
    this.barMaxH = h * 0.8;
    this.originX = x + (w - this.latticeSize * this.barWidth) / 2;
    this.originY = y + h * 0.9;

    this.initWalk();

    // Instanced mesh for bars
    const geo = new THREE.PlaneGeometry(1, 1);
    this.barMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0 });
    this.barMesh = new THREE.InstancedMesh(geo, this.barMat, this.latticeSize);
    this.barMesh.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(this.latticeSize * 3), 3,
    );
    this.group.add(this.barMesh);
  }

  private initWalk(): void {
    const N = this.latticeSize;
    this.ampLeft = new Float64Array(N * 2);  // [re, im] pairs
    this.ampRight = new Float64Array(N * 2);
    this.step = 0;

    // Start in center, coin state |right>
    const center = Math.floor(N / 2);
    this.ampRight[center * 2] = 1;     // real part = 1
    this.ampRight[center * 2 + 1] = 0; // imag part = 0
  }

  private quantumStep(): void {
    const N = this.latticeSize;
    const c = Math.cos(this.coinAngle);
    const s = Math.sin(this.coinAngle);

    // Apply coin operator (generalized Hadamard)
    const newLeft = new Float64Array(N * 2);
    const newRight = new Float64Array(N * 2);

    for (let i = 0; i < N; i++) {
      const lr = this.ampLeft[i * 2], li = this.ampLeft[i * 2 + 1];
      const rr = this.ampRight[i * 2], ri = this.ampRight[i * 2 + 1];

      // Coin: |L'> = c|L> + s|R>, |R'> = s|L> - c|R>
      const clr = c * lr + s * rr;
      const cli = c * li + s * ri;
      const crr = s * lr - c * rr;
      const cri = s * li - c * ri;

      // Shift: left moves left, right moves right
      if (i > 0) {
        newLeft[(i - 1) * 2] += clr;
        newLeft[(i - 1) * 2 + 1] += cli;
      }
      if (i < N - 1) {
        newRight[(i + 1) * 2] += crr;
        newRight[(i + 1) * 2 + 1] += cri;
      }
    }

    this.ampLeft = newLeft;
    this.ampRight = newRight;
    this.step++;
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);

    this.stepTimer += dt;
    while (this.stepTimer >= this.stepInterval && this.step < this.maxSteps) {
      this.stepTimer -= this.stepInterval;
      this.quantumStep();
    }

    // Reset when done
    if (this.step >= this.maxSteps) {
      this.initWalk();
      this.stepTimer = 0;
    }

    const N = this.latticeSize;
    const colorArr = this.barMesh.instanceColor!.array as Float32Array;
    const pr = this.palette.primary;
    const sr = this.palette.secondary;

    // Find max probability for normalization
    let maxProb = 0.001;
    for (let i = 0; i < N; i++) {
      const pl = this.ampLeft[i * 2] ** 2 + this.ampLeft[i * 2 + 1] ** 2;
      const prr = this.ampRight[i * 2] ** 2 + this.ampRight[i * 2 + 1] ** 2;
      maxProb = Math.max(maxProb, pl + prr);
    }

    for (let i = 0; i < N; i++) {
      const pl = this.ampLeft[i * 2] ** 2 + this.ampLeft[i * 2 + 1] ** 2;
      const prb = this.ampRight[i * 2] ** 2 + this.ampRight[i * 2 + 1] ** 2;
      const totalP = pl + prb;
      const normP = totalP / maxProb;
      const barH = Math.max(1, normP * this.barMaxH);

      this.dummy.makeScale(this.barWidth * 0.8, barH, 1);
      this.dummy.setPosition(
        this.originX + i * this.barWidth + this.barWidth / 2,
        this.originY - barH / 2,
        0,
      );
      this.barMesh.setMatrixAt(i, this.dummy);

      // Color: mix primary/secondary based on left/right ratio
      const ratio = totalP > 0.0001 ? pl / totalP : 0.5;
      const j = i * 3;
      colorArr[j] = (pr.r * ratio + sr.r * (1 - ratio)) * opacity;
      colorArr[j + 1] = (pr.g * ratio + sr.g * (1 - ratio)) * opacity;
      colorArr[j + 2] = (pr.b * ratio + sr.b * (1 - ratio)) * opacity;
    }

    this.barMesh.instanceMatrix.needsUpdate = true;
    this.barMesh.instanceColor!.needsUpdate = true;
    this.barMat.opacity = 1;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') this.glitchTimer = 0.5;
    if (action === 'alert') {
      this.initWalk();
      this.stepTimer = 0;
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level >= 2) this.stepInterval = Math.max(0.02, this.stepInterval - level * 0.01);
  }
}
