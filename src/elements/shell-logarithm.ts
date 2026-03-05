import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Logarithmic spiral seashell cross-section.
 * Parametric spiral with increasing chamber size.
 * Growth lines perpendicular to spiral. Line geometry with chamber divisions.
 */
export class ShellLogarithmElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'shell-logarithm',
    meta: {
      shape: 'radial',
      roles: ['decorative'],
      moods: ['ambient'],
      bandAffinity: 'mid',
      sizes: ['works-small', 'needs-medium'],
    } satisfies ElementMeta,
  };

  private lineMesh!: THREE.LineSegments;
  private maxVertices: number = 0;

  // Spiral parameters
  private growthFactor: number = 0;
  private spiralTurns: number = 0;
  private chamberCount: number = 0;
  private spiralResolution: number = 0;
  private growthProgress: number = 0;
  private growSpeed: number = 0;
  private phase: 'growing' | 'display' | 'fading' = 'growing';
  private displayTimer: number = 0;
  private fadeTimer: number = 0;

  build(): void {
    this.glitchAmount = 4;
    const variant = this.rng.int(0, 3);

    const presets = [
      { growth: 0.18, turns: 3.0, chambers: 12, res: 80,  speed: 0.3 },
      { growth: 0.12, turns: 4.0, chambers: 20, res: 120, speed: 0.2 },
      { growth: 0.25, turns: 2.0, chambers: 8,  res: 60,  speed: 0.4 },
      { growth: 0.15, turns: 3.5, chambers: 16, res: 100, speed: 0.25 },
    ];
    const p = presets[variant];

    this.growthFactor = p.growth + this.rng.float(-0.02, 0.02);
    this.spiralTurns = p.turns;
    this.chamberCount = p.chambers;
    this.spiralResolution = p.res;
    this.growSpeed = p.speed;
    this.growthProgress = 0;
    this.phase = 'growing';

    // Max vertices: spiral outline segments + chamber dividers + inner spiral
    this.maxVertices = (this.spiralResolution * 2 + this.chamberCount * 2 + this.spiralResolution * 2) * 2;
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
  }

  private spiralR(theta: number): number {
    return Math.exp(this.growthFactor * theta);
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);
    const { x, y, w, h } = this.px;

    if (this.phase === 'growing') {
      this.growthProgress = Math.min(this.growthProgress + this.growSpeed * dt, 1);
      if (this.growthProgress >= 1) {
        this.phase = 'display';
        this.displayTimer = 4;
      }
    } else if (this.phase === 'display') {
      this.displayTimer -= dt;
      if (this.displayTimer <= 0) {
        this.phase = 'fading';
        this.fadeTimer = 1.5;
      }
    } else if (this.phase === 'fading') {
      this.fadeTimer -= dt;
      if (this.fadeTimer <= 0) {
        this.growthProgress = 0;
        this.phase = 'growing';
      }
    }

    const cx = x + w / 2;
    const cy = y + h / 2;
    const scale = Math.min(w, h) * 0.4;
    const maxTheta = this.spiralTurns * Math.PI * 2 * this.growthProgress;
    const maxR = this.spiralR(maxTheta);
    const normScale = scale / Math.max(maxR, 1);

    const posAttr = this.lineMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const colAttr = this.lineMesh.geometry.getAttribute('color') as THREE.BufferAttribute;
    const pos = posAttr.array as Float32Array;
    const col = colAttr.array as Float32Array;

    const pr = this.palette.primary;
    const sc = this.palette.secondary;
    const dm = this.palette.dim;
    let vi = 0;

    // Draw outer spiral
    const visibleSteps = Math.floor(this.spiralResolution * this.growthProgress);
    for (let i = 0; i < visibleSteps && vi + 1 < this.maxVertices; i++) {
      const t0 = i / this.spiralResolution;
      const t1 = (i + 1) / this.spiralResolution;
      const theta0 = t0 * this.spiralTurns * Math.PI * 2;
      const theta1 = t1 * this.spiralTurns * Math.PI * 2;

      const r0 = this.spiralR(theta0) * normScale;
      const r1 = this.spiralR(theta1) * normScale;

      pos[vi * 3] = cx + Math.cos(theta0) * r0;
      pos[vi * 3 + 1] = cy + Math.sin(theta0) * r0;
      pos[vi * 3 + 2] = 0;
      pos[(vi + 1) * 3] = cx + Math.cos(theta1) * r1;
      pos[(vi + 1) * 3 + 1] = cy + Math.sin(theta1) * r1;
      pos[(vi + 1) * 3 + 2] = 0;

      col[vi * 3] = pr.r;
      col[vi * 3 + 1] = pr.g;
      col[vi * 3 + 2] = pr.b;
      col[(vi + 1) * 3] = pr.r;
      col[(vi + 1) * 3 + 1] = pr.g;
      col[(vi + 1) * 3 + 2] = pr.b;

      vi += 2;
    }

    // Draw inner spiral (offset by one turn)
    const innerOffset = Math.PI * 2;
    for (let i = 0; i < visibleSteps && vi + 1 < this.maxVertices; i++) {
      const t0 = i / this.spiralResolution;
      const t1 = (i + 1) / this.spiralResolution;
      const theta0 = t0 * this.spiralTurns * Math.PI * 2;
      const theta1 = t1 * this.spiralTurns * Math.PI * 2;

      if (theta0 < innerOffset) continue;

      const r0 = this.spiralR(theta0 - innerOffset) * normScale;
      const r1 = this.spiralR(theta1 - innerOffset) * normScale;

      pos[vi * 3] = cx + Math.cos(theta0) * r0;
      pos[vi * 3 + 1] = cy + Math.sin(theta0) * r0;
      pos[vi * 3 + 2] = 0;
      pos[(vi + 1) * 3] = cx + Math.cos(theta1) * r1;
      pos[(vi + 1) * 3 + 1] = cy + Math.sin(theta1) * r1;
      pos[(vi + 1) * 3 + 2] = 0;

      col[vi * 3] = dm.r;
      col[vi * 3 + 1] = dm.g;
      col[vi * 3 + 2] = dm.b;
      col[(vi + 1) * 3] = dm.r;
      col[(vi + 1) * 3 + 1] = dm.g;
      col[(vi + 1) * 3 + 2] = dm.b;

      vi += 2;
    }

    // Draw chamber dividers (growth lines perpendicular to spiral)
    const visibleChambers = Math.floor(this.chamberCount * this.growthProgress);
    for (let c = 1; c <= visibleChambers && vi + 1 < this.maxVertices; c++) {
      const chamberFrac = c / this.chamberCount;
      const theta = chamberFrac * this.spiralTurns * Math.PI * 2;

      const outerR = this.spiralR(theta) * normScale;
      const innerTheta = theta - innerOffset;
      const innerR = innerTheta > 0 ? this.spiralR(innerTheta) * normScale : 2;

      pos[vi * 3] = cx + Math.cos(theta) * innerR;
      pos[vi * 3 + 1] = cy + Math.sin(theta) * innerR;
      pos[vi * 3 + 2] = 0;
      pos[(vi + 1) * 3] = cx + Math.cos(theta) * outerR;
      pos[(vi + 1) * 3 + 1] = cy + Math.sin(theta) * outerR;
      pos[(vi + 1) * 3 + 2] = 0;

      const ct = chamberFrac;
      col[vi * 3] = sc.r * ct + dm.r * (1 - ct);
      col[vi * 3 + 1] = sc.g * ct + dm.g * (1 - ct);
      col[vi * 3 + 2] = sc.b * ct + dm.b * (1 - ct);
      col[(vi + 1) * 3] = col[vi * 3];
      col[(vi + 1) * 3 + 1] = col[vi * 3 + 1];
      col[(vi + 1) * 3 + 2] = col[vi * 3 + 2];

      vi += 2;
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
      // Distort growth factor temporarily
      this.growthFactor += this.rng.float(-0.05, 0.05);
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) {
      this.growSpeed = 0.3;
      return;
    }
    this.growSpeed = 0.3 + level * 0.1;
    if (level >= 5) {
      this.growthProgress = 1;
      this.phase = 'display';
      this.displayTimer = 2;
    }
  }
}
