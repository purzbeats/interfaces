import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

interface Vine {
  segments: { x: number; y: number }[];
  growthSpeed: number;
  maxLength: number;
  angle: number;       // current growth direction
  wobble: number;       // angular wobble magnitude
  thickness: number;
  tendrilAt: number[];  // indices where tendrils sprout
}

interface Tendril {
  baseIdx: number;      // vine index
  segIdx: number;       // attachment segment
  startAngle: number;
  curl: number;         // spiral tightness
  length: number;
  maxLength: number;
  growthSpeed: number;
}

/**
 * Vine tendrils climbing upward. Stems grow with slight randomness,
 * produce tendrils that curl using spiral math. Progressive growth animation.
 */
export class VineClimbElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'vine-climb',
    meta: {
      shape: 'linear',
      roles: ['decorative'],
      moods: ['ambient'],
      bandAffinity: 'sub',
      sizes: ['works-small', 'needs-medium', 'needs-large'],
    } satisfies ElementMeta,
  };

  private lineMesh!: THREE.LineSegments;
  private vines: Vine[] = [];
  private tendrils: Tendril[] = [];
  private maxVertices: number = 0;
  private growTimer: number = 0;
  private growInterval: number = 0;
  private segmentLength: number = 0;
  private resetTimer: number = 0;
  private phase: 'growing' | 'display' | 'fading' = 'growing';
  private fadeTimer: number = 0;

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;
    const variant = this.rng.int(0, 3);

    const presets = [
      { vineCount: 3, segLen: 4, maxLen: 40, interval: 0.06, tendrilChance: 0.3, curlRange: [2, 5] },
      { vineCount: 5, segLen: 3, maxLen: 50, interval: 0.04, tendrilChance: 0.4, curlRange: [3, 7] },
      { vineCount: 2, segLen: 6, maxLen: 30, interval: 0.08, tendrilChance: 0.2, curlRange: [1, 3] },
      { vineCount: 4, segLen: 3, maxLen: 60, interval: 0.03, tendrilChance: 0.5, curlRange: [4, 8] },
    ];
    const p = presets[variant];

    this.segmentLength = p.segLen;
    this.growInterval = p.interval;

    // Create vines starting from bottom, growing upward
    this.vines = [];
    this.tendrils = [];
    const vineCount = p.vineCount + this.rng.int(-1, 1);

    for (let i = 0; i < Math.max(1, vineCount); i++) {
      const startX = x + w * this.rng.float(0.15, 0.85);
      const startY = y + h; // bottom

      const vine: Vine = {
        segments: [{ x: startX, y: startY }],
        growthSpeed: this.rng.float(0.8, 1.2),
        maxLength: p.maxLen + this.rng.int(-5, 5),
        angle: -Math.PI / 2 + this.rng.float(-0.15, 0.15), // mostly upward
        wobble: this.rng.float(0.05, 0.2),
        thickness: this.rng.float(0.8, 1.5),
        tendrilAt: [],
      };
      this.vines.push(vine);
    }

    // Estimate max vertices: each vine segment = 2 verts, each tendril ~16 segments
    this.maxVertices = Math.max(1, vineCount) * p.maxLen * 2 + 200 * 2;
    const positions = new Float32Array(this.maxVertices * 3);
    const colors = new Float32Array(this.maxVertices * 3);
    for (let i = 0; i < this.maxVertices * 3; i++) {
      positions[i] = 0;
      colors[i] = 0;
    }

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

    this.phase = 'growing';
  }

  private growVine(vine: Vine, presetIdx: number): void {
    if (vine.segments.length >= vine.maxLength) return;

    const last = vine.segments[vine.segments.length - 1];

    // Wobble the angle
    vine.angle += this.rng.float(-vine.wobble, vine.wobble);
    // Bias upward
    vine.angle = vine.angle * 0.95 + (-Math.PI / 2) * 0.05;

    const nx = last.x + Math.cos(vine.angle) * this.segmentLength;
    const ny = last.y + Math.sin(vine.angle) * this.segmentLength;

    vine.segments.push({ x: nx, y: ny });

    // Maybe sprout a tendril
    const variant = this.rng.int(0, 3);
    const tendrilChances = [0.3, 0.4, 0.2, 0.5];
    if (vine.segments.length > 3 && this.rng.float(0, 1) < tendrilChances[Math.min(variant, 3)]) {
      const dir = this.rng.chance(0.5) ? 1 : -1;
      this.tendrils.push({
        baseIdx: this.vines.indexOf(vine),
        segIdx: vine.segments.length - 1,
        startAngle: vine.angle + dir * (Math.PI / 3 + this.rng.float(-0.3, 0.3)),
        curl: dir * this.rng.float(2, 6),
        length: 0,
        maxLength: this.rng.float(8, 20),
        growthSpeed: this.rng.float(0.5, 1.5),
      });
      vine.tendrilAt.push(vine.segments.length - 1);
    }
  }

  private growTendrils(dt: number): void {
    for (const t of this.tendrils) {
      if (t.length < t.maxLength) {
        t.length = Math.min(t.length + t.growthSpeed * dt * 30, t.maxLength);
      }
    }
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);

    if (this.phase === 'growing') {
      this.growTimer += dt;
      while (this.growTimer >= this.growInterval) {
        this.growTimer -= this.growInterval;
        let allDone = true;
        for (const vine of this.vines) {
          if (vine.segments.length < vine.maxLength) {
            this.growVine(vine, 0);
            allDone = false;
          }
        }
        if (allDone) {
          this.phase = 'display';
          this.resetTimer = 4;
        }
      }
      this.growTendrils(dt);
    } else if (this.phase === 'display') {
      this.resetTimer -= dt;
      this.growTendrils(dt);
      if (this.resetTimer <= 0) {
        this.phase = 'fading';
        this.fadeTimer = 1.5;
      }
    } else if (this.phase === 'fading') {
      this.fadeTimer -= dt;
      if (this.fadeTimer <= 0) {
        // Reset
        for (const vine of this.vines) {
          const startSeg = vine.segments[0];
          vine.segments = [startSeg];
          vine.angle = -Math.PI / 2 + this.rng.float(-0.15, 0.15);
          vine.tendrilAt = [];
        }
        this.tendrils = [];
        this.phase = 'growing';
      }
    }

    // Render to line geometry
    const posAttr = this.lineMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const colAttr = this.lineMesh.geometry.getAttribute('color') as THREE.BufferAttribute;
    const pos = posAttr.array as Float32Array;
    const col = colAttr.array as Float32Array;

    const pr = this.palette.primary;
    const sc = this.palette.secondary;
    const dm = this.palette.dim;
    let vi = 0;

    // Draw vine stems
    for (const vine of this.vines) {
      for (let s = 0; s < vine.segments.length - 1 && vi + 1 < this.maxVertices; s++) {
        const a = vine.segments[s];
        const b = vine.segments[s + 1];

        pos[vi * 3] = a.x;
        pos[vi * 3 + 1] = a.y;
        pos[vi * 3 + 2] = 0;
        pos[(vi + 1) * 3] = b.x;
        pos[(vi + 1) * 3 + 1] = b.y;
        pos[(vi + 1) * 3 + 2] = 0;

        const t = s / vine.maxLength;
        col[vi * 3] = pr.r * (1 - t) + sc.r * t;
        col[vi * 3 + 1] = pr.g * (1 - t) + sc.g * t;
        col[vi * 3 + 2] = pr.b * (1 - t) + sc.b * t;
        col[(vi + 1) * 3] = col[vi * 3];
        col[(vi + 1) * 3 + 1] = col[vi * 3 + 1];
        col[(vi + 1) * 3 + 2] = col[vi * 3 + 2];

        vi += 2;
      }
    }

    // Draw tendrils as spiraling segments
    for (const t of this.tendrils) {
      const vine = this.vines[t.baseIdx];
      if (!vine || t.segIdx >= vine.segments.length) continue;
      const base = vine.segments[t.segIdx];

      const steps = Math.floor(t.length);
      let cx = base.x;
      let cy = base.y;
      let ang = t.startAngle;

      for (let s = 0; s < steps && vi + 1 < this.maxVertices; s++) {
        const prevX = cx;
        const prevY = cy;
        ang += t.curl * 0.05;
        const stepLen = this.segmentLength * 0.5 * (1 - s / t.maxLength * 0.5);
        cx += Math.cos(ang) * stepLen;
        cy += Math.sin(ang) * stepLen;

        pos[vi * 3] = prevX;
        pos[vi * 3 + 1] = prevY;
        pos[vi * 3 + 2] = 0;
        pos[(vi + 1) * 3] = cx;
        pos[(vi + 1) * 3 + 1] = cy;
        pos[(vi + 1) * 3 + 2] = 0;

        col[vi * 3] = sc.r;
        col[vi * 3 + 1] = sc.g;
        col[vi * 3 + 2] = sc.b;
        col[(vi + 1) * 3] = dm.r;
        col[(vi + 1) * 3 + 1] = dm.g;
        col[(vi + 1) * 3 + 2] = dm.b;

        vi += 2;
      }
    }

    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
    this.lineMesh.geometry.setDrawRange(0, vi);

    const fadeAlpha = this.phase === 'fading' ? Math.max(this.fadeTimer / 1.5, 0) : 1;
    (this.lineMesh.material as THREE.LineBasicMaterial).opacity = opacity * fadeAlpha;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Wind gust: shift all vine segments horizontally
      for (const vine of this.vines) {
        const shift = this.rng.float(-8, 8);
        for (const seg of vine.segments) {
          seg.x += shift;
        }
      }
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) {
      this.growInterval = 0.06;
      return;
    }
    this.growInterval = Math.max(0.01, 0.06 - level * 0.01);
    if (level >= 5) {
      // Force rapid growth burst
      for (const vine of this.vines) {
        for (let i = 0; i < 10; i++) {
          if (vine.segments.length < vine.maxLength) {
            this.growVine(vine, 0);
          }
        }
      }
    }
  }
}
