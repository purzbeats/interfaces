import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';

/**
 * Grid of connected nodes that oscillate with wave propagation.
 * Some nodes are "sticky" — they lag behind then snap, creating organic irregularity.
 */
export class BreathingGridElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'breathing-grid',
    meta: { shape: 'rectangular', roles: ['decorative', 'data-display'], moods: ['ambient', 'diagnostic'], sizes: ['needs-medium', 'needs-large'], bandAffinity: 'bass' },
  };
  private nodePoints!: THREE.Points;
  private edgeLines!: THREE.LineSegments;
  private cols: number = 0;
  private rows: number = 0;
  private baseX: Float32Array = new Float32Array(0);
  private baseY: Float32Array = new Float32Array(0);
  private phases: Float32Array = new Float32Array(0);
  private sticky: boolean[] = [];
  private stickyLag: Float32Array = new Float32Array(0);
  private amplitude: number = 0;
  private waveSpeed: number = 0;
  private edgeCount: number = 0;
  private edgeMap: Uint32Array = new Uint32Array(0);
  private missing: Set<number> = new Set();

  build(): void {
    const variant = this.rng.int(0, 4);
    const presets = [
      { cols: 8,  rows: 6,  amp: 6,  speed: 2.0, stickyChance: 0.2, removePct: 0 },    // Organic
      { cols: 14, rows: 10, amp: 3,  speed: 3.0, stickyChance: 0.15, removePct: 0 },   // Dense Mesh
      { cols: 5,  rows: 4,  amp: 12, speed: 1.2, stickyChance: 0.3, removePct: 0 },    // Sparse
      { cols: 10, rows: 7,  amp: 5,  speed: 2.5, stickyChance: 0.1, removePct: 0.15 }, // Irregular
    ];
    const p = presets[variant];

    const { x, y, w, h } = this.px;
    this.cols = p.cols;
    this.rows = p.rows;
    this.amplitude = p.amp;
    this.waveSpeed = p.speed;
    const nodeCount = this.cols * this.rows;

    // Mark nodes to remove for irregular variant
    this.missing = new Set();
    if (p.removePct > 0) {
      for (let i = 0; i < nodeCount; i++) {
        if (this.rng.chance(p.removePct)) this.missing.add(i);
      }
    }

    const cellW = w / (this.cols - 1);
    const cellH = h / (this.rows - 1);

    this.baseX = new Float32Array(nodeCount);
    this.baseY = new Float32Array(nodeCount);
    this.phases = new Float32Array(nodeCount);
    this.sticky = new Array(nodeCount).fill(false);
    this.stickyLag = new Float32Array(nodeCount);

    const positions = new Float32Array(nodeCount * 3);

    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        const i = row * this.cols + col;
        this.baseX[i] = x + col * cellW;
        this.baseY[i] = y + row * cellH;
        this.phases[i] = this.rng.float(0, Math.PI * 2);
        this.sticky[i] = this.rng.chance(p.stickyChance);
        this.stickyLag[i] = 0;

        positions[i * 3] = this.baseX[i];
        positions[i * 3 + 1] = this.baseY[i];
        positions[i * 3 + 2] = 0;
      }
    }

    const nodeGeo = new THREE.BufferGeometry();
    nodeGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.nodePoints = new THREE.Points(nodeGeo, new THREE.PointsMaterial({
      color: this.palette.primary,
      size: Math.max(2, Math.min(cellW, cellH) * 0.25),
      transparent: true,
      opacity: 0,
      sizeAttenuation: false,
    }));
    this.group.add(this.nodePoints);

    // Build edges — horizontal + vertical neighbors
    const edgeVerts: number[] = [];
    const edgeIndices: number[] = [];
    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        const i = row * this.cols + col;
        if (this.missing.has(i)) continue;
        // Right neighbor
        if (col < this.cols - 1) {
          const j = i + 1;
          if (!this.missing.has(j)) {
            edgeIndices.push(i, j);
            edgeVerts.push(
              this.baseX[i], this.baseY[i], 0,
              this.baseX[j], this.baseY[j], 0,
            );
          }
        }
        // Bottom neighbor
        if (row < this.rows - 1) {
          const j = i + this.cols;
          if (!this.missing.has(j)) {
            edgeIndices.push(i, j);
            edgeVerts.push(
              this.baseX[i], this.baseY[i], 0,
              this.baseX[j], this.baseY[j], 0,
            );
          }
        }
      }
    }

    this.edgeCount = edgeVerts.length / 6;
    this.edgeMap = new Uint32Array(edgeIndices);

    const edgeGeo = new THREE.BufferGeometry();
    edgeGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(edgeVerts), 3));
    this.edgeLines = new THREE.LineSegments(edgeGeo, new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.edgeLines);
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    const nodePos = this.nodePoints.geometry.getAttribute('position') as THREE.BufferAttribute;
    const nodeCount = this.cols * this.rows;

    for (let i = 0; i < nodeCount; i++) {
      if (this.missing.has(i)) continue;

      let target = Math.sin(time * this.waveSpeed + this.phases[i]) * this.amplitude;

      if (this.sticky[i]) {
        // Sticky nodes lag behind then snap
        const diff = target - this.stickyLag[i];
        if (Math.abs(diff) > this.amplitude * 0.6) {
          // Snap
          this.stickyLag[i] = target;
        } else {
          this.stickyLag[i] += diff * dt * 1.5;
        }
        target = this.stickyLag[i];
      }

      nodePos.setXY(i, this.baseX[i], this.baseY[i] + target);
    }
    nodePos.needsUpdate = true;

    // Update edge positions to follow nodes
    const edgePos = this.edgeLines.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let e = 0; e < this.edgeCount; e++) {
      const i = this.edgeMap[e * 2];
      const j = this.edgeMap[e * 2 + 1];
      edgePos.setXY(e * 2,     nodePos.getX(i), nodePos.getY(i));
      edgePos.setXY(e * 2 + 1, nodePos.getX(j), nodePos.getY(j));
    }
    edgePos.needsUpdate = true;

    (this.nodePoints.material as THREE.PointsMaterial).opacity = opacity * 0.8;
    (this.edgeLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.35;
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) return;
    this.amplitude += level * 1.5;
    if (level >= 5) {
      this.amplitude *= 3;
      setTimeout(() => { this.amplitude /= 3; }, 1500);
    }
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Randomize phases
      for (let i = 0; i < this.phases.length; i++) {
        this.phases[i] = this.rng.float(0, Math.PI * 2);
      }
    }
  }
}
