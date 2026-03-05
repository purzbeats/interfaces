import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Cantor set middle-thirds removal. Animates progressive iteration levels.
 * Shows both 1D (line segments) and 2D (Cantor dust) versions.
 * LineSegments geometry.
 */
export class CantorDustElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'cantor-dust',
    meta: {
      shape: 'rectangular',
      roles: ['data-display', 'decorative'],
      moods: ['ambient', 'diagnostic'],
      bandAffinity: 'high',
      sizes: ['works-small', 'needs-medium'],
    },
  };

  private levelLines: THREE.LineSegments[] = [];
  private dustPoints!: THREE.Points;
  private maxLevel: number = 6;
  private animSpeed: number = 0.8;
  private animTime: number = 0;
  private show2D: boolean = true;
  private ox: number = 0;
  private oy: number = 0;
  private totalW: number = 0;
  private totalH: number = 0;
  private rowHeight: number = 0;

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;

    const variant = this.rng.int(0, 3);
    const presets = [
      { maxLevel: 6, animSpeed: 0.8, show2D: true },
      { maxLevel: 7, animSpeed: 0.6, show2D: false },
      { maxLevel: 5, animSpeed: 1.2, show2D: true },
      { maxLevel: 8, animSpeed: 0.5, show2D: false },
    ];
    const p = presets[variant];
    this.maxLevel = p.maxLevel;
    this.animSpeed = p.animSpeed;
    this.show2D = p.show2D;

    const padX = w * 0.06;
    const padY = h * 0.06;
    this.ox = x + padX;
    this.oy = y + padY;
    this.totalW = w - padX * 2;
    const dustSection = this.show2D ? 0.35 : 0;
    this.totalH = (h - padY * 2) * (1 - dustSection);
    this.rowHeight = this.totalH / (this.maxLevel + 1);

    // Build 1D Cantor set levels
    for (let level = 0; level <= this.maxLevel; level++) {
      const segments = this.cantorSegments(level);
      const segCount = segments.length;
      const pos = new Float32Array(segCount * 6);
      const rowY = Math.max(y, Math.min(y + h, this.oy + level * this.rowHeight));
      for (let i = 0; i < segCount; i++) {
        const [start, end] = segments[i];
        pos[i * 6] = Math.max(x, Math.min(x + w, this.ox + start * this.totalW));
        pos[i * 6 + 1] = rowY;
        pos[i * 6 + 2] = 0;
        pos[i * 6 + 3] = Math.max(x, Math.min(x + w, this.ox + end * this.totalW));
        pos[i * 6 + 4] = rowY;
        pos[i * 6 + 5] = 0;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const t = level / this.maxLevel;
      const col = new THREE.Color().copy(this.palette.dim).lerp(this.palette.primary, t);
      const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
        color: col, transparent: true, opacity: 0,
      }));
      this.group.add(lines);
      this.levelLines.push(lines);
    }

    // 2D Cantor dust (product of two Cantor sets)
    if (this.show2D) {
      const dustLevel = Math.min(this.maxLevel, 5);
      const segs1D = this.cantorSegments(dustLevel);
      const dustCount = segs1D.length * segs1D.length;
      const availH = (y + h - h * 0.06) - (this.oy + this.totalH + this.rowHeight * 0.3);
      const dustSize = Math.min(this.totalW * 0.35, availH > 0 ? availH : this.totalW * 0.35);
      const dustOx = this.ox + (this.totalW - dustSize) / 2;
      const dustOy = this.oy + this.totalH + this.rowHeight * 0.3;
      const dustPos = new Float32Array(dustCount * 3);
      let idx = 0;
      const xMin = x;
      const xMax = x + w;
      const yMin = y;
      const yMax = y + h;
      for (const [sx, ex] of segs1D) {
        const mx = (sx + ex) / 2;
        for (const [sy, ey] of segs1D) {
          const my = (sy + ey) / 2;
          const px = Math.max(xMin, Math.min(xMax, dustOx + mx * dustSize));
          const py = Math.max(yMin, Math.min(yMax, dustOy + my * dustSize));
          dustPos[idx * 3] = px;
          dustPos[idx * 3 + 1] = py;
          dustPos[idx * 3 + 2] = 1;
          idx++;
        }
      }
      const dustGeo = new THREE.BufferGeometry();
      dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
      this.dustPoints = new THREE.Points(dustGeo, new THREE.PointsMaterial({
        color: this.palette.secondary, size: 2, transparent: true, opacity: 0, sizeAttenuation: false,
      }));
      this.group.add(this.dustPoints);
    }
  }

  /** Generate Cantor set intervals at given iteration level */
  private cantorSegments(level: number): [number, number][] {
    let segments: [number, number][] = [[0, 1]];
    for (let i = 0; i < level; i++) {
      const next: [number, number][] = [];
      for (const [start, end] of segments) {
        const third = (end - start) / 3;
        next.push([start, start + third]);
        next.push([end - third, end]);
      }
      segments = next;
    }
    return segments;
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);
    this.animTime += dt * this.animSpeed;

    // Cycle through levels with smooth reveal
    const cycleLen = this.maxLevel + 3;
    const phase = this.animTime % cycleLen;

    for (let level = 0; level <= this.maxLevel; level++) {
      let levelOpacity = 0;
      if (phase > level) {
        levelOpacity = Math.min(1, phase - level);
      }
      // Fade out old levels as new ones appear
      if (phase > level + 2) {
        levelOpacity = Math.max(0.15, levelOpacity - (phase - level - 2) * 0.15);
      }
      (this.levelLines[level].material as THREE.LineBasicMaterial).opacity = opacity * levelOpacity;
    }

    // 2D dust fades in with the last level
    if (this.show2D && this.dustPoints) {
      const dustFade = Math.max(0, Math.min(1, phase - this.maxLevel + 1));
      (this.dustPoints.material as THREE.PointsMaterial).opacity = opacity * dustFade * 0.7;
    }
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      this.animTime = 0;
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) return;
    this.animSpeed = 0.8 + level * 0.3;
  }
}
