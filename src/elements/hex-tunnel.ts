import * as THREE from 'three';
import { BaseElement } from './base-element';

/**
 * Concentric hexagonal rings expanding outward like looking down a hex tunnel.
 * Each ring is a full hexagon outline at increasing radii with staggered phase.
 */
export class HexTunnelElement extends BaseElement {
  private rings: THREE.Line[] = [];
  private ringPhases: number[] = [];
  private ringCount: number = 0;
  private maxRadius: number = 0;
  private cx: number = 0;
  private cy: number = 0;
  private speed: number = 0;
  private rotationSpeed: number = 0;
  private rotationAngle: number = 0;

  build(): void {
    this.glitchAmount = 5;
    const { x, y, w, h } = this.px;
    this.cx = x + w / 2;
    this.cy = y + h / 2;
    this.maxRadius = Math.min(w, h) * 0.48;
    this.ringCount = this.rng.int(8, 14);
    this.speed = this.rng.float(0.3, 0.6);
    this.rotationSpeed = this.rng.float(0.1, 0.3) * (this.rng.chance(0.5) ? 1 : -1);

    for (let i = 0; i < this.ringCount; i++) {
      const points = this.hexPoints(0, 0, 1); // unit hex, scaled in update
      const geo = new THREE.BufferGeometry().setFromPoints(points);
      const mat = new THREE.LineBasicMaterial({
        color: this.palette.primary,
        transparent: true,
        opacity: 0,
      });
      const line = new THREE.Line(geo, mat);
      line.position.set(this.cx, this.cy, 0);
      this.group.add(line);
      this.rings.push(line);
      this.ringPhases.push(i / this.ringCount);
    }
  }

  private hexPoints(cx: number, cy: number, r: number): THREE.Vector3[] {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 6; i++) {
      const angle = (Math.PI / 3) * i - Math.PI / 6;
      pts.push(new THREE.Vector3(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r, 0));
    }
    return pts;
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);

    this.rotationAngle += this.rotationSpeed * dt;

    for (let i = 0; i < this.ringCount; i++) {
      this.ringPhases[i] += this.speed * dt;
      if (this.ringPhases[i] > 1) this.ringPhases[i] -= 1;

      const phase = this.ringPhases[i];
      const r = phase * this.maxRadius;
      // Fade in at center, peak at mid, fade out at edge
      const fadeIn = Math.min(phase * 4, 1);
      const fadeOut = 1 - Math.pow(phase, 2);
      const ringOpacity = opacity * fadeIn * fadeOut * 0.8;

      const pos = this.rings[i].geometry.getAttribute('position') as THREE.BufferAttribute;
      const rotAngle = this.rotationAngle + phase * 0.5;
      for (let j = 0; j <= 6; j++) {
        const angle = (Math.PI / 3) * j - Math.PI / 6 + rotAngle;
        pos.setXY(j, Math.cos(angle) * r, Math.sin(angle) * r);
      }
      pos.needsUpdate = true;

      const mat = this.rings[i].material as THREE.LineBasicMaterial;
      mat.opacity = ringOpacity;
      mat.color.copy(phase > 0.7 ? this.palette.dim : this.palette.primary);
    }
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'pulse') { this.speed *= 1.5; setTimeout(() => { this.speed /= 1.5; }, 500); }
    if (action === 'glitch') { this.rotationSpeed *= -1; }
    if (action === 'alert') {
      for (const ring of this.rings) {
        (ring.material as THREE.LineBasicMaterial).color.copy(this.palette.alert);
      }
    }
  }
}
