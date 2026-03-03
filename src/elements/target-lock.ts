import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Animated targeting reticle that tracks a wandering point —
 * concentric circles, rotating crosshairs, and distance readout.
 */
export class TargetLockElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'target-lock',
    meta: { shape: 'radial', roles: ['scanner', 'gauge'], moods: ['tactical'], bandAffinity: 'bass', sizes: ['needs-medium', 'needs-large'] },
  };
  private outerRing!: THREE.Line;
  private innerRing!: THREE.Line;
  private crosshairs!: THREE.LineSegments;
  private tickMarks!: THREE.LineSegments;
  private targetDot!: THREE.Points;
  private canvas!: HTMLCanvasElement;
  private canvasCtx!: CanvasRenderingContext2D;
  private texture!: THREE.CanvasTexture;
  private labelMesh!: THREE.Mesh;
  private cx: number = 0;
  private cy: number = 0;
  private radius: number = 0;
  private targetX: number = 0;
  private targetY: number = 0;
  private targetVx: number = 0;
  private targetVy: number = 0;
  private reticleAngle: number = 0;
  private locked: boolean = false;
  private lockTimer: number = 0;
  private renderAccum: number = 0;

  build(): void {
    const variant = this.rng.int(0, 3);
    const presets = [
      { outerPts: 64, innerPts: 48, tickCount: 36, targetSpeed: 20, dotSize: 5 },    // Standard
      { outerPts: 128, innerPts: 96, tickCount: 72, targetSpeed: 45, dotSize: 7 },    // Dense/Intense
      { outerPts: 32, innerPts: 24, tickCount: 12, targetSpeed: 10, dotSize: 4 },     // Minimal/Sparse
      { outerPts: 48, innerPts: 64, tickCount: 24, targetSpeed: 60, dotSize: 8 },     // Exotic/Alt
    ];
    const p = presets[variant];

    this.glitchAmount = 5;
    const { x, y, w, h } = this.px;
    this.cx = x + w / 2;
    this.cy = y + h / 2;
    this.radius = Math.min(w, h) * 0.42;

    this.targetX = this.cx + this.rng.float(-this.radius * 0.3, this.radius * 0.3);
    this.targetY = this.cy + this.rng.float(-this.radius * 0.3, this.radius * 0.3);
    this.targetVx = this.rng.float(-p.targetSpeed, p.targetSpeed);
    this.targetVy = this.rng.float(-p.targetSpeed, p.targetSpeed);

    // Outer ring
    const outerPts = p.outerPts;
    const outerPositions = new Float32Array(outerPts * 3);
    for (let i = 0; i < outerPts; i++) {
      const a = (i / (outerPts - 1)) * Math.PI * 2;
      outerPositions[i * 3] = this.cx + Math.cos(a) * this.radius;
      outerPositions[i * 3 + 1] = this.cy + Math.sin(a) * this.radius;
      outerPositions[i * 3 + 2] = 0;
    }
    const outerGeo = new THREE.BufferGeometry();
    outerGeo.setAttribute('position', new THREE.BufferAttribute(outerPositions, 3));
    this.outerRing = new THREE.Line(outerGeo, new THREE.LineBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.outerRing);

    // Inner ring (tracks target position)
    const innerPts = p.innerPts;
    const innerPositions = new Float32Array(innerPts * 3);
    const innerGeo = new THREE.BufferGeometry();
    innerGeo.setAttribute('position', new THREE.BufferAttribute(innerPositions, 3));
    this.innerRing = new THREE.Line(innerGeo, new THREE.LineBasicMaterial({
      color: this.palette.secondary,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.innerRing);

    // Crosshairs (4 lines from center outward with gap)
    const crossPositions = new Float32Array(8 * 3); // 4 segments × 2 endpoints
    const crossGeo = new THREE.BufferGeometry();
    crossGeo.setAttribute('position', new THREE.BufferAttribute(crossPositions, 3));
    this.crosshairs = new THREE.LineSegments(crossGeo, new THREE.LineBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.crosshairs);

    // Tick marks around outer ring
    const tickVerts: number[] = [];
    for (let i = 0; i < p.tickCount; i++) {
      const a = (i / p.tickCount) * Math.PI * 2;
      const isMajor = i % Math.max(1, Math.floor(p.tickCount / 4)) === 0;
      const innerR = this.radius * (isMajor ? 0.88 : 0.93);
      tickVerts.push(
        this.cx + Math.cos(a) * innerR, this.cy + Math.sin(a) * innerR, 0,
        this.cx + Math.cos(a) * this.radius, this.cy + Math.sin(a) * this.radius, 0,
      );
    }
    const tickGeo = new THREE.BufferGeometry();
    tickGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(tickVerts), 3));
    this.tickMarks = new THREE.LineSegments(tickGeo, new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.tickMarks);

    // Target dot
    const dotGeo = new THREE.BufferGeometry();
    dotGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0]), 3));
    this.targetDot = new THREE.Points(dotGeo, new THREE.PointsMaterial({
      color: this.palette.alert,
      transparent: true,
      opacity: 0,
      size: p.dotSize,
      sizeAttenuation: false,
    }));
    this.group.add(this.targetDot);

    // Canvas label — scale to radius
    const labelW = this.radius * 0.8;
    const labelH = this.radius * 0.2;
    const scale = Math.min(2, window.devicePixelRatio);
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.ceil(labelW * scale);
    this.canvas.height = Math.ceil(labelH * scale);
    this.canvasCtx = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.LinearFilter;
    const labelGeo = new THREE.PlaneGeometry(labelW, labelH);
    this.labelMesh = new THREE.Mesh(labelGeo, new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      opacity: 0,
    }));
    this.labelMesh.position.set(this.cx, this.cy - this.radius * 0.7, 1);
    this.group.add(this.labelMesh);
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);

    // Wander target
    this.targetVx += (Math.random() - 0.5) * 80 * dt;
    this.targetVy += (Math.random() - 0.5) * 80 * dt;
    this.targetVx *= Math.exp(-1.5 * dt);
    this.targetVy *= Math.exp(-1.5 * dt);
    this.targetX += this.targetVx * dt;
    this.targetY += this.targetVy * dt;

    // Keep in bounds
    const bound = this.radius * 0.6;
    if (Math.abs(this.targetX - this.cx) > bound) this.targetVx *= -1;
    if (Math.abs(this.targetY - this.cy) > bound) this.targetVy *= -1;
    this.targetX = Math.max(this.cx - bound, Math.min(this.cx + bound, this.targetX));
    this.targetY = Math.max(this.cy - bound, Math.min(this.cy + bound, this.targetY));

    // Lock detection
    const dist = Math.sqrt((this.targetX - this.cx) ** 2 + (this.targetY - this.cy) ** 2);
    if (dist < this.radius * 0.15) {
      this.lockTimer += dt;
      this.locked = this.lockTimer > 0.5;
    } else {
      this.lockTimer = Math.max(0, this.lockTimer - dt * 2);
      this.locked = false;
    }

    // Rotating crosshairs
    this.reticleAngle += (this.locked ? 3 : 1) * dt;
    const crossPos = this.crosshairs.geometry.getAttribute('position') as THREE.BufferAttribute;
    const gap = this.radius * 0.12;
    const len = this.radius * 0.35;
    for (let i = 0; i < 4; i++) {
      const a = this.reticleAngle + (Math.PI / 2) * i;
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      crossPos.setXYZ(i * 2, this.cx + cos * gap, this.cy + sin * gap, 0);
      crossPos.setXYZ(i * 2 + 1, this.cx + cos * len, this.cy + sin * len, 0);
    }
    crossPos.needsUpdate = true;

    // Inner ring follows target
    const innerR = this.radius * (this.locked ? 0.18 : 0.25);
    const innerPos = this.innerRing.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < innerPos.count; i++) {
      const a = (i / (innerPos.count - 1)) * Math.PI * 2;
      innerPos.setXYZ(i, this.targetX + Math.cos(a) * innerR, this.targetY + Math.sin(a) * innerR, 0);
    }
    innerPos.needsUpdate = true;

    // Target dot
    const dotPos = this.targetDot.geometry.getAttribute('position') as THREE.BufferAttribute;
    dotPos.setXYZ(0, this.targetX, this.targetY, 0);
    dotPos.needsUpdate = true;

    // Opacities
    const lockFlash = this.locked ? 0.7 + 0.3 * Math.sin(time * 12) : 1;
    (this.outerRing.material as THREE.LineBasicMaterial).opacity = opacity * 0.5;
    (this.innerRing.material as THREE.LineBasicMaterial).opacity = opacity * 0.7 * lockFlash;
    (this.crosshairs.material as THREE.LineBasicMaterial).opacity = opacity * 0.8;
    (this.tickMarks.material as THREE.LineBasicMaterial).opacity = opacity * 0.3;
    (this.targetDot.material as THREE.PointsMaterial).opacity = opacity * 0.9;
    if (this.locked) {
      (this.innerRing.material as THREE.LineBasicMaterial).color.copy(this.palette.alert);
    } else {
      (this.innerRing.material as THREE.LineBasicMaterial).color.copy(this.palette.secondary);
    }

    // Label
    this.renderAccum += dt;
    if (this.renderAccum > 0.1) {
      this.renderAccum = 0;
      const ctx = this.canvasCtx;
      const cw = this.canvas.width;
      const ch = this.canvas.height;
      ctx.clearRect(0, 0, cw, ch);
      const hex = '#' + this.palette.primary.getHexString();
      ctx.fillStyle = hex;
      const text = this.locked ? 'LOCKED' : `DST: ${dist.toFixed(0)}`;
      const heightSize = Math.floor(ch * 0.6);
      const widthSize = Math.floor(cw / (text.length * 0.62));
      const fontSize = Math.max(6, Math.min(heightSize, widthSize));
      ctx.font = `${fontSize}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, cw / 2, ch / 2);
      this.texture.needsUpdate = true;
    }
    (this.labelMesh.material as THREE.MeshBasicMaterial).opacity = opacity * 0.8;
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) return;
    // Wander amplitude scales with level
    const kick = level * (level >= 3 ? 40 : 15);
    this.targetVx += this.rng.float(-1, 1) * kick;
    this.targetVy += this.rng.float(-1, 1) * kick;
    // Velocity burst at high levels makes target harder to track
    if (level >= 3) {
      this.targetVx *= 1 + level * 0.15;
      this.targetVy *= 1 + level * 0.15;
    }
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      this.targetVx += (Math.random() - 0.5) * 200;
      this.targetVy += (Math.random() - 0.5) * 200;
    }
  }

  dispose(): void {
    this.texture.dispose();
    super.dispose();
  }
}
