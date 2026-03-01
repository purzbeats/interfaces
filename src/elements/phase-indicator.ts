import * as THREE from 'three';
import { BaseElement } from './base-element';
import { stateOpacity, pulse, glitchOffset } from '../animation/fx';

/**
 * Radial tick ring with animated needle (vertex-based, not rotation).
 * Center readout showing current phase angle/value.
 */
export class PhaseIndicatorElement extends BaseElement {
  private tickRing!: THREE.LineSegments;
  private needle!: THREE.Line;
  private centerDot!: THREE.Mesh;
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private texture!: THREE.CanvasTexture;
  private labelMesh!: THREE.Mesh;
  private value: number = 0;
  private targetValue: number = 0;
  private velocity: number = 0;
  private cycleTimer: number = 0;
  private pulseTimer: number = 0;
  private glitchTimer: number = 0;
  private renderAccum: number = 0;
  private tickCount: number = 36;
  private label: string = '';

  build(): void {
    const { x, y, w, h } = this.px;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const radius = Math.min(w, h) / 2 * 0.85;
    this.targetValue = this.rng.float(0, 1);
    this.label = this.rng.pick(['PHASE', 'ANGLE', 'BEARING', 'HEADING', 'AZM', 'VECTOR']);

    // Tick marks around the ring
    this.tickCount = this.rng.pick([24, 36, 48]);
    const tickVerts: number[] = [];
    for (let i = 0; i < this.tickCount; i++) {
      const a = (i / this.tickCount) * Math.PI * 2 - Math.PI / 2;
      const isMajor = i % (this.tickCount / 4) === 0;
      const isMinor = i % (this.tickCount / 12) === 0;
      const innerR = isMajor ? radius * 0.7 : isMinor ? radius * 0.8 : radius * 0.88;
      tickVerts.push(
        cx + Math.cos(a) * innerR, cy + Math.sin(a) * innerR, 0,
        cx + Math.cos(a) * radius, cy + Math.sin(a) * radius, 0,
      );
    }
    const tickGeo = new THREE.BufferGeometry();
    tickGeo.setAttribute('position', new THREE.Float32BufferAttribute(tickVerts, 3));
    this.tickRing = new THREE.LineSegments(tickGeo, new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.tickRing);

    // Needle (line from center to edge, updated via vertex positions)
    const needleGeo = new THREE.BufferGeometry();
    const needlePos = new Float32Array([cx, cy, 1, cx, cy + radius * 0.9, 1]);
    needleGeo.setAttribute('position', new THREE.BufferAttribute(needlePos, 3));
    this.needle = new THREE.Line(needleGeo, new THREE.LineBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.needle);

    // Center dot
    const dotGeo = new THREE.PlaneGeometry(6, 6);
    this.centerDot = new THREE.Mesh(dotGeo, new THREE.MeshBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
    }));
    this.centerDot.position.set(cx, cy, 2);
    this.group.add(this.centerDot);

    // Label canvas
    const scale = Math.min(2, window.devicePixelRatio);
    const labelW = radius * 1.4;
    const labelH = radius * 0.8;
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
    this.labelMesh.position.set(cx, cy, 3);
    this.group.add(this.labelMesh);
  }

  update(dt: number, _time: number): void {
    let opacity = stateOpacity(this.stateMachine.state, this.stateMachine.progress);
    const { x, y, w, h } = this.px;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const radius = Math.min(w, h) / 2 * 0.85;

    if (this.pulseTimer > 0) {
      this.pulseTimer -= dt;
      opacity *= pulse(this.pulseTimer);
    }

    const gx = this.glitchTimer > 0 ? glitchOffset(this.glitchTimer, 4) : 0;
    if (this.glitchTimer > 0) this.glitchTimer -= dt;
    this.group.position.x = gx;

    // Cycle target
    this.cycleTimer += dt;
    if (this.cycleTimer > 3) {
      this.cycleTimer = 0;
      this.targetValue = this.rng.float(0, 1);
    }

    // Spring physics for needle
    const force = (this.targetValue - this.value) * 12;
    this.velocity += force * dt;
    this.velocity *= Math.exp(-3.5 * dt);
    this.value += this.velocity * dt;

    // Update needle tip position (vertex-based, no rotation)
    const angle = this.value * Math.PI * 2 - Math.PI / 2;
    const tipX = cx + Math.cos(angle) * radius * 0.9;
    const tipY = cy + Math.sin(angle) * radius * 0.9;
    const needlePos = this.needle.geometry.getAttribute('position') as THREE.BufferAttribute;
    needlePos.setXY(1, tipX, tipY);
    needlePos.needsUpdate = true;

    (this.needle.material as THREE.LineBasicMaterial).opacity = opacity * 0.9;
    (this.tickRing.material as THREE.LineBasicMaterial).opacity = opacity * 0.3;
    (this.centerDot.material as THREE.MeshBasicMaterial).opacity = opacity * 0.8;

    // Render label
    this.renderAccum += dt;
    if (this.renderAccum >= 1 / 10) {
      this.renderAccum = 0;
      this.renderLabel();
    }
    (this.labelMesh.material as THREE.MeshBasicMaterial).opacity = opacity * 0.7;
  }

  private renderLabel(): void {
    const { ctx, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const degrees = Math.round(((this.value % 1) + 1) % 1 * 360);
    const primaryHex = '#' + this.palette.primary.getHexString();
    const dimHex = '#' + this.palette.dim.getHexString();

    const bigSize = Math.floor(canvas.height * 0.35);
    ctx.font = `bold ${bigSize}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = primaryHex;
    ctx.fillText(`${degrees}°`, canvas.width / 2, canvas.height * 0.4);

    const smallSize = Math.floor(canvas.height * 0.18);
    ctx.font = `${smallSize}px monospace`;
    ctx.fillStyle = dimHex;
    ctx.fillText(this.label, canvas.width / 2, canvas.height * 0.72);

    this.texture.needsUpdate = true;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'pulse') {
      this.pulseTimer = 0.5;
      this.velocity += 2;
    }
    if (action === 'glitch') {
      this.glitchTimer = 0.5;
      this.targetValue = this.rng.float(0, 1);
      this.velocity += this.rng.float(-5, 5);
    }
    if (action === 'alert') {
      this.pulseTimer = 2.0;
      // Spin rapidly
      this.velocity += 8;
    }
  }

  dispose(): void {
    this.texture.dispose();
    super.dispose();
  }
}
