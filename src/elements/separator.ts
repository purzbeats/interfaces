import * as THREE from 'three';
import { BaseElement } from './base-element';
import { pulse, stateOpacity, glitchOffset } from '../animation/fx';

export class SeparatorElement extends BaseElement {
  private lines!: THREE.LineSegments;
  private pulseTimer: number = 0;
  private glitchTimer: number = 0;

  build(): void {
    const { x, y, w, h } = this.px;
    const verts: number[] = [];
    const style = this.rng.int(0, 4);

    switch (style) {
      case 0: { // Corner brackets
        const cs = Math.min(w, h) * 0.15;
        verts.push(x, y + cs, 0, x, y, 0, x, y, 0, x + cs, y, 0);
        verts.push(x + w - cs, y, 0, x + w, y, 0, x + w, y, 0, x + w, y + cs, 0);
        verts.push(x + w, y + h - cs, 0, x + w, y + h, 0, x + w, y + h, 0, x + w - cs, y + h, 0);
        verts.push(x + cs, y + h, 0, x, y + h, 0, x, y + h, 0, x, y + h - cs, 0);
        break;
      }
      case 1: { // Horizontal lines with ticks
        verts.push(x, y + h / 2, 0, x + w, y + h / 2, 0);
        const tickCount = this.rng.int(5, 15);
        for (let i = 0; i <= tickCount; i++) {
          const tx = x + (w / tickCount) * i;
          const tickH = (i % 5 === 0) ? h * 0.3 : h * 0.15;
          verts.push(tx, y + h / 2 - tickH, 0, tx, y + h / 2 + tickH, 0);
        }
        break;
      }
      case 2: { // Dashed cross
        const cx = x + w / 2, cy = y + h / 2;
        const dashLen = Math.min(w, h) * 0.05;
        const gap = dashLen * 0.5;
        for (let d = 0; d < w / 2; d += dashLen + gap) {
          verts.push(cx + d, cy, 0, cx + d + dashLen, cy, 0);
          verts.push(cx - d - dashLen, cy, 0, cx - d, cy, 0);
        }
        for (let d = 0; d < h / 2; d += dashLen + gap) {
          verts.push(cx, cy + d, 0, cx, cy + d + dashLen, 0);
          verts.push(cx, cy - d - dashLen, 0, cx, cy - d, 0);
        }
        break;
      }
      default: { // Double border
        const inset = Math.min(w, h) * 0.06;
        verts.push(x, y, 0, x + w, y, 0);
        verts.push(x + w, y, 0, x + w, y + h, 0);
        verts.push(x + w, y + h, 0, x, y + h, 0);
        verts.push(x, y + h, 0, x, y, 0);
        verts.push(x + inset, y + inset, 0, x + w - inset, y + inset, 0);
        verts.push(x + w - inset, y + inset, 0, x + w - inset, y + h - inset, 0);
        verts.push(x + w - inset, y + h - inset, 0, x + inset, y + h - inset, 0);
        verts.push(x + inset, y + h - inset, 0, x + inset, y + inset, 0);
        break;
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    this.lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.lines);
  }

  update(dt: number, _time: number): void {
    let opacity = stateOpacity(this.stateMachine.state, this.stateMachine.progress);

    if (this.pulseTimer > 0) {
      this.pulseTimer -= dt;
      opacity *= pulse(this.pulseTimer);
    }

    const gx = this.glitchTimer > 0 ? glitchOffset(this.glitchTimer, 3) : 0;
    if (this.glitchTimer > 0) this.glitchTimer -= dt;
    this.group.position.x = gx;

    (this.lines.material as THREE.LineBasicMaterial).opacity = opacity * 0.5;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'pulse') this.pulseTimer = 0.3;
    if (action === 'glitch') this.glitchTimer = 0.35;
  }
}
