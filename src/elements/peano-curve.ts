import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Peano space-filling curve. Recursive 9-segment construction that
 * progressively fills a rectangular region. Animates through iteration
 * levels 1-5, revealing deeper detail over time.
 */
export class PeanoCurveElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'peano-curve',
    meta: {
      shape: 'rectangular',
      roles: ['decorative', 'data-display'],
      moods: ['ambient', 'diagnostic'],
      bandAffinity: 'mid',
      sizes: ['needs-medium', 'needs-large'],
    },
  };

  private line!: THREE.Line;
  private lineMat!: THREE.LineBasicMaterial;
  private maxIter = 4;
  private animSpeed = 0.5;
  private currentLevel = 0;
  private levelTimer = 0;
  private levelDuration = 3;
  private ascending = true;
  private lineWidth = 1;
  private cx = 0;
  private cy = 0;
  private regionW = 0;
  private regionH = 0;

  build(): void {
    this.glitchAmount = 4;
    const variant = this.rng.int(0, 4);
    const { x, y, w, h } = this.px;

    const presets = [
      { maxIter: 4, animSpeed: 0.4, levelDuration: 3.0 },
      { maxIter: 5, animSpeed: 0.3, levelDuration: 4.0 },
      { maxIter: 3, animSpeed: 0.6, levelDuration: 2.0 },
      { maxIter: 4, animSpeed: 0.5, levelDuration: 2.5 },
    ];
    const p = presets[variant];
    this.maxIter = p.maxIter;
    this.animSpeed = p.animSpeed;
    this.levelDuration = p.levelDuration;

    this.cx = x;
    this.cy = y;
    this.regionW = w;
    this.regionH = h;

    // Max points for highest iteration: 3^maxIter + 1
    const maxPoints = Math.pow(3, this.maxIter) * Math.pow(3, this.maxIter) + 1;
    // Cap to avoid huge allocations
    const capPoints = Math.min(maxPoints, 60000);
    const positions = new Float32Array(capPoints * 3);
    // Fill with center point to avoid (0,0,0) defaults
    for (let i = 0; i < capPoints; i++) {
      positions[i * 3] = x + w / 2;
      positions[i * 3 + 1] = y + h / 2;
      positions[i * 3 + 2] = 0;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setDrawRange(0, 0);

    this.lineMat = new THREE.LineBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
    });
    this.line = new THREE.Line(geo, this.lineMat);
    this.group.add(this.line);
  }

  /** Generate Peano curve points for given iteration depth */
  private generatePeano(iter: number): number[][] {
    // Start with single point at origin in unit square
    let points: number[][] = [[0, 0]];

    for (let i = 0; i < iter; i++) {
      const newPoints: number[][] = [];
      const n = points.length;
      // 9 sub-copies arranged in a 3x3 grid with appropriate reflections
      for (let row = 0; row < 3; row++) {
        if (row % 2 === 0) {
          // Left to right
          for (let col = 0; col < 3; col++) {
            const flipY = col % 2 === 1;
            const subset = flipY ? [...points].reverse() : points;
            for (const [px, py] of subset) {
              const sx = (col + px) / 3;
              const sy = (row + (flipY ? (1 - py) : py)) / 3;
              newPoints.push([sx, sy]);
            }
          }
        } else {
          // Right to left
          for (let col = 2; col >= 0; col--) {
            const flipY = col % 2 === 0;
            const subset = flipY ? [...points].reverse() : points;
            for (const [px, py] of subset) {
              const sx = (col + px) / 3;
              const sy = (row + (flipY ? (1 - py) : py)) / 3;
              newPoints.push([sx, sy]);
            }
          }
        }
      }
      points = newPoints;
    }
    return points;
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);

    this.levelTimer += dt;
    if (this.levelTimer >= this.levelDuration) {
      this.levelTimer = 0;
      if (this.ascending) {
        this.currentLevel++;
        if (this.currentLevel >= this.maxIter) {
          this.ascending = false;
        }
      } else {
        this.currentLevel--;
        if (this.currentLevel <= 0) {
          this.ascending = true;
        }
      }
    }

    const level = Math.max(1, this.currentLevel);
    const points = this.generatePeano(level);
    const pos = this.line.geometry.getAttribute('position') as THREE.BufferAttribute;
    const maxDraw = Math.min(points.length, pos.count);

    const margin = 4;
    const drawW = this.regionW - margin * 2;
    const drawH = this.regionH - margin * 2;

    // Animate progressive reveal
    const revealFrac = Math.min(1, this.levelTimer / (this.levelDuration * 0.7));
    const drawCount = Math.max(2, Math.floor(maxDraw * revealFrac));

    for (let i = 0; i < drawCount; i++) {
      const [px, py] = points[i];
      pos.setXYZ(
        i,
        this.cx + margin + px * drawW,
        this.cy + margin + py * drawH,
        0,
      );
    }
    pos.needsUpdate = true;
    this.line.geometry.setDrawRange(0, drawCount);

    this.lineMat.opacity = opacity * 0.8;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      this.currentLevel = this.rng.int(1, this.maxIter);
      this.levelTimer = 0;
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level >= 3) {
      this.animSpeed = 0.3 + level * 0.1;
    }
  }
}
