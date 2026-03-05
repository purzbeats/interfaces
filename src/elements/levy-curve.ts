import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Levy C curve fractal — each line segment is replaced by two segments
 * at 45-degree angles, producing a distinctive tapestry-like pattern.
 * Animates through iteration levels with progressive reveal.
 */
export class LevyCurveElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'levy-curve',
    meta: {
      shape: 'rectangular',
      roles: ['decorative', 'data-display'],
      moods: ['ambient', 'diagnostic'],
      bandAffinity: 'high',
      sizes: ['needs-medium', 'needs-large'],
    },
  };

  private line!: THREE.Line;
  private lineMat!: THREE.LineBasicMaterial;
  private glowLine!: THREE.Line;
  private glowMat!: THREE.LineBasicMaterial;
  private maxIter = 14;
  private currentLevel = 4;
  private levelTimer = 0;
  private levelDuration = 3.0;
  private ascending = true;
  private colorCycleSpeed = 0.2;

  build(): void {
    this.glitchAmount = 4;
    const variant = this.rng.int(0, 4);
    const presets = [
      { maxIter: 14, levelDuration: 3.0, colorCycleSpeed: 0.2 },
      { maxIter: 16, levelDuration: 4.0, colorCycleSpeed: 0.15 },
      { maxIter: 12, levelDuration: 2.0, colorCycleSpeed: 0.3 },
      { maxIter: 15, levelDuration: 2.5, colorCycleSpeed: 0.25 },
    ];
    const p = presets[variant];
    this.maxIter = p.maxIter;
    this.levelDuration = p.levelDuration;
    this.colorCycleSpeed = p.colorCycleSpeed;

    // 2^maxIter + 1 points max
    const capPoints = Math.min(Math.pow(2, this.maxIter) + 1, 70000);
    const positions = new Float32Array(capPoints * 3);
    const { x, y, w, h } = this.px;
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

    // Glow / trail
    const glowGeo = new THREE.BufferGeometry();
    glowGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    glowGeo.setDrawRange(0, 0);
    this.glowMat = new THREE.LineBasicMaterial({
      color: this.palette.secondary,
      transparent: true,
      opacity: 0,
    });
    this.glowLine = new THREE.Line(glowGeo, this.glowMat);
    this.group.add(this.glowLine);
  }

  /** Generate Levy C curve points iteratively */
  private generateLevy(iterations: number): number[][] {
    // Start with two endpoints
    let points: number[][] = [[0, 0], [1, 0]];

    for (let iter = 0; iter < iterations; iter++) {
      const newPoints: number[][] = [points[0]];
      for (let i = 0; i < points.length - 1; i++) {
        const [ax, ay] = points[i];
        const [bx, by] = points[i + 1];
        // Midpoint rotated 45 degrees
        const mx = (ax + bx) / 2 + (by - ay) / 2;
        const my = (ay + by) / 2 + (ax - bx) / 2;
        newPoints.push([mx, my]);
        newPoints.push([bx, by]);
      }
      points = newPoints;
      if (points.length > 70000) break;
    }
    return points;
  }

  /** Fit points into the region */
  private fitToRegion(points: number[][]): void {
    if (points.length < 2) return;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [px, py] of points) {
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
    }
    const { x, y, w, h } = this.px;
    const margin = 8;
    const rangeX = maxX - minX || 1;
    const rangeY = maxY - minY || 1;
    const scaleX = (w - margin * 2) / rangeX;
    const scaleY = (h - margin * 2) / rangeY;
    const scale = Math.min(scaleX, scaleY);
    const offX = x + margin + ((w - margin * 2) - rangeX * scale) / 2;
    const offY = y + margin + ((h - margin * 2) - rangeY * scale) / 2;

    for (const pt of points) {
      pt[0] = offX + (pt[0] - minX) * scale;
      pt[1] = offY + (pt[1] - minY) * scale;
    }
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);

    this.levelTimer += dt;
    if (this.levelTimer >= this.levelDuration) {
      this.levelTimer = 0;
      if (this.ascending) {
        this.currentLevel++;
        if (this.currentLevel >= this.maxIter) this.ascending = false;
      } else {
        this.currentLevel--;
        if (this.currentLevel <= 4) this.ascending = true;
      }
    }

    const points = this.generateLevy(this.currentLevel);
    this.fitToRegion(points);

    const pos = this.line.geometry.getAttribute('position') as THREE.BufferAttribute;
    const drawCount = Math.min(points.length, pos.count);

    // Progressive reveal within each level
    const revealFrac = Math.min(1, this.levelTimer / (this.levelDuration * 0.5));
    const revealed = Math.max(2, Math.floor(drawCount * revealFrac));

    for (let i = 0; i < revealed; i++) {
      pos.setXYZ(i, points[i][0], points[i][1], 0);
    }
    pos.needsUpdate = true;
    this.line.geometry.setDrawRange(0, revealed);

    // Color cycling
    const hueShift = Math.sin(time * this.colorCycleSpeed) * 0.05;
    const color = new THREE.Color().copy(this.palette.primary);
    color.offsetHSL(hueShift, 0, 0);
    this.lineMat.color.copy(color);
    this.lineMat.opacity = opacity * 0.8;

    // Glow shows older portion dimmer
    const glowCount = Math.max(0, revealed - Math.floor(revealed * 0.3));
    this.glowLine.geometry.setDrawRange(0, glowCount);
    (this.glowLine.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    this.glowMat.opacity = opacity * 0.2;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      this.currentLevel = this.rng.int(4, this.maxIter);
      this.levelTimer = 0;
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level >= 2) {
      this.colorCycleSpeed = 0.2 + level * 0.1;
    }
    if (level === 0) {
      this.colorCycleSpeed = 0.2;
    }
  }
}
