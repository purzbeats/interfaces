import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Radial tick ring with animated needle (vertex-based, not rotation).
 * Center readout showing current phase angle/value.
 */
export class PhaseIndicatorElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'phase-indicator',
    meta: { shape: 'radial', roles: ['gauge'], moods: ['tactical', 'diagnostic'], bandAffinity: 'mid', sizes: ['works-small', 'needs-medium'] },
  };
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
  private renderAccum: number = 0;
  private tickCount: number = 36;
  private label: string = '';
  private springK: number = 12;
  private springDamping: number = 3.5;

  build(): void {
    const variant = this.rng.int(0, 3);
    const presets = [
      { tickCounts: [24, 36, 48] as const, springK: 12, damping: 3.5, labels: ['PHASE', 'ANGLE', 'BEARING', 'HEADING', 'AZM', 'VECTOR'], needleLen: 0.9 },
      { tickCounts: [48, 60, 72] as const, springK: 25, damping: 2, labels: ['BEARING', 'HEADING', 'TRACK', 'AZM'], needleLen: 0.95 },
      { tickCounts: [8, 12, 16] as const, springK: 6, damping: 6, labels: ['PHASE', 'SECTOR', 'QUAD'], needleLen: 0.8 },
      { tickCounts: [36, 48, 60] as const, springK: 40, damping: 1.5, labels: ['VECTOR', 'SPIN', 'GYRO', 'ROTOR'], needleLen: 0.85 },
    ];
    const p = presets[variant];

    const { x, y, w, h } = this.px;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const radius = Math.min(w, h) / 2 * 0.85;
    this.targetValue = this.rng.float(0, 1);
    this.label = this.rng.pick(p.labels);
    this.springK = p.springK + this.rng.float(-1, 1);
    this.springDamping = p.damping + this.rng.float(-0.3, 0.3);

    // Tick marks around the ring
    this.tickCount = this.rng.pick(p.tickCounts as unknown as number[]);
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
    const opacity = this.applyEffects(dt);
    const { x, y, w, h } = this.px;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const radius = Math.min(w, h) / 2 * 0.85;

    // Cycle target
    this.cycleTimer += dt;
    if (this.cycleTimer > 3) {
      this.cycleTimer = 0;
      this.targetValue = this.rng.float(0, 1);
    }

    // Spring physics for needle
    const force = (this.targetValue - this.value) * this.springK;
    this.velocity += force * dt;
    this.velocity *= Math.exp(-this.springDamping * dt);
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

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) return;
    this.velocity += level * (level >= 3 ? 2 : 1);
    if (level >= 5) {
      this.velocity += 8;
    }
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'pulse') {
      this.velocity += 2;
    }
    if (action === 'glitch') {
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
