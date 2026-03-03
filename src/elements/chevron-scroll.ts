import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Repeating chevron/arrow shapes scrolling horizontally.
 * Leading chevrons are brighter, creating a directional flow effect.
 */
export class ChevronScrollElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'chevron-scroll',
    meta: { shape: 'linear', roles: ['decorative', 'structural'], moods: ['tactical', 'ambient'], sizes: ['works-small'] },
  };
  private chevronLines!: THREE.LineSegments;
  private chevronCount: number = 0;
  private scrollOffset: number = 0;
  private scrollSpeed: number = 0;
  private spacing: number = 0;

  build(): void {
    this.glitchAmount = 3;
    const { x, y, w, h } = this.px;

    // Space chevrons evenly; each chevron is ~h wide
    const chevronW = Math.max(8, h * 0.6);
    this.spacing = chevronW * 1.8;
    this.chevronCount = Math.ceil(w / this.spacing) + 2;
    this.scrollSpeed = this.rng.float(30, 80);

    const clipPlanes = [
      new THREE.Plane(new THREE.Vector3(1, 0, 0), -x),       // left
      new THREE.Plane(new THREE.Vector3(-1, 0, 0), x + w),   // right
      new THREE.Plane(new THREE.Vector3(0, 1, 0), -y),       // bottom
      new THREE.Plane(new THREE.Vector3(0, -1, 0), y + h),   // top
    ];

    // Each chevron = 2 line segments (4 vertices = 2 pairs)
    const verts = new Float32Array(this.chevronCount * 4 * 3);
    const colors = new Float32Array(this.chevronCount * 4 * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.chevronLines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0,
      clippingPlanes: clipPlanes,
    }));
    this.group.add(this.chevronLines);

    this.scrollOffset = 0;
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);
    const { x, y, w, h } = this.px;
    const cy = y + h / 2;
    const chevronH = h * 0.35;
    const chevronW = Math.max(8, h * 0.6) * 0.5;

    this.scrollOffset += this.scrollSpeed * dt;
    if (this.scrollOffset > this.spacing) {
      this.scrollOffset -= this.spacing;
    }

    const positions = this.chevronLines.geometry.getAttribute('position') as THREE.BufferAttribute;
    const colors = this.chevronLines.geometry.getAttribute('color') as THREE.BufferAttribute;
    const primary = this.palette.primary;
    const dim = this.palette.dim;

    for (let i = 0; i < this.chevronCount; i++) {
      let cx = x + i * this.spacing + this.scrollOffset - this.spacing;

      // Wrap around
      const totalW = this.chevronCount * this.spacing;
      cx = ((cx - x + totalW) % totalW) + x - this.spacing;

      // Brightness: based on position (right = brighter)
      const t = Math.max(0, Math.min(1, (cx - x) / w));
      const brightness = 0.3 + t * 0.7;

      const vi = i * 4;
      // Top arm: tip -> top
      positions.setXYZ(vi, cx + chevronW, cy, 1);
      positions.setXYZ(vi + 1, cx, cy + chevronH, 1);
      // Bottom arm: tip -> bottom
      positions.setXYZ(vi + 2, cx + chevronW, cy, 1);
      positions.setXYZ(vi + 3, cx, cy - chevronH, 1);

      const r = dim.r + (primary.r - dim.r) * brightness;
      const g = dim.g + (primary.g - dim.g) * brightness;
      const b = dim.b + (primary.b - dim.b) * brightness;
      for (let v = vi; v < vi + 4; v++) {
        colors.setXYZ(v, r, g, b);
      }
    }
    positions.needsUpdate = true;
    colors.needsUpdate = true;
    (this.chevronLines.material as THREE.LineBasicMaterial).opacity = opacity;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      this.scrollSpeed *= -1;
      setTimeout(() => { this.scrollSpeed = Math.abs(this.scrollSpeed); }, 500);
    }
    if (action === 'alert') {
      this.scrollSpeed *= 3;
      this.pulseTimer = 1.0;
      setTimeout(() => { this.scrollSpeed /= 3; }, 1000);
    }
  }
}
