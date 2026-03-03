import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Analog dial gauge with a rotating needle and spring physics.
 * Arc scale markings, needle sweeps back and forth. Variants:
 * full circle, half circle, quarter arc, thin vs thick needle.
 */
export class GaugeNeedleElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'gauge-needle',
    meta: {
      shape: 'radial',
      roles: ['gauge', 'data-display'],
      moods: ['diagnostic', 'tactical'],
      bandAffinity: 'bass',
      sizes: ['works-small', 'needs-medium', 'needs-large'],
    },
  };

  private arcLines!: THREE.LineSegments;
  private tickLines!: THREE.LineSegments;
  private majorTickLines!: THREE.LineSegments;
  private dangerArc!: THREE.LineSegments;
  private needle!: THREE.LineSegments;
  private centerDot!: THREE.Mesh;
  private hubRing!: THREE.LineSegments;

  private needleValue: number = 0;
  private needleTarget: number = 0;
  private needleVelocity: number = 0;
  private updateTimer: number = 0;
  private updateInterval: number = 0;
  private springK: number = 20;
  private springDamping: number = 5;
  private dangerThreshold: number = 0.8;

  private arcStart: number = 0;
  private arcEnd: number = 0;
  private arcSpan: number = 0;
  private radius: number = 0;
  private cx: number = 0;
  private cy: number = 0;
  private variant: number = 0;
  private thickNeedle: boolean = false;

  build(): void {
    this.variant = this.rng.int(0, 3);
    const { x, y, w, h } = this.px;

    const presets = [
      // Variant 0: Full circle (270° sweep), thin needle, 10 major ticks
      {
        arcStartDeg: 135, arcEndDeg: 405, tickCount: 40, majorEvery: 4,
        springK: 18, damping: 4.5, dangerThreshold: 0.82,
        updateRange: [1.0, 3.5] as const, thick: false, radiusFrac: 0.42,
      },
      // Variant 1: Half circle (180° sweep), thick needle, fewer ticks
      {
        arcStartDeg: 180, arcEndDeg: 360, tickCount: 20, majorEvery: 4,
        springK: 28, damping: 3.5, dangerThreshold: 0.75,
        updateRange: [0.6, 2.0] as const, thick: true, radiusFrac: 0.44,
      },
      // Variant 2: Quarter arc (90° sweep), thin precision needle
      {
        arcStartDeg: 225, arcEndDeg: 315, tickCount: 18, majorEvery: 3,
        springK: 45, damping: 2.5, dangerThreshold: 0.88,
        updateRange: [0.4, 1.5] as const, thick: false, radiusFrac: 0.44,
      },
      // Variant 3: 240° sweep, thick needle, fast nervous spring
      {
        arcStartDeg: 150, arcEndDeg: 390, tickCount: 36, majorEvery: 6,
        springK: 60, damping: 2.0, dangerThreshold: 0.7,
        updateRange: [0.3, 1.2] as const, thick: true, radiusFrac: 0.40,
      },
    ];

    const p = presets[this.variant];
    this.thickNeedle = p.thick;
    this.springK = p.springK + this.rng.float(-3, 3);
    this.springDamping = p.damping + this.rng.float(-0.5, 0.5);
    this.dangerThreshold = p.dangerThreshold;
    this.updateInterval = this.rng.float(p.updateRange[0], p.updateRange[1]);

    this.arcStart = (p.arcStartDeg * Math.PI) / 180;
    this.arcEnd = (p.arcEndDeg * Math.PI) / 180;
    this.arcSpan = this.arcEnd - this.arcStart;

    this.radius = Math.min(w, h) * p.radiusFrac;
    // For half-circle: position center near bottom of region
    if (this.variant === 1) {
      this.cx = x + w / 2;
      this.cy = y + h * 0.72;
    } else if (this.variant === 2) {
      // Quarter arc: position in corner-ish area
      this.cx = x + w * 0.5;
      this.cy = y + h * 0.6;
    } else {
      this.cx = x + w / 2;
      this.cy = y + h / 2;
    }

    // Initial needle value
    this.needleValue = this.rng.float(0.15, 0.65);
    this.needleTarget = this.needleValue;

    const segments = 80 + this.rng.int(-8, 8);
    const arcVerts: number[] = [];

    // Outer arc
    for (let i = 0; i < segments; i++) {
      const a1 = this.arcStart + this.arcSpan * (i / segments);
      const a2 = this.arcStart + this.arcSpan * ((i + 1) / segments);
      arcVerts.push(
        this.cx + Math.cos(a1) * this.radius, this.cy + Math.sin(a1) * this.radius, 0,
        this.cx + Math.cos(a2) * this.radius, this.cy + Math.sin(a2) * this.radius, 0,
      );
    }

    // Inner arc (ring feel)
    const innerR = this.radius * 0.88;
    if (this.variant === 0 || this.variant === 3) {
      for (let i = 0; i < segments; i++) {
        const a1 = this.arcStart + this.arcSpan * (i / segments);
        const a2 = this.arcStart + this.arcSpan * ((i + 1) / segments);
        arcVerts.push(
          this.cx + Math.cos(a1) * innerR, this.cy + Math.sin(a1) * innerR, 0,
          this.cx + Math.cos(a2) * innerR, this.cy + Math.sin(a2) * innerR, 0,
        );
      }
    }

    // End caps
    arcVerts.push(
      this.cx + Math.cos(this.arcStart) * innerR, this.cy + Math.sin(this.arcStart) * innerR, 0,
      this.cx + Math.cos(this.arcStart) * this.radius, this.cy + Math.sin(this.arcStart) * this.radius, 0,
    );
    arcVerts.push(
      this.cx + Math.cos(this.arcEnd) * innerR, this.cy + Math.sin(this.arcEnd) * innerR, 0,
      this.cx + Math.cos(this.arcEnd) * this.radius, this.cy + Math.sin(this.arcEnd) * this.radius, 0,
    );

    const arcGeo = new THREE.BufferGeometry();
    arcGeo.setAttribute('position', new THREE.Float32BufferAttribute(arcVerts, 3));
    this.arcLines = new THREE.LineSegments(arcGeo, new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.arcLines);

    // Danger arc — last portion of arc
    const dangerVerts: number[] = [];
    const dangerSegments = 24;
    const dangerStart = this.arcStart + this.arcSpan * this.dangerThreshold;
    for (let i = 0; i < dangerSegments; i++) {
      const a1 = dangerStart + (this.arcEnd - dangerStart) * (i / dangerSegments);
      const a2 = dangerStart + (this.arcEnd - dangerStart) * ((i + 1) / dangerSegments);
      dangerVerts.push(
        this.cx + Math.cos(a1) * this.radius * 0.94, this.cy + Math.sin(a1) * this.radius * 0.94, 0,
        this.cx + Math.cos(a2) * this.radius * 0.94, this.cy + Math.sin(a2) * this.radius * 0.94, 0,
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

    // Minor tick marks
    const tickCount = p.tickCount + this.rng.int(-2, 2);
    const tickVerts: number[] = [];
    const majorTickVerts: number[] = [];
    for (let i = 0; i <= tickCount; i++) {
      const t = i / tickCount;
      const a = this.arcStart + this.arcSpan * t;
      const isMajor = i % p.majorEvery === 0;
      const innerFrac = isMajor ? 0.74 : 0.84;

      if (isMajor) {
        majorTickVerts.push(
          this.cx + Math.cos(a) * this.radius * innerFrac, this.cy + Math.sin(a) * this.radius * innerFrac, 0,
          this.cx + Math.cos(a) * this.radius * 0.97, this.cy + Math.sin(a) * this.radius * 0.97, 0,
        );
      } else {
        tickVerts.push(
          this.cx + Math.cos(a) * this.radius * innerFrac, this.cy + Math.sin(a) * this.radius * innerFrac, 0,
          this.cx + Math.cos(a) * this.radius * 0.97, this.cy + Math.sin(a) * this.radius * 0.97, 0,
        );
      }
    }

    const tickGeo = new THREE.BufferGeometry();
    tickGeo.setAttribute('position', new THREE.Float32BufferAttribute(tickVerts, 3));
    this.tickLines = new THREE.LineSegments(tickGeo, new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.tickLines);

    const majorTickGeo = new THREE.BufferGeometry();
    majorTickGeo.setAttribute('position', new THREE.Float32BufferAttribute(majorTickVerts, 3));
    this.majorTickLines = new THREE.LineSegments(majorTickGeo, new THREE.LineBasicMaterial({
      color: this.palette.secondary,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.majorTickLines);

    // Needle — from center outward
    const needleLen = this.radius * 0.78;
    const needleBackLen = this.radius * 0.12;
    let needleVerts: number[];
    if (this.thickNeedle) {
      // Thick needle: two side lines + center line
      const perpAngle = 0; // will be rotated via geometry rebuild
      needleVerts = [
        // Main spine
        this.cx, this.cy, 1,
        this.cx, this.cy + needleLen, 1,
        // Left edge (offset perp)
        this.cx - 2, this.cy, 1,
        this.cx - 1, this.cy + needleLen, 1,
        // Right edge
        this.cx + 2, this.cy, 1,
        this.cx + 1, this.cy + needleLen, 1,
        // Tail counterweight
        this.cx, this.cy, 1,
        this.cx, this.cy - needleBackLen, 1,
      ];
    } else {
      // Thin needle with tail
      needleVerts = [
        this.cx, this.cy, 1,
        this.cx, this.cy + needleLen, 1,
        // Tail
        this.cx, this.cy, 1,
        this.cx, this.cy - needleBackLen, 1,
      ];
    }

    const needleGeo = new THREE.BufferGeometry();
    needleGeo.setAttribute('position', new THREE.Float32BufferAttribute(needleVerts, 3));
    this.needle = new THREE.LineSegments(needleGeo, new THREE.LineBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
    }));
    // We rotate the needle group rather than rebuilding vertices
    this.needle.position.set(this.cx, this.cy, 0);
    // Offset geometry to rotate around center
    // Shift verts so center is at 0,0
    const posAttr = this.needle.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < posAttr.count; i++) {
      posAttr.setXY(i, posAttr.getX(i) - this.cx, posAttr.getY(i) - this.cy);
    }
    posAttr.needsUpdate = true;
    this.group.add(this.needle);

    // Center hub dot
    const hubGeo = new THREE.PlaneGeometry(this.radius * 0.06, this.radius * 0.06);
    this.centerDot = new THREE.Mesh(hubGeo, new THREE.MeshBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
    }));
    this.centerDot.position.set(this.cx, this.cy, 2);
    this.group.add(this.centerDot);

    // Hub ring
    const hubRingR = this.radius * 0.06;
    const hubRingVerts: number[] = [];
    const hubSegs = 16;
    for (let i = 0; i < hubSegs; i++) {
      const a1 = (i / hubSegs) * Math.PI * 2;
      const a2 = ((i + 1) / hubSegs) * Math.PI * 2;
      hubRingVerts.push(
        this.cx + Math.cos(a1) * hubRingR, this.cy + Math.sin(a1) * hubRingR, 1.5,
        this.cx + Math.cos(a2) * hubRingR, this.cy + Math.sin(a2) * hubRingR, 1.5,
      );
    }
    const hubRingGeo = new THREE.BufferGeometry();
    hubRingGeo.setAttribute('position', new THREE.Float32BufferAttribute(hubRingVerts, 3));
    this.hubRing = new THREE.LineSegments(hubRingGeo, new THREE.LineBasicMaterial({
      color: this.palette.secondary,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.hubRing);
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);

    // Update target periodically
    this.updateTimer += dt;
    if (this.updateTimer >= this.updateInterval) {
      this.updateTimer = 0;
      this.needleTarget = this.rng.float(0.05, 0.98);
    }

    // Spring physics
    const force = (this.needleTarget - this.needleValue) * this.springK;
    this.needleVelocity += force * dt;
    this.needleVelocity *= Math.exp(-this.springDamping * dt);
    this.needleValue += this.needleVelocity * dt;
    this.needleValue = Math.max(-0.02, Math.min(1.05, this.needleValue));

    // Rotate needle
    const needleAngle = this.arcStart + this.arcSpan * Math.max(0, Math.min(1, this.needleValue));
    // We want the needle to point "up" at 0 rotation and sweep by needleAngle.
    // The geometry was built pointing up (positive Y), so rotation is the arc angle offset by -π/2
    this.needle.rotation.z = needleAngle - Math.PI / 2;

    // Color based on danger
    const inDanger = this.needleValue > this.dangerThreshold;
    const needleMat = this.needle.material as THREE.LineBasicMaterial;
    needleMat.color.copy(inDanger ? this.palette.alert : this.palette.primary);
    needleMat.opacity = opacity;

    (this.arcLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.35;
    (this.tickLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.4;
    (this.majorTickLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.65;
    (this.dangerArc.material as THREE.LineBasicMaterial).opacity = opacity * (inDanger ? 0.9 : 0.45);
    (this.centerDot.material as THREE.MeshBasicMaterial).opacity = opacity * 0.9;
    (this.hubRing.material as THREE.LineBasicMaterial).opacity = opacity * 0.6;

    // Subtle hub ring pulse
    const hubScale = 1 + 0.05 * Math.sin(time * 2.5);
    this.hubRing.scale.setScalar(hubScale);
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'pulse') {
      this.needleVelocity += this.rng.float(3, 7);
    }
    if (action === 'glitch') {
      this.needleValue = this.rng.float(0, 1);
      this.needleVelocity = this.rng.float(-8, 8);
    }
    if (action === 'alert') {
      this.needleTarget = 1.0;
      this.needleVelocity += 5;
    }
    if (action === 'activate') {
      this.needleValue = 0;
      this.needleVelocity = 0;
      this.needleTarget = this.rng.float(0.15, 0.65);
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) return;
    this.needleVelocity += level * (level >= 4 ? 3 : 1.5);
    if (level >= 5) {
      this.needleTarget = 1.0;
    }
  }
}
