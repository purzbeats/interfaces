import * as THREE from 'three';
import { BaseElement } from './base-element';
import { stateOpacity, pulse, glitchOffset } from '../animation/fx';

/**
 * Tactical grid with wandering point, trailing path, and coordinate readout.
 * Geometry-based grid lines with canvas overlay for coordinates.
 */
export class CoordGridElement extends BaseElement {
  private gridLines!: THREE.LineSegments;
  private pathLine!: THREE.Line;
  private pointMesh!: THREE.Mesh;
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private texture!: THREE.CanvasTexture;
  private labelMesh!: THREE.Mesh;
  private borderLines!: THREE.LineSegments;
  private pointX: number = 0;
  private pointY: number = 0;
  private pointVx: number = 0;
  private pointVy: number = 0;
  private trail: number[] = [];
  private maxTrail: number = 60;
  private pulseTimer: number = 0;
  private glitchTimer: number = 0;
  private renderAccum: number = 0;

  build(): void {
    const { x, y, w, h } = this.px;
    const minDim = Math.min(w, h);
    this.pointX = x + w / 2;
    this.pointY = y + h / 2;
    this.pointVx = this.rng.float(-30, 30);
    this.pointVy = this.rng.float(-30, 30);

    // Grid lines — scale spacing to region size (aim for 8-15 divisions on shortest axis)
    const divisions = this.rng.pick([8, 10, 12, 15]);
    const gridSpacing = Math.max(10, Math.floor(minDim / divisions));
    const gridVerts: number[] = [];
    // Vertical lines
    for (let gx2 = x; gx2 <= x + w; gx2 += gridSpacing) {
      gridVerts.push(gx2, y, 0, gx2, y + h, 0);
    }
    // Horizontal lines
    for (let gy = y; gy <= y + h; gy += gridSpacing) {
      gridVerts.push(x, gy, 0, x + w, gy, 0);
    }
    const gridGeo = new THREE.BufferGeometry();
    gridGeo.setAttribute('position', new THREE.Float32BufferAttribute(gridVerts, 3));
    this.gridLines = new THREE.LineSegments(gridGeo, new THREE.LineBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.gridLines);

    // Trail line
    const trailPos = new Float32Array(this.maxTrail * 3);
    const trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPos, 3));
    trailGeo.setDrawRange(0, 0);
    this.pathLine = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.pathLine);

    // Point indicator — scale to region
    const ptSize = Math.max(8, minDim * 0.025);
    const ptGeo = new THREE.PlaneGeometry(ptSize, ptSize);
    this.pointMesh = new THREE.Mesh(ptGeo, new THREE.MeshBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
    }));
    this.pointMesh.position.set(this.pointX, this.pointY, 2);
    this.group.add(this.pointMesh);

    // Coordinate label canvas — scale to region
    const scale = Math.min(2, window.devicePixelRatio);
    const labelW = Math.max(100, Math.min(w * 0.3, 300));
    const labelH = Math.max(20, Math.min(h * 0.04, 40));
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.ceil(labelW * scale);
    this.canvas.height = Math.ceil(labelH * scale);
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.LinearFilter;
    const labelGeo = new THREE.PlaneGeometry(labelW, labelH);
    this.labelMesh = new THREE.Mesh(labelGeo, new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      opacity: 0,
    }));
    this.labelMesh.position.set(x + labelW / 2 + 4, y + h - labelH / 2 - 8, 3);
    this.group.add(this.labelMesh);

    // Border
    const bv = new Float32Array([
      x, y, 0, x + w, y, 0,
      x + w, y, 0, x + w, y + h, 0,
      x + w, y + h, 0, x, y + h, 0,
      x, y + h, 0, x, y, 0,
    ]);
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.BufferAttribute(bv, 3));
    this.borderLines = new THREE.LineSegments(bg, new THREE.LineBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.borderLines);
  }

  update(dt: number, _time: number): void {
    let opacity = stateOpacity(this.stateMachine.state, this.stateMachine.progress);
    const { x, y, w, h } = this.px;

    if (this.pulseTimer > 0) {
      this.pulseTimer -= dt;
      opacity *= pulse(this.pulseTimer);
    }

    const gx = this.glitchTimer > 0 ? glitchOffset(this.glitchTimer, 4) : 0;
    if (this.glitchTimer > 0) this.glitchTimer -= dt;
    this.group.position.x = gx;

    // Move point with random acceleration — scale to region size
    const speed = Math.min(w, h) * 0.15;
    const maxSpeed = speed * 1.5;
    this.pointVx += this.rng.float(-speed * 2, speed * 2) * dt;
    this.pointVy += this.rng.float(-speed * 2, speed * 2) * dt;
    this.pointVx *= Math.exp(-1 * dt); // drag
    this.pointVy *= Math.exp(-1 * dt);
    this.pointVx = Math.max(-maxSpeed, Math.min(maxSpeed, this.pointVx));
    this.pointVy = Math.max(-maxSpeed, Math.min(maxSpeed, this.pointVy));

    this.pointX += this.pointVx * dt;
    this.pointY += this.pointVy * dt;

    // Bounce off bounds
    if (this.pointX < x + 4 || this.pointX > x + w - 4) {
      this.pointVx *= -1;
      this.pointX = Math.max(x + 4, Math.min(x + w - 4, this.pointX));
    }
    if (this.pointY < y + 4 || this.pointY > y + h - 4) {
      this.pointVy *= -1;
      this.pointY = Math.max(y + 4, Math.min(y + h - 4, this.pointY));
    }

    this.pointMesh.position.set(this.pointX, this.pointY, 2);

    // Update trail
    this.trail.push(this.pointX, this.pointY, 1);
    if (this.trail.length > this.maxTrail * 3) {
      this.trail.splice(0, 3);
    }

    const trailPos = this.pathLine.geometry.getAttribute('position') as THREE.BufferAttribute;
    const pointCount = this.trail.length / 3;
    for (let i = 0; i < pointCount; i++) {
      trailPos.setXYZ(i, this.trail[i * 3], this.trail[i * 3 + 1], this.trail[i * 3 + 2]);
    }
    trailPos.needsUpdate = true;
    this.pathLine.geometry.setDrawRange(0, pointCount);

    (this.gridLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.35;
    (this.pathLine.material as THREE.LineBasicMaterial).opacity = opacity * 0.8;
    (this.pointMesh.material as THREE.MeshBasicMaterial).opacity = opacity;
    (this.borderLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.6;

    // Render coordinate label
    this.renderAccum += dt;
    if (this.renderAccum >= 1 / 10) {
      this.renderAccum = 0;
      this.renderLabel();
    }
    (this.labelMesh.material as THREE.MeshBasicMaterial).opacity = opacity * 0.7;
  }

  private renderLabel(): void {
    const { ctx, canvas } = this;
    const { x, y, w, h } = this.px;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Normalize coordinates to grid space
    const nx = ((this.pointX - x) / w * 100).toFixed(1);
    const ny = ((this.pointY - y) / h * 100).toFixed(1);

    const text = `X:${nx} Y:${ny}`;
    const heightSize = Math.floor(canvas.height * 0.65);
    const widthSize = Math.floor(canvas.width / (text.length * 0.62));
    const size = Math.max(6, Math.min(heightSize, widthSize));
    ctx.font = `${size}px monospace`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#' + this.palette.primary.getHexString();
    ctx.fillText(text, 4, canvas.height / 2);

    this.texture.needsUpdate = true;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'pulse') this.pulseTimer = 0.5;
    if (action === 'glitch') {
      this.glitchTimer = 0.5;
      const { w, h } = this.px;
      const kick = Math.min(w, h) * 0.2;
      this.pointVx = this.rng.float(-kick, kick);
      this.pointVy = this.rng.float(-kick, kick);
    }
    if (action === 'alert') {
      this.pulseTimer = 1.5;
      // Center the point
      const { x, y, w, h } = this.px;
      this.pointX = x + w / 2;
      this.pointY = y + h / 2;
      this.trail = [];
    }
  }

  dispose(): void {
    this.texture.dispose();
    super.dispose();
  }
}
