import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

interface Arrow {
  progress: number;   // 0..1 position along the flow axis
  speed: number;      // normalized progress per second
  size: number;       // scale multiplier
  phase: number;      // spawn offset
}

/**
 * Stream of chevron/arrow shapes flowing in one direction.
 * Arrows fade in at one end, travel across, and fade out at the other.
 * Variants: rightward flow, upward flow, diagonal, varying sizes.
 */
export class ArrowFlowElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'arrow-flow',
    meta: {
      shape: 'linear',
      roles: ['decorative', 'data-display'],
      moods: ['tactical', 'ambient'],
      sizes: ['works-small', 'needs-medium'],
      bandAffinity: 'mid',
    },
  };

  private arrowLines!: THREE.LineSegments;
  private arrows: Arrow[] = [];
  private variant: number = 0;
  private arrowCount: number = 0;
  private baseSpeed: number = 0;
  private alertMode: boolean = false;
  private speedMultiplier: number = 1;
  // Arrow geometry constants
  private arrowW: number = 0;
  private arrowH: number = 0;

  build(): void {
    this.variant = this.rng.int(0, 3);
    const { x, y, w, h } = this.px;

    const presets = [
      { count: 6, speedMin: 0.25, speedMax: 0.55, sizeMin: 0.8, sizeMax: 1.2, spacingFrac: 0.15 },  // right flow
      { count: 5, speedMin: 0.20, speedMax: 0.45, sizeMin: 0.7, sizeMax: 1.3, spacingFrac: 0.18 },  // upward flow
      { count: 7, speedMin: 0.30, speedMax: 0.60, sizeMin: 0.6, sizeMax: 1.0, spacingFrac: 0.12 },  // diagonal
      { count: 4, speedMin: 0.15, speedMax: 0.40, sizeMin: 0.5, sizeMax: 1.8, spacingFrac: 0.20 },  // varying sizes
    ];
    const p = presets[this.variant];

    this.arrowCount = p.count;
    this.baseSpeed = this.rng.float(p.speedMin, p.speedMax);
    this.glitchAmount = 4;

    // Arrow size based on region
    const dim = Math.min(w, h);
    this.arrowH = dim * 0.35;
    this.arrowW = this.arrowH * 0.6;

    // Initialize arrows with staggered start positions
    for (let i = 0; i < this.arrowCount; i++) {
      this.arrows.push({
        progress: i / this.arrowCount,
        speed: this.rng.float(p.speedMin, p.speedMax),
        size: this.rng.float(p.sizeMin, p.sizeMax),
        phase: this.rng.float(0, Math.PI * 2),
      });
    }

    // 4 verts per arrow: 2 line segments (top arm + bottom arm), each segment = 2 endpoints
    // LineSegments pairs: [v0,v1], [v2,v3]
    const vertsPerArrow = 4; // 2 segments * 2 endpoints
    const totalVerts = this.arrowCount * vertsPerArrow;
    const positions = new Float32Array(totalVerts * 3);
    const colors = new Float32Array(totalVerts * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.arrowLines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.arrowLines);
  }

  /** Compute the tip position and direction vector for a given progress (0..1) */
  private computeArrowTransform(progress: number, x: number, y: number, w: number, h: number): {
    tipX: number; tipY: number; dirX: number; dirY: number;
  } {
    switch (this.variant) {
      case 0: // rightward
        return { tipX: x + progress * w, tipY: y + h / 2, dirX: 1, dirY: 0 };
      case 1: // upward (positive Y = up in screen coords means decreasing y)
        return { tipX: x + w / 2, tipY: y + h - progress * h, dirX: 0, dirY: -1 };
      case 2: { // diagonal (top-left to bottom-right)
        const t = progress;
        return { tipX: x + t * w, tipY: y + t * h, dirX: 0.707, dirY: 0.707 };
      }
      case 3: // rightward varying sizes (same direction as 0)
      default:
        return { tipX: x + progress * w, tipY: y + h / 2, dirX: 1, dirY: 0 };
    }
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    const { x, y, w, h } = this.px;

    const positions = this.arrowLines.geometry.getAttribute('position') as THREE.BufferAttribute;
    const colors = this.arrowLines.geometry.getAttribute('color') as THREE.BufferAttribute;

    const primary = this.alertMode ? this.palette.alert : this.palette.primary;
    const dim = this.palette.dim;
    const speed = this.baseSpeed * this.speedMultiplier;

    for (let i = 0; i < this.arrowCount; i++) {
      const arrow = this.arrows[i];
      arrow.progress = (arrow.progress + arrow.speed * speed * dt) % 1.0;

      // Fade: ramp in during first 15%, ramp out during last 15%
      const fade = Math.min(arrow.progress / 0.15, 1) * Math.min((1 - arrow.progress) / 0.15, 1);
      // Optional pulsing shimmer per arrow
      const shimmer = this.variant === 3 ? (0.7 + 0.3 * Math.sin(time * 3 + arrow.phase)) : 1;

      const { tipX, tipY, dirX, dirY } = this.computeArrowTransform(arrow.progress, x, y, w, h);

      // Arrow geometry: tip points in direction of travel
      // Arms extend backward from tip at ±45 degrees relative to direction
      const aw = this.arrowW * arrow.size;
      const ah = this.arrowH * arrow.size;

      // Perpendicular to direction
      const perpX = -dirY;
      const perpY = dirX;

      // Base of the chevron sits behind the tip
      const baseX = tipX - dirX * aw;
      const baseY = tipY - dirY * aw;

      // Top arm: from tip to upper-back
      const topAX = baseX + perpX * ah * 0.5;
      const topAY = baseY + perpY * ah * 0.5;
      // Bottom arm: from tip to lower-back
      const botAX = baseX - perpX * ah * 0.5;
      const botAY = baseY - perpY * ah * 0.5;

      const vi = i * 4;
      const clampX = (v: number) => Math.max(x, Math.min(x + w, v));
      const clampY = (v: number) => Math.max(y, Math.min(y + h, v));
      // segment 0: tip -> top arm
      positions.setXYZ(vi + 0, clampX(tipX), clampY(tipY), 1);
      positions.setXYZ(vi + 1, clampX(topAX), clampY(topAY), 1);
      // segment 1: tip -> bottom arm
      positions.setXYZ(vi + 2, clampX(tipX), clampY(tipY), 1);
      positions.setXYZ(vi + 3, clampX(botAX), clampY(botAY), 1);

      const brightness = fade * shimmer;
      const r = dim.r + (primary.r - dim.r) * brightness;
      const g = dim.g + (primary.g - dim.g) * brightness;
      const b = dim.b + (primary.b - dim.b) * brightness;

      for (let v = vi; v < vi + 4; v++) {
        colors.setXYZ(v, r, g, b);
      }
    }

    positions.needsUpdate = true;
    colors.needsUpdate = true;
    (this.arrowLines.material as THREE.LineBasicMaterial).opacity = opacity;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Briefly reverse flow direction
      this.speedMultiplier = -1.5;
      setTimeout(() => { this.speedMultiplier = 1; }, 400);
    }
    if (action === 'alert') {
      this.alertMode = true;
      this.speedMultiplier = 3;
      this.pulseTimer = 1.5;
      setTimeout(() => {
        this.alertMode = false;
        this.speedMultiplier = 1;
      }, 2000);
    }
    if (action === 'pulse') {
      this.speedMultiplier = 2.5;
      setTimeout(() => { this.speedMultiplier = 1; }, 500);
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) {
      this.speedMultiplier = 1;
      this.alertMode = false;
      return;
    }
    this.speedMultiplier = 1 + level * 0.35;
    if (level >= 5) {
      this.alertMode = true;
      setTimeout(() => { this.alertMode = false; }, 1000);
    }
  }
}
