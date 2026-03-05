import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

interface Vein {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  depth: number; // 0=midrib, 1=secondary, 2=tertiary
  spawnTime: number; // normalized 0-1, when this vein starts growing
}

/**
 * Leaf vein network. Central midrib with secondary veins branching at angles,
 * then tertiary veins. Growth animation over time with periodic reset.
 */
export class LeafVenationElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'leaf-venation',
    meta: {
      shape: 'rectangular',
      roles: ['decorative'],
      moods: ['ambient'],
      bandAffinity: 'mid',
      sizes: ['needs-medium', 'needs-large'],
    },
  };

  private lineMesh!: THREE.LineSegments;
  private veins: Vein[] = [];
  private maxSegments: number = 0;
  private growthTime: number = 0;
  private growDuration: number = 0;
  private fadeDuration: number = 1.5;
  private fadeTimer: number = 0;
  private phase: 'growing' | 'fading' = 'growing';
  private branchAngle: number = 0;
  private secondaryCount: number = 0;

  build(): void {
    this.glitchAmount = 4;

    const variant = this.rng.int(0, 3);
    const presets = [
      { branches: 6, angle: Math.PI / 5, tertiaryChance: 0.4, duration: 5 },
      { branches: 10, angle: Math.PI / 4, tertiaryChance: 0.6, duration: 4 },
      { branches: 4, angle: Math.PI / 6, tertiaryChance: 0.2, duration: 7 },
      { branches: 8, angle: Math.PI / 3, tertiaryChance: 0.8, duration: 3.5 },
    ];
    const p = presets[variant];
    this.secondaryCount = p.branches;
    this.branchAngle = p.angle;
    this.growDuration = p.duration;

    this.generateVeins(p.tertiaryChance);

    this.maxSegments = this.veins.length;
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

  private generateVeins(tertiaryChance: number): void {
    const { x, y, w, h } = this.px;
    this.veins = [];

    // Midrib: vertical center line from bottom to top
    const cx = x + w / 2;
    const top = y + h * 0.1;
    const bottom = y + h * 0.9;
    const midribLen = bottom - top;

    this.veins.push({ x0: cx, y0: bottom, x1: cx, y1: top, depth: 0, spawnTime: 0 });

    // Secondary veins branching from midrib
    for (let i = 0; i < this.secondaryCount; i++) {
      const frac = (i + 1) / (this.secondaryCount + 1);
      const py = bottom - midribLen * frac;
      const side = i % 2 === 0 ? 1 : -1;
      const angle = side * this.branchAngle;
      const len = (w * 0.35) * this.rng.float(0.6, 1.0);
      const ex = cx + Math.cos(angle - Math.PI / 2) * len * side;
      const ey = py + Math.sin(angle - Math.PI / 2) * len;

      this.veins.push({ x0: cx, y0: py, x1: ex, y1: ey, depth: 1, spawnTime: frac * 0.5 });

      // Tertiary veins
      const terCount = this.rng.int(1, 3);
      for (let t = 0; t < terCount; t++) {
        if (!this.rng.chance(tertiaryChance)) continue;
        const tf = this.rng.float(0.3, 0.7);
        const tx = cx + (ex - cx) * tf;
        const ty = py + (ey - py) * tf;
        const tAngle = angle + side * this.rng.float(0.2, 0.6);
        const tLen = len * this.rng.float(0.2, 0.4);
        const tex = tx + Math.cos(tAngle - Math.PI / 2) * tLen * side;
        const tey = ty + Math.sin(tAngle - Math.PI / 2) * tLen;
        this.veins.push({
          x0: tx, y0: ty, x1: tex, y1: tey,
          depth: 2, spawnTime: frac * 0.5 + 0.3,
        });
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
        this.phase = 'growing';
        this.growthTime = 0;
        this.generateVeins(this.rng.float(0.2, 0.8));
        if (this.veins.length > this.maxSegments) {
          this.maxSegments = this.veins.length;
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
    for (let i = 0; i < this.veins.length && segIdx < this.maxSegments; i++) {
      const v = this.veins[i];
      const t = Math.max(0, Math.min(1, (globalGrowth - v.spawnTime) / (1 - v.spawnTime)));
      if (t <= 0) continue;

      const ex = v.x0 + (v.x1 - v.x0) * t;
      const ey = v.y0 + (v.y1 - v.y0) * t;

      const vi = segIdx * 2;
      posAttr.setXYZ(vi, v.x0, v.y0, 0);
      posAttr.setXYZ(vi + 1, ex, ey, 0);

      const col = v.depth === 0 ? this.palette.primary
        : v.depth === 1 ? this.palette.secondary
        : this.palette.dim;
      colAttr.setXYZ(vi, col.r, col.g, col.b);
      colAttr.setXYZ(vi + 1, col.r, col.g, col.b);
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
      this.growthTime = this.growDuration * this.rng.float(0, 0.5);
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level >= 3) {
      this.growDuration = Math.max(2, this.growDuration - level * 0.3);
    }
  }
}
