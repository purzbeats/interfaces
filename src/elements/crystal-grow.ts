import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

interface Branch {
  startX: number;
  startY: number;
  angle: number;       // direction in radians
  maxLength: number;    // fully grown length
  depth: number;        // 0 = main trunk, 1 = sub-branch, etc.
  children: number[];   // indices of child branches
  spawnAt: number;      // fraction of parent growth when this branch spawns
}

/**
 * Growing crystal formation that branches outward from center at 60-degree angles.
 * Grows over time, then fades and restarts.
 */
export class CrystalGrowElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'crystal-grow',
    meta: {
      shape: 'radial',
      roles: ['decorative'],
      moods: ['ambient'],
      sizes: ['needs-medium'],
    },
  };

  private lineMesh!: THREE.LineSegments;
  private branches: Branch[] = [];
  private growthTime: number = 0;
  private growDuration: number = 0;
  private fadeDuration: number = 1.5;
  private fadeTimer: number = 0;
  private phase: 'growing' | 'fading' = 'growing';
  private maxSegments: number = 0;

  build(): void {
    const { x, y, w, h } = this.px;

    this.growDuration = this.rng.float(4, 7);
    this.generateCrystal();

    // Preallocate buffer for all branch segments
    this.maxSegments = this.branches.length;
    const positions = new Float32Array(this.maxSegments * 2 * 3);
    const colors = new Float32Array(this.maxSegments * 2 * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setDrawRange(0, 0);

    this.lineMesh = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.lineMesh);
  }

  private generateCrystal(): void {
    const { x, y, w, h } = this.px;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const maxRadius = Math.min(w, h) * 0.4;

    this.branches = [];

    // Create 6 main branches at 60-degree intervals (hexagonal)
    const mainCount = 6;
    const baseAngle = this.rng.float(0, Math.PI / 3);

    for (let i = 0; i < mainCount; i++) {
      const angle = baseAngle + (Math.PI * 2 / mainCount) * i;
      const length = maxRadius * this.rng.float(0.6, 1.0);
      const branchIdx = this.branches.length;

      this.branches.push({
        startX: cx,
        startY: cy,
        angle,
        maxLength: length,
        depth: 0,
        children: [],
        spawnAt: 0,
      });

      // Sub-branches
      const subCount = this.rng.int(1, 3);
      for (let s = 0; s < subCount; s++) {
        const spawnFrac = this.rng.float(0.3, 0.8);
        const subAngle = angle + (this.rng.chance(0.5) ? 1 : -1) * (Math.PI / 3);
        const subLength = length * this.rng.float(0.3, 0.6);

        const subIdx = this.branches.length;
        this.branches[branchIdx].children.push(subIdx);

        this.branches.push({
          startX: cx + Math.cos(angle) * length * spawnFrac,
          startY: cy + Math.sin(angle) * length * spawnFrac,
          angle: subAngle,
          maxLength: subLength,
          depth: 1,
          children: [],
          spawnAt: spawnFrac,
        });

        // Tertiary branches (occasional)
        if (this.rng.chance(0.4)) {
          const terSpawnFrac = this.rng.float(0.4, 0.7);
          const terAngle = subAngle + (this.rng.chance(0.5) ? 1 : -1) * (Math.PI / 3);
          const terLength = subLength * this.rng.float(0.3, 0.5);

          const terIdx = this.branches.length;
          this.branches[subIdx].children.push(terIdx);

          this.branches.push({
            startX: this.branches[subIdx].startX + Math.cos(subAngle) * subLength * terSpawnFrac,
            startY: this.branches[subIdx].startY + Math.sin(subAngle) * subLength * terSpawnFrac,
            angle: terAngle,
            maxLength: terLength,
            depth: 2,
            children: [],
            spawnAt: terSpawnFrac,
          });
        }
      }
    }
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);

    if (this.phase === 'growing') {
      this.growthTime += dt;
      if (this.growthTime >= this.growDuration) {
        this.phase = 'fading';
        this.fadeTimer = this.fadeDuration;
      }
    } else {
      this.fadeTimer -= dt;
      if (this.fadeTimer <= 0) {
        // Restart
        this.phase = 'growing';
        this.growthTime = 0;
        this.generateCrystal();
        // Reallocate if needed
        if (this.branches.length > this.maxSegments) {
          this.maxSegments = this.branches.length;
          const positions = new Float32Array(this.maxSegments * 2 * 3);
          const colors = new Float32Array(this.maxSegments * 2 * 3);
          this.lineMesh.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
          this.lineMesh.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        }
      }
    }

    const globalGrowth = Math.min(this.growthTime / this.growDuration, 1.0);
    const fadeAlpha = this.phase === 'fading'
      ? Math.max(this.fadeTimer / this.fadeDuration, 0)
      : 1.0;

    const posAttr = this.lineMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const colAttr = this.lineMesh.geometry.getAttribute('color') as THREE.BufferAttribute;

    const primaryR = this.palette.primary.r;
    const primaryG = this.palette.primary.g;
    const primaryB = this.palette.primary.b;
    const dimR = this.palette.dim.r;
    const dimG = this.palette.dim.g;
    const dimB = this.palette.dim.b;

    let segIdx = 0;

    for (let bi = 0; bi < this.branches.length && segIdx < this.maxSegments; bi++) {
      const branch = this.branches[bi];

      // Depth-based growth delay: deeper branches start growing later
      const depthDelay = branch.depth * 0.2;
      const adjustedGrowth = Math.max(0, (globalGrowth - depthDelay) / (1 - depthDelay));

      // Account for spawnAt (sub-branches start after parent reaches them)
      const effectiveGrowth = branch.depth === 0
        ? adjustedGrowth
        : Math.max(0, adjustedGrowth - branch.spawnAt) / (1 - branch.spawnAt);

      if (effectiveGrowth <= 0) continue;

      const currentLength = branch.maxLength * Math.min(effectiveGrowth, 1.0);

      const endX = branch.startX + Math.cos(branch.angle) * currentLength;
      const endY = branch.startY + Math.sin(branch.angle) * currentLength;

      const vi = segIdx * 2;
      posAttr.setXYZ(vi, branch.startX, branch.startY, 0);
      posAttr.setXYZ(vi + 1, endX, endY, 0);

      // Primary color for main branches, dim for smaller ones
      const isPrimary = branch.depth === 0;
      const r = isPrimary ? primaryR : dimR;
      const g = isPrimary ? primaryG : dimG;
      const b = isPrimary ? primaryB : dimB;

      colAttr.setXYZ(vi, r, g, b);
      colAttr.setXYZ(vi + 1, r, g, b);

      segIdx++;
    }

    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
    this.lineMesh.geometry.setDrawRange(0, segIdx * 2);
    (this.lineMesh.material as THREE.LineBasicMaterial).opacity = opacity * fadeAlpha;
  }
}
