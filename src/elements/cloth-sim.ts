import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Verlet cloth physics simulation.
 * A grid of connected points responds to gravity and constraints,
 * rippling like a fabric curtain on a physics lab display.
 */
export class ClothSimElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'cloth-sim',
    meta: { shape: 'rectangular', roles: ['decorative', 'data-display'], moods: ['ambient', 'diagnostic'], bandAffinity: 'bass', sizes: ['needs-medium', 'needs-large'] },
  };

  private cols = 0;
  private rows = 0;
  private posX!: Float32Array;
  private posY!: Float32Array;
  private prevX!: Float32Array;
  private prevY!: Float32Array;
  private pinned!: Uint8Array;
  private restLen = 0;
  private gravity = 60;

  private lineMesh!: THREE.LineSegments;
  private lineMat!: THREE.LineBasicMaterial;
  private nodesMesh!: THREE.Points;

  build(): void {
    const variant = this.rng.int(0, 3);
    const presets = [
      { cols: 20, rows: 15, gravity: 60 },
      { cols: 35, rows: 25, gravity: 80 },
      { cols: 12, rows: 10, gravity: 40 },
      { cols: 28, rows: 20, gravity: 100 },
    ];
    const p = presets[variant];
    this.glitchAmount = 4;

    const { x, y, w, h } = this.px;
    this.cols = p.cols;
    this.rows = p.rows;
    this.gravity = p.gravity;

    const spacingX = w / (this.cols - 1);
    const spacingY = h / (this.rows - 1);
    this.restLen = Math.sqrt(spacingX * spacingX + spacingY * spacingY) * 0.71; // diagonal rest

    const total = this.cols * this.rows;
    this.posX = new Float32Array(total);
    this.posY = new Float32Array(total);
    this.prevX = new Float32Array(total);
    this.prevY = new Float32Array(total);
    this.pinned = new Uint8Array(total);

    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const idx = r * this.cols + c;
        this.posX[idx] = x + c * spacingX;
        this.posY[idx] = y + r * spacingY;
        this.prevX[idx] = this.posX[idx];
        this.prevY[idx] = this.posY[idx];
      }
    }

    // Pin top row
    for (let c = 0; c < this.cols; c++) this.pinned[c] = 1;

    // Line segments (horizontal + vertical links)
    const maxLines = (this.cols - 1) * this.rows + this.cols * (this.rows - 1);
    const linePos = new Float32Array(maxLines * 6);
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.BufferAttribute(linePos, 3));
    this.lineMat = new THREE.LineBasicMaterial({ color: this.palette.primary, transparent: true, opacity: 0 });
    this.lineMesh = new THREE.LineSegments(lineGeo, this.lineMat);
    this.group.add(this.lineMesh);

    // Node points
    const nodePos = new Float32Array(total * 3);
    const nodeGeo = new THREE.BufferGeometry();
    nodeGeo.setAttribute('position', new THREE.BufferAttribute(nodePos, 3));
    this.nodesMesh = new THREE.Points(nodeGeo, new THREE.PointsMaterial({
      color: this.palette.dim, transparent: true, opacity: 0, size: Math.max(1, Math.min(w, h) * 0.007), sizeAttenuation: false,
    }));
    this.group.add(this.nodesMesh);
  }

  private satisfy(a: number, b: number, rest: number): void {
    const dx = this.posX[b] - this.posX[a];
    const dy = this.posY[b] - this.posY[a];
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < 0.001) return;
    const diff = (d - rest) / d * 0.5;
    const ox = dx * diff;
    const oy = dy * diff;
    if (!this.pinned[a]) { this.posX[a] += ox; this.posY[a] += oy; }
    if (!this.pinned[b]) { this.posX[b] -= ox; this.posY[b] -= oy; }
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    const cdt = Math.min(dt, 0.02);
    const { x, y, w, h } = this.px;

    // Verlet integration
    const total = this.cols * this.rows;
    for (let i = 0; i < total; i++) {
      if (this.pinned[i]) continue;
      const vx = this.posX[i] - this.prevX[i];
      const vy = this.posY[i] - this.prevY[i];
      this.prevX[i] = this.posX[i];
      this.prevY[i] = this.posY[i];
      this.posX[i] += vx * 0.99;
      this.posY[i] += vy * 0.99 + this.gravity * cdt * cdt;
    }

    // Wind perturbation
    const wind = Math.sin(time * 1.5) * 15 * cdt * cdt;
    for (let i = 0; i < total; i++) {
      if (!this.pinned[i]) this.posX[i] += wind;
    }

    // Constraint satisfaction
    const spacingX = w / (this.cols - 1);
    const spacingY = h / (this.rows - 1);
    for (let iter = 0; iter < 3; iter++) {
      // Horizontal constraints
      for (let r = 0; r < this.rows; r++) {
        for (let c = 0; c < this.cols - 1; c++) {
          this.satisfy(r * this.cols + c, r * this.cols + c + 1, spacingX);
        }
      }
      // Vertical constraints
      for (let r = 0; r < this.rows - 1; r++) {
        for (let c = 0; c < this.cols; c++) {
          this.satisfy(r * this.cols + c, (r + 1) * this.cols + c, spacingY);
        }
      }
    }

    // Bound check
    for (let i = 0; i < total; i++) {
      if (this.posY[i] > y + h + 50) this.posY[i] = y + h + 50;
    }

    // Update GPU
    const linePos = this.lineMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    let li = 0;
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols - 1; c++) {
        const a = r * this.cols + c;
        const b = a + 1;
        linePos.setXYZ(li++, this.posX[a], this.posY[a], 0);
        linePos.setXYZ(li++, this.posX[b], this.posY[b], 0);
      }
    }
    for (let r = 0; r < this.rows - 1; r++) {
      for (let c = 0; c < this.cols; c++) {
        const a = r * this.cols + c;
        const b = a + this.cols;
        linePos.setXYZ(li++, this.posX[a], this.posY[a], 0);
        linePos.setXYZ(li++, this.posX[b], this.posY[b], 0);
      }
    }
    linePos.needsUpdate = true;

    const nodePos = this.nodesMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < total; i++) nodePos.setXYZ(i, this.posX[i], this.posY[i], 0.5);
    nodePos.needsUpdate = true;

    this.lineMat.opacity = opacity * 0.6;
    (this.nodesMesh.material as THREE.PointsMaterial).opacity = opacity * 0.3;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      for (let i = 0; i < this.posX.length; i++) {
        if (!this.pinned[i]) {
          this.posX[i] += (this.rng.next() - 0.5) * 20;
          this.posY[i] += (this.rng.next() - 0.5) * 20;
        }
      }
    }
    if (action === 'alert') {
      // Drop: unpin everything briefly
      for (let i = 0; i < this.cols; i += 2) this.pinned[i] = 0;
      setTimeout(() => { for (let i = 0; i < this.cols; i++) this.pinned[i] = 1; }, 1500);
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level >= 3) this.gravity = 150;
    if (level >= 5) {
      for (let i = 0; i < this.posY.length; i++) {
        if (!this.pinned[i]) this.posY[i] -= 30;
      }
    }
  }
}
