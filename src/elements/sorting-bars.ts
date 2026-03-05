import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Animated sorting algorithm visualization.
 * Bars of varying height get sorted by different algorithms (quicksort, merge, heap),
 * with active comparisons highlighted — a computer science education display.
 */
export class SortingBarsElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'sorting-bars',
    meta: { shape: 'rectangular', roles: ['data-display', 'structural'], moods: ['diagnostic', 'tactical'], bandAffinity: 'high', sizes: ['works-small', 'needs-medium', 'needs-large'] },
  };

  private barCount = 0;
  private values!: Float32Array;
  private barMesh!: THREE.Mesh;
  private barPositions!: Float32Array;
  private barColors!: Float32Array;

  private ops: Array<{ type: 'swap' | 'compare'; a: number; b: number }> = [];
  private opIdx = 0;
  private stepAccum = 0;
  private stepsPerSec = 30;
  private activeA = -1;
  private activeB = -1;
  private phase: 'sorting' | 'done' = 'sorting';
  private doneTimer = 0;

  build(): void {
    const variant = this.rng.int(0, 3);
    const presets = [
      { bars: 40, speed: 30 },
      { bars: 80, speed: 60 },
      { bars: 20, speed: 15 },
      { bars: 60, speed: 100 },
    ];
    const p = presets[variant];
    this.glitchAmount = 4;

    const { x, y, w, h } = this.px;
    this.barCount = p.bars;
    this.stepsPerSec = p.speed;

    this.values = new Float32Array(this.barCount);
    for (let i = 0; i < this.barCount; i++) this.values[i] = (i + 1) / this.barCount;
    // Shuffle
    for (let i = this.barCount - 1; i > 0; i--) {
      const j = this.rng.int(0, i);
      const tmp = this.values[i]; this.values[i] = this.values[j]; this.values[j] = tmp;
    }

    // Pre-compute sort operations (quicksort)
    this.generateQuickSort(0, this.barCount - 1);

    // Each bar = 2 triangles = 6 vertices
    const vertCount = this.barCount * 6;
    this.barPositions = new Float32Array(vertCount * 3);
    this.barColors = new Float32Array(vertCount * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.barPositions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.barColors, 3));
    this.barMesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0, side: THREE.DoubleSide,
    }));
    this.group.add(this.barMesh);
  }

  private generateQuickSort(lo: number, hi: number): void {
    if (lo >= hi) return;
    // Record partition operations
    const arr = [...this.values]; // snapshot for generating ops
    const pivot = arr[hi];
    let i = lo;
    for (let j = lo; j < hi; j++) {
      this.ops.push({ type: 'compare', a: j, b: hi });
      if (arr[j] <= pivot) {
        this.ops.push({ type: 'swap', a: i, b: j });
        const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
        i++;
      }
    }
    this.ops.push({ type: 'swap', a: i, b: hi });
    const tmp = arr[i]; arr[i] = arr[hi]; arr[hi] = tmp;

    // Update values to match
    for (let k = lo; k <= hi; k++) this.values[k] = arr[k];

    this.generateQuickSort(lo, i - 1);
    this.generateQuickSort(i + 1, hi);
  }

  private resetAndReshuffle(): void {
    for (let i = 0; i < this.barCount; i++) this.values[i] = (i + 1) / this.barCount;
    for (let i = this.barCount - 1; i > 0; i--) {
      const j = this.rng.int(0, i);
      const tmp = this.values[i]; this.values[i] = this.values[j]; this.values[j] = tmp;
    }
    this.ops = [];
    this.opIdx = 0;
    this.generateQuickSort(0, this.barCount - 1);
    this.phase = 'sorting';
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);
    const { x, y, w, h } = this.px;

    if (this.phase === 'sorting') {
      this.stepAccum += dt * this.stepsPerSec;
      const steps = Math.floor(this.stepAccum);
      this.stepAccum -= steps;

      for (let s = 0; s < steps && this.opIdx < this.ops.length; s++) {
        const op = this.ops[this.opIdx++];
        this.activeA = op.a;
        this.activeB = op.b;
        if (op.type === 'swap') {
          const tmp = this.values[op.a];
          this.values[op.a] = this.values[op.b];
          this.values[op.b] = tmp;
        }
      }

      if (this.opIdx >= this.ops.length) {
        this.phase = 'done';
        this.doneTimer = 3;
        this.activeA = -1;
        this.activeB = -1;
      }
    } else {
      this.doneTimer -= dt;
      if (this.doneTimer <= 0) this.resetAndReshuffle();
    }

    // Update bar geometry
    const barW = w / this.barCount;
    const pr = this.palette.primary.r, pg2 = this.palette.primary.g, pb = this.palette.primary.b;
    const sr = this.palette.secondary.r, sg = this.palette.secondary.g, sb = this.palette.secondary.b;

    for (let i = 0; i < this.barCount; i++) {
      const bx = x + i * barW;
      const bh = this.values[i] * h * 0.9;
      const by = y + h - bh;

      const vi = i * 18; // 6 verts * 3 components
      // Triangle 1
      this.barPositions[vi] = bx; this.barPositions[vi + 1] = by; this.barPositions[vi + 2] = 0;
      this.barPositions[vi + 3] = bx + barW * 0.8; this.barPositions[vi + 4] = by; this.barPositions[vi + 5] = 0;
      this.barPositions[vi + 6] = bx; this.barPositions[vi + 7] = by + bh; this.barPositions[vi + 8] = 0;
      // Triangle 2
      this.barPositions[vi + 9] = bx + barW * 0.8; this.barPositions[vi + 10] = by; this.barPositions[vi + 11] = 0;
      this.barPositions[vi + 12] = bx + barW * 0.8; this.barPositions[vi + 13] = by + bh; this.barPositions[vi + 14] = 0;
      this.barPositions[vi + 15] = bx; this.barPositions[vi + 16] = by + bh; this.barPositions[vi + 17] = 0;

      const isActive = i === this.activeA || i === this.activeB;
      const cr = isActive ? sr : pr * (0.3 + this.values[i] * 0.7);
      const cg = isActive ? sg : pg2 * (0.3 + this.values[i] * 0.7);
      const cb = isActive ? sb : pb * (0.3 + this.values[i] * 0.7);

      const ci = i * 18;
      for (let v = 0; v < 6; v++) {
        this.barColors[ci + v * 3] = cr;
        this.barColors[ci + v * 3 + 1] = cg;
        this.barColors[ci + v * 3 + 2] = cb;
      }
    }

    (this.barMesh.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.barMesh.geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
    (this.barMesh.material as THREE.MeshBasicMaterial).opacity = opacity * 0.9;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch' || action === 'alert') this.resetAndReshuffle();
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level >= 3) this.stepsPerSec = 100;
    if (level >= 5) this.stepsPerSec = 300;
  }
}
