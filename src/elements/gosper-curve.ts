import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Gosper flowsnake curve — a hexagonal space-filling fractal
 * generated via L-system:
 *   A -> A-B--B+A++AA+B-
 *   B -> +A-BB--B-A++A+B
 * Animates through iteration levels, drawing the curve as line geometry.
 */
export class GosperCurveElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'gosper-curve',
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
  private trailLine!: THREE.Line;
  private trailMat!: THREE.LineBasicMaterial;
  private maxIter = 4;
  private currentLevel = 1;
  private levelTimer = 0;
  private levelDuration = 3.5;
  private ascending = true;
  private rotOffset = 0;
  private rotSpeed = 0.1;

  build(): void {
    this.glitchAmount = 4;
    const variant = this.rng.int(0, 4);
    const presets = [
      { maxIter: 4, levelDuration: 3.5, rotSpeed: 0.08 },
      { maxIter: 5, levelDuration: 4.5, rotSpeed: 0.05 },
      { maxIter: 3, levelDuration: 2.5, rotSpeed: 0.15 },
      { maxIter: 4, levelDuration: 3.0, rotSpeed: 0.12 },
    ];
    const p = presets[variant];
    this.maxIter = p.maxIter;
    this.levelDuration = p.levelDuration;
    this.rotSpeed = p.rotSpeed;

    // Allocate for max iteration (7^maxIter + 1 points)
    const capPoints = Math.min(Math.pow(7, this.maxIter) + 1, 60000);
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

    // Trail (dimmer copy)
    const trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    trailGeo.setDrawRange(0, 0);
    this.trailMat = new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    });
    this.trailLine = new THREE.Line(trailGeo, this.trailMat);
    this.group.add(this.trailLine);
  }

  /** Generate L-system string for Gosper curve */
  private lSystem(iterations: number): string {
    let str = 'A';
    for (let i = 0; i < iterations; i++) {
      let next = '';
      for (const ch of str) {
        if (ch === 'A') next += 'A-B--B+A++AA+B-';
        else if (ch === 'B') next += '+A-BB--B-A++A+B';
        else next += ch;
      }
      str = next;
      // Safety cap
      if (str.length > 500000) break;
    }
    return str;
  }

  /** Convert L-system string to points */
  private lSystemToPoints(str: string): number[][] {
    const points: number[][] = [];
    let px = 0, py = 0;
    let angle = 0;
    const step = 1;
    const turnAngle = Math.PI / 3; // 60 degrees

    points.push([px, py]);
    for (const ch of str) {
      if (ch === 'A' || ch === 'B') {
        px += step * Math.cos(angle);
        py += step * Math.sin(angle);
        points.push([px, py]);
      } else if (ch === '+') {
        angle += turnAngle;
      } else if (ch === '-') {
        angle -= turnAngle;
      }
    }
    return points;
  }

  /** Normalize points to fit within region */
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
    const margin = 6;
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
    this.rotOffset = time * this.rotSpeed;

    this.levelTimer += dt;
    if (this.levelTimer >= this.levelDuration) {
      this.levelTimer = 0;
      if (this.ascending) {
        this.currentLevel++;
        if (this.currentLevel >= this.maxIter) this.ascending = false;
      } else {
        this.currentLevel--;
        if (this.currentLevel <= 1) this.ascending = true;
      }
    }

    const str = this.lSystem(this.currentLevel);
    const points = this.lSystemToPoints(str);
    this.fitToRegion(points);

    const pos = this.line.geometry.getAttribute('position') as THREE.BufferAttribute;
    const maxDraw = Math.min(points.length, pos.count);

    // Progressive reveal
    const revealFrac = Math.min(1, this.levelTimer / (this.levelDuration * 0.6));
    const drawCount = Math.max(2, Math.floor(maxDraw * revealFrac));
    const recentStart = Math.max(0, drawCount - Math.floor(drawCount * 0.4));

    for (let i = 0; i < drawCount; i++) {
      pos.setXYZ(i, points[i][0], points[i][1], 0);
    }
    pos.needsUpdate = true;

    this.line.geometry.setDrawRange(recentStart, drawCount - recentStart);
    this.lineMat.opacity = opacity * 0.8;

    this.trailLine.geometry.setDrawRange(0, recentStart);
    (this.trailLine.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    this.trailMat.opacity = opacity * 0.25;
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
      this.rotSpeed = 0.1 + level * 0.04;
    }
    if (level === 0) {
      this.rotSpeed = 0.08;
    }
  }
}
