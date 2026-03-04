import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * A zigzag coil line drawn vertically that compresses and extends cyclically.
 * Bottom end is fixed, top end bounces. Coil spacing changes during animation.
 */
export class SpringCoilElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'spring-coil',
    meta: {
      shape: 'linear',
      roles: ['decorative'],
      moods: ['ambient'],
      sizes: ['works-small'],
    },
  };

  private coilLine!: THREE.Line;
  private topCap!: THREE.LineSegments;
  private bottomCap!: THREE.LineSegments;
  private topDot!: THREE.Mesh;

  private baseX: number = 0;
  private baseY: number = 0;
  private coilWidth: number = 0;
  private restHeight: number = 0;
  private coilSegments: number = 0;
  private speed: number = 0;
  private compressionAmount: number = 0;
  private variant: number = 0;

  build(): void {
    const { x, y, w, h } = this.px;
    this.variant = this.rng.int(0, 3);

    const presets = [
      // Variant 0: Tall spring, slow bounce
      { segments: 12, speed: 1.0, compression: 0.4, widthFrac: 0.35 },
      // Variant 1: Short spring, fast bounce
      { segments: 8, speed: 2.2, compression: 0.35, widthFrac: 0.4 },
      // Variant 2: Dense spring, medium bounce
      { segments: 18, speed: 1.5, compression: 0.3, widthFrac: 0.3 },
      // Variant 3: Loose spring, bouncy
      { segments: 6, speed: 1.8, compression: 0.55, widthFrac: 0.45 },
    ];

    const p = presets[this.variant];
    this.coilSegments = p.segments;
    this.speed = p.speed;
    this.compressionAmount = p.compression;
    this.coilWidth = w * p.widthFrac;

    this.baseX = x + w / 2;
    this.baseY = y + h * 0.85;  // Bottom anchor
    this.restHeight = h * 0.65;

    // Bottom anchor cap (horizontal line)
    const capW = this.coilWidth * 0.6;
    const bottomVerts = [
      this.baseX - capW / 2, this.baseY, 0,
      this.baseX + capW / 2, this.baseY, 0,
    ];
    const bottomGeo = new THREE.BufferGeometry();
    bottomGeo.setAttribute('position', new THREE.Float32BufferAttribute(bottomVerts, 3));
    this.bottomCap = new THREE.LineSegments(bottomGeo, new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.bottomCap);

    // Top cap (horizontal line, will be repositioned)
    const topVerts = [
      this.baseX - capW / 2, this.baseY - this.restHeight, 0,
      this.baseX + capW / 2, this.baseY - this.restHeight, 0,
    ];
    const topGeo = new THREE.BufferGeometry();
    topGeo.setAttribute('position', new THREE.Float32BufferAttribute(topVerts, 3));
    this.topCap = new THREE.LineSegments(topGeo, new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.topCap);

    // Coil zigzag line
    // Each segment alternates left-right creating the zigzag
    const coilPositions = new Float32Array((this.coilSegments + 2) * 3); // +2 for top and bottom anchor points
    this.updateCoilPositions(coilPositions, 0);

    const coilGeo = new THREE.BufferGeometry();
    coilGeo.setAttribute('position', new THREE.BufferAttribute(coilPositions, 3));
    this.coilLine = new THREE.Line(coilGeo, new THREE.LineBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.coilLine);

    // Bouncing weight dot at top
    const dotR = Math.max(2, Math.min(w, h) * 0.03);
    const dotGeo = new THREE.CircleGeometry(dotR, 8);
    this.topDot = new THREE.Mesh(dotGeo, new THREE.MeshBasicMaterial({
      color: this.palette.secondary,
      transparent: true,
      opacity: 0,
    }));
    this.topDot.position.set(this.baseX, this.baseY - this.restHeight, 1);
    this.group.add(this.topDot);
  }

  private updateCoilPositions(positions: Float32Array, compressionFactor: number): void {
    // compressionFactor: 0 = rest, 1 = fully compressed, -1 = fully extended
    const currentHeight = this.restHeight * (1 - compressionFactor * this.compressionAmount);
    const totalPoints = this.coilSegments + 2;

    // Bottom anchor point
    positions[0] = this.baseX;
    positions[1] = this.baseY;
    positions[2] = 0;

    // Zigzag coil points — spacing is non-uniform to simulate spring physics
    // Bottom coils are more compressed when spring is compressed
    for (let i = 0; i < this.coilSegments; i++) {
      const t = (i + 1) / (this.coilSegments + 1);
      // Apply easing so compression is more visible at the bottom
      const adjustedT = t + compressionFactor * 0.15 * Math.sin(t * Math.PI);
      const coilY = this.baseY - adjustedT * currentHeight;
      const side = (i % 2 === 0) ? 1 : -1;
      const idx = (i + 1) * 3;
      positions[idx] = this.baseX + side * this.coilWidth / 2;
      positions[idx + 1] = coilY;
      positions[idx + 2] = 0;
    }

    // Top anchor point
    const topIdx = (totalPoints - 1) * 3;
    positions[topIdx] = this.baseX;
    positions[topIdx + 1] = this.baseY - currentHeight;
    positions[topIdx + 2] = 0;
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);

    // Sine-based compression cycle
    const compressionFactor = Math.sin(time * this.speed);
    const currentHeight = this.restHeight * (1 - compressionFactor * this.compressionAmount);

    // Update coil geometry
    const positions = this.coilLine.geometry.getAttribute('position') as THREE.BufferAttribute;
    this.updateCoilPositions(positions.array as Float32Array, compressionFactor);
    positions.needsUpdate = true;

    // Update top cap position
    const topY = this.baseY - currentHeight;
    const capW = this.coilWidth * 0.6;
    const topCapPos = this.topCap.geometry.getAttribute('position') as THREE.BufferAttribute;
    topCapPos.setXYZ(0, this.baseX - capW / 2, topY, 0);
    topCapPos.setXYZ(1, this.baseX + capW / 2, topY, 0);
    topCapPos.needsUpdate = true;

    // Update top dot
    this.topDot.position.set(this.baseX, topY, 1);

    // Set opacities
    (this.coilLine.material as THREE.LineBasicMaterial).opacity = opacity * 0.8;
    (this.bottomCap.material as THREE.LineBasicMaterial).opacity = opacity * 0.5;
    (this.topCap.material as THREE.LineBasicMaterial).opacity = opacity * 0.5;
    (this.topDot.material as THREE.MeshBasicMaterial).opacity = opacity * 0.85;
  }
}
