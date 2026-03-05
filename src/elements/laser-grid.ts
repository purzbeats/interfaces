import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

interface LaserLine {
  position: number;   // current offset in px
  basePosition: number;
  speed: number;      // drift speed px/s
  brightness: number; // 0..1 base brightness
  visible: boolean;
  flashTimer: number; // countdown for flash effect
  horizontal: boolean;
}

/**
 * Intersecting laser beams forming a shifting grid.
 * Lines drift slowly and occasionally flash brighter.
 */
export class LaserGridElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'laser-grid',
    meta: {
      shape: 'rectangular',
      roles: ['scanner'],
      moods: ['tactical'],
      sizes: ['needs-medium'],
    },
  };

  private lineMesh!: THREE.LineSegments;
  private lines: LaserLine[] = [];
  private maxSegments: number = 0;
  private flashInterval: number = 0;
  private flashAccum: number = 0;

  build(): void {
    const { x, y, w, h } = this.px;

    const hCount = 4 + this.rng.int(0, 4);
    const vCount = 4 + this.rng.int(0, 4);
    const totalLines = hCount + vCount;
    this.maxSegments = totalLines;

    // Create horizontal lines
    for (let i = 0; i < hCount; i++) {
      const pos = y + (h / (hCount + 1)) * (i + 1) + this.rng.float(-h * 0.05, h * 0.05);
      this.lines.push({
        position: pos,
        basePosition: pos,
        speed: this.rng.float(-8, 8),
        brightness: this.rng.float(0.2, 1.0),
        visible: this.rng.chance(0.75),
        flashTimer: 0,
        horizontal: true,
      });
    }

    // Create vertical lines
    for (let i = 0; i < vCount; i++) {
      const pos = x + (w / (vCount + 1)) * (i + 1) + this.rng.float(-w * 0.05, w * 0.05);
      this.lines.push({
        position: pos,
        basePosition: pos,
        speed: this.rng.float(-8, 8),
        brightness: this.rng.float(0.2, 1.0),
        visible: this.rng.chance(0.75),
        flashTimer: 0,
        horizontal: false,
      });
    }

    this.flashInterval = this.rng.float(0.8, 2.5);
    this.flashAccum = 0;

    // Preallocate line segments buffer
    const positions = new Float32Array(this.maxSegments * 2 * 3);
    const colors = new Float32Array(this.maxSegments * 2 * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setDrawRange(0, 0);

    this.lineMesh = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.lineMesh);
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    const { x, y, w, h } = this.px;

    // Occasionally flash a random line
    this.flashAccum += dt;
    if (this.flashAccum >= this.flashInterval) {
      this.flashAccum -= this.flashInterval;
      const idx = Math.floor(this.rng.next() * this.lines.length);
      this.lines[idx].flashTimer = 0.3;
    }

    // Occasionally toggle visibility of a random line
    if (this.rng.next() < dt * 0.3) {
      const idx = Math.floor(this.rng.next() * this.lines.length);
      this.lines[idx].visible = !this.lines[idx].visible;
    }

    const posAttr = this.lineMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const colAttr = this.lineMesh.geometry.getAttribute('color') as THREE.BufferAttribute;
    const pr = this.palette.primary.r;
    const pg = this.palette.primary.g;
    const pb = this.palette.primary.b;

    let segIdx = 0;

    for (const line of this.lines) {
      // Drift position
      line.position += line.speed * dt;

      // Clamp to bounds
      if (line.horizontal) {
        const minY = y + h * 0.05;
        const maxY = y + h * 0.95;
        if (line.position < minY || line.position > maxY) {
          line.speed = -line.speed;
          line.position = Math.max(minY, Math.min(maxY, line.position));
        }
      } else {
        const minX = x + w * 0.05;
        const maxX = x + w * 0.95;
        if (line.position < minX || line.position > maxX) {
          line.speed = -line.speed;
          line.position = Math.max(minX, Math.min(maxX, line.position));
        }
      }

      // Update flash timer
      if (line.flashTimer > 0) {
        line.flashTimer -= dt;
      }

      if (!line.visible) continue;

      // Compute brightness
      let bright = line.brightness;
      if (line.flashTimer > 0) {
        bright = Math.min(1.0, bright + 0.6 * (line.flashTimer / 0.3));
      }

      const vi = segIdx * 2;
      if (line.horizontal) {
        posAttr.setXYZ(vi, x, line.position, 0);
        posAttr.setXYZ(vi + 1, x + w, line.position, 0);
      } else {
        posAttr.setXYZ(vi, line.position, y, 0);
        posAttr.setXYZ(vi + 1, line.position, y + h, 0);
      }

      colAttr.setXYZ(vi, pr * bright, pg * bright, pb * bright);
      colAttr.setXYZ(vi + 1, pr * bright, pg * bright, pb * bright);

      segIdx++;
    }

    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
    this.lineMesh.geometry.setDrawRange(0, segIdx * 2);
    (this.lineMesh.material as THREE.LineBasicMaterial).opacity = opacity;
  }
}
