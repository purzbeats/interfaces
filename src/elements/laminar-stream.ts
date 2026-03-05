import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Potential flow streamlines around a circular obstacle.
 * Tracers animate along streamlines computed from the analytical
 * solution for inviscid flow past a cylinder.
 */
export class LaminarStreamElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'laminar-stream',
    meta: { shape: 'rectangular', roles: ['data-display', 'decorative'], moods: ['ambient', 'tactical'], bandAffinity: 'bass', sizes: ['needs-medium', 'needs-large'] },
  };

  private streamCount = 0;
  private tracersPerStream = 0;
  private tracerT!: Float32Array;   // parameter along streamline [0..1]
  private tracerSpeed!: Float32Array;
  private obstacleR = 0;
  private obsCX = 0;
  private obsCY = 0;
  private flowSpeed = 1;

  private tracerPoints!: THREE.Points;
  private streamLines!: THREE.Line;
  private obstacleLine!: THREE.Line;
  private borderLines!: THREE.LineSegments;

  build(): void {
    this.glitchAmount = 4;
    const variant = this.rng.int(0, 3);
    const presets = [
      { streams: 12, tracers: 6, obstR: 0.15, speed: 0.3 },
      { streams: 20, tracers: 4, obstR: 0.1, speed: 0.5 },
      { streams: 8, tracers: 8, obstR: 0.2, speed: 0.2 },
      { streams: 16, tracers: 5, obstR: 0.12, speed: 0.4 },
    ];
    const p = presets[variant];

    const { x, y, w, h } = this.px;
    this.streamCount = p.streams;
    this.tracersPerStream = p.tracers;
    this.obstacleR = Math.min(w, h) * p.obstR;
    this.obsCX = x + w * 0.4;
    this.obsCY = y + h * 0.5;
    this.flowSpeed = p.speed;

    const totalTracers = this.streamCount * this.tracersPerStream;
    this.tracerT = new Float32Array(totalTracers);
    this.tracerSpeed = new Float32Array(totalTracers);

    for (let i = 0; i < totalTracers; i++) {
      this.tracerT[i] = this.rng.float(0, 1);
      this.tracerSpeed[i] = this.flowSpeed * this.rng.float(0.8, 1.2);
    }

    // Precompute streamline paths (discretized)
    const segsPerStream = 60;
    const streamPositions = new Float32Array(this.streamCount * (segsPerStream + 1) * 3);
    let vi = 0;
    for (let s = 0; s < this.streamCount; s++) {
      const y0 = y + h * 0.05 + (s / (this.streamCount - 1)) * h * 0.9;
      for (let k = 0; k <= segsPerStream; k++) {
        const t = k / segsPerStream;
        const sx = x + t * w;
        const sy = this.streamlineY(sx, y0);
        streamPositions[vi++] = sx;
        streamPositions[vi++] = sy;
        streamPositions[vi++] = 0;
      }
    }
    const streamGeo = new THREE.BufferGeometry();
    streamGeo.setAttribute('position', new THREE.BufferAttribute(streamPositions, 3));
    // Use groups to render multiple separate line strips
    for (let s = 0; s < this.streamCount; s++) {
      streamGeo.addGroup(s * (segsPerStream + 1), segsPerStream + 1, 0);
    }
    this.streamLines = new THREE.Line(streamGeo, new THREE.LineBasicMaterial({
      color: this.palette.dim, transparent: true, opacity: 0,
    }));
    this.group.add(this.streamLines);

    // Tracer points
    const tracerPositions = new Float32Array(totalTracers * 3);
    const tracerGeo = new THREE.BufferGeometry();
    tracerGeo.setAttribute('position', new THREE.BufferAttribute(tracerPositions, 3));
    this.tracerPoints = new THREE.Points(tracerGeo, new THREE.PointsMaterial({
      color: this.palette.primary, transparent: true, opacity: 0,
      size: 3, sizeAttenuation: false,
    }));
    this.group.add(this.tracerPoints);

    // Obstacle circle
    const circSegs = 48;
    const circPositions = new Float32Array((circSegs + 1) * 3);
    for (let i = 0; i <= circSegs; i++) {
      const a = (i / circSegs) * Math.PI * 2;
      circPositions[i * 3] = this.obsCX + Math.cos(a) * this.obstacleR;
      circPositions[i * 3 + 1] = this.obsCY + Math.sin(a) * this.obstacleR;
      circPositions[i * 3 + 2] = 0;
    }
    const circGeo = new THREE.BufferGeometry();
    circGeo.setAttribute('position', new THREE.BufferAttribute(circPositions, 3));
    this.obstacleLine = new THREE.Line(circGeo, new THREE.LineBasicMaterial({
      color: this.palette.secondary, transparent: true, opacity: 0,
    }));
    this.group.add(this.obstacleLine);

    // Border
    const bv = [x, y, 0, x + w, y, 0, x + w, y, 0, x + w, y + h, 0,
      x + w, y + h, 0, x, y + h, 0, x, y + h, 0, x, y, 0];
    const borderGeo = new THREE.BufferGeometry();
    borderGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(bv), 3));
    this.borderLines = new THREE.LineSegments(borderGeo, new THREE.LineBasicMaterial({
      color: this.palette.dim, transparent: true, opacity: 0,
    }));
    this.group.add(this.borderLines);
  }

  /** Deflect y based on potential flow around cylinder */
  private streamlineY(sx: number, y0: number): number {
    const dx = sx - this.obsCX;
    const dy = y0 - this.obsCY;
    const r2 = dx * dx + dy * dy;
    const R2 = this.obstacleR * this.obstacleR;
    if (r2 < R2 * 1.1) {
      // Push away from obstacle
      const angle = Math.atan2(dy, dx);
      return this.obsCY + Math.sign(dy) * this.obstacleR * 1.05 + dy * 0.3;
    }
    // Potential flow: stream function psi = U*(y - R^2*y/r^2)
    // Deflection: delta_y = R^2 * dy / r^2 (approximate displacement)
    const deflection = R2 * dy / r2;
    return y0 + deflection * 0.5;
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);
    const { x, y, w, h } = this.px;
    const totalTracers = this.streamCount * this.tracersPerStream;

    // Move tracers
    const pos = this.tracerPoints.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let s = 0; s < this.streamCount; s++) {
      const y0 = y + h * 0.05 + (s / (this.streamCount - 1)) * h * 0.9;
      for (let t = 0; t < this.tracersPerStream; t++) {
        const idx = s * this.tracersPerStream + t;
        this.tracerT[idx] += this.tracerSpeed[idx] * dt;
        if (this.tracerT[idx] > 1) this.tracerT[idx] -= 1;

        const sx = x + this.tracerT[idx] * w;
        const sy = this.streamlineY(sx, y0);
        pos.setXYZ(idx, sx, sy, 0.5);
      }
    }
    pos.needsUpdate = true;

    (this.tracerPoints.material as THREE.PointsMaterial).opacity = opacity;
    (this.streamLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.15;
    (this.obstacleLine.material as THREE.LineBasicMaterial).opacity = opacity * 0.6;
    (this.borderLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.25;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      for (let i = 0; i < this.tracerT.length; i++) {
        this.tracerT[i] = this.rng.float(0, 1);
      }
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) { this.flowSpeed = 0.3; return; }
    this.flowSpeed = 0.3 * (1 + level * 0.2);
    for (let i = 0; i < this.tracerSpeed.length; i++) {
      this.tracerSpeed[i] = this.flowSpeed * this.rng.float(0.8, 1.2);
    }
  }
}
