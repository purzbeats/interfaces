import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Signal convolution visualization. Two signals (input + kernel) and their
 * convolution output. Kernel slides across input with animated overlap.
 * Line geometry for all three signals.
 */
export class SignalConvolveElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'signal-convolve',
    meta: {
      shape: 'rectangular',
      roles: ['data-display', 'gauge'],
      moods: ['diagnostic', 'tactical'],
      bandAffinity: 'mid',
      sizes: ['needs-medium', 'needs-large'],
    } satisfies ElementMeta,
  };

  private inputLine!: THREE.Line;
  private kernelLine!: THREE.Line;
  private outputLine!: THREE.Line;
  private overlapLine!: THREE.Line;
  private markerLine!: THREE.LineSegments;

  private inputSignal: Float32Array = new Float32Array(0);
  private kernelSignal: Float32Array = new Float32Array(0);
  private outputSignal: Float32Array = new Float32Array(0);

  private inputLen: number = 64;
  private kernelLen: number = 12;
  private outputLen: number = 0;
  private slidePos: number = 0;
  private slideSpeed: number = 8;
  private signalType: number = 0;

  build(): void {
    this.glitchAmount = 4;
    const variant = this.rng.int(0, 3);

    const presets = [
      { inputLen: 64,  kernelLen: 12, speed: 8,  type: 0 },
      { inputLen: 128, kernelLen: 16, speed: 14, type: 1 },
      { inputLen: 48,  kernelLen: 8,  speed: 5,  type: 2 },
      { inputLen: 96,  kernelLen: 20, speed: 10, type: 3 },
    ];
    const p = presets[variant];

    this.inputLen = p.inputLen;
    this.kernelLen = p.kernelLen;
    this.slideSpeed = p.speed;
    this.signalType = p.type;
    this.outputLen = this.inputLen + this.kernelLen - 1;

    this.generateSignals();
    this.computeConvolution();
    this.buildGeometry();
  }

  private generateSignals(): void {
    this.inputSignal = new Float32Array(this.inputLen);
    this.kernelSignal = new Float32Array(this.kernelLen);

    switch (this.signalType) {
      case 0: // Pulse train + gaussian kernel
        for (let i = 0; i < this.inputLen; i++) {
          this.inputSignal[i] = (i % 16 < 4) ? 0.8 : 0.1;
        }
        for (let i = 0; i < this.kernelLen; i++) {
          const t = (i - this.kernelLen / 2) / (this.kernelLen / 4);
          this.kernelSignal[i] = Math.exp(-t * t * 0.5);
        }
        break;
      case 1: // Sine + box filter
        for (let i = 0; i < this.inputLen; i++) {
          this.inputSignal[i] = 0.5 + 0.4 * Math.sin(i * 0.3) + 0.2 * Math.sin(i * 0.9);
        }
        for (let i = 0; i < this.kernelLen; i++) {
          this.kernelSignal[i] = 1.0 / this.kernelLen;
        }
        break;
      case 2: // Noisy step + triangular
        for (let i = 0; i < this.inputLen; i++) {
          const step = i > this.inputLen / 3 && i < this.inputLen * 2 / 3 ? 0.8 : 0.1;
          this.inputSignal[i] = step + this.rng.float(-0.1, 0.1);
        }
        for (let i = 0; i < this.kernelLen; i++) {
          const mid = this.kernelLen / 2;
          this.kernelSignal[i] = 1.0 - Math.abs(i - mid) / mid;
        }
        break;
      default: // Random spikes + exponential decay
        for (let i = 0; i < this.inputLen; i++) {
          this.inputSignal[i] = this.rng.float(0, 1) < 0.1 ? this.rng.float(0.5, 1.0) : 0.05;
        }
        for (let i = 0; i < this.kernelLen; i++) {
          this.kernelSignal[i] = Math.exp(-i * 0.3);
        }
        break;
    }
  }

  private computeConvolution(): void {
    this.outputSignal = new Float32Array(this.outputLen);
    for (let i = 0; i < this.outputLen; i++) {
      let sum = 0;
      for (let j = 0; j < this.kernelLen; j++) {
        const ii = i - j;
        if (ii >= 0 && ii < this.inputLen) {
          sum += this.inputSignal[ii] * this.kernelSignal[j];
        }
      }
      this.outputSignal[i] = sum;
    }
  }

  private buildGeometry(): void {
    const { x, y, w, h } = this.px;
    const rowH = h / 3;

    // Input signal line (top row)
    const inputVerts = new Float32Array(this.inputLen * 3);
    for (let i = 0; i < this.inputLen; i++) {
      inputVerts[i * 3] = x + (i / (this.inputLen - 1)) * w;
      inputVerts[i * 3 + 1] = y + rowH * 0.1 + this.inputSignal[i] * rowH * 0.8;
      inputVerts[i * 3 + 2] = 0;
    }
    const inputGeo = new THREE.BufferGeometry();
    inputGeo.setAttribute('position', new THREE.BufferAttribute(inputVerts, 3));
    this.inputLine = new THREE.Line(inputGeo, new THREE.LineBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.inputLine);

    // Kernel line (sliding indicator, in top row space)
    const kernelVerts = new Float32Array(this.kernelLen * 3);
    kernelVerts.fill(0);
    const kernelGeo = new THREE.BufferGeometry();
    kernelGeo.setAttribute('position', new THREE.BufferAttribute(kernelVerts, 3));
    this.kernelLine = new THREE.Line(kernelGeo, new THREE.LineBasicMaterial({
      color: this.palette.secondary,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.kernelLine);

    // Overlap product (middle row)
    const overlapVerts = new Float32Array(this.kernelLen * 3);
    overlapVerts.fill(0);
    const overlapGeo = new THREE.BufferGeometry();
    overlapGeo.setAttribute('position', new THREE.BufferAttribute(overlapVerts, 3));
    this.overlapLine = new THREE.Line(overlapGeo, new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.overlapLine);

    // Output signal line (bottom row)
    const outputVerts = new Float32Array(this.outputLen * 3);
    for (let i = 0; i < this.outputLen; i++) {
      outputVerts[i * 3] = x + (i / (this.outputLen - 1)) * w;
      outputVerts[i * 3 + 1] = y + rowH * 2;
      outputVerts[i * 3 + 2] = 0;
    }
    const outputGeo = new THREE.BufferGeometry();
    outputGeo.setAttribute('position', new THREE.BufferAttribute(outputVerts, 3));
    this.outputLine = new THREE.Line(outputGeo, new THREE.LineBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.outputLine);

    // Vertical marker showing current convolution position
    const markerVerts = new Float32Array(6);
    markerVerts.fill(0);
    const markerGeo = new THREE.BufferGeometry();
    markerGeo.setAttribute('position', new THREE.BufferAttribute(markerVerts, 3));
    this.markerLine = new THREE.LineSegments(markerGeo, new THREE.LineBasicMaterial({
      color: this.palette.secondary,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.markerLine);
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);
    const { x, y, w, h } = this.px;
    const rowH = h / 3;

    // Advance slide position
    this.slidePos += this.slideSpeed * dt;
    if (this.slidePos >= this.outputLen) {
      this.slidePos = 0;
    }

    const pos = Math.floor(this.slidePos);
    const pixelsPerSample = w / this.inputLen;

    // Update kernel position overlay on input row
    const kernelPos = this.kernelLine.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let j = 0; j < this.kernelLen; j++) {
      const sampleIdx = pos - j;
      const sx = x + ((pos - this.kernelLen + 1 + j) / (this.inputLen - 1)) * w;
      const val = (sampleIdx >= 0 && sampleIdx < this.inputLen) ? this.kernelSignal[j] : 0;
      kernelPos.setXYZ(j, sx, y + rowH * 0.1 + val * rowH * 0.8, 1);
    }
    kernelPos.needsUpdate = true;

    // Update overlap product in middle row
    const overlapPos = this.overlapLine.geometry.getAttribute('position') as THREE.BufferAttribute;
    const maxOut = Math.max(...Array.from(this.outputSignal));
    const outScale = maxOut > 0 ? 1 / maxOut : 1;
    for (let j = 0; j < this.kernelLen; j++) {
      const sampleIdx = pos - j;
      const sx = x + ((pos - this.kernelLen + 1 + j) / (this.inputLen - 1)) * w;
      let val = 0;
      if (sampleIdx >= 0 && sampleIdx < this.inputLen) {
        val = this.inputSignal[sampleIdx] * this.kernelSignal[j];
      }
      overlapPos.setXYZ(j, sx, y + rowH + rowH * 0.1 + val * outScale * rowH * 0.8, 0);
    }
    overlapPos.needsUpdate = true;

    // Update output line up to current position
    const outputPos = this.outputLine.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < this.outputLen; i++) {
      const sx = x + (i / (this.outputLen - 1)) * w;
      const val = i <= pos ? this.outputSignal[i] * outScale : 0;
      outputPos.setXYZ(i, sx, y + rowH * 2 + rowH * 0.1 + val * rowH * 0.8, 0);
    }
    outputPos.needsUpdate = true;

    // Marker line
    const markerPos = this.markerLine.geometry.getAttribute('position') as THREE.BufferAttribute;
    const mx = x + (pos / (this.outputLen - 1)) * w;
    markerPos.setXYZ(0, mx, y, 2);
    markerPos.setXYZ(1, mx, y + h, 2);
    markerPos.needsUpdate = true;

    (this.inputLine.material as THREE.LineBasicMaterial).opacity = opacity * 0.8;
    (this.kernelLine.material as THREE.LineBasicMaterial).opacity = opacity * 0.9;
    (this.overlapLine.material as THREE.LineBasicMaterial).opacity = opacity * 0.5;
    (this.outputLine.material as THREE.LineBasicMaterial).opacity = opacity;
    (this.markerLine.material as THREE.LineBasicMaterial).opacity = opacity * 0.4;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      this.generateSignals();
      this.computeConvolution();
      this.slidePos = 0;
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) {
      this.slideSpeed = 8;
      return;
    }
    this.slideSpeed = 8 + level * 4;
    if (level >= 5) {
      this.generateSignals();
      this.computeConvolution();
    }
  }
}
