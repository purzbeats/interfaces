import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Animated Mobius strip wireframe with a particle tracing the surface,
 * demonstrating the single-sided topology. The strip rotates slowly
 * while the tracer moves along it, crossing what appears to be both sides.
 */
export class MobiusStripElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'mobius-strip',
    meta: {
      shape: 'radial',
      roles: ['decorative'],
      moods: ['ambient'],
      sizes: ['needs-medium', 'needs-large'],
    } satisfies ElementMeta,
  };

  private stripLines!: THREE.LineSegments;
  private stripPositions!: Float32Array;
  private stripMat!: THREE.LineBasicMaterial;
  private tracerMesh!: THREE.Points;
  private tracerPositions!: Float32Array;
  private tracerMat!: THREE.PointsMaterial;
  private trailMesh!: THREE.Points;
  private trailPositions!: Float32Array;
  private trailMat!: THREE.PointsMaterial;
  private borderLines!: THREE.LineSegments;
  private borderMat!: THREE.LineBasicMaterial;

  private cx: number = 0;
  private cy: number = 0;
  private majorRadius: number = 0;
  private stripWidth: number = 0;
  private uSegments: number = 0;
  private vSegments: number = 0;
  private rotSpeed: number = 0;
  private tracerSpeed: number = 0;
  private tracerPhase: number = 0;
  private tiltX: number = 0;
  private tiltY: number = 0;
  private trailLength: number = 0;
  private trailHistory: { x: number; y: number }[] = [];
  private intensityLevel: number = 0;

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;
    this.cx = x + w / 2;
    this.cy = y + h / 2;
    const minDim = Math.min(w, h);
    this.majorRadius = minDim * 0.32;
    this.stripWidth = minDim * 0.12;

    const variant = this.rng.int(0, 3);
    const presets = [
      { uSeg: 60, vSeg: 6, rot: 0.2, tSpeed: 0.4, tiltX: 0.8, tiltY: 0.3, trail: 30 },
      { uSeg: 80, vSeg: 8, rot: 0.12, tSpeed: 0.3, tiltX: 1.0, tiltY: 0.5, trail: 50 },
      { uSeg: 40, vSeg: 4, rot: 0.35, tSpeed: 0.6, tiltX: 0.6, tiltY: 0.2, trail: 20 },
      { uSeg: 100, vSeg: 10, rot: -0.15, tSpeed: 0.25, tiltX: 0.9, tiltY: 0.4, trail: 40 },
    ];
    const p = presets[variant];
    this.uSegments = p.uSeg;
    this.vSegments = p.vSeg;
    this.rotSpeed = p.rot;
    this.tracerSpeed = p.tSpeed;
    this.tiltX = p.tiltX;
    this.tiltY = p.tiltY;
    this.trailLength = p.trail;

    // Strip wireframe: u-lines + v-lines
    const uLines = (this.uSegments) * this.vSegments; // along u
    const vLines = this.uSegments * (this.vSegments); // along v
    const totalSegs = uLines + vLines;
    this.stripPositions = new Float32Array(totalSegs * 2 * 3);
    const stripGeo = new THREE.BufferGeometry();
    stripGeo.setAttribute('position', new THREE.BufferAttribute(this.stripPositions, 3));
    this.stripMat = new THREE.LineBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
    });
    this.stripLines = new THREE.LineSegments(stripGeo, this.stripMat);
    this.group.add(this.stripLines);

    // Tracer point
    this.tracerPositions = new Float32Array(3);
    const tracerGeo = new THREE.BufferGeometry();
    tracerGeo.setAttribute('position', new THREE.BufferAttribute(this.tracerPositions, 3));
    this.tracerMat = new THREE.PointsMaterial({
      color: this.palette.secondary,
      transparent: true,
      opacity: 0,
      size: 5,
      sizeAttenuation: false,
    });
    this.tracerMesh = new THREE.Points(tracerGeo, this.tracerMat);
    this.group.add(this.tracerMesh);

    // Trail
    this.trailPositions = new Float32Array(this.trailLength * 3);
    const trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute('position', new THREE.BufferAttribute(this.trailPositions, 3));
    this.trailMat = new THREE.PointsMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
      size: 2,
      sizeAttenuation: false,
    });
    this.trailMesh = new THREE.Points(trailGeo, this.trailMat);
    this.group.add(this.trailMesh);

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

  private mobiusPoint(u: number, v: number, rot: number): { x: number; y: number; z: number } {
    // u in [0, 2*PI], v in [-1, 1]
    // Mobius strip parametric equations
    const halfU = u / 2;
    const px = (this.majorRadius + v * this.stripWidth * Math.cos(halfU)) * Math.cos(u);
    const py = (this.majorRadius + v * this.stripWidth * Math.cos(halfU)) * Math.sin(u);
    const pz = v * this.stripWidth * Math.sin(halfU);
    return { x: px, y: py, z: pz };
  }

  private project(p: { x: number; y: number; z: number }, rot: number): { x: number; y: number } {
    // Rotate around X
    const cosX = Math.cos(this.tiltX);
    const sinX = Math.sin(this.tiltX);
    const y1 = p.y * cosX - p.z * sinX;
    const z1 = p.y * sinX + p.z * cosX;
    // Rotate around Y (time rotation)
    const cosR = Math.cos(rot);
    const sinR = Math.sin(rot);
    const x2 = p.x * cosR - z1 * sinR;
    const z2 = p.x * sinR + z1 * cosR;
    const persp = 1.0 / (1.0 + z2 * 0.002);
    return { x: this.cx + x2 * persp, y: this.cy + y1 * persp };
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    const rot = time * this.rotSpeed;

    let vi = 0;
    const TWO_PI = Math.PI * 2;

    // Draw u-direction lines (along the strip)
    for (let v = 0; v < this.vSegments; v++) {
      const vn = (v / (this.vSegments - 1)) * 2 - 1;
      for (let u = 0; u < this.uSegments; u++) {
        const u0 = (u / this.uSegments) * TWO_PI;
        const u1 = ((u + 1) / this.uSegments) * TWO_PI;
        const p0 = this.project(this.mobiusPoint(u0, vn, rot), rot);
        const p1 = this.project(this.mobiusPoint(u1, vn, rot), rot);
        this.stripPositions[vi++] = p0.x; this.stripPositions[vi++] = p0.y; this.stripPositions[vi++] = 0;
        this.stripPositions[vi++] = p1.x; this.stripPositions[vi++] = p1.y; this.stripPositions[vi++] = 0;
      }
    }

    // Draw v-direction lines (across the strip)
    for (let u = 0; u < this.uSegments; u++) {
      const un = (u / this.uSegments) * TWO_PI;
      for (let v = 0; v < this.vSegments; v++) {
        const v0 = (v / (this.vSegments - 1)) * 2 - 1;
        const v1 = ((v + 1) / (this.vSegments - 1)) * 2 - 1;
        if (v + 1 >= this.vSegments) {
          // last v seg, just repeat
          const pp = this.project(this.mobiusPoint(un, v0, rot), rot);
          this.stripPositions[vi++] = pp.x; this.stripPositions[vi++] = pp.y; this.stripPositions[vi++] = 0;
          this.stripPositions[vi++] = pp.x; this.stripPositions[vi++] = pp.y; this.stripPositions[vi++] = 0;
        } else {
          const p0 = this.project(this.mobiusPoint(un, v0, rot), rot);
          const p1 = this.project(this.mobiusPoint(un, v1, rot), rot);
          this.stripPositions[vi++] = p0.x; this.stripPositions[vi++] = p0.y; this.stripPositions[vi++] = 0;
          this.stripPositions[vi++] = p1.x; this.stripPositions[vi++] = p1.y; this.stripPositions[vi++] = 0;
        }
      }
    }

    const sPos = this.stripLines.geometry.getAttribute('position') as THREE.BufferAttribute;
    sPos.needsUpdate = true;

    // Tracer: travels around the strip, u goes 0..4*PI to traverse both "sides"
    this.tracerPhase += dt * this.tracerSpeed;
    const tracerU = (this.tracerPhase % 2) * Math.PI * 2;
    const tracerV = Math.sin(this.tracerPhase * 3) * 0.5;
    const tp = this.project(this.mobiusPoint(tracerU, tracerV, rot), rot);
    this.tracerPositions[0] = tp.x;
    this.tracerPositions[1] = tp.y;
    this.tracerPositions[2] = 0.2;
    const tPos = this.tracerMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    tPos.needsUpdate = true;

    // Trail
    this.trailHistory.push({ x: tp.x, y: tp.y });
    if (this.trailHistory.length > this.trailLength) {
      this.trailHistory.shift();
    }
    for (let i = 0; i < this.trailLength; i++) {
      if (i < this.trailHistory.length) {
        this.trailPositions[i * 3] = this.trailHistory[i].x;
        this.trailPositions[i * 3 + 1] = this.trailHistory[i].y;
        this.trailPositions[i * 3 + 2] = 0.1;
      }
    }
    const trPos = this.trailMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    trPos.needsUpdate = true;

    this.stripMat.opacity = opacity * 0.5;
    this.tracerMat.opacity = opacity;
    this.trailMat.opacity = opacity * 0.3;
    this.borderMat.opacity = opacity * 0.2;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') { this.rotSpeed *= -1; }
    if (action === 'pulse') { this.tracerSpeed *= 3; setTimeout(() => { this.tracerSpeed /= 3; }, 500); }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    this.intensityLevel = level;
    if (level === 0) return;
    this.rotSpeed = Math.sign(this.rotSpeed || 1) * (0.2 + level * 0.06);
  }
}
