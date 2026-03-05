import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Feather barbule pattern. Central rachis with parallel barbs branching
 * at angles. Barbs have smaller barbules. Recursive branching structure
 * rendered with line geometry.
 */
export class FeatherBarbElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'feather-barb',
    meta: {
      shape: 'rectangular',
      roles: ['decorative'],
      moods: ['ambient'],
      bandAffinity: 'high',
      sizes: ['works-small', 'needs-medium'],
    } satisfies ElementMeta,
  };

  private lineMesh!: THREE.LineSegments;
  private lineMat!: THREE.LineBasicMaterial;
  private maxSegments: number = 0;

  private barbCount: number = 20;
  private barbuleCount: number = 6;
  private barbAngle: number = Math.PI / 4;
  private barbLength: number = 0.3;
  private barbuleLength: number = 0.08;
  private swayAmount: number = 3;
  private swaySpeed: number = 1.5;
  private rachisOffsets!: Float32Array; // per-barb sway phase offsets

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;

    const variant = this.rng.int(0, 3);
    const presets = [
      { barbs: 20, barbules: 6, angle: Math.PI / 4, barbLen: 0.30, barbuleLen: 0.08, sway: 3, speed: 1.5 },
      { barbs: 30, barbules: 4, angle: Math.PI / 5, barbLen: 0.25, barbuleLen: 0.06, sway: 2, speed: 2.0 },
      { barbs: 14, barbules: 8, angle: Math.PI / 3, barbLen: 0.38, barbuleLen: 0.12, sway: 5, speed: 1.0 },
      { barbs: 24, barbules: 5, angle: Math.PI / 4.5, barbLen: 0.28, barbuleLen: 0.07, sway: 4, speed: 1.8 },
    ];
    const p = presets[variant];
    this.barbCount = p.barbs;
    this.barbuleCount = p.barbules;
    this.barbAngle = p.angle;
    this.barbLength = p.barbLen;
    this.barbuleLength = p.barbuleLen;
    this.swayAmount = p.sway;
    this.swaySpeed = p.speed;

    // Phase offsets for per-barb sway
    this.rachisOffsets = new Float32Array(this.barbCount);
    for (let i = 0; i < this.barbCount; i++) {
      this.rachisOffsets[i] = this.rng.float(0, Math.PI * 2);
    }

    // Calculate max segments:
    // rachis = 1 segment
    // each barb = 1 segment (left + right = 2 barbs per level)
    // each barbule = 1 segment per barb side
    const barbsPerSide = this.barbCount;
    const totalBarbs = barbsPerSide * 2; // left + right
    const totalBarbules = totalBarbs * this.barbuleCount;
    this.maxSegments = 1 + totalBarbs + totalBarbules;

    const positions = new Float32Array(this.maxSegments * 2 * 3);
    const colors = new Float32Array(this.maxSegments * 2 * 3);
    // Fill all positions with zeros
    for (let i = 0; i < positions.length; i++) positions[i] = 0;
    for (let i = 0; i < colors.length; i++) colors[i] = 0;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setDrawRange(0, 0);

    this.lineMat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0,
    });
    this.lineMesh = new THREE.LineSegments(geo, this.lineMat);
    this.group.add(this.lineMesh);
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    const { x, y, w, h } = this.px;

    const posAttr = this.lineMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const colAttr = this.lineMesh.geometry.getAttribute('color') as THREE.BufferAttribute;

    const priR = this.palette.primary.r, priG = this.palette.primary.g, priB = this.palette.primary.b;
    const secR = this.palette.secondary.r, secG = this.palette.secondary.g, secB = this.palette.secondary.b;
    const dimR = this.palette.dim.r, dimG = this.palette.dim.g, dimB = this.palette.dim.b;

    // Rachis runs vertically from top to bottom of region
    const rachisX = x + w * 0.5;
    const rachisTop = y + h * 0.05;
    const rachisBot = y + h * 0.95;
    const rachisLen = rachisBot - rachisTop;
    const barbLenPx = rachisLen * this.barbLength;
    const barbuleLenPx = rachisLen * this.barbuleLength;

    let seg = 0;

    // Draw rachis (central shaft)
    posAttr.setXYZ(seg * 2, rachisX, rachisTop, 0);
    posAttr.setXYZ(seg * 2 + 1, rachisX, rachisBot, 0);
    colAttr.setXYZ(seg * 2, priR, priG, priB);
    colAttr.setXYZ(seg * 2 + 1, priR, priG, priB);
    seg++;

    // Draw barbs on both sides
    const barbSpacing = rachisLen / (this.barbCount + 1);

    for (let i = 0; i < this.barbCount; i++) {
      const t = (i + 1) / (this.barbCount + 1);
      const baseY = rachisTop + t * rachisLen;

      // Sway offset for this barb
      const sway = Math.sin(time * this.swaySpeed + this.rachisOffsets[i]) * this.swayAmount;

      // Barb length tapers toward tip and base
      const taper = 1 - Math.abs(t - 0.5) * 1.6;
      const curBarbLen = barbLenPx * Math.max(0.2, taper);

      for (let side = -1; side <= 1; side += 2) {
        // Barb extends at angle from rachis
        const bx = rachisX + sway * 0.3;
        const endX = bx + Math.cos(side > 0 ? -this.barbAngle : Math.PI + this.barbAngle) * curBarbLen + sway;
        const endY = baseY + Math.sin(side > 0 ? -this.barbAngle : Math.PI + this.barbAngle) * curBarbLen * 0.3;

        if (seg < this.maxSegments) {
          posAttr.setXYZ(seg * 2, bx, baseY, 0);
          posAttr.setXYZ(seg * 2 + 1, endX, endY, 0);
          colAttr.setXYZ(seg * 2, secR, secG, secB);
          colAttr.setXYZ(seg * 2 + 1, secR * 0.6, secG * 0.6, secB * 0.6);
          seg++;
        }

        // Draw barbules along each barb
        for (let b = 0; b < this.barbuleCount; b++) {
          if (seg >= this.maxSegments) break;
          const bt = (b + 1) / (this.barbuleCount + 1);
          const bbx = bx + (endX - bx) * bt;
          const bby = baseY + (endY - baseY) * bt;

          // Barbules branch at steeper angle from the barb
          const bbAngle = side > 0 ? -this.barbAngle * 0.8 : Math.PI + this.barbAngle * 0.8;
          const bbEndX = bbx + Math.cos(bbAngle) * barbuleLenPx + sway * 0.15;
          const bbEndY = bby + Math.sin(bbAngle) * barbuleLenPx * 0.5;

          posAttr.setXYZ(seg * 2, bbx, bby, 0);
          posAttr.setXYZ(seg * 2 + 1, bbEndX, bbEndY, 0);
          colAttr.setXYZ(seg * 2, dimR, dimG, dimB);
          colAttr.setXYZ(seg * 2 + 1, dimR * 0.5, dimG * 0.5, dimB * 0.5);
          seg++;
        }
      }
    }

    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
    this.lineMesh.geometry.setDrawRange(0, seg * 2);
    this.lineMat.opacity = opacity;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Ruffle: increase sway temporarily
      this.swayAmount *= 3;
      setTimeout(() => { this.swayAmount /= 3; }, 400);
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) {
      this.swaySpeed = 1.5;
      return;
    }
    this.swaySpeed = 1.5 + level * 0.5;
  }
}
