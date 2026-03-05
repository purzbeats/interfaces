import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

interface RootBranch {
  x0: number;
  y0: number;
  angle: number;
  length: number;
  depth: number;
  spawnFrac: number; // when parent reaches this fraction, child starts
}

/**
 * Root system branching downward. Recursive branching with random angles,
 * thicker near trunk. Grows progressively with periodic reset.
 */
export class RootFractalElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'root-fractal',
    meta: {
      shape: 'rectangular',
      roles: ['decorative'],
      moods: ['ambient'],
      bandAffinity: 'bass',
      sizes: ['needs-medium', 'needs-large'],
    },
  };

  private lineMesh!: THREE.LineSegments;
  private branches: RootBranch[] = [];
  private maxSegments: number = 0;
  private growthTime: number = 0;
  private growDuration: number = 0;
  private fadeDuration: number = 1.5;
  private fadeTimer: number = 0;
  private phase: 'growing' | 'fading' = 'growing';
  private maxDepth: number = 0;
  private spreadAngle: number = 0;

  build(): void {
    this.glitchAmount = 4;

    const variant = this.rng.int(0, 3);
    const presets = [
      { depth: 4, spread: 0.6, duration: 5, rootCount: 3 },
      { depth: 6, spread: 0.4, duration: 4, rootCount: 5 },
      { depth: 3, spread: 0.8, duration: 7, rootCount: 2 },
      { depth: 5, spread: 0.5, duration: 3.5, rootCount: 4 },
    ];
    const p = presets[variant];
    this.maxDepth = p.depth;
    this.spreadAngle = p.spread;
    this.growDuration = p.duration;

    this.generateRoots(p.rootCount);

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

  private generateRoots(rootCount: number): void {
    const { x, y, w, h } = this.px;
    this.branches = [];
    const cx = x + w / 2;
    const topY = y + h * 0.08;
    const baseLen = h * 0.25;

    for (let r = 0; r < rootCount; r++) {
      const angle = Math.PI / 2 + (r - (rootCount - 1) / 2) * this.spreadAngle * 0.5;
      this.addBranch(cx, topY, angle, baseLen * this.rng.float(0.8, 1.0), 0, 0);
    }
  }

  private addBranch(bx: number, by: number, angle: number, length: number, depth: number, spawnFrac: number): void {
    if (depth > this.maxDepth) return;

    this.branches.push({ x0: bx, y0: by, angle, length, depth, spawnFrac });

    const endX = bx + Math.cos(angle) * length;
    const endY = by + Math.sin(angle) * length;

    const childCount = depth < 2 ? this.rng.int(2, 3) : this.rng.int(1, 2);
    for (let c = 0; c < childCount; c++) {
      const childAngle = angle + (this.rng.float(-1, 1)) * this.spreadAngle;
      const childLen = length * this.rng.float(0.5, 0.75);
      const sf = this.rng.float(0.5, 0.9);
      const sx = bx + Math.cos(angle) * length * sf;
      const sy = by + Math.sin(angle) * length * sf;
      this.addBranch(sx, sy, childAngle, childLen, depth + 1, spawnFrac + (1 - spawnFrac) * sf * 0.5);
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
        this.generateRoots(this.rng.int(2, 5));
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

    let segIdx = 0;
    for (let i = 0; i < this.branches.length && segIdx < this.maxSegments; i++) {
      const b = this.branches[i];
      const depthDelay = b.depth * 0.12;
      const adjusted = Math.max(0, (globalGrowth - depthDelay - b.spawnFrac * 0.3) / (1 - depthDelay));
      if (adjusted <= 0) continue;

      const t = Math.min(adjusted, 1.0);
      const ex = b.x0 + Math.cos(b.angle) * b.length * t;
      const ey = b.y0 + Math.sin(b.angle) * b.length * t;

      const vi = segIdx * 2;
      posAttr.setXYZ(vi, b.x0, b.y0, 0);
      posAttr.setXYZ(vi + 1, ex, ey, 0);

      // Deeper branches are dimmer
      const brightness = Math.max(0.3, 1 - b.depth / (this.maxDepth + 1));
      const col = b.depth === 0 ? this.palette.primary : this.palette.secondary;
      colAttr.setXYZ(vi, col.r * brightness, col.g * brightness, col.b * brightness);
      colAttr.setXYZ(vi + 1, col.r * brightness * 0.7, col.g * brightness * 0.7, col.b * brightness * 0.7);
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
      this.growthTime = this.growDuration * this.rng.float(0.2, 0.8);
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level >= 3) {
      this.growDuration = Math.max(2, this.growDuration - level * 0.2);
    }
  }
}
