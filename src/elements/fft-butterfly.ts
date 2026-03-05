import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * FFT butterfly network diagram. Shows the butterfly operations at each
 * stage of a radix-2 FFT. Data flows left to right through stages.
 * Lines connecting nodes with butterfly crosses, animated data pulses.
 */
export class FftButterflyElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'fft-butterfly',
    meta: {
      shape: 'rectangular',
      roles: ['data-display', 'structural'],
      moods: ['tactical', 'diagnostic'],
      bandAffinity: 'high',
      sizes: ['needs-medium', 'needs-large'],
    } satisfies ElementMeta,
  };

  private nodePoints!: THREE.Points;
  private horzLines!: THREE.LineSegments;
  private butterflyLines!: THREE.LineSegments;
  private pulsePoints!: THREE.Points;

  private n: number = 8; // FFT size (power of 2)
  private stages: number = 3;
  private nodePositions: { x: number; y: number }[] = [];

  // Pulse animation
  private pulses: { stage: number; row: number; t: number; speed: number }[] = [];
  private maxPulses: number = 24;
  private spawnTimer: number = 0;
  private spawnRate: number = 2;

  // Data values for coloring
  private nodeValues: Float32Array = new Float32Array(0);

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;
    const variant = this.rng.int(0, 3);

    const presets = [
      { n: 8,  spawnRate: 2,  pulseSpeed: 1.0 },
      { n: 16, spawnRate: 4,  pulseSpeed: 1.5 },
      { n: 8,  spawnRate: 1,  pulseSpeed: 0.6 },
      { n: 16, spawnRate: 3,  pulseSpeed: 2.0 },
    ];
    const p = presets[variant];

    this.n = p.n;
    this.stages = Math.log2(this.n);
    this.spawnRate = p.spawnRate;

    const totalNodes = this.n * (this.stages + 1);
    this.nodeValues = new Float32Array(totalNodes);
    for (let i = 0; i < totalNodes; i++) {
      this.nodeValues[i] = this.rng.float(0, 1);
    }

    // Compute node positions
    const pad = Math.min(w, h) * 0.08;
    const stageW = (w - pad * 2) / this.stages;
    const rowH = (h - pad * 2) / (this.n - 1);

    this.nodePositions = [];
    for (let s = 0; s <= this.stages; s++) {
      for (let r = 0; r < this.n; r++) {
        this.nodePositions.push({
          x: x + pad + s * stageW,
          y: y + pad + r * rowH,
        });
      }
    }

    // Build horizontal pass-through lines
    const horzVerts: number[] = [];
    for (let s = 0; s < this.stages; s++) {
      for (let r = 0; r < this.n; r++) {
        const from = this.nodePos(s, r);
        const to = this.nodePos(s + 1, r);
        horzVerts.push(from.x, from.y, 0, to.x, to.y, 0);
      }
    }

    // Build butterfly cross lines
    const bflyVerts: number[] = [];
    for (let s = 0; s < this.stages; s++) {
      const blockSize = 1 << (s + 1);
      const halfBlock = blockSize >> 1;
      for (let k = 0; k < this.n; k += blockSize) {
        for (let j = 0; j < halfBlock; j++) {
          const top = k + j;
          const bot = top + halfBlock;
          const fromTop = this.nodePos(s, top);
          const toBot = this.nodePos(s + 1, bot);
          const fromBot = this.nodePos(s, bot);
          const toTop = this.nodePos(s + 1, top);
          // Cross: top->bot and bot->top at next stage
          bflyVerts.push(fromTop.x, fromTop.y, 0, toBot.x, toBot.y, 0);
          bflyVerts.push(fromBot.x, fromBot.y, 0, toTop.x, toTop.y, 0);
        }
      }
    }

    // Node points
    const nodePos = new Float32Array(totalNodes * 3);
    for (let i = 0; i < totalNodes; i++) {
      nodePos[i * 3] = this.nodePositions[i].x;
      nodePos[i * 3 + 1] = this.nodePositions[i].y;
      nodePos[i * 3 + 2] = 1;
    }
    const nodeGeo = new THREE.BufferGeometry();
    nodeGeo.setAttribute('position', new THREE.BufferAttribute(nodePos, 3));
    this.nodePoints = new THREE.Points(nodeGeo, new THREE.PointsMaterial({
      color: this.palette.secondary,
      size: Math.max(3, Math.min(w, h) * 0.01),
      transparent: true,
      opacity: 0,
      sizeAttenuation: false,
    }));
    this.group.add(this.nodePoints);

    // Horizontal lines
    const horzGeo = new THREE.BufferGeometry();
    horzGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(horzVerts), 3));
    this.horzLines = new THREE.LineSegments(horzGeo, new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.horzLines);

    // Butterfly cross lines
    const bflyGeo = new THREE.BufferGeometry();
    bflyGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(bflyVerts), 3));
    this.butterflyLines = new THREE.LineSegments(bflyGeo, new THREE.LineBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.butterflyLines);

    // Pulse points
    const pulsePos = new Float32Array(this.maxPulses * 3);
    pulsePos.fill(0);
    const pulseGeo = new THREE.BufferGeometry();
    pulseGeo.setAttribute('position', new THREE.BufferAttribute(pulsePos, 3));
    pulseGeo.setDrawRange(0, 0);
    this.pulsePoints = new THREE.Points(pulseGeo, new THREE.PointsMaterial({
      color: this.palette.secondary,
      size: Math.max(4, Math.min(w, h) * 0.018),
      transparent: true,
      opacity: 0,
      sizeAttenuation: false,
    }));
    this.group.add(this.pulsePoints);

    this.pulses = [];
  }

  private nodePos(stage: number, row: number): { x: number; y: number } {
    return this.nodePositions[stage * this.n + row];
  }

  private spawnPulse(): void {
    if (this.pulses.length >= this.maxPulses) return;
    this.pulses.push({
      stage: 0,
      row: this.rng.int(0, this.n - 1),
      t: 0,
      speed: this.rng.float(0.5, 1.5),
    });
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);

    // Spawn pulses
    this.spawnTimer += dt * this.spawnRate;
    while (this.spawnTimer >= 1) {
      this.spawnTimer -= 1;
      this.spawnPulse();
    }

    // Update pulses
    const pulsePos = this.pulsePoints.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = this.pulses.length - 1; i >= 0; i--) {
      const p = this.pulses[i];
      p.t += p.speed * dt;
      if (p.t >= 1) {
        p.t = 0;
        p.stage++;
        if (p.stage >= this.stages) {
          this.pulses.splice(i, 1);
          continue;
        }
        // Butterfly: chance of jumping to partner row
        const blockSize = 1 << (p.stage + 1);
        const halfBlock = blockSize >> 1;
        const posInBlock = p.row % blockSize;
        if (this.rng.float(0, 1) < 0.5) {
          if (posInBlock < halfBlock) {
            p.row = p.row + halfBlock;
          } else {
            p.row = p.row - halfBlock;
          }
          p.row = Math.max(0, Math.min(this.n - 1, p.row));
        }
      }
    }

    // Write pulse positions
    for (let i = 0; i < this.maxPulses; i++) {
      if (i < this.pulses.length) {
        const p = this.pulses[i];
        const from = this.nodePos(p.stage, p.row);
        const to = this.nodePos(p.stage + 1, p.row);
        const px = from.x + (to.x - from.x) * p.t;
        const py = from.y + (to.y - from.y) * p.t;
        pulsePos.setXYZ(i, px, py, 2);
      } else {
        pulsePos.setXYZ(i, -99999, -99999, 0);
      }
    }
    pulsePos.needsUpdate = true;
    this.pulsePoints.geometry.setDrawRange(0, Math.min(this.pulses.length, this.maxPulses));

    (this.nodePoints.material as THREE.PointsMaterial).opacity = opacity * 0.6;
    (this.horzLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.25;
    (this.butterflyLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.5;
    (this.pulsePoints.material as THREE.PointsMaterial).opacity = opacity;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      for (let i = 0; i < 8; i++) this.spawnPulse();
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) {
      this.spawnRate = 2;
      return;
    }
    this.spawnRate = 2 + level * 1.5;
    for (let i = 0; i < level; i++) this.spawnPulse();
  }
}
