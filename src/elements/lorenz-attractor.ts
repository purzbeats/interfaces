import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Lorenz strange attractor with multiple trailing particle traces.
 * Mesmerizing chaos theory visualization — the classic butterfly shape
 * rendered as luminous trails on a research terminal display.
 */
export class LorenzAttractorElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'lorenz-attractor',
    meta: { shape: 'rectangular', roles: ['data-display', 'decorative'], moods: ['diagnostic', 'ambient'], bandAffinity: 'mid', sizes: ['needs-medium', 'needs-large'] },
  };
  private traces: THREE.Line[] = [];
  private traceMaterials: THREE.LineBasicMaterial[] = [];
  private crosshairs!: THREE.LineSegments;
  private crosshairMat!: THREE.LineBasicMaterial;

  /* Lorenz system state per trace */
  private states: Array<{ x: number; y: number; z: number }> = [];
  private buffers: Array<{ positions: Float32Array; head: number; filled: boolean; count: number }> = [];

  /* Lorenz parameters */
  private sigma = 10;
  private rho = 28;
  private beta = 8 / 3;
  private integrationDt = 0.005;
  private substeps = 6;

  /* Projection */
  private cx = 0;
  private cy = 0;
  private scale = 1;
  private traceCount = 3;
  private pointsPerTrace = 600;

  build(): void {
    const variant = this.rng.int(0, 3);
    const presets = [
      { sigma: 10, rho: 28, beta: 8/3, traceMin: 2, traceMax: 3, pointsMin: 500, pointsMax: 800, substeps: 6, dt: 0.005 },
      { sigma: 10, rho: 28, beta: 8/3, traceMin: 3, traceMax: 4, pointsMin: 900, pointsMax: 1200, substeps: 10, dt: 0.004 },
      { sigma: 10, rho: 28, beta: 8/3, traceMin: 1, traceMax: 2, pointsMin: 300, pointsMax: 450, substeps: 4, dt: 0.006 },
      { sigma: 14, rho: 32, beta: 3.0, traceMin: 2, traceMax: 3, pointsMin: 600, pointsMax: 1000, substeps: 8, dt: 0.004 },
    ];
    const p = presets[variant];

    this.sigma = p.sigma + this.rng.float(-0.5, 0.5);
    this.rho = p.rho + this.rng.float(-1, 1);
    this.beta = p.beta + this.rng.float(-0.1, 0.1);
    this.integrationDt = p.dt;
    this.substeps = p.substeps;

    this.glitchAmount = 5;
    const { x, y, w, h } = this.px;
    this.cx = x + w / 2;
    this.cy = y + h / 2;
    this.scale = Math.min(w, h) / 55;

    this.traceCount = this.rng.int(p.traceMin, p.traceMax);
    this.pointsPerTrace = this.rng.int(p.pointsMin, p.pointsMax);

    const traceColors = [this.palette.primary, this.palette.secondary, this.palette.dim];

    // Initialize traces
    for (let t = 0; t < this.traceCount; t++) {
      // Slightly different initial conditions
      const offset = this.rng.float(0.1, 1.0);
      this.states.push({
        x: 1.0 + offset * (t + 1) * 0.7,
        y: 1.0 + offset * (t + 1) * 0.3,
        z: 1.0 + offset * (t + 1) * 0.5,
      });

      const count = this.pointsPerTrace;
      const positions = new Float32Array(count * 3);
      // Initialize all points to the starting projected position
      const px = this.projectX(this.states[t].x);
      const py = this.projectY(this.states[t].z);
      for (let i = 0; i < count; i++) {
        positions[i * 3] = px;
        positions[i * 3 + 1] = py;
        positions[i * 3 + 2] = 0;
      }
      this.buffers.push({ positions, head: 0, filled: false, count });

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geo.setDrawRange(0, 0);

      const mat = new THREE.LineBasicMaterial({
        color: traceColors[t % traceColors.length],
        transparent: true,
        opacity: 0,
      });
      this.traceMaterials.push(mat);

      const line = new THREE.Line(geo, mat);
      this.traces.push(line);
      this.group.add(line);
    }

    // Crosshair axes in background
    const chLen = Math.min(w, h) * 0.44;
    const chVerts = new Float32Array([
      // Horizontal
      this.cx - chLen, this.cy, -0.5,
      this.cx + chLen, this.cy, -0.5,
      // Vertical
      this.cx, this.cy - chLen, -0.5,
      this.cx, this.cy + chLen, -0.5,
      // Small ticks on horizontal
      this.cx - chLen * 0.5, this.cy - 3, -0.5,
      this.cx - chLen * 0.5, this.cy + 3, -0.5,
      this.cx + chLen * 0.5, this.cy - 3, -0.5,
      this.cx + chLen * 0.5, this.cy + 3, -0.5,
      // Small ticks on vertical
      this.cx - 3, this.cy - chLen * 0.5, -0.5,
      this.cx + 3, this.cy - chLen * 0.5, -0.5,
      this.cx - 3, this.cy + chLen * 0.5, -0.5,
      this.cx + 3, this.cy + chLen * 0.5, -0.5,
    ]);
    const chGeo = new THREE.BufferGeometry();
    chGeo.setAttribute('position', new THREE.BufferAttribute(chVerts, 3));
    this.crosshairMat = new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    });
    this.crosshairs = new THREE.LineSegments(chGeo, this.crosshairMat);
    this.group.add(this.crosshairs);

    // Warm up: run the system forward so the butterfly shape is partially visible on first draw
    for (let i = 0; i < 200; i++) {
      this.stepAll();
    }
  }

  /** Project Lorenz x -> screen x (uses Lorenz x axis) */
  private projectX(lx: number): number {
    return this.cx + lx * this.scale;
  }

  /** Project Lorenz z -> screen y (uses Lorenz z axis, offset so attractor is centered) */
  private projectY(lz: number): number {
    // Center of attractor is roughly z=25
    return this.cy + (lz - 25) * this.scale;
  }

  /** Euler integration step for the Lorenz system */
  private lorenzStep(s: { x: number; y: number; z: number }, dt: number): void {
    const dx = this.sigma * (s.y - s.x);
    const dy = s.x * (this.rho - s.z) - s.y;
    const dz = s.x * s.y - this.beta * s.z;
    s.x += dx * dt;
    s.y += dy * dt;
    s.z += dz * dt;
  }

  /** Advance all traces by one integration cycle and write new head positions */
  private stepAll(): void {
    for (let t = 0; t < this.traceCount; t++) {
      const state = this.states[t];
      const buf = this.buffers[t];

      // RK4 integration for accuracy
      for (let sub = 0; sub < this.substeps; sub++) {
        const dt = this.integrationDt;
        const s = state;

        // k1
        const k1x = this.sigma * (s.y - s.x);
        const k1y = s.x * (this.rho - s.z) - s.y;
        const k1z = s.x * s.y - this.beta * s.z;

        // k2
        const mx = s.x + k1x * dt * 0.5;
        const my = s.y + k1y * dt * 0.5;
        const mz = s.z + k1z * dt * 0.5;
        const k2x = this.sigma * (my - mx);
        const k2y = mx * (this.rho - mz) - my;
        const k2z = mx * my - this.beta * mz;

        // k3
        const nx = s.x + k2x * dt * 0.5;
        const ny = s.y + k2y * dt * 0.5;
        const nz = s.z + k2z * dt * 0.5;
        const k3x = this.sigma * (ny - nx);
        const k3y = nx * (this.rho - nz) - ny;
        const k3z = nx * ny - this.beta * nz;

        // k4
        const ex = s.x + k3x * dt;
        const ey = s.y + k3y * dt;
        const ez = s.z + k3z * dt;
        const k4x = this.sigma * (ey - ex);
        const k4y = ex * (this.rho - ez) - ey;
        const k4z = ex * ey - this.beta * ez;

        s.x += (k1x + 2 * k2x + 2 * k3x + k4x) * dt / 6;
        s.y += (k1y + 2 * k2y + 2 * k3y + k4y) * dt / 6;
        s.z += (k1z + 2 * k2z + 2 * k3z + k4z) * dt / 6;
      }

      // Write new position at head
      const idx = buf.head * 3;
      buf.positions[idx] = this.projectX(state.x);
      buf.positions[idx + 1] = this.projectY(state.z);
      buf.positions[idx + 2] = 0;

      buf.head = (buf.head + 1) % buf.count;
      if (buf.head === 0) buf.filled = true;
    }
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);

    // Run integration substeps based on real dt (aim for smooth continuous feel)
    const steps = Math.max(1, Math.min(8, Math.round(dt / 0.016)));
    for (let i = 0; i < steps; i++) {
      this.stepAll();
    }

    // Update geometry draw ranges and mark for GPU upload
    for (let t = 0; t < this.traceCount; t++) {
      const buf = this.buffers[t];
      const geo = this.traces[t].geometry;
      const posAttr = geo.getAttribute('position') as THREE.BufferAttribute;
      posAttr.needsUpdate = true;

      const drawCount = buf.filled ? buf.count : buf.head;
      geo.setDrawRange(0, drawCount);

      // Trace opacity: primary trace brightest, others dimmer
      const traceOpacity = t === 0 ? 0.9 : t === 1 ? 0.65 : 0.4;
      this.traceMaterials[t].opacity = opacity * traceOpacity;
    }

    this.crosshairMat.opacity = opacity * 0.12;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Perturb all trajectories
      for (const state of this.states) {
        state.x += (this.rng.next() - 0.5) * 5;
        state.y += (this.rng.next() - 0.5) * 5;
        state.z += (this.rng.next() - 0.5) * 5;
      }
    }
    if (action === 'alert') {
      // Reset all trajectories to new random initial conditions near the attractor
      for (let t = 0; t < this.states.length; t++) {
        this.states[t].x = (this.rng.next() - 0.5) * 10;
        this.states[t].y = (this.rng.next() - 0.5) * 10;
        this.states[t].z = 20 + this.rng.next() * 15;
        // Clear trail buffers so fresh traces draw
        this.buffers[t].head = 0;
        this.buffers[t].filled = false;
      }
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) return;
    // Parameter nudge proportional to level
    for (const state of this.states) {
      state.x += (this.rng.next() - 0.5) * level * 0.5;
      state.y += (this.rng.next() - 0.5) * level * 0.5;
    }
    if (level >= 5) {
      // Bifurcation: reset to new random initial conditions
      for (let t = 0; t < this.states.length; t++) {
        this.states[t].x = (this.rng.next() - 0.5) * 10;
        this.states[t].y = (this.rng.next() - 0.5) * 10;
        this.states[t].z = 20 + this.rng.next() * 15;
        this.buffers[t].head = 0;
        this.buffers[t].filled = false;
      }
    }
  }
}
