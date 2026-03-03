import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Two circular wave sources creating animated moire patterns.
 * Two sets of expanding concentric ring Lines, centers drift slowly.
 */
export class WaveInterferenceElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'wave-interference',
    meta: { shape: 'rectangular', roles: ['decorative', 'data-display'], moods: ['ambient', 'diagnostic'], bandAffinity: 'mid', sizes: ['needs-medium', 'needs-large'] },
  };
  private sourceRings: THREE.Line[][] = [[], []];
  private sourcePos: Array<{ x: number; y: number; vx: number; vy: number }> = [];
  private ringRadii: number[][] = [[], []];
  private maxRadius: number = 0;
  private expandSpeed: number = 0;
  private spawnTimer: number = 0;
  private spawnInterval: number = 0;
  private nextRing: number[] = [0, 0];
  private ringSegments: number = 48;

  build(): void {
    const variant = this.rng.int(0, 3);
    const presets = [
      { ringCount: 8, segments: 48, expandSpeed: [40, 100] as const, spawnInterval: [0.3, 0.7] as const, driftSpeed: 5 },
      { ringCount: 14, segments: 72, expandSpeed: [80, 180] as const, spawnInterval: [0.15, 0.35] as const, driftSpeed: 10 },
      { ringCount: 4, segments: 24, expandSpeed: [20, 50] as const, spawnInterval: [0.6, 1.2] as const, driftSpeed: 3 },
      { ringCount: 10, segments: 36, expandSpeed: [120, 250] as const, spawnInterval: [0.1, 0.25] as const, driftSpeed: 15 },
    ];
    const p = presets[variant];

    this.glitchAmount = 5;
    const { x, y, w, h } = this.px;
    this.maxRadius = Math.max(w, h) * 0.6;
    this.expandSpeed = this.rng.float(p.expandSpeed[0], p.expandSpeed[1]);
    this.spawnInterval = this.rng.float(p.spawnInterval[0], p.spawnInterval[1]);
    this.ringSegments = p.segments + this.rng.int(-4, 4);

    // Two source positions
    const drift = p.driftSpeed + this.rng.float(-1, 1);
    this.sourcePos = [
      { x: x + w * 0.35, y: y + h * 0.5, vx: this.rng.float(-drift, drift), vy: this.rng.float(-drift, drift) },
      { x: x + w * 0.65, y: y + h * 0.5, vx: this.rng.float(-drift, drift), vy: this.rng.float(-drift, drift) },
    ];

    const ringCount = p.ringCount + this.rng.int(-1, 1);
    const segments = this.ringSegments;
    const colors = [this.palette.primary, this.palette.secondary];

    for (let s = 0; s < 2; s++) {
      for (let r = 0; r < ringCount; r++) {
        const verts = new Float32Array((segments + 1) * 3);
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
        const ring = new THREE.Line(geo, new THREE.LineBasicMaterial({
          color: colors[s],
          transparent: true,
          opacity: 0,
        }));
        this.sourceRings[s].push(ring);
        this.ringRadii[s].push(-1);
        this.group.add(ring);
      }
    }
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);
    const { x, y, w, h } = this.px;

    // Drift sources
    for (const src of this.sourcePos) {
      src.x += src.vx * dt;
      src.y += src.vy * dt;
      if (src.x < x + w * 0.2 || src.x > x + w * 0.8) src.vx *= -1;
      if (src.y < y + h * 0.2 || src.y > y + h * 0.8) src.vy *= -1;
    }

    // Spawn rings
    this.spawnTimer += dt;
    if (this.spawnTimer >= this.spawnInterval) {
      this.spawnTimer = 0;
      for (let s = 0; s < 2; s++) {
        this.ringRadii[s][this.nextRing[s]] = 1;
        this.nextRing[s] = (this.nextRing[s] + 1) % this.sourceRings[s].length;
      }
    }

    // Expand rings
    const segments = this.ringSegments;
    for (let s = 0; s < 2; s++) {
      const src = this.sourcePos[s];
      for (let r = 0; r < this.sourceRings[s].length; r++) {
        if (this.ringRadii[s][r] < 0) {
          (this.sourceRings[s][r].material as THREE.LineBasicMaterial).opacity = 0;
          continue;
        }
        this.ringRadii[s][r] += this.expandSpeed * dt;
        const fade = Math.max(0, 1 - this.ringRadii[s][r] / this.maxRadius);

        if (this.ringRadii[s][r] > this.maxRadius) {
          this.ringRadii[s][r] = -1;
          continue;
        }

        const pos = this.sourceRings[s][r].geometry.getAttribute('position') as THREE.BufferAttribute;
        const rad = this.ringRadii[s][r];
        for (let i = 0; i <= segments; i++) {
          const a = (i / segments) * Math.PI * 2;
          pos.setXYZ(i, src.x + Math.cos(a) * rad, src.y + Math.sin(a) * rad, 1);
        }
        pos.needsUpdate = true;
        (this.sourceRings[s][r].material as THREE.LineBasicMaterial).opacity = opacity * fade * 0.5;
      }
    }
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      this.expandSpeed = this.rng.float(100, 250);
    }
    if (action === 'alert') {
      this.pulseTimer = 2.0;
      this.spawnInterval *= 0.3;
    }
  }
}
