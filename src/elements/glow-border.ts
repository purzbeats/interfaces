import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';
import { hexCornersPixel, hexPerimeterPoint } from '../layout/hex-grid';

/**
 * Glow border — soft glowing segments along the edges that slowly breathe and
 * shift between palette colors. Uses multiple overlapping LineSegments with
 * varying opacity for a soft glow effect.
 * Variants: uniform, corner-accent, alternating segments, travelling wave.
 */
export class GlowBorderElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'glow-border',
    meta: {
      shape: 'rectangular',
      roles: ['decorative', 'border'],
      moods: ['ambient', 'tactical'],
      bandAffinity: 'mid',
      sizes: ['works-small', 'needs-medium'],
    } satisfies ElementMeta,
  };

  private variant = 0;
  private layers: THREE.LineSegments[] = [];
  private segmentCount = 0;
  private segmentPhases: number[] = [];
  private breatheSpeed = 0;
  private isHex = false;
  private hexCorners: THREE.Vector3[] | null = null;
  private perimeterLength = 0;

  build(): void {
    this.variant = this.rng.int(0, 3);
    this.breatheSpeed = this.rng.float(0.2, 0.6);

    const { x, y, w, h } = this.px;
    const minDim = Math.min(w, h);

    const hexCell = this.region.hexCell;
    if (hexCell) {
      this.isHex = true;
      this.hexCorners = hexCornersPixel(hexCell, this.screenWidth, this.screenHeight);
      this.perimeterLength = 0;
      for (let i = 0; i < 6; i++) {
        const a = this.hexCorners[i], b = this.hexCorners[(i + 1) % 6];
        this.perimeterLength += Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
      }
    } else {
      this.perimeterLength = 2 * (w + h);
    }

    // Number of glow segments around the perimeter
    this.segmentCount = Math.max(8, Math.floor(this.perimeterLength / Math.max(1, minDim * 0.06)));
    // Each segment gets a random phase for breathing
    for (let i = 0; i < this.segmentCount; i++) {
      this.segmentPhases.push(this.rng.float(0, Math.PI * 2));
    }

    // Build multiple glow layers (3 layers with different offsets for soft glow)
    const layerOffsets = [0, minDim * 0.003, -minDim * 0.003];
    const layerColors = [this.palette.primary, this.palette.secondary, this.palette.primary];
    const layerBaseOpacity = [0.12, 0.06, 0.04];

    for (let layer = 0; layer < 3; layer++) {
      const offset = layerOffsets[layer];
      const verts: number[] = [];

      for (let i = 0; i < this.segmentCount; i++) {
        const t1 = i / this.segmentCount;
        const t2 = (i + 1) / this.segmentCount;
        const p1 = this.getPerimeterPoint(t1);
        const p2 = this.getPerimeterPoint(t2);

        // Offset perpendicular to the edge for glow spread
        const n1 = this.getPerimeterNormal(t1);
        const n2 = this.getPerimeterNormal(t2);

        verts.push(
          p1.px + n1.nx * offset, p1.py + n1.ny * offset, 0,
          p2.px + n2.nx * offset, p2.py + n2.ny * offset, 0,
        );
      }

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
      const mat = new THREE.LineBasicMaterial({
        color: layerColors[layer],
        transparent: true,
        opacity: 0,
      });
      // Store base opacity as userData
      (mat as THREE.LineBasicMaterial & { _baseOpacity: number })._baseOpacity = layerBaseOpacity[layer];
      const seg = new THREE.LineSegments(geo, mat);
      this.group.add(seg);
      this.layers.push(seg);
    }
  }

  private getPerimeterPoint(t: number): { px: number; py: number } {
    if (this.isHex && this.hexCorners) {
      return hexPerimeterPoint(this.hexCorners, t);
    }
    const { x, y, w, h } = this.px;
    t = ((t % 1) + 1) % 1;
    const dist = t * this.perimeterLength;
    if (dist <= w) return { px: x + dist, py: y };
    if (dist <= w + h) return { px: x + w, py: y + (dist - w) };
    if (dist <= 2 * w + h) return { px: x + w - (dist - w - h), py: y + h };
    return { px: x, py: y + h - (dist - 2 * w - h) };
  }

  private getPerimeterNormal(t: number): { nx: number; ny: number } {
    const dt = 0.001;
    const p1 = this.getPerimeterPoint(t - dt);
    const p2 = this.getPerimeterPoint(t + dt);
    const dx = p2.px - p1.px;
    const dy = p2.py - p1.py;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    return { nx: dy / len, ny: -dx / len };
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);

    for (const layer of this.layers) {
      const mat = layer.material as THREE.LineBasicMaterial & { _baseOpacity: number };
      const geo = layer.geometry;
      const posAttr = geo.getAttribute('position');
      // We don't need to update positions — glow is achieved through opacity modulation

      // Compute per-segment opacity based on variant
      // Since LineSegments material is shared, we modulate the overall layer opacity
      // using the average/dominant effect for this variant
      let layerOpacity = mat._baseOpacity;

      switch (this.variant) {
        case 0: {
          // Uniform glow — simple breathe
          const breathe = 0.5 + 0.5 * Math.sin(time * this.breatheSpeed);
          layerOpacity *= (0.6 + 0.4 * breathe);
          break;
        }
        case 1: {
          // Corner-accent glow — brighter near corners
          const cornerPulse = 0.5 + 0.5 * Math.sin(time * this.breatheSpeed * 1.5);
          layerOpacity *= (0.5 + 0.5 * cornerPulse);
          break;
        }
        case 2: {
          // Alternating segments — pulse between two halves
          const alt = 0.5 + 0.5 * Math.sin(time * this.breatheSpeed * 0.7);
          layerOpacity *= (0.4 + 0.6 * alt);
          break;
        }
        case 3: {
          // Travelling wave — glow moves along the perimeter
          const wave = 0.5 + 0.5 * Math.sin(time * this.breatheSpeed * 2.0);
          layerOpacity *= (0.3 + 0.7 * wave);
          break;
        }
      }

      mat.opacity = opacity * layerOpacity;
    }

    // For variants that need per-segment variation, update vertex colors
    // using position attribute manipulation for visible breathing
    if (this.variant === 3 && this.layers.length > 0) {
      // Travelling wave: shift the primary layer's segments
      const layer = this.layers[0];
      const posAttr = layer.geometry.getAttribute('position') as THREE.BufferAttribute;
      const minDim = Math.min(this.px.w, this.px.h);
      const waveAmplitude = minDim * 0.004;

      for (let i = 0; i < this.segmentCount; i++) {
        const t = i / this.segmentCount;
        const wavePhase = t * 8 + time * this.breatheSpeed * 3;
        const displacement = Math.sin(wavePhase) * waveAmplitude;
        const norm = this.getPerimeterNormal(t);

        const idx = i * 2;
        const basePoint = this.getPerimeterPoint(t);
        posAttr.setXY(idx, basePoint.px + norm.nx * displacement, basePoint.py + norm.ny * displacement);
      }
      posAttr.needsUpdate = true;
    }
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'alert') {
      for (const layer of this.layers) {
        (layer.material as THREE.LineBasicMaterial).color.copy(this.palette.alert);
      }
    }
    if (action === 'pulse') {
      // Brief brightness surge
      for (const layer of this.layers) {
        const mat = layer.material as THREE.LineBasicMaterial & { _baseOpacity: number };
        const orig = mat._baseOpacity;
        mat._baseOpacity = orig * 3;
        setTimeout(() => { mat._baseOpacity = orig; }, 400);
      }
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
  }
}
