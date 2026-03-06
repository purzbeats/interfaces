import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Tensor/stress field visualization with directional line elements.
 * Short oriented dashes show principal stress directions across the region,
 * swirling around singularities — like a structural analysis overlay.
 */
export class TensorFieldElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'tensor-field',
    meta: { shape: 'rectangular', roles: ['data-display', 'decorative'], moods: ['diagnostic', 'tactical'], bandAffinity: 'mid', sizes: ['needs-medium', 'needs-large'] },
  };

  private dashCount = 0;
  private dashSegments!: THREE.LineSegments;
  private dashColors!: Float32Array;
  private dashPositions!: Float32Array;
  private dashMat!: THREE.LineBasicMaterial;

  // Singularity points that define the field
  private singX: number[] = [];
  private singY: number[] = [];
  private singType: number[] = []; // 0=source, 1=sink, 2=vortex
  private singDriftVx: number[] = [];
  private singDriftVy: number[] = [];

  private gridCols = 0;
  private gridRows = 0;
  private dashLen = 0;

  build(): void {
    const variant = this.rng.int(0, 3);
    const presets = [
      { spacing: 12, sings: 3, dashLenMul: 0.4 },
      { spacing: 8, sings: 5, dashLenMul: 0.3 },
      { spacing: 18, sings: 2, dashLenMul: 0.5 },
      { spacing: 10, sings: 4, dashLenMul: 0.35 },
    ];
    const p = presets[variant];
    this.glitchAmount = 4;

    const { x, y, w, h } = this.px;
    const spacing = Math.max(6, p.spacing);
    this.gridCols = Math.floor(w / spacing);
    this.gridRows = Math.floor(h / spacing);
    this.dashCount = this.gridCols * this.gridRows;
    this.dashLen = spacing * p.dashLenMul;

    // Singularities
    for (let i = 0; i < p.sings; i++) {
      this.singX.push(x + this.rng.float(w * 0.2, w * 0.8));
      this.singY.push(y + this.rng.float(h * 0.2, h * 0.8));
      this.singType.push(this.rng.int(0, 2));
      this.singDriftVx.push(this.rng.float(-8, 8));
      this.singDriftVy.push(this.rng.float(-8, 8));
    }

    // Dash geometry
    this.dashPositions = new Float32Array(this.dashCount * 6);
    this.dashColors = new Float32Array(this.dashCount * 6);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.dashPositions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.dashColors, 3));
    this.dashMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0 });
    this.dashSegments = new THREE.LineSegments(geo, this.dashMat);
    this.group.add(this.dashSegments);
  }

  private fieldAngle(wx: number, wy: number): { angle: number; magnitude: number } {
    let ax = 0, ay = 0;
    for (let s = 0; s < this.singX.length; s++) {
      const dx = wx - this.singX[s];
      const dy = wy - this.singY[s];
      const d = Math.sqrt(dx * dx + dy * dy) + 5;
      const str = 80 / (d * d);

      switch (this.singType[s]) {
        case 0: // source: radial outward
          ax += (dx / d) * str;
          ay += (dy / d) * str;
          break;
        case 1: // sink: radial inward
          ax -= (dx / d) * str;
          ay -= (dy / d) * str;
          break;
        case 2: // vortex: tangential
          ax += (-dy / d) * str;
          ay += (dx / d) * str;
          break;
      }
    }
    return { angle: Math.atan2(ay, ax), magnitude: Math.min(1, Math.sqrt(ax * ax + ay * ay) * 5) };
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);
    const { x, y, w, h } = this.px;
    const spacing = w / this.gridCols;

    // Drift singularities
    for (let s = 0; s < this.singX.length; s++) {
      this.singX[s] += this.singDriftVx[s] * dt;
      this.singY[s] += this.singDriftVy[s] * dt;
      const bndPad = Math.min(w, h) * 0.06;
      if (this.singX[s] < x + bndPad || this.singX[s] > x + w - bndPad) this.singDriftVx[s] *= -1;
      if (this.singY[s] < y + bndPad || this.singY[s] > y + h - bndPad) this.singDriftVy[s] *= -1;
    }

    const pr = this.palette.primary.r, pg2 = this.palette.primary.g, pb = this.palette.primary.b;
    const sr = this.palette.secondary.r, sg = this.palette.secondary.g, sb = this.palette.secondary.b;
    const dr = this.palette.dim.r, dg = this.palette.dim.g, db = this.palette.dim.b;

    let idx = 0;
    for (let row = 0; row < this.gridRows; row++) {
      for (let col = 0; col < this.gridCols; col++) {
        const cx = x + (col + 0.5) * spacing;
        const cy = y + (row + 0.5) * (h / this.gridRows);
        const { angle, magnitude } = this.fieldAngle(cx, cy);

        const half = this.dashLen * 0.5 * (0.3 + magnitude * 0.7);
        const cos = Math.cos(angle) * half;
        const sin = Math.sin(angle) * half;

        this.dashPositions[idx * 6] = cx - cos;
        this.dashPositions[idx * 6 + 1] = cy - sin;
        this.dashPositions[idx * 6 + 2] = 0;
        this.dashPositions[idx * 6 + 3] = cx + cos;
        this.dashPositions[idx * 6 + 4] = cy + sin;
        this.dashPositions[idx * 6 + 5] = 0;

        // Color: dim → primary → secondary based on magnitude
        const t = magnitude;
        const r = dr * (1 - t) + (t < 0.5 ? pr : sr) * t;
        const g = dg * (1 - t) + (t < 0.5 ? pg2 : sg) * t;
        const b = db * (1 - t) + (t < 0.5 ? pb : sb) * t;
        this.dashColors[idx * 6] = r;
        this.dashColors[idx * 6 + 1] = g;
        this.dashColors[idx * 6 + 2] = b;
        this.dashColors[idx * 6 + 3] = r;
        this.dashColors[idx * 6 + 4] = g;
        this.dashColors[idx * 6 + 5] = b;
        idx++;
      }
    }

    (this.dashSegments.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.dashSegments.geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
    this.dashMat.opacity = opacity * 0.8;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      for (let s = 0; s < this.singX.length; s++) this.singType[s] = this.rng.int(0, 2);
    }
    if (action === 'alert') {
      const { x, y, w, h } = this.px;
      this.singX.push(x + w / 2);
      this.singY.push(y + h / 2);
      this.singType.push(2);
      this.singDriftVx.push(0);
      this.singDriftVy.push(0);
      setTimeout(() => {
        this.singX.pop(); this.singY.pop(); this.singType.pop();
        this.singDriftVx.pop(); this.singDriftVy.pop();
      }, 2000);
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level >= 3) {
      for (let s = 0; s < this.singDriftVx.length; s++) {
        this.singDriftVx[s] *= 2;
        this.singDriftVy[s] *= 2;
      }
    }
  }
}
