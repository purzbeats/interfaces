import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Fanning card deck — overlapping rectangles fanned out from a common
 * bottom-center pivot point. Cards slowly fan open and close.
 */
export class CardFanElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'card-fan',
    meta: {
      shape: 'radial',
      roles: ['decorative'],
      moods: ['ambient'],
      sizes: ['needs-medium'],
    },
  };

  private cardMeshes: THREE.Mesh[] = [];
  private cardBorders: THREE.LineSegments[] = [];
  private cardCount: number = 0;
  private cx: number = 0;
  private cy: number = 0;
  private cardWidth: number = 0;
  private cardHeight: number = 0;

  private spreadAngle: number = 0;
  private maxSpread: number = Math.PI * 0.4;
  private minSpread: number = Math.PI * 0.05;
  private spreadDirection: number = 1;
  private spreadSpeed: number = 0.3;

  build(): void {
    const { x, y, w, h } = this.px;
    this.cx = x + w / 2;
    this.cy = y + h * 0.25;  // pivot near bottom
    const maxR = Math.min(w, h) / 2 * 0.85;

    this.cardCount = this.rng.int(5, 8);
    this.cardWidth = maxR * 0.35;
    this.cardHeight = maxR * 0.65;
    this.spreadAngle = this.rng.float(this.minSpread, this.maxSpread);
    this.spreadSpeed = this.rng.float(0.2, 0.5);
    this.maxSpread = Math.PI * this.rng.float(0.3, 0.5);

    for (let i = 0; i < this.cardCount; i++) {
      const isPrimary = i % 2 === 0;
      const color = isPrimary ? this.palette.primary : this.palette.secondary;

      // Card plane — geometry centered at bottom-center (pivot point)
      // Offset Y so bottom edge is at origin
      const cardGeo = new THREE.PlaneGeometry(this.cardWidth, this.cardHeight);
      // Shift vertices so the pivot is at the bottom center of the card
      const posAttr = cardGeo.getAttribute('position') as THREE.BufferAttribute;
      for (let v = 0; v < posAttr.count; v++) {
        posAttr.setY(v, posAttr.getY(v) + this.cardHeight / 2);
      }
      posAttr.needsUpdate = true;

      const cardMesh = new THREE.Mesh(cardGeo, new THREE.MeshBasicMaterial({
        color: color,
        transparent: true,
        opacity: 0,
      }));
      cardMesh.position.set(this.cx, this.cy, i * 0.1);
      this.cardMeshes.push(cardMesh);
      this.group.add(cardMesh);

      // Card border lines
      const hw = this.cardWidth / 2;
      const ch = this.cardHeight;
      const borderVerts = new Float32Array([
        -hw, 0, 0,   hw, 0, 0,      // bottom
        hw, 0, 0,    hw, ch, 0,      // right
        hw, ch, 0,   -hw, ch, 0,     // top
        -hw, ch, 0,  -hw, 0, 0,      // left
      ]);
      const borderGeo = new THREE.BufferGeometry();
      borderGeo.setAttribute('position', new THREE.BufferAttribute(borderVerts, 3));
      const border = new THREE.LineSegments(borderGeo, new THREE.LineBasicMaterial({
        color: isPrimary ? this.palette.secondary : this.palette.primary,
        transparent: true,
        opacity: 0,
      }));
      border.position.set(this.cx, this.cy, i * 0.1 + 0.05);
      this.cardBorders.push(border);
      this.group.add(border);
    }
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);

    // Animate spread
    this.spreadAngle += this.spreadDirection * this.spreadSpeed * dt;
    if (this.spreadAngle >= this.maxSpread) {
      this.spreadAngle = this.maxSpread;
      this.spreadDirection = -1;
    } else if (this.spreadAngle <= this.minSpread) {
      this.spreadAngle = this.minSpread;
      this.spreadDirection = 1;
    }

    // Fan cards around pivot
    const totalSpread = this.spreadAngle;
    for (let i = 0; i < this.cardCount; i++) {
      // Distribute cards evenly across the spread, centered
      const t = this.cardCount > 1 ? (i / (this.cardCount - 1)) - 0.5 : 0;
      const angle = t * totalSpread;

      this.cardMeshes[i].rotation.z = angle;
      this.cardBorders[i].rotation.z = angle;

      const cardOpacity = opacity * (0.15 + 0.1 * (1 - Math.abs(t)));
      (this.cardMeshes[i].material as THREE.MeshBasicMaterial).opacity = cardOpacity;
      (this.cardBorders[i].material as THREE.LineBasicMaterial).opacity = opacity * 0.6;
    }
  }
}
