import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Submarine-style depth gauge. A vertical bar with scrolling depth tick marks
 * and a moving indicator showing current depth. Depth value drifts slowly
 * up and down. Ticks use dim color, indicator uses primary.
 */
export class DepthGaugeElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'depth-gauge',
    meta: {
      shape: 'linear',
      roles: ['gauge'],
      moods: ['tactical'],
      sizes: ['works-small'],
    },
  };

  private barFrame!: THREE.LineSegments;
  private tickLines!: THREE.LineSegments;
  private indicator!: THREE.LineSegments;
  private indicatorMat!: THREE.LineBasicMaterial;
  private depthBar!: THREE.Mesh;
  private depthBarMat!: THREE.MeshBasicMaterial;

  // Depth state
  private depthValue: number = 200;   // current depth in "meters"
  private depthTarget: number = 200;
  private driftTimer: number = 0;
  private driftInterval: number = 3.0;
  private depthSpeed: number = 15;    // m/s approach speed

  // Layout
  private barLeft: number = 0;
  private barRight: number = 0;
  private barTop: number = 0;
  private barBottom: number = 0;
  private barW: number = 0;
  private barH: number = 0;

  // Tick config
  private tickSpacing: number = 50;   // depth units per tick
  private maxDepth: number = 500;
  private minDepth: number = 0;
  private tickCount: number = 12;
  private variant: number = 0;

  build(): void {
    this.variant = this.rng.int(0, 3);
    const presets = [
      // 0: Standard submarine depth, moderate range
      { minD: 0, maxD: 500, tickSpace: 50, speed: 15, interval: [3, 6] as const, startDepth: 200 },
      // 1: Deep dive, wide range, slow
      { minD: 0, maxD: 1000, tickSpace: 100, speed: 25, interval: [4, 8] as const, startDepth: 400 },
      // 2: Shallow / precise, narrow range, fast updates
      { minD: 0, maxD: 200, tickSpace: 20, speed: 8, interval: [1.5, 3.5] as const, startDepth: 80 },
      // 3: Extreme depth, large ticks
      { minD: 100, maxD: 2000, tickSpace: 200, speed: 40, interval: [5, 10] as const, startDepth: 600 },
    ];
    const p = presets[this.variant];

    this.minDepth = p.minD;
    this.maxDepth = p.maxD;
    this.tickSpacing = p.tickSpace;
    this.depthSpeed = p.speed + this.rng.float(-3, 3);
    this.driftInterval = this.rng.float(p.interval[0], p.interval[1]);
    this.depthValue = p.startDepth + this.rng.float(-p.tickSpace, p.tickSpace);
    this.depthTarget = this.depthValue;
    this.tickCount = Math.ceil((this.maxDepth - this.minDepth) / this.tickSpacing) + 1;

    const { x, y, w, h } = this.px;
    const margin = 3;
    this.barLeft = x + margin;
    this.barRight = x + w - margin;
    this.barTop = y + margin;
    this.barBottom = y + h - margin;
    this.barW = this.barRight - this.barLeft;
    this.barH = this.barBottom - this.barTop;

    // --- Bar frame (vertical rectangle) ---
    const fv: number[] = [
      this.barLeft, this.barTop, 0, this.barRight, this.barTop, 0,
      this.barRight, this.barTop, 0, this.barRight, this.barBottom, 0,
      this.barRight, this.barBottom, 0, this.barLeft, this.barBottom, 0,
      this.barLeft, this.barBottom, 0, this.barLeft, this.barTop, 0,
    ];
    const frameGeo = new THREE.BufferGeometry();
    frameGeo.setAttribute('position', new THREE.Float32BufferAttribute(fv, 3));
    this.barFrame = new THREE.LineSegments(frameGeo, new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.barFrame);

    // --- Tick mark lines (will be updated dynamically as depth scrolls) ---
    // Pre-allocate enough ticks to fill the visible area
    const maxVisibleTicks = 20;
    const tickVerts = new Float32Array(maxVisibleTicks * 2 * 3);
    const tickGeo = new THREE.BufferGeometry();
    tickGeo.setAttribute('position', new THREE.BufferAttribute(tickVerts, 3));
    tickGeo.setDrawRange(0, 0);
    this.tickLines = new THREE.LineSegments(tickGeo, new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.tickLines);

    // --- Depth indicator (horizontal line with arrow-like triangle) ---
    const indVerts = new Float32Array([
      // Main horizontal line
      this.barLeft, this.barTop + this.barH / 2, 1,
      this.barRight, this.barTop + this.barH / 2, 1,
      // Left arrow (small triangle using line segments)
      this.barLeft, this.barTop + this.barH / 2, 1,
      this.barLeft + 6, this.barTop + this.barH / 2 - 4, 1,
      this.barLeft, this.barTop + this.barH / 2, 1,
      this.barLeft + 6, this.barTop + this.barH / 2 + 4, 1,
    ]);
    const indGeo = new THREE.BufferGeometry();
    indGeo.setAttribute('position', new THREE.BufferAttribute(indVerts, 3));
    this.indicatorMat = new THREE.LineBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
    });
    this.indicator = new THREE.LineSegments(indGeo, this.indicatorMat);
    this.group.add(this.indicator);

    // --- Depth fill bar (shows depth proportion as a subtle background) ---
    const fillGeo = new THREE.PlaneGeometry(1, 1);
    this.depthBarMat = new THREE.MeshBasicMaterial({
      color: this.palette.secondary,
      transparent: true,
      opacity: 0,
    });
    this.depthBar = new THREE.Mesh(fillGeo, this.depthBarMat);
    this.depthBar.position.z = 0;
    this.group.add(this.depthBar);
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);

    // Drift to new depth targets periodically
    this.driftTimer += dt;
    if (this.driftTimer >= this.driftInterval) {
      this.driftTimer = 0;
      this.driftInterval = this.rng.float(2, 7);
      this.depthTarget = this.rng.float(this.minDepth + this.tickSpacing, this.maxDepth - this.tickSpacing);
    }

    // Smooth depth approach
    const diff = this.depthTarget - this.depthValue;
    const step = this.depthSpeed * dt;
    if (Math.abs(diff) < step) {
      this.depthValue = this.depthTarget;
    } else {
      this.depthValue += Math.sign(diff) * step;
    }

    // Normalized depth (0 = top/surface, 1 = max depth)
    const depthNorm = (this.depthValue - this.minDepth) / (this.maxDepth - this.minDepth);

    // --- Update tick marks (scroll with depth) ---
    // Show ticks relative to current depth. The indicator stays at vertical center.
    // Ticks scroll relative to depth changes.
    const tickPos = this.tickLines.geometry.getAttribute('position') as THREE.BufferAttribute;
    const centerY = this.barTop + this.barH / 2;
    const pixelsPerUnit = this.barH / (this.maxDepth - this.minDepth) * 3;

    let vertIdx = 0;
    const visibleRange = this.barH / pixelsPerUnit;
    const firstTick = Math.floor((this.depthValue - visibleRange / 2) / this.tickSpacing) * this.tickSpacing;
    const lastTick = this.depthValue + visibleRange / 2;

    for (let d = firstTick; d <= lastTick; d += this.tickSpacing) {
      if (vertIdx >= 20 * 2) break;
      const yOffset = (d - this.depthValue) * pixelsPerUnit;
      const ty = centerY + yOffset;

      // Skip if outside visible bar
      if (ty < this.barTop || ty > this.barBottom) continue;

      const isMajor = (Math.round(d) % (this.tickSpacing * 2)) === 0;
      const tickLen = isMajor ? this.barW * 0.35 : this.barW * 0.2;

      tickPos.setXYZ(vertIdx, this.barLeft, ty, 0.5);
      tickPos.setXYZ(vertIdx + 1, this.barLeft + tickLen, ty, 0.5);
      vertIdx += 2;
    }

    // Hide unused tick vertices by overlapping them
    for (let i = vertIdx; i < 20 * 2; i++) {
      tickPos.setXYZ(i, 0, 0, -10);
    }
    tickPos.needsUpdate = true;
    this.tickLines.geometry.setDrawRange(0, vertIdx);

    // --- Update indicator position (stays at center) ---
    const indPos = this.indicator.geometry.getAttribute('position') as THREE.BufferAttribute;
    const indY = centerY;
    indPos.setXYZ(0, this.barLeft, indY, 1);
    indPos.setXYZ(1, this.barRight, indY, 1);
    indPos.setXYZ(2, this.barLeft, indY, 1);
    indPos.setXYZ(3, this.barLeft + 6, indY - 4, 1);
    indPos.setXYZ(4, this.barLeft, indY, 1);
    indPos.setXYZ(5, this.barLeft + 6, indY + 4, 1);
    indPos.needsUpdate = true;

    // --- Update depth fill bar ---
    const gap = 2;
    const fillH = (this.barH - gap * 2) * Math.max(0.02, depthNorm);
    this.depthBar.scale.set(this.barW - gap * 2, fillH, 1);
    this.depthBar.position.set(
      this.barLeft + this.barW / 2,
      this.barTop + gap + fillH / 2,
      0,
    );

    // --- Opacities ---
    (this.barFrame.material as THREE.LineBasicMaterial).opacity = opacity * 0.4;
    (this.tickLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.45;
    this.indicatorMat.opacity = opacity * 0.9;
    this.depthBarMat.opacity = opacity * 0.08;
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) return;
    // Rapid depth change on high intensity
    if (level >= 4) {
      this.depthTarget = this.maxDepth * 0.9;
      this.depthSpeed *= 2;
    }
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'alert') {
      this.depthTarget = this.maxDepth * 0.95;
    }
    if (action === 'pulse') {
      this.depthValue += this.rng.float(-this.tickSpacing, this.tickSpacing);
    }
    if (action === 'glitch') {
      this.depthValue = this.rng.float(this.minDepth, this.maxDepth);
    }
  }
}
