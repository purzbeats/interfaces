import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Analog Bourdon tube gauge with needle, tick marks, and danger zone arc.
 * 270° arc + tick marks + needle with spring physics.
 */
export class PressureGaugeElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'pressure-gauge',
    meta: { shape: 'radial', roles: ['gauge'], moods: ['diagnostic', 'tactical'], bandAffinity: 'bass', audioSensitivity: 1.2, sizes: ['works-small', 'needs-medium'] },
  };
  private arcLines!: THREE.LineSegments;
  private innerArc!: THREE.LineSegments;
  private filledArc!: THREE.LineSegments;
  private dangerArc!: THREE.LineSegments;
  private needle!: THREE.Line;
  private tickLines!: THREE.LineSegments;
  private minorTickLines!: THREE.LineSegments;
  private needleValue: number = 0;
  private needleTarget: number = 0;
  private needleVelocity: number = 0;
  private updateTimer: number = 0;
  private updateInterval: number = 0;
  private springK: number = 20;
  private springDamping: number = 5;
  private dangerThreshold: number = 0.8;
  build(): void {
    const variant = this.rng.int(0, 3);
    const presets = [
      { tickCount: 10, segments: 64, dangerThreshold: 0.8, springK: 20, damping: 5, updateInterval: [1.0, 3.0] as const },
      { tickCount: 20, segments: 96, dangerThreshold: 0.65, springK: 35, damping: 3, updateInterval: [0.4, 1.2] as const },
      { tickCount: 6, segments: 32, dangerThreshold: 0.9, springK: 10, damping: 8, updateInterval: [2.0, 5.0] as const },
      { tickCount: 15, segments: 48, dangerThreshold: 0.5, springK: 50, damping: 2, updateInterval: [0.6, 2.0] as const },
    ];
    const p = presets[variant];

    const { x, y, w, h } = this.px;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const radius = Math.min(w, h) / 2 * 0.85;
    this.needleValue = this.rng.float(0.2, 0.6);
    this.needleTarget = this.needleValue;
    this.updateInterval = this.rng.float(p.updateInterval[0], p.updateInterval[1]);
    this.springK = p.springK + this.rng.float(-2, 2);
    this.springDamping = p.damping + this.rng.float(-0.5, 0.5);
    this.dangerThreshold = p.dangerThreshold;

    // 270° arc (from 135° to 405° i.e. -45° to 225° in standard)
    const arcStart = Math.PI * 0.75; // 135°
    const arcEnd = Math.PI * 2.25; // 405°
    const segments = p.segments + this.rng.int(-4, 4);
    const arcVerts: number[] = [];
    for (let i = 0; i < segments; i++) {
      const a1 = arcStart + (arcEnd - arcStart) * (i / segments);
      const a2 = arcStart + (arcEnd - arcStart) * ((i + 1) / segments);
      arcVerts.push(
        cx + Math.cos(a1) * radius, cy + Math.sin(a1) * radius, 0,
        cx + Math.cos(a2) * radius, cy + Math.sin(a2) * radius, 0,
      );
    }
    const arcGeo = new THREE.BufferGeometry();
    arcGeo.setAttribute('position', new THREE.Float32BufferAttribute(arcVerts, 3));
    this.arcLines = new THREE.LineSegments(arcGeo, new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.arcLines);

    // Inner decorative ring (smaller concentric arc)
    const innerVerts: number[] = [];
    const innerRadius = radius * 0.65;
    for (let i = 0; i < segments; i++) {
      const a1 = arcStart + (arcEnd - arcStart) * (i / segments);
      const a2 = arcStart + (arcEnd - arcStart) * ((i + 1) / segments);
      innerVerts.push(
        cx + Math.cos(a1) * innerRadius, cy + Math.sin(a1) * innerRadius, 0,
        cx + Math.cos(a2) * innerRadius, cy + Math.sin(a2) * innerRadius, 0,
      );
    }
    const innerGeo = new THREE.BufferGeometry();
    innerGeo.setAttribute('position', new THREE.Float32BufferAttribute(innerVerts, 3));
    this.innerArc = new THREE.LineSegments(innerGeo, new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.innerArc);

    // Filled arc (shows current reading as a bright arc between inner and outer)
    const filledSegs = 48;
    const filledVerts: number[] = [];
    for (let i = 0; i < filledSegs; i++) {
      const a1 = arcStart + (arcEnd - arcStart) * (i / filledSegs);
      const a2 = arcStart + (arcEnd - arcStart) * ((i + 1) / filledSegs);
      const midR = (radius * 0.92 + innerRadius) / 2;
      filledVerts.push(
        cx + Math.cos(a1) * midR, cy + Math.sin(a1) * midR, 0,
        cx + Math.cos(a2) * midR, cy + Math.sin(a2) * midR, 0,
      );
    }
    const filledGeo = new THREE.BufferGeometry();
    filledGeo.setAttribute('position', new THREE.Float32BufferAttribute(filledVerts, 3));
    this.filledArc = new THREE.LineSegments(filledGeo, new THREE.LineBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.filledArc);

    // Danger zone (last portion of arc)
    const dangerStart = arcStart + (arcEnd - arcStart) * p.dangerThreshold;
    const dangerVerts: number[] = [];
    for (let i = 0; i < 16; i++) {
      const a1 = dangerStart + (arcEnd - dangerStart) * (i / 16);
      const a2 = dangerStart + (arcEnd - dangerStart) * ((i + 1) / 16);
      dangerVerts.push(
        cx + Math.cos(a1) * radius * 0.92, cy + Math.sin(a1) * radius * 0.92, 0,
        cx + Math.cos(a2) * radius * 0.92, cy + Math.sin(a2) * radius * 0.92, 0,
      );
    }
    const dangerGeo = new THREE.BufferGeometry();
    dangerGeo.setAttribute('position', new THREE.Float32BufferAttribute(dangerVerts, 3));
    this.dangerArc = new THREE.LineSegments(dangerGeo, new THREE.LineBasicMaterial({
      color: this.palette.alert,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.dangerArc);

    // Tick marks
    const tickVerts: number[] = [];
    const tickCount = p.tickCount + this.rng.int(-1, 1);
    for (let i = 0; i <= tickCount; i++) {
      const t = i / tickCount;
      const a = arcStart + (arcEnd - arcStart) * t;
      const inner = (i % 5 === 0) ? 0.78 : 0.85;
      tickVerts.push(
        cx + Math.cos(a) * radius * inner, cy + Math.sin(a) * radius * inner, 0,
        cx + Math.cos(a) * radius * 0.95, cy + Math.sin(a) * radius * 0.95, 0,
      );
    }
    const tickGeo = new THREE.BufferGeometry();
    tickGeo.setAttribute('position', new THREE.Float32BufferAttribute(tickVerts, 3));
    this.tickLines = new THREE.LineSegments(tickGeo, new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.tickLines);

    // Minor tick marks (between major ticks)
    const minorTickVerts: number[] = [];
    const minorPerMajor = 4;
    const totalMinor = tickCount * minorPerMajor;
    for (let i = 0; i <= totalMinor; i++) {
      if (i % minorPerMajor === 0) continue; // skip positions that overlap major ticks
      const t = i / totalMinor;
      const a = arcStart + (arcEnd - arcStart) * t;
      minorTickVerts.push(
        cx + Math.cos(a) * radius * 0.88, cy + Math.sin(a) * radius * 0.88, 0,
        cx + Math.cos(a) * radius * 0.93, cy + Math.sin(a) * radius * 0.93, 0,
      );
    }
    const minorTickGeo = new THREE.BufferGeometry();
    minorTickGeo.setAttribute('position', new THREE.Float32BufferAttribute(minorTickVerts, 3));
    this.minorTickLines = new THREE.LineSegments(minorTickGeo, new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.minorTickLines);

    // Needle
    const needleGeo = new THREE.BufferGeometry();
    needleGeo.setAttribute('position', new THREE.Float32BufferAttribute([
      cx, cy, 1, cx, cy + radius * 0.8, 1,
    ], 3));
    this.needle = new THREE.Line(needleGeo, new THREE.LineBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.needle);
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);
    const { x, y, w, h } = this.px;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const radius = Math.min(w, h) / 2 * 0.85;

    // Update target periodically
    this.updateTimer += dt;
    if (this.updateTimer >= this.updateInterval) {
      this.updateTimer = 0;
      this.needleTarget = this.rng.float(0.1, 0.95);
    }

    // Spring physics for needle
    const force = (this.needleTarget - this.needleValue) * this.springK;
    this.needleVelocity += force * dt;
    this.needleVelocity *= Math.exp(-this.springDamping * dt);
    this.needleValue += this.needleVelocity * dt;
    this.needleValue = Math.max(0, Math.min(1.05, this.needleValue));

    // Update needle position
    const arcStart = Math.PI * 0.75;
    const arcEnd = Math.PI * 2.25;
    const needleAngle = arcStart + (arcEnd - arcStart) * this.needleValue;
    const pos = this.needle.geometry.getAttribute('position') as THREE.BufferAttribute;
    pos.setXY(0, cx, cy);
    pos.setXY(1, cx + Math.cos(needleAngle) * radius * 0.8, cy + Math.sin(needleAngle) * radius * 0.8);
    pos.needsUpdate = true;

    // Update filled arc to show current reading
    const filledPos = this.filledArc.geometry.getAttribute('position') as THREE.BufferAttribute;
    const filledSegs = 48;
    const innerRadius = radius * 0.65;
    const midR = (radius * 0.92 + innerRadius) / 2;
    for (let i = 0; i < filledSegs; i++) {
      const t = i / filledSegs;
      if (t <= this.needleValue) {
        const a1 = arcStart + (arcEnd - arcStart) * (i / filledSegs);
        const a2 = arcStart + (arcEnd - arcStart) * ((i + 1) / filledSegs);
        filledPos.setXYZ(i * 2, cx + Math.cos(a1) * midR, cy + Math.sin(a1) * midR, 0);
        filledPos.setXYZ(i * 2 + 1, cx + Math.cos(a2) * midR, cy + Math.sin(a2) * midR, 0);
      } else {
        filledPos.setXYZ(i * 2, -9999, -9999, 0);
        filledPos.setXYZ(i * 2 + 1, -9999, -9999, 0);
      }
    }
    filledPos.needsUpdate = true;

    // Color needle and filled arc based on danger zone
    const inDanger = this.needleValue > this.dangerThreshold;
    (this.needle.material as THREE.LineBasicMaterial).color.copy(
      inDanger ? this.palette.alert : this.palette.primary
    );
    (this.filledArc.material as THREE.LineBasicMaterial).color.copy(
      inDanger ? this.palette.alert : this.palette.primary
    );
    (this.needle.material as THREE.LineBasicMaterial).opacity = opacity;
    (this.arcLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.5;
    (this.innerArc.material as THREE.LineBasicMaterial).opacity = opacity * 0.25;
    (this.filledArc.material as THREE.LineBasicMaterial).opacity = opacity * 0.6;
    (this.dangerArc.material as THREE.LineBasicMaterial).opacity = opacity * 0.7;
    (this.tickLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.6;
    (this.minorTickLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.3;
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) return;
    if (level >= 5) {
      this.needleTarget = 1.0;
    }
    this.needleVelocity += level * (level >= 3 ? 2 : 1);
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'pulse') {
      this.needleVelocity += this.rng.float(2, 5);
    }
    if (action === 'glitch') {
      this.needleValue = this.rng.float(0, 1);
    }
    if (action === 'alert') {
      this.needleTarget = 1.0;
    }
  }
}
