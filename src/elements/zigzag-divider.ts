import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Zigzag/sawtooth line divider that animates by shifting the pattern over time.
 * Supports horizontal and vertical orientations with four visual variants.
 */
export class ZigzagDividerElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'zigzag-divider',
    meta: {
      shape: 'linear',
      roles: ['structural', 'decorative'],
      moods: ['tactical', 'ambient'],
      sizes: ['works-small'],
      bandAffinity: 'mid',
    },
  };

  private lineMesh!: THREE.Line;
  private glowDots: THREE.Points | null = null;
  private secondLine: THREE.Line | null = null;
  private variant: number = 0;
  private zigOffset: number = 0;
  private zigSpeed: number = 0;
  private zigAmplitude: number = 0;
  private zigFrequency: number = 0;
  private isVertical: boolean = false;
  private pointCount: number = 0;
  private alertMode: boolean = false;
  private baseSpeed: number = 0;
  private clipPlanes: THREE.Plane[] = [];

  build(): void {
    this.variant = this.rng.int(0, 3);
    const { x, y, w, h } = this.px;

    this.clipPlanes = [
      new THREE.Plane(new THREE.Vector3(1, 0, 0), -x),       // left
      new THREE.Plane(new THREE.Vector3(-1, 0, 0), x + w),   // right
      new THREE.Plane(new THREE.Vector3(0, 1, 0), -y),       // bottom
      new THREE.Plane(new THREE.Vector3(0, -1, 0), y + h),   // top
    ];

    // Determine orientation: use vertical if height > width significantly
    this.isVertical = h > w * 1.5;

    const length = this.isVertical ? h : w;
    const thickness = this.isVertical ? w : h;

    this.zigAmplitude = thickness * 0.3;
    this.zigFrequency = this.rng.float(0.03, 0.07); // cycles per pixel
    this.zigSpeed = this.rng.float(20, 60);
    this.baseSpeed = this.zigSpeed;
    this.pointCount = Math.ceil(length) + 2;

    switch (this.variant) {
      case 0: this.buildSharpZigzag(x, y, w, h, length); break;
      case 1: this.buildSmoothWave(x, y, w, h, length); break;
      case 2: this.buildDoubleLine(x, y, w, h, length); break;
      case 3: this.buildGlowDots(x, y, w, h, length); break;
    }
  }

  private buildSharpZigzag(x: number, y: number, w: number, h: number, length: number): void {
    const positions = new Float32Array(this.pointCount * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.lineMesh = new THREE.Line(geo, new THREE.LineBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
      clippingPlanes: this.clipPlanes,
    }));
    this.group.add(this.lineMesh);
  }

  private buildSmoothWave(x: number, y: number, w: number, h: number, length: number): void {
    // More points for smooth sine wave
    this.pointCount = Math.ceil(length * 2) + 2;
    const positions2 = new Float32Array(this.pointCount * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions2, 3));
    this.lineMesh = new THREE.Line(geo, new THREE.LineBasicMaterial({
      color: this.palette.secondary,
      transparent: true,
      opacity: 0,
      clippingPlanes: this.clipPlanes,
    }));
    this.group.add(this.lineMesh);
  }

  private buildDoubleLine(x: number, y: number, w: number, h: number, length: number): void {
    const positions = new Float32Array(this.pointCount * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.lineMesh = new THREE.Line(geo, new THREE.LineBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
      clippingPlanes: this.clipPlanes,
    }));
    this.group.add(this.lineMesh);

    // Second line with phase offset
    const positions2 = new Float32Array(this.pointCount * 3);
    const geo2 = new THREE.BufferGeometry();
    geo2.setAttribute('position', new THREE.BufferAttribute(positions2, 3));
    this.secondLine = new THREE.Line(geo2, new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
      clippingPlanes: this.clipPlanes,
    }));
    this.group.add(this.secondLine);
  }

  private buildGlowDots(x: number, y: number, w: number, h: number, length: number): void {
    const positions = new Float32Array(this.pointCount * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.lineMesh = new THREE.Line(geo, new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
      clippingPlanes: this.clipPlanes,
    }));
    this.group.add(this.lineMesh);

    // Glow dots at peaks — one per zigzag cycle
    const dotCount = Math.ceil(length * this.zigFrequency) + 2;
    const dotPositions = new Float32Array(dotCount * 3);
    const dotGeo = new THREE.BufferGeometry();
    dotGeo.setAttribute('position', new THREE.BufferAttribute(dotPositions, 3));
    this.glowDots = new THREE.Points(dotGeo, new THREE.PointsMaterial({
      color: this.palette.primary,
      size: Math.max(3, Math.min(this.px.w, this.px.h) * 0.06),
      transparent: true,
      opacity: 0,
      sizeAttenuation: false,
      clippingPlanes: this.clipPlanes,
    }));
    this.group.add(this.glowDots);
  }

  private sampleZig(t: number, smooth: boolean): number {
    if (smooth) {
      return Math.sin(t * Math.PI * 2) * this.zigAmplitude;
    }
    // Sharp sawtooth: 0..1 -> -amp..+amp..−amp
    const phase = ((t % 1) + 1) % 1;
    return (phase < 0.5 ? phase * 4 - 1 : 3 - phase * 4) * this.zigAmplitude;
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);
    const { x, y, w, h } = this.px;

    this.zigOffset += this.zigSpeed * dt;

    const length = this.isVertical ? h : w;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const smooth = this.variant === 1 || this.variant === 3;

    const positions = this.lineMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const step = length / (this.pointCount - 1);

    for (let i = 0; i < this.pointCount; i++) {
      const d = i * step;
      const t = (d + this.zigOffset) * this.zigFrequency;
      const zig = this.sampleZig(t, smooth);

      if (this.isVertical) {
        positions.setXYZ(i, cx + zig, y + d, 1);
      } else {
        positions.setXYZ(i, x + d, cy + zig, 1);
      }
    }
    positions.needsUpdate = true;
    (this.lineMesh.material as THREE.LineBasicMaterial).opacity = opacity;

    // Double line: second line with opposite phase
    if (this.secondLine) {
      const pos2 = this.secondLine.geometry.getAttribute('position') as THREE.BufferAttribute;
      const phaseShift = 0.5 / this.zigFrequency; // half period offset
      for (let i = 0; i < this.pointCount; i++) {
        const d = i * step;
        const t = (d + this.zigOffset + phaseShift) * this.zigFrequency;
        const zig = this.sampleZig(t, smooth);
        if (this.isVertical) {
          pos2.setXYZ(i, cx + zig, y + d, 1);
        } else {
          pos2.setXYZ(i, x + d, cy + zig, 1);
        }
      }
      pos2.needsUpdate = true;
      (this.secondLine.material as THREE.LineBasicMaterial).opacity = opacity * 0.5;
    }

    // Glow dots at peaks
    if (this.glowDots) {
      const dotPos = this.glowDots.geometry.getAttribute('position') as THREE.BufferAttribute;
      const period = 1 / this.zigFrequency;
      const dotCount = dotPos.count;
      for (let i = 0; i < dotCount; i++) {
        // Peak is at every full cycle
        const d = i * period - (this.zigOffset % period);
        const t = (d + this.zigOffset) * this.zigFrequency;
        const zig = this.sampleZig(Math.round(t) + 0.5, false); // peak = amplitude
        if (this.isVertical) {
          dotPos.setXYZ(i, cx + zig, y + ((d % length) + length) % length, 2);
        } else {
          dotPos.setXYZ(i, x + ((d % length) + length) % length, cy + zig, 2);
        }
      }
      dotPos.needsUpdate = true;
      // Dots pulse with a small sine flicker
      const pulse = 0.7 + 0.3 * Math.sin(_time * 4);
      (this.glowDots.material as THREE.PointsMaterial).opacity = opacity * pulse;
    }
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      this.zigSpeed *= -1;
      setTimeout(() => { this.zigSpeed = Math.abs(this.baseSpeed); }, 600);
    }
    if (action === 'alert') {
      this.alertMode = true;
      this.zigSpeed = this.baseSpeed * 4;
      this.pulseTimer = 1.0;
      setTimeout(() => {
        this.alertMode = false;
        this.zigSpeed = this.baseSpeed;
      }, 1500);
    }
    if (action === 'pulse') {
      this.zigAmplitude *= 2;
      setTimeout(() => { this.zigAmplitude /= 2; }, 300);
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) {
      this.zigSpeed = this.baseSpeed;
      this.alertMode = false;
      return;
    }
    this.zigSpeed = this.baseSpeed * (1 + level * 0.4);
    if (level >= 4) {
      // Color shift toward alert
      const mat = this.lineMesh.material as THREE.LineBasicMaterial;
      mat.color.copy(this.palette.alert);
      setTimeout(() => { mat.color.copy(this.palette.primary); }, 800);
    }
  }
}
