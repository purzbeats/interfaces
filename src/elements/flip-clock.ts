import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Mechanical flip-clock with 2-4 digit panels.
 * Each digit uses 7-segment horizontal line segments.
 * Digits increment over time; a brief scale-y squeeze simulates the flip.
 */
export class FlipClockElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'flip-clock',
    meta: {
      shape: 'rectangular',
      roles: ['data-display'],
      moods: ['diagnostic'],
      sizes: ['works-small', 'needs-medium'],
    },
  };

  // 7-segment truth table: [top, topRight, botRight, bot, botLeft, topLeft, mid]
  private static readonly SEG_MAP: boolean[][] = [
    [true,  true,  true,  true,  true,  true,  false], // 0
    [false, true,  true,  false, false, false, false], // 1
    [true,  true,  false, true,  true,  false, true],  // 2
    [true,  true,  true,  true,  false, false, true],  // 3
    [false, true,  true,  false, false, true,  true],  // 4
    [true,  false, true,  true,  false, true,  true],  // 5
    [true,  false, true,  true,  true,  true,  true],  // 6
    [true,  true,  true,  false, false, false, false], // 7
    [true,  true,  true,  true,  true,  true,  true],  // 8
    [true,  true,  true,  true,  false, true,  true],  // 9
  ];

  private digitCount = 3;
  private panelMeshes: THREE.Mesh[] = [];
  private panelBorders: THREE.LineSegments[] = [];
  private digitLines: THREE.LineSegments[] = [];
  private currentDigits: number[] = [];
  private flipTimers: number[] = [];
  private counter = 0;
  private tickInterval = 1.0;
  private tickTimer = 0;

  build(): void {
    const { x, y, w, h } = this.px;

    this.digitCount = w > 120 ? 4 : w > 70 ? 3 : 2;
    this.tickInterval = this.rng.float(0.6, 2.0);

    const padding = w * 0.06;
    const gap = w * 0.04;
    const totalGaps = gap * (this.digitCount - 1);
    const panelW = (w - padding * 2 - totalGaps) / this.digitCount;
    const panelH = h * 0.75;
    const panelY = y + (h - panelH) * 0.5;

    this.counter = this.rng.int(0, Math.pow(10, this.digitCount) - 1);
    this.currentDigits = this.extractDigits(this.counter);
    this.flipTimers = new Array(this.digitCount).fill(0);

    for (let d = 0; d < this.digitCount; d++) {
      const px = x + padding + d * (panelW + gap);

      // Panel background
      const bgGeo = new THREE.PlaneGeometry(panelW, panelH);
      const bgMat = new THREE.MeshBasicMaterial({
        color: this.palette.dim,
        transparent: true,
        opacity: 0,
      });
      const bgMesh = new THREE.Mesh(bgGeo, bgMat);
      bgMesh.position.set(px + panelW / 2, panelY + panelH / 2, 0);
      this.panelMeshes.push(bgMesh);
      this.group.add(bgMesh);

      // Panel border
      const bv = new Float32Array([
        px, panelY, 1,  px + panelW, panelY, 1,
        px + panelW, panelY, 1,  px + panelW, panelY + panelH, 1,
        px + panelW, panelY + panelH, 1,  px, panelY + panelH, 1,
        px, panelY + panelH, 1,  px, panelY, 1,
      ]);
      const borderGeo = new THREE.BufferGeometry();
      borderGeo.setAttribute('position', new THREE.BufferAttribute(bv, 3));
      const borderLine = new THREE.LineSegments(borderGeo, new THREE.LineBasicMaterial({
        color: this.palette.dim,
        transparent: true,
        opacity: 0,
      }));
      this.panelBorders.push(borderLine);
      this.group.add(borderLine);

      // 7-segment digit lines
      const segLines = this.buildSegmentLines(px, panelY, panelW, panelH);
      this.digitLines.push(segLines);
      this.group.add(segLines);
    }
  }

  private buildSegmentLines(dx: number, dy: number, dw: number, dh: number): THREE.LineSegments {
    const inset = dw * 0.18;
    const halfH = dh / 2;
    // 7 segments x 2 verts x 3 coords = 42 floats
    const verts = new Float32Array(42);
    // 0: top horizontal
    verts.set([dx + inset, dy + dh - inset, 2, dx + dw - inset, dy + dh - inset, 2], 0);
    // 1: top-right vertical
    verts.set([dx + dw - inset, dy + halfH + inset * 0.5, 2, dx + dw - inset, dy + dh - inset, 2], 6);
    // 2: bottom-right vertical
    verts.set([dx + dw - inset, dy + inset, 2, dx + dw - inset, dy + halfH - inset * 0.5, 2], 12);
    // 3: bottom horizontal
    verts.set([dx + inset, dy + inset, 2, dx + dw - inset, dy + inset, 2], 18);
    // 4: bottom-left vertical
    verts.set([dx + inset, dy + inset, 2, dx + inset, dy + halfH - inset * 0.5, 2], 24);
    // 5: top-left vertical
    verts.set([dx + inset, dy + halfH + inset * 0.5, 2, dx + inset, dy + dh - inset, 2], 30);
    // 6: middle horizontal
    verts.set([dx + inset, dy + halfH, 2, dx + dw - inset, dy + halfH, 2], 36);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    return new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
    }));
  }

  private extractDigits(value: number): number[] {
    const clamped = Math.abs(Math.floor(value)) % Math.pow(10, this.digitCount);
    return String(clamped).padStart(this.digitCount, '0').split('').map(Number);
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);

    // Tick counter
    this.tickTimer += dt;
    if (this.tickTimer >= this.tickInterval) {
      this.tickTimer -= this.tickInterval;
      const oldDigits = this.currentDigits.slice();
      this.counter = (this.counter + 1) % Math.pow(10, this.digitCount);
      this.currentDigits = this.extractDigits(this.counter);
      for (let d = 0; d < this.digitCount; d++) {
        if (oldDigits[d] !== this.currentDigits[d]) {
          this.flipTimers[d] = 0.25;
        }
      }
    }

    const { x, y, w, h } = this.px;
    const padding = w * 0.06;
    const gap = w * 0.04;
    const totalGaps = gap * (this.digitCount - 1);
    const panelW = (w - padding * 2 - totalGaps) / this.digitCount;
    const panelH = h * 0.75;
    const panelY = y + (h - panelH) * 0.5;

    for (let d = 0; d < this.digitCount; d++) {
      // Flip squeeze
      if (this.flipTimers[d] > 0) {
        this.flipTimers[d] -= dt;
      }
      const flipProgress = Math.max(0, this.flipTimers[d]) / 0.25;
      const scaleY = 1.0 - 0.3 * Math.sin(flipProgress * Math.PI);

      const px = x + padding + d * (panelW + gap);
      const centerX = px + panelW / 2;
      const centerY = panelY + panelH / 2;

      // Apply scale to panel mesh
      const mesh = this.panelMeshes[d];
      mesh.scale.set(1, scaleY, 1);
      mesh.position.set(centerX, centerY, 0);
      (mesh.material as THREE.MeshBasicMaterial).opacity = opacity * 0.15;

      // Apply scale to border
      this.panelBorders[d].scale.set(1, scaleY, 1);
      // Pivot around center
      this.panelBorders[d].position.set(0, centerY * (1 - scaleY), 0);
      (this.panelBorders[d].material as THREE.LineBasicMaterial).opacity = opacity * 0.4;

      // Apply scale to digit lines
      this.digitLines[d].scale.set(1, scaleY, 1);
      this.digitLines[d].position.set(0, centerY * (1 - scaleY), 0);

      // Update segment visibility
      const digit = this.currentDigits[d];
      const map = FlipClockElement.SEG_MAP[digit];
      const posAttr = this.digitLines[d].geometry.getAttribute('position') as THREE.BufferAttribute;
      const inset = panelW * 0.18;
      const halfH = panelH / 2;

      // Rebuild segments: visible ones get proper coords, hidden ones collapse
      const segs: [number, number, number, number][] = [
        [px + inset, panelY + panelH - inset, px + panelW - inset, panelY + panelH - inset],
        [px + panelW - inset, panelY + halfH + inset * 0.5, px + panelW - inset, panelY + panelH - inset],
        [px + panelW - inset, panelY + inset, px + panelW - inset, panelY + halfH - inset * 0.5],
        [px + inset, panelY + inset, px + panelW - inset, panelY + inset],
        [px + inset, panelY + inset, px + inset, panelY + halfH - inset * 0.5],
        [px + inset, panelY + halfH + inset * 0.5, px + inset, panelY + panelH - inset],
        [px + inset, panelY + halfH, px + panelW - inset, panelY + halfH],
      ];

      for (let s = 0; s < 7; s++) {
        if (map[s]) {
          posAttr.setXY(s * 2, segs[s][0], segs[s][1]);
          posAttr.setXY(s * 2 + 1, segs[s][2], segs[s][3]);
        } else {
          posAttr.setXY(s * 2, segs[s][0], segs[s][1]);
          posAttr.setXY(s * 2 + 1, segs[s][0], segs[s][1]);
        }
      }
      posAttr.needsUpdate = true;

      (this.digitLines[d].material as THREE.LineBasicMaterial).opacity = opacity * 0.85;
    }
  }
}
