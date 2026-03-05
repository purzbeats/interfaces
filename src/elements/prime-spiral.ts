import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Ulam spiral: integers placed in a spiral pattern with primes highlighted.
 * Animated with expanding radius revealing diagonal prime patterns.
 * Points accumulate over time showing the mysterious prime alignments.
 */
export class PrimeSpiralElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'prime-spiral',
    meta: {
      shape: 'rectangular',
      roles: ['data-display', 'decorative'],
      moods: ['diagnostic', 'ambient'],
      bandAffinity: 'high',
      sizes: ['needs-medium', 'needs-large'],
    },
  };

  private primeMesh!: THREE.Points;
  private compositeMesh!: THREE.Points;
  private borderLines!: THREE.LineSegments;

  private maxN: number = 2000;
  private currentN: number = 1;
  private addRate: number = 20;
  private primePositions: number[] = [];
  private compositePositions: number[] = [];
  private showComposites: boolean = true;
  private cellSize: number = 3;
  private cx: number = 0;
  private cy: number = 0;
  private intensityLevel: number = 0;
  private primeCache: Set<number> = new Set();

  build(): void {
    const variant = this.rng.int(0, 3);
    const presets = [
      { maxN: 2000, rate: 20, showComp: true, cellSize: 3 },    // Standard
      { maxN: 5000, rate: 50, showComp: false, cellSize: 2 },   // Dense primes only
      { maxN: 1000, rate: 8, showComp: true, cellSize: 5 },     // Slow large
      { maxN: 8000, rate: 80, showComp: true, cellSize: 1.5 },  // Ultra-dense
    ];
    const p = presets[variant];

    this.maxN = p.maxN;
    this.addRate = p.rate;
    this.showComposites = p.showComp;
    this.cellSize = p.cellSize;
    this.currentN = 1;
    this.primePositions = [];
    this.compositePositions = [];
    this.glitchAmount = 4;

    // Pre-compute primes using sieve
    this.buildSieve(this.maxN + 1);

    const { x, y, w, h } = this.px;
    this.cx = x + w / 2;
    this.cy = y + h / 2;

    // Prime points
    const primeGeo = new THREE.BufferGeometry();
    primeGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.maxN * 3), 3));
    primeGeo.setDrawRange(0, 0);
    this.primeMesh = new THREE.Points(primeGeo, new THREE.PointsMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
      size: this.cellSize,
      sizeAttenuation: false,
    }));
    this.group.add(this.primeMesh);

    // Composite points (dim)
    if (this.showComposites) {
      const compGeo = new THREE.BufferGeometry();
      compGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.maxN * 3), 3));
      compGeo.setDrawRange(0, 0);
      this.compositeMesh = new THREE.Points(compGeo, new THREE.PointsMaterial({
        color: this.palette.dim,
        transparent: true,
        opacity: 0,
        size: this.cellSize * 0.6,
        sizeAttenuation: false,
      }));
      this.group.add(this.compositeMesh);
    }

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

  private buildSieve(limit: number): void {
    this.primeCache.clear();
    const sieve = new Uint8Array(limit);
    for (let i = 2; i < limit; i++) {
      if (!sieve[i]) {
        this.primeCache.add(i);
        for (let j = i * i; j < limit; j += i) {
          sieve[j] = 1;
        }
      }
    }
  }

  private spiralPosition(n: number): [number, number] {
    // Ulam spiral: integer n maps to (x, y) grid coordinates
    if (n === 1) return [0, 0];
    let x = 0, y = 0;
    let dx = 1, dy = 0;
    let steps = 1, stepsTaken = 0, turnCount = 0;

    for (let i = 1; i < n; i++) {
      x += dx;
      y += dy;
      stepsTaken++;
      if (stepsTaken === steps) {
        stepsTaken = 0;
        // Turn left
        const tmp = dx;
        dx = -dy;
        dy = tmp;
        turnCount++;
        if (turnCount % 2 === 0) steps++;
      }
    }
    return [x, y];
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);

    // Add numbers progressively
    const rate = this.addRate + this.intensityLevel * 10;
    const prevN = this.currentN;
    for (let i = 0; i < rate && this.currentN <= this.maxN; i++) {
      const [gx, gy] = this.spiralPosition(this.currentN);
      const px = this.cx + gx * this.cellSize;
      const py = this.cy + gy * this.cellSize;

      if (this.primeCache.has(this.currentN)) {
        const pos = this.primeMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
        const idx = this.primePositions.length / 3;
        this.primePositions.push(px, py, 0.5);
        pos.setXYZ(idx, px, py, 0.5);
        pos.needsUpdate = true;
        this.primeMesh.geometry.setDrawRange(0, this.primePositions.length / 3);
      } else if (this.showComposites && this.compositeMesh) {
        const pos = this.compositeMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
        const idx = this.compositePositions.length / 3;
        this.compositePositions.push(px, py, 0);
        pos.setXYZ(idx, px, py, 0);
        pos.needsUpdate = true;
        this.compositeMesh.geometry.setDrawRange(0, this.compositePositions.length / 3);
      }
      this.currentN++;
    }

    // Reset when complete
    if (this.currentN > this.maxN && prevN <= this.maxN) {
      setTimeout(() => {
        this.currentN = 1;
        this.primePositions = [];
        this.compositePositions = [];
        this.primeMesh.geometry.setDrawRange(0, 0);
        if (this.compositeMesh) this.compositeMesh.geometry.setDrawRange(0, 0);
      }, 3000);
    }

    (this.primeMesh.material as THREE.PointsMaterial).opacity = opacity;
    if (this.compositeMesh) {
      (this.compositeMesh.material as THREE.PointsMaterial).opacity = opacity * 0.15;
    }
    (this.borderLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.25;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Scatter some points
      const pos = this.primeMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
      const count = this.primePositions.length / 3;
      for (let i = 0; i < count; i++) {
        if (this.rng.chance(0.3)) {
          const ox = this.rng.float(-5, 5);
          const oy = this.rng.float(-5, 5);
          pos.setXYZ(i, pos.getX(i) + ox, pos.getY(i) + oy, pos.getZ(i));
        }
      }
      pos.needsUpdate = true;
    }
    if (action === 'pulse') {
      this.currentN = 1;
      this.primePositions = [];
      this.compositePositions = [];
      this.primeMesh.geometry.setDrawRange(0, 0);
      if (this.compositeMesh) this.compositeMesh.geometry.setDrawRange(0, 0);
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    this.intensityLevel = level;
  }
}
