import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

interface CrackSeg {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  spawnTime: number; // normalized 0-1
  depth: number;
}

/**
 * Fracture/crack propagation. Cracks start from edges, branch and split
 * following stress fields. Like dried mud or cracked glass.
 */
export class CrackPropagateElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'crack-propagate',
    meta: {
      shape: 'rectangular',
      roles: ['decorative'],
      moods: ['tactical', 'diagnostic'],
      bandAffinity: 'high',
      sizes: ['works-small', 'needs-medium'],
    },
  };

  private lineMesh!: THREE.LineSegments;
  private cracks: CrackSeg[] = [];
  private maxSegments: number = 0;
  private growthTime: number = 0;
  private growDuration: number = 0;
  private fadeDuration: number = 2.0;
  private fadeTimer: number = 0;
  private phase: 'growing' | 'fading' = 'growing';
  private seedCount: number = 0;
  private maxBranches: number = 0;

  build(): void {
    this.glitchAmount = 4;

    const variant = this.rng.int(0, 3);
    const presets = [
      { seeds: 4, maxBranch: 80, duration: 6, branchChance: 0.3 },
      { seeds: 8, maxBranch: 150, duration: 4, branchChance: 0.4 },
      { seeds: 2, maxBranch: 40, duration: 8, branchChance: 0.2 },
      { seeds: 6, maxBranch: 120, duration: 3, branchChance: 0.5 },
    ];
    const p = presets[variant];
    this.seedCount = p.seeds;
    this.maxBranches = p.maxBranch;
    this.growDuration = p.duration;

    this.generateCracks(p.branchChance);

    this.maxSegments = this.cracks.length;
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

  private generateCracks(branchChance: number): void {
    const { x, y, w, h } = this.px;
    this.cracks = [];

    // Seed cracks from edges
    for (let s = 0; s < this.seedCount; s++) {
      const edge = this.rng.int(0, 3); // 0=top, 1=right, 2=bottom, 3=left
      let sx: number, sy: number, angle: number;

      if (edge === 0) {
        sx = x + this.rng.float(0.1, 0.9) * w;
        sy = y;
        angle = Math.PI / 2 + this.rng.float(-0.3, 0.3);
      } else if (edge === 1) {
        sx = x + w;
        sy = y + this.rng.float(0.1, 0.9) * h;
        angle = Math.PI + this.rng.float(-0.3, 0.3);
      } else if (edge === 2) {
        sx = x + this.rng.float(0.1, 0.9) * w;
        sy = y + h;
        angle = -Math.PI / 2 + this.rng.float(-0.3, 0.3);
      } else {
        sx = x;
        sy = y + this.rng.float(0.1, 0.9) * h;
        angle = this.rng.float(-0.3, 0.3);
      }

      this.propagateCrack(sx, sy, angle, 0, 0, branchChance);
    }
  }

  private propagateCrack(
    sx: number, sy: number, angle: number,
    depth: number, parentTime: number, branchChance: number,
  ): void {
    if (this.cracks.length >= this.maxBranches) return;
    if (depth > 5) return;

    const { x, y, w, h } = this.px;
    const segLen = Math.min(w, h) * this.rng.float(0.04, 0.1);
    const steps = this.rng.int(3, 8);

    let cx = sx;
    let cy = sy;
    let curAngle = angle;

    for (let i = 0; i < steps; i++) {
      if (this.cracks.length >= this.maxBranches) return;
      curAngle += this.rng.float(-0.5, 0.5);
      const ex = cx + Math.cos(curAngle) * segLen;
      const ey = cy + Math.sin(curAngle) * segLen;

      // Clip to bounds
      if (ex < x || ex > x + w || ey < y || ey > y + h) break;

      const spawnTime = parentTime + (i / steps) * (1 - parentTime) * 0.5;
      this.cracks.push({ x0: cx, y0: cy, x1: ex, y1: ey, spawnTime, depth });

      // Branch?
      if (this.rng.chance(branchChance) && depth < 4) {
        const branchAngle = curAngle + (this.rng.chance(0.5) ? 1 : -1) * this.rng.float(0.5, 1.2);
        this.propagateCrack(ex, ey, branchAngle, depth + 1, spawnTime, branchChance * 0.7);
      }

      cx = ex;
      cy = ey;
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
        this.phase = 'growing';
        this.growthTime = 0;
        this.generateCracks(this.rng.float(0.2, 0.5));
        if (this.cracks.length > this.maxSegments) {
          this.maxSegments = this.cracks.length;
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

    let segIdx = 0;
    for (let i = 0; i < this.cracks.length && segIdx < this.maxSegments; i++) {
      const c = this.cracks[i];
      if (globalGrowth < c.spawnTime) continue;

      const t = Math.min(1, (globalGrowth - c.spawnTime) / Math.max(0.05, 1 - c.spawnTime) * 3);
      const ex = c.x0 + (c.x1 - c.x0) * t;
      const ey = c.y0 + (c.y1 - c.y0) * t;

      const vi = segIdx * 2;
      posAttr.setXYZ(vi, c.x0, c.y0, 0);
      posAttr.setXYZ(vi + 1, ex, ey, 0);

      const col = c.depth === 0 ? this.palette.primary : this.palette.secondary;
      const fade = Math.max(0.3, 1 - c.depth * 0.15);
      colAttr.setXYZ(vi, col.r * fade, col.g * fade, col.b * fade);
      colAttr.setXYZ(vi + 1, col.r * fade * 0.8, col.g * fade * 0.8, col.b * fade * 0.8);
      segIdx++;
    }

    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
    this.lineMesh.geometry.setDrawRange(0, segIdx * 2);
    (this.lineMesh.material as THREE.LineBasicMaterial).opacity = opacity * fadeAlpha;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Jump growth forward
      this.growthTime = Math.min(this.growDuration, this.growthTime + this.rng.float(1, 3));
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level >= 3) {
      this.growDuration = Math.max(1.5, this.growDuration - level * 0.3);
    }
  }
}
