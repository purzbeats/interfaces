import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Three-body gravitational simulation with leapfrog integration.
 * Each body leaves a colored trail via a ring-buffer line.
 * Softened gravity keeps orbits bounded and chaotic.
 */
export class ThreeBodyElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'three-body',
    meta: { shape: 'rectangular', roles: ['data-display', 'decorative'], moods: ['ambient', 'diagnostic'], bandAffinity: 'sub', sizes: ['needs-medium', 'needs-large'] },
  };

  private bx!: Float64Array; // positions x
  private by!: Float64Array;
  private vx!: Float64Array; // velocities
  private vy!: Float64Array;
  private mass!: Float64Array;
  private trailLen = 0;
  private trailHead = 0;
  private trails!: Float32Array[]; // 3 trails, each trailLen*3 floats
  private trailLines!: THREE.Line[];
  private bodyPoints!: THREE.Points;
  private G = 0;
  private softening = 0;
  private cx = 0;
  private cy = 0;
  private scale = 0;

  build(): void {
    this.glitchAmount = 4;
    const variant = this.rng.int(0, 4);
    const presets = [
      { G: 500, soft: 15, trailLen: 300, masses: [1, 1, 1] },
      { G: 800, soft: 20, trailLen: 400, masses: [2, 1, 1] },
      { G: 350, soft: 10, trailLen: 250, masses: [1, 1.5, 0.8] },
      { G: 600, soft: 18, trailLen: 350, masses: [1.5, 1.5, 1] },
    ];
    const p = presets[variant];

    const { x, y, w, h } = this.px;
    this.cx = x + w / 2;
    this.cy = y + h / 2;
    this.scale = Math.min(w, h) * 0.35;
    this.G = p.G;
    this.softening = p.soft;
    this.trailLen = p.trailLen;

    this.bx = new Float64Array(3);
    this.by = new Float64Array(3);
    this.vx = new Float64Array(3);
    this.vy = new Float64Array(3);
    this.mass = new Float64Array(p.masses);

    // Initialize in a figure-8-like config
    const angles = [0, (2 * Math.PI) / 3, (4 * Math.PI) / 3];
    const r0 = 0.6;
    for (let i = 0; i < 3; i++) {
      const a = angles[i] + this.rng.float(-0.2, 0.2);
      this.bx[i] = Math.cos(a) * r0;
      this.by[i] = Math.sin(a) * r0;
      // Tangential velocity for quasi-stable orbit
      const speed = 0.4 + this.rng.float(-0.05, 0.05);
      this.vx[i] = -Math.sin(a) * speed;
      this.vy[i] = Math.cos(a) * speed;
    }

    // Zero out center-of-mass velocity
    let cmvx = 0, cmvy = 0, totalM = 0;
    for (let i = 0; i < 3; i++) { cmvx += this.vx[i] * this.mass[i]; cmvy += this.vy[i] * this.mass[i]; totalM += this.mass[i]; }
    for (let i = 0; i < 3; i++) { this.vx[i] -= cmvx / totalM; this.vy[i] -= cmvy / totalM; }

    const colors = [this.palette.primary, this.palette.secondary, this.palette.dim];
    this.trails = [];
    this.trailLines = [];
    this.trailHead = 0;

    for (let i = 0; i < 3; i++) {
      const arr = new Float32Array(this.trailLen * 3);
      const px = this.cx + this.bx[i] * this.scale;
      const py = this.cy + this.by[i] * this.scale;
      for (let t = 0; t < this.trailLen; t++) {
        arr[t * 3] = px;
        arr[t * 3 + 1] = py;
        arr[t * 3 + 2] = 0;
      }
      this.trails.push(arr);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
        color: colors[i], transparent: true, opacity: 0,
      }));
      this.group.add(line);
      this.trailLines.push(line);
    }

    // Body points
    const bodyPos = new Float32Array(9);
    const bodyGeo = new THREE.BufferGeometry();
    bodyGeo.setAttribute('position', new THREE.BufferAttribute(bodyPos, 3));
    this.bodyPoints = new THREE.Points(bodyGeo, new THREE.PointsMaterial({
      color: this.palette.primary, transparent: true, opacity: 0,
      size: 5, sizeAttenuation: false,
    }));
    this.group.add(this.bodyPoints);
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);
    const clampDt = Math.min(dt, 0.033);
    const steps = 8;
    const subDt = clampDt / steps;

    for (let s = 0; s < steps; s++) {
      this.leapfrogStep(subDt);
    }

    // Recenter to prevent drift
    let cmx = 0, cmy = 0, totalM = 0;
    for (let i = 0; i < 3; i++) { cmx += this.bx[i] * this.mass[i]; cmy += this.by[i] * this.mass[i]; totalM += this.mass[i]; }
    cmx /= totalM; cmy /= totalM;
    for (let i = 0; i < 3; i++) { this.bx[i] -= cmx; this.by[i] -= cmy; }

    // Clamp to bounds
    for (let i = 0; i < 3; i++) {
      const r = Math.sqrt(this.bx[i] * this.bx[i] + this.by[i] * this.by[i]);
      if (r > 1.5) {
        this.bx[i] *= 1.5 / r;
        this.by[i] *= 1.5 / r;
        this.vx[i] *= -0.5;
        this.vy[i] *= -0.5;
      }
    }

    // Record trail
    for (let i = 0; i < 3; i++) {
      const px = this.cx + this.bx[i] * this.scale;
      const py = this.cy + this.by[i] * this.scale;
      const idx = this.trailHead * 3;
      this.trails[i][idx] = px;
      this.trails[i][idx + 1] = py;
      this.trails[i][idx + 2] = 0;
    }
    this.trailHead = (this.trailHead + 1) % this.trailLen;

    // Update trail geometries (draw from trailHead forward = oldest to newest)
    for (let i = 0; i < 3; i++) {
      (this.trailLines[i].geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
      (this.trailLines[i].material as THREE.LineBasicMaterial).opacity = opacity * 0.5;
    }

    // Update body positions
    const bp = this.bodyPoints.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < 3; i++) {
      bp.setXYZ(i, this.cx + this.bx[i] * this.scale, this.cy + this.by[i] * this.scale, 0.5);
    }
    bp.needsUpdate = true;
    (this.bodyPoints.material as THREE.PointsMaterial).opacity = opacity;
  }

  private leapfrogStep(dt: number): void {
    const ax = new Float64Array(3);
    const ay = new Float64Array(3);
    this.computeAccel(ax, ay);
    for (let i = 0; i < 3; i++) {
      this.vx[i] += ax[i] * dt * 0.5;
      this.vy[i] += ay[i] * dt * 0.5;
      this.bx[i] += this.vx[i] * dt;
      this.by[i] += this.vy[i] * dt;
    }
    this.computeAccel(ax, ay);
    for (let i = 0; i < 3; i++) {
      this.vx[i] += ax[i] * dt * 0.5;
      this.vy[i] += ay[i] * dt * 0.5;
    }
  }

  private computeAccel(ax: Float64Array, ay: Float64Array): void {
    ax.fill(0); ay.fill(0);
    const eps2 = (this.softening / this.scale) * (this.softening / this.scale);
    for (let i = 0; i < 3; i++) {
      for (let j = i + 1; j < 3; j++) {
        const dx = this.bx[j] - this.bx[i];
        const dy = this.by[j] - this.by[i];
        const r2 = dx * dx + dy * dy + eps2;
        const inv = this.G / (this.scale * r2 * Math.sqrt(r2));
        ax[i] += dx * inv * this.mass[j]; ay[i] += dy * inv * this.mass[j];
        ax[j] -= dx * inv * this.mass[i]; ay[j] -= dy * inv * this.mass[i];
      }
    }
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      for (let i = 0; i < 3; i++) {
        this.vx[i] += this.rng.float(-0.3, 0.3);
        this.vy[i] += this.rng.float(-0.3, 0.3);
      }
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level >= 3) {
      for (let i = 0; i < 3; i++) {
        this.vx[i] *= 1 + level * 0.05;
        this.vy[i] *= 1 + level * 0.05;
      }
    }
  }
}
