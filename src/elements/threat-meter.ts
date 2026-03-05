import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Segmented vertical bar with severity zones (LOW/MED/HIGH/CRIT).
 * Spring-physics driven level indicator.
 */
export class ThreatMeterElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'threat-meter',
    meta: { shape: 'linear', roles: ['gauge'], moods: ['tactical'], bandAffinity: 'bass', audioSensitivity: 1.2, sizes: ['works-small'] },
  };
  private segments: THREE.Mesh[] = [];
  private borderLines!: THREE.LineSegments;
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private texture!: THREE.CanvasTexture;
  private labelMesh!: THREE.Mesh;
  private value: number = 0;
  private targetValue: number = 0;
  private velocity: number = 0;
  private segCount: number = 0;
  private cycleTimer: number = 0;
  private alertTimer: number = 0;
  private renderAccum: number = 0;
  private springK: number = 20;
  private springDamping: number = 4;
  private zoneBreaks: [number, number] = [0.4, 0.7];

  build(): void {
    const variant = this.rng.int(0, 3);
    const presets = [
      { segCount: [12, 24] as const, springK: 20, damping: 4, sweepCycle: 2.5, zoneBreaks: [0.4, 0.7] as [number, number] },
      { segCount: [24, 40] as const, springK: 35, damping: 2.5, sweepCycle: 1.2, zoneBreaks: [0.3, 0.55] as [number, number] },
      { segCount: [6, 12] as const, springK: 10, damping: 6, sweepCycle: 4.0, zoneBreaks: [0.5, 0.8] as [number, number] },
      { segCount: [16, 30] as const, springK: 50, damping: 1.5, sweepCycle: 1.8, zoneBreaks: [0.25, 0.5] as [number, number] },
    ];
    const p = presets[variant];

    this.glitchAmount = 3;
    const { x, y, w, h } = this.px;
    this.segCount = this.rng.int(p.segCount[0], p.segCount[1]);
    this.targetValue = this.rng.float(0.2, 0.7);
    this.springK = p.springK + this.rng.float(-2, 2);
    this.springDamping = p.damping + this.rng.float(-0.3, 0.3);
    this.zoneBreaks = p.zoneBreaks;

    const gap = Math.max(2, Math.floor(Math.min(w, h) * 0.005));
    const segH = (h - gap * (this.segCount + 1)) / this.segCount;
    const segW = Math.min(w * 0.6, Math.max(40, w * 0.15));
    const segX = x + (w - segW) / 2;

    for (let i = 0; i < this.segCount; i++) {
      const sy = y + gap + (segH + gap) * i;
      const geo = new THREE.PlaneGeometry(segW, segH);
      const mat = new THREE.MeshBasicMaterial({
        color: this.palette.primary,
        transparent: true,
        opacity: 0,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(segX + segW / 2, sy + segH / 2, 1);
      this.segments.push(mesh);
      this.group.add(mesh);
    }

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
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.borderLines);

    // Label canvas — scale to region
    const scale = Math.min(2, window.devicePixelRatio);
    const labelH = Math.max(16, h * 0.08);
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.ceil(w * scale);
    this.canvas.height = Math.ceil(labelH * scale);
    this.ctx = this.get2DContext(this.canvas);
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.NearestFilter;
    const labelGeo = new THREE.PlaneGeometry(w, labelH);
    this.labelMesh = new THREE.Mesh(labelGeo, new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      opacity: 0,
    }));
    this.labelMesh.position.set(x + w / 2, y + h - labelH / 2 - 2, 2);
    this.group.add(this.labelMesh);
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);
    if (this.alertTimer > 0) this.alertTimer -= dt;

    // Cycle target
    this.cycleTimer += dt;
    if (this.cycleTimer > 2.5) {
      this.cycleTimer = 0;
      this.targetValue = this.rng.float(0.1, 0.95);
    }

    // Spring physics
    const force = (this.targetValue - this.value) * this.springK;
    this.velocity += force * dt;
    this.velocity *= Math.exp(-this.springDamping * dt);
    this.value += this.velocity * dt;
    this.value = Math.max(0, Math.min(1.1, this.value));

    // Update segments - bottom segments fill first
    const filledCount = this.value * this.segCount;
    for (let i = 0; i < this.segCount; i++) {
      const fraction = i / this.segCount;
      const isFilled = i < filledCount;
      const mat = this.segments[i].material as THREE.MeshBasicMaterial;

      // Color zones: green -> yellow -> red
      if (fraction < this.zoneBreaks[0]) {
        mat.color.copy(this.palette.primary);
      } else if (fraction < this.zoneBreaks[1]) {
        mat.color.copy(this.palette.secondary);
      } else {
        mat.color.copy(this.alertTimer > 0 ? this.palette.alert : this.palette.alert);
      }

      mat.opacity = isFilled ? opacity * 0.7 : opacity * 0.08;
    }

    (this.borderLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.3;

    // Render label at reduced rate
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

    const zones = ['LOW', 'MED', 'HIGH', 'CRIT'];
    const zoneIndex = Math.min(3, Math.floor(this.value * 4));
    const label = zones[zoneIndex];

    const heightSize = Math.floor(canvas.height * 0.6);
    const widthSize = Math.floor(canvas.width / (label.length * 0.65));
    const size = Math.max(6, Math.min(heightSize, widthSize));
    ctx.font = `bold ${size}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const isAlert = zoneIndex >= 3;
    ctx.fillStyle = isAlert
      ? '#' + this.palette.alert.getHexString()
      : '#' + this.palette.primary.getHexString();
    ctx.fillText(label, canvas.width / 2, canvas.height / 2);

    this.texture.needsUpdate = true;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'pulse') {
      this.velocity += 3;
    }
    if (action === 'glitch') {
      this.targetValue = this.rng.float(0, 1);
    }
    if (action === 'alert') {
      this.targetValue = 1.0;
      this.alertTimer = 2.0;
      this.pulseTimer = 2.0;
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) return;
    // Impulse upward proportional to level
    this.velocity += level * 1.2;
    if (level >= 5) {
      this.targetValue = 1.0;
      this.alertTimer = 1.0;
    }
  }

  dispose(): void {
    this.texture.dispose();
    super.dispose();
  }
}
