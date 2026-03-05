import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Spring-mass mesh with wave propagation.
 * A grid of spring-connected masses ripples when disturbed,
 * with waves bouncing off edges — like a liquid surface scanner.
 */
export class SpringMeshElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'spring-mesh',
    meta: { shape: 'rectangular', roles: ['data-display', 'decorative'], moods: ['ambient', 'diagnostic'], bandAffinity: 'bass', audioSensitivity: 1.5, sizes: ['needs-medium', 'needs-large'] },
  };

  private cols = 0;
  private rows = 0;
  private displacement!: Float32Array;
  private velocity!: Float32Array;
  private stiffness = 0.3;
  private damping = 0.98;

  private lineMesh!: THREE.LineSegments;
  private lineMat!: THREE.LineBasicMaterial;
  private linePositions!: Float32Array;

  private dropTimer = 0;
  private dropInterval = 1.5;

  build(): void {
    const variant = this.rng.int(0, 3);
    const presets = [
      { cols: 30, rows: 25, stiffness: 0.3, damping: 0.98, interval: 1.5 },
      { cols: 50, rows: 40, stiffness: 0.4, damping: 0.97, interval: 0.8 },
      { cols: 18, rows: 14, stiffness: 0.2, damping: 0.99, interval: 2.5 },
      { cols: 40, rows: 30, stiffness: 0.5, damping: 0.96, interval: 0.5 },
    ];
    const p = presets[variant];
    this.glitchAmount = 4;

    const { x, y, w, h } = this.px;
    this.cols = p.cols;
    this.rows = p.rows;
    this.stiffness = p.stiffness;
    this.damping = p.damping;
    this.dropInterval = p.interval;

    const total = this.cols * this.rows;
    this.displacement = new Float32Array(total);
    this.velocity = new Float32Array(total);

    // Initial ripple
    const cx = Math.floor(this.cols / 2);
    const cy = Math.floor(this.rows / 2);
    this.displacement[cy * this.cols + cx] = 15;

    // Line segments: horizontal + vertical grid lines
    const maxLines = (this.cols - 1) * this.rows + this.cols * (this.rows - 1);
    this.linePositions = new Float32Array(maxLines * 6);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.linePositions, 3));
    this.lineMat = new THREE.LineBasicMaterial({ color: this.palette.primary, transparent: true, opacity: 0 });
    this.lineMesh = new THREE.LineSegments(geo, this.lineMat);
    this.group.add(this.lineMesh);
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);
    const { x, y, w, h } = this.px;

    // Random drops
    this.dropTimer -= dt;
    if (this.dropTimer <= 0) {
      this.dropTimer = this.dropInterval * this.rng.float(0.7, 1.3);
      const rx = this.rng.int(2, this.cols - 3);
      const ry = this.rng.int(2, this.rows - 3);
      this.displacement[ry * this.cols + rx] += this.rng.float(8, 20);
    }

    // Spring physics
    const cdt = Math.min(dt, 0.02);
    for (let gy = 1; gy < this.rows - 1; gy++) {
      for (let gx = 1; gx < this.cols - 1; gx++) {
        const idx = gy * this.cols + gx;
        const laplacian = this.displacement[idx - 1] + this.displacement[idx + 1] +
          this.displacement[idx - this.cols] + this.displacement[idx + this.cols] -
          4 * this.displacement[idx];
        this.velocity[idx] += laplacian * this.stiffness;
        this.velocity[idx] *= this.damping;
      }
    }
    for (let i = 0; i < this.displacement.length; i++) {
      this.displacement[i] += this.velocity[i] * cdt * 60;
    }

    // Update geometry
    const spacingX = w / (this.cols - 1);
    const spacingY = h / (this.rows - 1);
    let li = 0;

    for (let gy = 0; gy < this.rows; gy++) {
      for (let gx = 0; gx < this.cols - 1; gx++) {
        const a = gy * this.cols + gx;
        const b = a + 1;
        this.linePositions[li++] = x + gx * spacingX;
        this.linePositions[li++] = y + gy * spacingY + this.displacement[a];
        this.linePositions[li++] = 0;
        this.linePositions[li++] = x + (gx + 1) * spacingX;
        this.linePositions[li++] = y + gy * spacingY + this.displacement[b];
        this.linePositions[li++] = 0;
      }
    }
    for (let gy = 0; gy < this.rows - 1; gy++) {
      for (let gx = 0; gx < this.cols; gx++) {
        const a = gy * this.cols + gx;
        const b = a + this.cols;
        this.linePositions[li++] = x + gx * spacingX;
        this.linePositions[li++] = y + gy * spacingY + this.displacement[a];
        this.linePositions[li++] = 0;
        this.linePositions[li++] = x + gx * spacingX;
        this.linePositions[li++] = y + (gy + 1) * spacingY + this.displacement[b];
        this.linePositions[li++] = 0;
      }
    }

    (this.lineMesh.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    this.lineMat.opacity = opacity * 0.6;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      for (let i = 0; i < this.displacement.length; i++) {
        this.displacement[i] += (this.rng.next() - 0.5) * 10;
      }
    }
    if (action === 'alert') {
      // Big central drop
      const cx = Math.floor(this.cols / 2);
      const cy = Math.floor(this.rows / 2);
      this.displacement[cy * this.cols + cx] = 40;
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level >= 3) this.dropInterval = 0.3;
    if (level >= 5) {
      for (let i = 0; i < this.displacement.length; i++) {
        this.displacement[i] += (this.rng.next() - 0.5) * 15;
      }
    }
  }
}
