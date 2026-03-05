import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Force-directed graph layout. Nodes repel via Coulomb force, edges attract
 * via spring force, producing self-organizing network topology. Nodes drift
 * and settle into stable configurations.
 */
export class WebGraphElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'web-graph',
    meta: {
      shape: 'rectangular',
      roles: ['data-display', 'structural'],
      moods: ['tactical', 'diagnostic'],
      bandAffinity: 'mid',
      sizes: ['needs-medium', 'needs-large'],
    },
  };

  private nodeMesh!: THREE.Points;
  private edgeMesh!: THREE.LineSegments;
  private borderLines!: THREE.LineSegments;

  private nodeCount: number = 0;
  private posX!: Float32Array;
  private posY!: Float32Array;
  private velX!: Float32Array;
  private velY!: Float32Array;
  private edges: [number, number][] = [];

  private repulsion: number = 5000;
  private springK: number = 0.01;
  private springLen: number = 60;
  private damping: number = 0.9;
  private intensityLevel: number = 0;

  build(): void {
    const variant = this.rng.int(0, 3);
    const presets = [
      { nodes: 30, edgeDensity: 0.06, repulsion: 5000, springK: 0.01, springLen: 60 },   // Sparse
      { nodes: 50, edgeDensity: 0.04, repulsion: 8000, springK: 0.008, springLen: 50 },   // Medium
      { nodes: 20, edgeDensity: 0.12, repulsion: 3000, springK: 0.02, springLen: 40 },    // Dense small
      { nodes: 60, edgeDensity: 0.025, repulsion: 10000, springK: 0.005, springLen: 70 }, // Large sparse
    ];
    const p = presets[variant];

    this.nodeCount = p.nodes;
    this.repulsion = p.repulsion;
    this.springK = p.springK;
    this.springLen = p.springLen;
    this.glitchAmount = 4;

    const { x, y, w, h } = this.px;
    const cx = x + w / 2;
    const cy = y + h / 2;

    // Initialize node positions
    this.posX = new Float32Array(this.nodeCount);
    this.posY = new Float32Array(this.nodeCount);
    this.velX = new Float32Array(this.nodeCount);
    this.velY = new Float32Array(this.nodeCount);

    for (let i = 0; i < this.nodeCount; i++) {
      this.posX[i] = cx + this.rng.float(-w * 0.3, w * 0.3);
      this.posY[i] = cy + this.rng.float(-h * 0.3, h * 0.3);
    }

    // Generate random edges
    this.edges = [];
    for (let i = 0; i < this.nodeCount; i++) {
      for (let j = i + 1; j < this.nodeCount; j++) {
        if (this.rng.chance(p.edgeDensity)) {
          this.edges.push([i, j]);
        }
      }
    }
    // Ensure connectivity: connect each isolated node to nearest
    const connected = new Set<number>();
    for (const [a, b] of this.edges) {
      connected.add(a);
      connected.add(b);
    }
    for (let i = 0; i < this.nodeCount; i++) {
      if (!connected.has(i)) {
        let nearest = (i + 1) % this.nodeCount;
        let minDist = Infinity;
        for (let j = 0; j < this.nodeCount; j++) {
          if (j === i) continue;
          const dx = this.posX[j] - this.posX[i];
          const dy = this.posY[j] - this.posY[i];
          const d = dx * dx + dy * dy;
          if (d < minDist) { minDist = d; nearest = j; }
        }
        this.edges.push([i, nearest]);
        connected.add(i);
      }
    }

    // Node points
    const nodePositions = new Float32Array(this.nodeCount * 3);
    const nodeGeo = new THREE.BufferGeometry();
    nodeGeo.setAttribute('position', new THREE.BufferAttribute(nodePositions, 3));
    this.nodeMesh = new THREE.Points(nodeGeo, new THREE.PointsMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
      size: 4,
      sizeAttenuation: false,
    }));
    this.group.add(this.nodeMesh);

    // Edge lines
    const edgePositions = new Float32Array(this.edges.length * 6);
    const edgeGeo = new THREE.BufferGeometry();
    edgeGeo.setAttribute('position', new THREE.BufferAttribute(edgePositions, 3));
    this.edgeMesh = new THREE.LineSegments(edgeGeo, new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.edgeMesh);

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

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);
    const { x, y, w, h } = this.px;
    const n = this.nodeCount;

    // Force calculation
    // Repulsion (Coulomb)
    for (let i = 0; i < n; i++) {
      let fx = 0, fy = 0;

      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const dx = this.posX[i] - this.posX[j];
        const dy = this.posY[i] - this.posY[j];
        const dist2 = dx * dx + dy * dy;
        const dist = Math.sqrt(dist2) + 0.1;
        const force = this.repulsion / dist2;
        fx += (dx / dist) * force;
        fy += (dy / dist) * force;
      }

      this.velX[i] += fx * dt;
      this.velY[i] += fy * dt;
    }

    // Spring forces (edges)
    for (const [a, b] of this.edges) {
      const dx = this.posX[b] - this.posX[a];
      const dy = this.posY[b] - this.posY[a];
      const dist = Math.sqrt(dx * dx + dy * dy) + 0.1;
      const force = this.springK * (dist - this.springLen);
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      this.velX[a] += fx * dt * 60;
      this.velY[a] += fy * dt * 60;
      this.velX[b] -= fx * dt * 60;
      this.velY[b] -= fy * dt * 60;
    }

    // Center gravity (keep nodes from drifting away)
    const cx = x + w / 2;
    const cy = y + h / 2;
    for (let i = 0; i < n; i++) {
      this.velX[i] += (cx - this.posX[i]) * 0.001;
      this.velY[i] += (cy - this.posY[i]) * 0.001;
    }

    // Apply velocity with damping
    for (let i = 0; i < n; i++) {
      this.velX[i] *= this.damping;
      this.velY[i] *= this.damping;
      this.posX[i] += this.velX[i] * dt;
      this.posY[i] += this.velY[i] * dt;

      // Clamp to region
      this.posX[i] = Math.max(x + 5, Math.min(x + w - 5, this.posX[i]));
      this.posY[i] = Math.max(y + 5, Math.min(y + h - 5, this.posY[i]));
    }

    // Update node positions
    const nodePos = this.nodeMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < n; i++) {
      nodePos.setXYZ(i, this.posX[i], this.posY[i], 0.5);
    }
    nodePos.needsUpdate = true;

    // Update edge positions
    const edgePos = this.edgeMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let e = 0; e < this.edges.length; e++) {
      const [a, b] = this.edges[e];
      edgePos.setXYZ(e * 2, this.posX[a], this.posY[a], 0.2);
      edgePos.setXYZ(e * 2 + 1, this.posX[b], this.posY[b], 0.2);
    }
    edgePos.needsUpdate = true;

    (this.nodeMesh.material as THREE.PointsMaterial).opacity = opacity;
    (this.edgeMesh.material as THREE.LineBasicMaterial).opacity = opacity * 0.4;
    (this.borderLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.2;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Scatter nodes
      for (let i = 0; i < this.nodeCount; i++) {
        this.velX[i] += this.rng.float(-50, 50);
        this.velY[i] += this.rng.float(-50, 50);
      }
    }
    if (action === 'pulse') {
      // Explode from center
      const cx = this.px.x + this.px.w / 2;
      const cy = this.px.y + this.px.h / 2;
      for (let i = 0; i < this.nodeCount; i++) {
        const dx = this.posX[i] - cx;
        const dy = this.posY[i] - cy;
        const dist = Math.sqrt(dx * dx + dy * dy) + 0.1;
        this.velX[i] += (dx / dist) * 100;
        this.velY[i] += (dy / dist) * 100;
      }
    }
    if (action === 'alert') {
      // Add new edges
      for (let i = 0; i < 5; i++) {
        const a = this.rng.int(0, this.nodeCount - 1);
        const b = this.rng.int(0, this.nodeCount - 1);
        if (a !== b) this.edges.push([a, b]);
      }
      // Rebuild edge geometry
      const edgePositions = new Float32Array(this.edges.length * 6);
      const edgeGeo = new THREE.BufferGeometry();
      edgeGeo.setAttribute('position', new THREE.BufferAttribute(edgePositions, 3));
      this.edgeMesh.geometry.dispose();
      this.edgeMesh.geometry = edgeGeo;
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    this.intensityLevel = level;
    this.repulsion = 5000 * (1 + level * 0.3);
  }
}
