import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Dual countdown timer -- two side-by-side panels with bar fills.
 * One side counts down while the other pauses; they swap periodically.
 * Active side uses primary color, inactive uses dim.
 */
export class ChessClockElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'chess-clock',
    meta: {
      shape: 'rectangular',
      roles: ['data-display'],
      moods: ['tactical'],
      sizes: ['needs-medium'],
    },
  };

  private leftBar!: THREE.Mesh;
  private rightBar!: THREE.Mesh;
  private leftBorder!: THREE.LineSegments;
  private rightBorder!: THREE.LineSegments;
  private indicator!: THREE.Mesh;
  private dividerLine!: THREE.LineSegments;

  private leftFill = 1.0;
  private rightFill = 1.0;
  private activeSide: 0 | 1 = 0; // 0 = left, 1 = right
  private drainRate = 0.08;
  private swapInterval = 3.0;
  private swapTimer = 0;
  private maxBarW = 0;
  private panelH = 0;
  private leftX = 0;
  private rightX = 0;
  private panelY = 0;

  build(): void {
    const { x, y, w, h } = this.px;

    const padding = w * 0.06;
    const centerGap = w * 0.06;
    const panelW = (w - padding * 2 - centerGap) / 2;
    this.panelH = h * 0.6;
    const barH = this.panelH * 0.5;
    this.panelY = y + (h - this.panelH) * 0.5;
    this.leftX = x + padding;
    this.rightX = x + padding + panelW + centerGap;
    this.maxBarW = panelW * 0.9;

    this.drainRate = this.rng.float(0.05, 0.15);
    this.swapInterval = this.rng.float(2.0, 5.0);

    const barInset = panelW * 0.05;
    const barY = this.panelY + (this.panelH - barH) * 0.5;

    // Left fill bar
    const lGeo = new THREE.PlaneGeometry(1, barH);
    const lMat = new THREE.MeshBasicMaterial({ color: this.palette.primary, transparent: true, opacity: 0 });
    this.leftBar = new THREE.Mesh(lGeo, lMat);
    this.leftBar.position.set(this.leftX + barInset + this.maxBarW / 2, barY + barH / 2, 1);
    this.group.add(this.leftBar);

    // Right fill bar
    const rGeo = new THREE.PlaneGeometry(1, barH);
    const rMat = new THREE.MeshBasicMaterial({ color: this.palette.dim, transparent: true, opacity: 0 });
    this.rightBar = new THREE.Mesh(rGeo, rMat);
    this.rightBar.position.set(this.rightX + barInset + this.maxBarW / 2, barY + barH / 2, 1);
    this.group.add(this.rightBar);

    // Borders for both panels
    this.leftBorder = this.makeBorder(this.leftX, this.panelY, panelW, this.panelH);
    this.group.add(this.leftBorder);
    this.rightBorder = this.makeBorder(this.rightX, this.panelY, panelW, this.panelH);
    this.group.add(this.rightBorder);

    // Divider line between the two panels
    const divX = x + padding + panelW + centerGap / 2;
    const dv = new Float32Array([
      divX, this.panelY, 1,
      divX, this.panelY + this.panelH, 1,
    ]);
    const divGeo = new THREE.BufferGeometry();
    divGeo.setAttribute('position', new THREE.BufferAttribute(dv, 3));
    this.dividerLine = new THREE.LineSegments(divGeo, new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.dividerLine);

    // Indicator dot between panels
    const dotSize = Math.min(centerGap * 0.3, 4);
    const dotGeo = new THREE.CircleGeometry(dotSize, 8);
    const dotMat = new THREE.MeshBasicMaterial({ color: this.palette.primary, transparent: true, opacity: 0 });
    this.indicator = new THREE.Mesh(dotGeo, dotMat);
    this.indicator.position.set(divX, this.panelY + this.panelH / 2, 2);
    this.group.add(this.indicator);
  }

  private makeBorder(bx: number, by: number, bw: number, bh: number): THREE.LineSegments {
    const v = new Float32Array([
      bx, by, 1,  bx + bw, by, 1,
      bx + bw, by, 1,  bx + bw, by + bh, 1,
      bx + bw, by + bh, 1,  bx, by + bh, 1,
      bx, by + bh, 1,  bx, by, 1,
    ]);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(v, 3));
    return new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    }));
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);

    // Drain active side
    if (this.activeSide === 0) {
      this.leftFill = Math.max(0, this.leftFill - this.drainRate * dt);
    } else {
      this.rightFill = Math.max(0, this.rightFill - this.drainRate * dt);
    }

    // Swap sides periodically or when a side runs out
    this.swapTimer += dt;
    const activeEmpty = this.activeSide === 0 ? this.leftFill <= 0 : this.rightFill <= 0;
    if (this.swapTimer >= this.swapInterval || activeEmpty) {
      this.swapTimer = 0;
      this.activeSide = this.activeSide === 0 ? 1 : 0;

      // Reset the side that just became inactive (simulating resetting the clock)
      if (activeEmpty) {
        if (this.activeSide === 0) {
          this.rightFill = 1.0;
        } else {
          this.leftFill = 1.0;
        }
      }
    }

    // Update bar widths
    const leftW = this.maxBarW * this.leftFill;
    const rightW = this.maxBarW * this.rightFill;

    this.leftBar.scale.set(leftW, 1, 1);
    this.rightBar.scale.set(rightW, 1, 1);

    // Color: active side = primary, inactive = dim
    const leftActive = this.activeSide === 0;
    const lMat = this.leftBar.material as THREE.MeshBasicMaterial;
    const rMat = this.rightBar.material as THREE.MeshBasicMaterial;

    lMat.color.copy(leftActive ? this.palette.primary : this.palette.dim);
    rMat.color.copy(leftActive ? this.palette.dim : this.palette.primary);
    lMat.opacity = opacity * (leftActive ? 0.7 : 0.3);
    rMat.opacity = opacity * (leftActive ? 0.3 : 0.7);

    // Borders
    (this.leftBorder.material as THREE.LineBasicMaterial).opacity = opacity * (leftActive ? 0.5 : 0.25);
    (this.leftBorder.material as THREE.LineBasicMaterial).color.copy(leftActive ? this.palette.primary : this.palette.dim);
    (this.rightBorder.material as THREE.LineBasicMaterial).opacity = opacity * (leftActive ? 0.25 : 0.5);
    (this.rightBorder.material as THREE.LineBasicMaterial).color.copy(leftActive ? this.palette.dim : this.palette.primary);

    // Divider
    (this.dividerLine.material as THREE.LineBasicMaterial).opacity = opacity * 0.3;

    // Indicator: shift toward active side
    const indMat = this.indicator.material as THREE.MeshBasicMaterial;
    indMat.opacity = opacity * 0.9;
    indMat.color.copy(this.palette.primary);
  }
}
