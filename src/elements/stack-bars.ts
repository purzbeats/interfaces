import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Horizontal stacked bar segments arranged in multiple rows.
 * Each row has segments with varying widths that shift and pulse over time,
 * like a segmented loading bar or data allocation display.
 */
export class StackBarsElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'stack-bars',
    meta: { shape: 'rectangular', roles: ['gauge', 'data-display'], moods: ['diagnostic', 'tactical'], bandAffinity: 'mid', sizes: ['works-small', 'needs-medium'] },
  };

  private rows: Array<{
    segments: THREE.Mesh[];
    gaps: THREE.Mesh[];
    segmentWidths: number[];
    targetWidths: number[];
    scrollOffset: number;
    scrollSpeed: number;
    y: number;
    h: number;
  }> = [];
  private borderLines!: THREE.LineSegments;
  private rowCount: number = 0;
  private segmentsPerRow: number = 0;
  private updateTimer: number = 0;
  private updateInterval: number = 0;
  private hasGapSeparators: boolean = false;
  private gapLines: THREE.LineSegments[] = [];

  build(): void {
    const variant = this.rng.int(0, 3);
    const presets = [
      { rowCount: 2, segCount: 8, gapSeparators: false, scrollSpeed: [0.05, 0.15] as const, updateInt: [0.8, 1.5] as const },
      { rowCount: 4, segCount: 6, gapSeparators: false, scrollSpeed: [0.03, 0.1] as const, updateInt: [0.5, 1.0] as const },
      { rowCount: 8, segCount: 5, gapSeparators: false, scrollSpeed: [0.02, 0.08] as const, updateInt: [0.3, 0.7] as const },
      { rowCount: 4, segCount: 7, gapSeparators: true, scrollSpeed: [0.04, 0.12] as const, updateInt: [0.6, 1.2] as const },
    ];
    const p = presets[variant];

    this.glitchAmount = 4;
    this.rowCount = p.rowCount;
    this.segmentsPerRow = p.segCount;
    this.hasGapSeparators = p.gapSeparators;
    this.updateInterval = this.rng.float(p.updateInt[0], p.updateInt[1]);

    const { x, y, w, h } = this.px;
    const clipPlanes = [
      new THREE.Plane(new THREE.Vector3(1, 0, 0), -x),
      new THREE.Plane(new THREE.Vector3(-1, 0, 0), x + w),
      new THREE.Plane(new THREE.Vector3(0, 1, 0), -y),
      new THREE.Plane(new THREE.Vector3(0, -1, 0), y + h),
    ];
    const gapBetweenRows = p.gapSeparators ? h * 0.04 : h * 0.02;
    const separatorH = p.gapSeparators ? h * 0.015 : 0;
    const totalGapSpace = gapBetweenRows * (this.rowCount - 1) + separatorH * (this.rowCount - 1);
    const rowH = (h - totalGapSpace) / this.rowCount;
    const segGap = w * 0.012;

    for (let ri = 0; ri < this.rowCount; ri++) {
      const rowY = y + ri * (rowH + gapBetweenRows + separatorH);
      const segments: THREE.Mesh[] = [];
      const gaps: THREE.Mesh[] = [];
      const segmentWidths: number[] = [];
      const targetWidths: number[] = [];

      // Generate random initial segment widths that sum to ~1 (minus gaps)
      const usableW = w - segGap * (this.segmentsPerRow + 1);
      let remainingW = usableW;
      for (let si = 0; si < this.segmentsPerRow; si++) {
        const fraction = si === this.segmentsPerRow - 1
          ? remainingW
          : this.rng.float(0.05, remainingW / (this.segmentsPerRow - si) * 2);
        const segW = Math.max(w * 0.02, Math.min(fraction, w * 0.5));
        segmentWidths.push(segW);
        targetWidths.push(segW);
        remainingW -= segW;
        if (remainingW < w * 0.02) {
          // Fill rest with minimum widths
          for (let j = si + 1; j < this.segmentsPerRow; j++) {
            segmentWidths.push(w * 0.02);
            targetWidths.push(w * 0.02);
          }
          break;
        }
      }
      // Pad if needed
      while (segmentWidths.length < this.segmentsPerRow) {
        segmentWidths.push(w * 0.02);
        targetWidths.push(w * 0.02);
      }

      // Determine color for this row
      const rowFraction = ri / Math.max(this.rowCount - 1, 1);
      const useSecondary = rowFraction > 0.7 && this.rng.chance(0.4);
      const useDim = this.rng.chance(0.2);
      const baseColor = useDim ? this.palette.dim : (useSecondary ? this.palette.secondary : this.palette.primary);

      // Build segment meshes
      let curX = x + segGap;
      for (let si = 0; si < this.segmentsPerRow; si++) {
        const segW = segmentWidths[si];
        const geo = new THREE.PlaneGeometry(1, rowH);
        const mat = new THREE.MeshBasicMaterial({
          color: new THREE.Color().copy(baseColor),
          transparent: true,
          opacity: 0,
          clippingPlanes: clipPlanes,
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(curX + segW / 2, rowY + rowH / 2, 1);
        segments.push(mesh);
        this.group.add(mesh);
        curX += segW + segGap;

        // Gap filler mesh (thin dark strip between segments)
        const gapGeo = new THREE.PlaneGeometry(segGap, rowH);
        const gapMat = new THREE.MeshBasicMaterial({
          color: this.palette.bg,
          transparent: true,
          opacity: 0,
          clippingPlanes: clipPlanes,
        });
        const gapMesh = new THREE.Mesh(gapGeo, gapMat);
        gapMesh.position.set(curX - segGap / 2, rowY + rowH / 2, 1.5);
        gaps.push(gapMesh);
        this.group.add(gapMesh);
      }

      // Separator line below each row (except last) for gap variant
      if (p.gapSeparators && ri < this.rowCount - 1) {
        const sepY = rowY + rowH + gapBetweenRows / 2;
        const sv = new Float32Array([x, sepY, 0, x + w, sepY, 0]);
        const sg = new THREE.BufferGeometry();
        sg.setAttribute('position', new THREE.BufferAttribute(sv, 3));
        const sepLine = new THREE.LineSegments(sg, new THREE.LineBasicMaterial({
          color: this.palette.dim,
          transparent: true,
          opacity: 0,
          clippingPlanes: clipPlanes,
        }));
        this.gapLines.push(sepLine);
        this.group.add(sepLine);
      }

      this.rows.push({
        segments,
        gaps,
        segmentWidths,
        targetWidths,
        scrollOffset: 0,
        scrollSpeed: this.rng.float(p.scrollSpeed[0], p.scrollSpeed[1]) * (this.rng.chance(0.5) ? 1 : -1),
        y: rowY,
        h: rowH,
      });
    }

    // Border
    const bv = new Float32Array([
      x, y, 0, x + w, y, 0,
      x + w, y, 0, x + w, y + h, 0,
      x + w, y + h, 0, x, y + h, 0,
      x, y + h, 0, x, y, 0,
    ]);
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.BufferAttribute(bv, 3));
    this.borderLines = new THREE.LineSegments(bg, new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
      clippingPlanes: clipPlanes,
    }));
    this.group.add(this.borderLines);
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    const { x, w } = this.px;
    const segGap = w * 0.012;

    // Periodically retarget segment widths
    this.updateTimer += dt;
    if (this.updateTimer >= this.updateInterval) {
      this.updateTimer = 0;
      for (const row of this.rows) {
        const usableW = w - segGap * (this.segmentsPerRow + 1);
        let rem = usableW;
        for (let si = 0; si < this.segmentsPerRow; si++) {
          const isLast = si === this.segmentsPerRow - 1;
          const target = isLast
            ? Math.max(w * 0.02, rem)
            : this.rng.float(w * 0.02, rem * 0.7);
          row.targetWidths[si] = Math.max(w * 0.015, Math.min(target, rem - w * 0.02 * (this.segmentsPerRow - si - 1)));
          rem -= row.targetWidths[si];
          if (rem < w * 0.015) break;
        }
      }
    }

    for (let ri = 0; ri < this.rowCount; ri++) {
      const row = this.rows[ri];

      // Animate scrolling offset
      row.scrollOffset += row.scrollSpeed * dt;

      // Smoothly interpolate segment widths toward targets
      let curX = x + segGap;
      for (let si = 0; si < this.segmentsPerRow; si++) {
        row.segmentWidths[si] += (row.targetWidths[si] - row.segmentWidths[si]) * dt * 2.5;
        const segW = row.segmentWidths[si];

        // Scroll-based brightness modulation
        const scrollPhase = (si / this.segmentsPerRow + row.scrollOffset) % 1;
        const scrollBrightness = 0.5 + 0.5 * Math.sin(scrollPhase * Math.PI * 2);
        const timePulse = 0.85 + 0.15 * Math.sin(time * 1.5 + ri * 0.7 + si * 0.3);
        const brightness = scrollBrightness * timePulse;

        // Resize and reposition segment
        const mesh = row.segments[si];
        mesh.scale.x = segW;
        mesh.position.x = curX + segW / 2;

        const mat = mesh.material as THREE.MeshBasicMaterial;
        mat.opacity = opacity * (0.2 + brightness * 0.35);
        curX += segW + segGap;

        // Gap strip
        if (row.gaps[si]) {
          const gapMesh = row.gaps[si];
          gapMesh.position.x = curX - segGap / 2;
          (gapMesh.material as THREE.MeshBasicMaterial).opacity = opacity * 0.35;
        }
      }
    }

    // Separator lines
    for (const line of this.gapLines) {
      (line.material as THREE.LineBasicMaterial).opacity = opacity * 0.25;
    }

    (this.borderLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.3;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'pulse') {
      // Burst — snap all segments to full width briefly
      for (const row of this.rows) {
        for (let si = 0; si < this.segmentsPerRow; si++) {
          row.targetWidths[si] = this.px.w / this.segmentsPerRow * 0.9;
        }
      }
    }
    if (action === 'glitch') {
      // Scramble widths randomly
      for (const row of this.rows) {
        for (let si = 0; si < this.segmentsPerRow; si++) {
          row.targetWidths[si] = this.rng.float(this.px.w * 0.01, this.px.w * 0.3);
        }
        row.scrollSpeed = this.rng.float(0.05, 0.3) * (this.rng.chance(0.5) ? 1 : -1);
      }
    }
    if (action === 'alert') {
      // All rows flash to max fill with alert color
      for (const row of this.rows) {
        for (const seg of row.segments) {
          (seg.material as THREE.MeshBasicMaterial).color.copy(this.palette.alert);
        }
        for (let si = 0; si < this.segmentsPerRow; si++) {
          row.targetWidths[si] = this.px.w / (this.segmentsPerRow + 1) * 0.85;
        }
      }
      setTimeout(() => {
        for (let ri = 0; ri < this.rowCount; ri++) {
          const rowFraction = ri / Math.max(this.rowCount - 1, 1);
          const color = rowFraction > 0.7 ? this.palette.secondary : this.palette.primary;
          for (const seg of this.rows[ri].segments) {
            (seg.material as THREE.MeshBasicMaterial).color.copy(color);
          }
        }
      }, 2500);
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) return;
    const boost = level * 0.12;
    for (const row of this.rows) {
      for (let si = 0; si < this.segmentsPerRow; si++) {
        row.targetWidths[si] = Math.min(
          this.px.w * 0.4,
          row.targetWidths[si] * (1 + boost)
        );
      }
      row.scrollSpeed *= 1 + level * 0.1;
    }
  }
}
