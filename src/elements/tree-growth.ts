import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Space colonization tree growth algorithm.
 * Attraction points guide branch growth producing organic tree structures
 * that look more natural than L-systems — like a botanical scanner display.
 */
export class TreeGrowthElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'tree-growth',
    meta: { shape: 'rectangular', roles: ['decorative', 'data-display'], moods: ['ambient', 'diagnostic'], bandAffinity: 'bass', sizes: ['needs-medium', 'needs-large'] },
  };

  private branchSegments = 2000;
  private branchPositions!: Float32Array;
  private branchColors!: Float32Array;
  private branchCount = 0;
  private branchMesh!: THREE.LineSegments;
  private branchMat!: THREE.LineBasicMaterial;

  // Space colonization data
  private attractors: Array<{ x: number; y: number; active: boolean }> = [];
  private nodes: Array<{ x: number; y: number; parent: number }> = [];
  private growthRate = 5;
  private growTimer = 0;
  private phase: 'growing' | 'display' | 'reset' = 'growing';
  private displayTimer = 0;

  build(): void {
    const variant = this.rng.int(0, 3);
    const presets = [
      { attractors: 200, segLen: 5, rate: 5, maxSegs: 2000 },
      { attractors: 400, segLen: 3, rate: 10, maxSegs: 4000 },
      { attractors: 100, segLen: 8, rate: 3, maxSegs: 1000 },
      { attractors: 300, segLen: 4, rate: 15, maxSegs: 3000 },
    ];
    const p = presets[variant];
    this.glitchAmount = 4;
    this.branchSegments = p.maxSegs;
    this.growthRate = p.rate;

    const { x, y, w, h } = this.px;

    // Scatter attraction points in crown area
    for (let i = 0; i < p.attractors; i++) {
      // Elliptical canopy distribution
      const angle = this.rng.float(0, Math.PI * 2);
      const r = this.rng.float(0, 1);
      const ax = x + w / 2 + Math.cos(angle) * r * w * 0.4;
      const ay = y + h * 0.05 + Math.abs(Math.sin(angle)) * r * h * 0.6;
      this.attractors.push({ x: ax, y: ay, active: true });
    }

    // Root node at bottom center
    this.nodes.push({ x: x + w / 2, y: y + h * 0.95, parent: -1 });

    this.branchPositions = new Float32Array(this.branchSegments * 6);
    this.branchColors = new Float32Array(this.branchSegments * 6);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.branchPositions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.branchColors, 3));
    geo.setDrawRange(0, 0);
    this.branchMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0 });
    this.branchMesh = new THREE.LineSegments(geo, this.branchMat);
    this.group.add(this.branchMesh);
  }

  private growStep(): boolean {
    if (this.branchCount >= this.branchSegments) return true;

    const killDist = 8;
    const influenceDist = 80;
    const segLen = 5;

    // For each node, find closest active attractor
    const nodeInfluence: Map<number, { dx: number; dy: number; count: number }> = new Map();

    for (const attr of this.attractors) {
      if (!attr.active) continue;
      let minDist = Infinity;
      let closestNode = -1;

      for (let n = 0; n < this.nodes.length; n++) {
        const dx = attr.x - this.nodes[n].x;
        const dy = attr.y - this.nodes[n].y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < minDist) { minDist = d; closestNode = n; }
      }

      if (minDist < killDist) { attr.active = false; continue; }
      if (minDist > influenceDist || closestNode === -1) continue;

      if (!nodeInfluence.has(closestNode)) nodeInfluence.set(closestNode, { dx: 0, dy: 0, count: 0 });
      const inf = nodeInfluence.get(closestNode)!;
      const dx = attr.x - this.nodes[closestNode].x;
      const dy = attr.y - this.nodes[closestNode].y;
      const d = Math.sqrt(dx * dx + dy * dy) + 0.01;
      inf.dx += dx / d;
      inf.dy += dy / d;
      inf.count++;
    }

    if (nodeInfluence.size === 0) return true;

    // Grow new segments
    for (const [nodeIdx, inf] of nodeInfluence) {
      if (this.branchCount >= this.branchSegments) break;
      const len = Math.sqrt(inf.dx * inf.dx + inf.dy * inf.dy) + 0.01;
      const nx = this.nodes[nodeIdx].x + (inf.dx / len) * segLen;
      const ny = this.nodes[nodeIdx].y + (inf.dy / len) * segLen;
      const newIdx = this.nodes.length;
      this.nodes.push({ x: nx, y: ny, parent: nodeIdx });

      // Write segment
      const si = this.branchCount * 6;
      this.branchPositions[si] = this.nodes[nodeIdx].x;
      this.branchPositions[si + 1] = this.nodes[nodeIdx].y;
      this.branchPositions[si + 2] = 0;
      this.branchPositions[si + 3] = nx;
      this.branchPositions[si + 4] = ny;
      this.branchPositions[si + 5] = 0;

      // Color: trunk=primary, tips=secondary
      const depth = Math.min(1, this.branchCount / (this.branchSegments * 0.5));
      const pr = this.palette.primary.r, pg2 = this.palette.primary.g, pb = this.palette.primary.b;
      const sr = this.palette.secondary.r, sg = this.palette.secondary.g, sb = this.palette.secondary.b;
      this.branchColors[si] = pr * (1 - depth) + sr * depth;
      this.branchColors[si + 1] = pg2 * (1 - depth) + sg * depth;
      this.branchColors[si + 2] = pb * (1 - depth) + sb * depth;
      this.branchColors[si + 3] = pr * (1 - depth) + sr * depth;
      this.branchColors[si + 4] = pg2 * (1 - depth) + sg * depth;
      this.branchColors[si + 5] = pb * (1 - depth) + sb * depth;

      this.branchCount++;
    }

    return !this.attractors.some(a => a.active);
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);

    if (this.phase === 'growing') {
      this.growTimer += dt * this.growthRate;
      const steps = Math.floor(this.growTimer);
      this.growTimer -= steps;
      let done = false;
      for (let i = 0; i < steps; i++) {
        if (this.growStep()) { done = true; break; }
      }

      (this.branchMesh.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
      (this.branchMesh.geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
      this.branchMesh.geometry.setDrawRange(0, this.branchCount * 2);

      if (done) { this.phase = 'display'; this.displayTimer = 5; }
    } else if (this.phase === 'display') {
      this.displayTimer -= dt;
      if (this.displayTimer <= 0) this.phase = 'reset';
    } else {
      // Reset
      const { x, y, w, h } = this.px;
      this.branchCount = 0;
      this.nodes = [{ x: x + w / 2, y: y + h * 0.95, parent: -1 }];
      this.attractors = [];
      for (let i = 0; i < 200; i++) {
        const angle = this.rng.float(0, Math.PI * 2);
        const r = this.rng.float(0, 1);
        this.attractors.push({
          x: x + w / 2 + Math.cos(angle) * r * w * 0.4,
          y: y + h * 0.05 + Math.abs(Math.sin(angle)) * r * h * 0.6,
          active: true,
        });
      }
      this.branchMesh.geometry.setDrawRange(0, 0);
      this.phase = 'growing';
    }

    this.branchMat.opacity = opacity * 0.8;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'alert' || action === 'glitch') this.phase = 'reset';
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level >= 3) this.growthRate = 20;
    if (level >= 5) this.growthRate = 50;
  }
}
