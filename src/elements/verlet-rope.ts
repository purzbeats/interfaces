import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Multiple verlet-integrated ropes hanging from anchor points, swinging and
 * responding to wind forces. Each rope is a chain of point masses connected
 * by distance constraints, simulated with Verlet integration.
 */
export class VerletRopeElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'verlet-rope',
    meta: {
      shape: 'rectangular',
      roles: ['decorative'],
      moods: ['ambient', 'tactical'],
      bandAffinity: 'bass',
      sizes: ['works-small', 'needs-medium', 'needs-large'],
    } satisfies ElementMeta,
  };

  private ropeLines: THREE.Line[] = [];
  private ropeMats: THREE.LineBasicMaterial[] = [];
  private anchorPoints!: THREE.Points;
  private anchorMat!: THREE.PointsMaterial;
  private borderLines!: THREE.LineSegments;
  private borderMat!: THREE.LineBasicMaterial;

  private ropeCount: number = 0;
  private segmentsPerRope: number = 0;
  // Per-rope arrays: [rope][segment] x, y, prevX, prevY
  private posX: Float32Array[] = [];
  private posY: Float32Array[] = [];
  private prevX: Float32Array[] = [];
  private prevY: Float32Array[] = [];
  private restLength: number = 0;
  private gravity: number = 0;
  private windSpeed: number = 0;
  private windFreq: number = 0;
  private damping: number = 0;
  private constraintIters: number = 0;
  private intensityLevel: number = 0;

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;
    const variant = this.rng.int(0, 3);
    const presets = [
      { ropes: 4, segs: 20, grav: 200, wind: 40, wFreq: 0.7, damp: 0.998, iters: 5 },
      { ropes: 8, segs: 30, grav: 300, wind: 60, wFreq: 0.5, damp: 0.997, iters: 6 },
      { ropes: 3, segs: 15, grav: 150, wind: 25, wFreq: 1.0, damp: 0.999, iters: 4 },
      { ropes: 6, segs: 40, grav: 250, wind: 80, wFreq: 0.3, damp: 0.996, iters: 8 },
    ];
    const p = presets[variant];
    this.ropeCount = p.ropes;
    this.segmentsPerRope = p.segs;
    this.gravity = p.grav;
    this.windSpeed = p.wind;
    this.windFreq = p.wFreq;
    this.damping = p.damp;
    this.constraintIters = p.iters;
    this.restLength = (h * 0.7) / this.segmentsPerRope;

    // Initialize ropes
    const anchorPositions = new Float32Array(this.ropeCount * 3);

    for (let r = 0; r < this.ropeCount; r++) {
      const anchorX = x + (r + 1) / (this.ropeCount + 1) * w;
      const anchorY = y + h * 0.05;
      const n = this.segmentsPerRope + 1;
      const px = new Float32Array(n);
      const py = new Float32Array(n);
      const ppx = new Float32Array(n);
      const ppy = new Float32Array(n);

      for (let i = 0; i < n; i++) {
        px[i] = anchorX + this.rng.float(-2, 2);
        py[i] = anchorY + i * this.restLength;
        ppx[i] = px[i];
        ppy[i] = py[i];
      }
      this.posX.push(px);
      this.posY.push(py);
      this.prevX.push(ppx);
      this.prevY.push(ppy);

      anchorPositions[r * 3] = anchorX;
      anchorPositions[r * 3 + 1] = anchorY;
      anchorPositions[r * 3 + 2] = 0.1;

      // Line for rope
      const linePositions = new Float32Array(n * 3);
      const lineGeo = new THREE.BufferGeometry();
      lineGeo.setAttribute('position', new THREE.BufferAttribute(linePositions, 3));
      const mat = new THREE.LineBasicMaterial({
        color: r % 2 === 0 ? this.palette.primary : this.palette.secondary,
        transparent: true,
        opacity: 0,
      });
      const line = new THREE.Line(lineGeo, mat);
      this.group.add(line);
      this.ropeLines.push(line);
      this.ropeMats.push(mat);
    }

    // Anchor points
    const anchorGeo = new THREE.BufferGeometry();
    anchorGeo.setAttribute('position', new THREE.BufferAttribute(anchorPositions, 3));
    this.anchorMat = new THREE.PointsMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
      size: 4,
      sizeAttenuation: false,
    });
    this.anchorPoints = new THREE.Points(anchorGeo, this.anchorMat);
    this.group.add(this.anchorPoints);

    // Border
    const bv = new Float32Array([
      x, y, 0, x + w, y, 0, x + w, y, 0, x + w, y + h, 0,
      x + w, y + h, 0, x, y + h, 0, x, y + h, 0, x, y, 0,
    ]);
    const bGeo = new THREE.BufferGeometry();
    bGeo.setAttribute('position', new THREE.BufferAttribute(bv, 3));
    this.borderMat = new THREE.LineBasicMaterial({
      color: this.palette.dim, transparent: true, opacity: 0,
    });
    this.borderLines = new THREE.LineSegments(bGeo, this.borderMat);
    this.group.add(this.borderLines);
  }

  private simulate(dt: number, time: number): void {
    const { x, y, w, h } = this.px;
    const clampedDt = Math.min(dt, 0.033);

    for (let r = 0; r < this.ropeCount; r++) {
      const n = this.segmentsPerRope + 1;
      const px = this.posX[r];
      const py = this.posY[r];
      const ppx = this.prevX[r];
      const ppy = this.prevY[r];

      // Wind force varies per rope
      const windPhase = time * this.windFreq + r * 1.5;
      const windForce = Math.sin(windPhase) * this.windSpeed + Math.sin(windPhase * 2.3) * this.windSpeed * 0.3;

      // Verlet integration (skip anchor point i=0)
      for (let i = 1; i < n; i++) {
        const vx = (px[i] - ppx[i]) * this.damping;
        const vy = (py[i] - ppy[i]) * this.damping;
        ppx[i] = px[i];
        ppy[i] = py[i];
        px[i] += vx + windForce * clampedDt * clampedDt;
        py[i] += vy + this.gravity * clampedDt * clampedDt;
      }

      // Distance constraints
      for (let iter = 0; iter < this.constraintIters; iter++) {
        for (let i = 0; i < n - 1; i++) {
          const dx = px[i + 1] - px[i];
          const dy = py[i + 1] - py[i];
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 0.001) continue;
          const diff = (dist - this.restLength) / dist * 0.5;

          if (i === 0) {
            // Anchor is fixed
            px[i + 1] -= dx * diff * 2;
            py[i + 1] -= dy * diff * 2;
          } else {
            px[i] += dx * diff;
            py[i] += dy * diff;
            px[i + 1] -= dx * diff;
            py[i + 1] -= dy * diff;
          }
        }

        // Clamp to region
        for (let i = 1; i < n; i++) {
          if (px[i] < x + 2) px[i] = x + 2;
          if (px[i] > x + w - 2) px[i] = x + w - 2;
          if (py[i] > y + h - 2) py[i] = y + h - 2;
        }
      }
    }
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    this.simulate(dt, time);

    for (let r = 0; r < this.ropeCount; r++) {
      const n = this.segmentsPerRope + 1;
      const pos = this.ropeLines[r].geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < n; i++) {
        pos.setXYZ(i, this.posX[r][i], this.posY[r][i], 0);
      }
      pos.needsUpdate = true;
      this.ropeMats[r].opacity = opacity * 0.7;
    }

    this.anchorMat.opacity = opacity;
    this.borderMat.opacity = opacity * 0.2;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Apply sudden sideways force
      for (let r = 0; r < this.ropeCount; r++) {
        const n = this.segmentsPerRope + 1;
        const force = this.rng.float(-30, 30);
        for (let i = 1; i < n; i++) {
          this.posX[r][i] += force * (i / n);
        }
      }
    }
    if (action === 'pulse') {
      // Snap all ropes upward
      for (let r = 0; r < this.ropeCount; r++) {
        const n = this.segmentsPerRope + 1;
        for (let i = 1; i < n; i++) {
          this.posY[r][i] -= 20 * (i / n);
        }
      }
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    this.intensityLevel = level;
    if (level === 0) {
      this.windSpeed = 40;
      return;
    }
    this.windSpeed = 40 + level * 20;
    this.gravity = 200 + level * 30;
  }
}
