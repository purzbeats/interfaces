import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Hexagonal grid — NERV-style honeycomb pattern.
 * Cells activate individually with staggered timing, some pulsing, some solid.
 */
export class HexGridElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'hex-grid',
    meta: { shape: 'radial', roles: ['decorative', 'scanner'], moods: ['tactical'], bandAffinity: 'mid', sizes: ['needs-medium', 'needs-large'] },
  };
  private cells: THREE.LineSegments[] = [];
  private fills: THREE.Mesh[] = [];
  private cellActivation: number[] = [];
  private cellTargetBright: number[] = [];
  private activationSpeed: number = 0;

  build(): void {
    const { x, y, w, h } = this.px;
    const hexR = Math.min(w, h) * this.rng.float(0.04, 0.08);
    const hexW = hexR * Math.sqrt(3);
    const hexH = hexR * 2;
    const cols = Math.floor(w / hexW);
    const rows = Math.floor(h / (hexH * 0.75));
    this.activationSpeed = this.rng.float(2, 6);

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const offsetX = (row % 2) * (hexW / 2);
        const cx = x + col * hexW + offsetX + hexW / 2;
        const cy = y + row * (hexH * 0.75) + hexR;
        if (cx + hexR > x + w || cy + hexR > y + h) continue;

        // Hex outline
        const verts: number[] = [];
        for (let i = 0; i < 6; i++) {
          const a1 = (Math.PI / 3) * i - Math.PI / 6;
          const a2 = (Math.PI / 3) * (i + 1) - Math.PI / 6;
          verts.push(
            cx + Math.cos(a1) * hexR, cy + Math.sin(a1) * hexR, 1,
            cx + Math.cos(a2) * hexR, cy + Math.sin(a2) * hexR, 1,
          );
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
        const line = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
          color: this.palette.primary,
          transparent: true,
          opacity: 0,
        }));
        this.cells.push(line);
        this.group.add(line);

        // Small fill hexagon (slightly smaller)
        const fillR = hexR * 0.6;
        const fillVerts: number[] = [];
        for (let i = 0; i < 6; i++) {
          const a = (Math.PI / 3) * i - Math.PI / 6;
          fillVerts.push(cx + Math.cos(a) * fillR, cy + Math.sin(a) * fillR);
        }
        const shape = new THREE.Shape();
        shape.moveTo(fillVerts[0], fillVerts[1]);
        for (let i = 2; i < fillVerts.length; i += 2) {
          shape.lineTo(fillVerts[i], fillVerts[i + 1]);
        }
        shape.closePath();
        const fillGeo = new THREE.ShapeGeometry(shape);
        const fill = new THREE.Mesh(fillGeo, new THREE.MeshBasicMaterial({
          color: this.palette.primary,
          transparent: true,
          opacity: 0,
        }));
        fill.position.z = 0.5;
        this.fills.push(fill);
        this.group.add(fill);

        // Staggered activation + random brightness targets
        const dist = Math.sqrt((col - cols / 2) ** 2 + (row - rows / 2) ** 2);
        this.cellActivation.push(-dist * 0.15); // negative = delay
        this.cellTargetBright.push(this.rng.float(0.05, 0.4));
      }
    }
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);

    for (let i = 0; i < this.cells.length; i++) {
      this.cellActivation[i] += dt * this.activationSpeed;
      const t = Math.max(0, Math.min(1, this.cellActivation[i]));
      // Elastic-ish entrance
      const elastic = t < 1 ? 1 - Math.pow(1 - t, 3) * Math.cos(t * Math.PI * 2) : 1;
      const cellOpacity = elastic * opacity;

      (this.cells[i].material as THREE.LineBasicMaterial).opacity = cellOpacity * 0.6;

      // Fill brightness oscillates slowly per cell
      const fillBright = this.cellTargetBright[i] * (0.7 + Math.sin(time * 2 + i * 0.7) * 0.3);
      (this.fills[i].material as THREE.MeshBasicMaterial).opacity = cellOpacity * fillBright;
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) return;
    const count = this.cellTargetBright.length;
    if (level >= 5) {
      for (let i = 0; i < count; i++) {
        if (this.rng.chance(0.5)) {
          this.cellTargetBright[i] = 1.0;
        }
      }
    } else if (level >= 3) {
      for (let i = 0; i < count; i++) {
        if (this.rng.chance(0.3)) {
          this.cellTargetBright[i] = Math.min(1.0, this.cellTargetBright[i] + 0.5);
        }
      }
    }
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Scramble some cells
      for (let i = 0; i < this.cells.length; i++) {
        if (this.rng.chance(0.3)) {
          this.cellTargetBright[i] = this.rng.float(0.5, 1.0);
        }
      }
    }
    if (action === 'alert') {
      this.pulseTimer = 2.0;
      for (let i = 0; i < this.fills.length; i++) {
        (this.fills[i].material as THREE.MeshBasicMaterial).color.copy(
          this.rng.chance(0.4) ? this.palette.alert : this.palette.primary
        );
      }
    }
  }
}
