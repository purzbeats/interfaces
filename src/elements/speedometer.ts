import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';
import { drawGlowText } from '../animation/retro-text';

/**
 * Speedometer / tachometer gauge with sweeping needle, tick marks,
 * numerical readout, and unit label. Variants: MPH, KPH, RPM x1000.
 */
export class SpeedometerElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'speedometer',
    meta: {
      shape: 'radial',
      roles: ['gauge', 'data-display'],
      moods: ['diagnostic', 'tactical'],
      bandAffinity: 'bass',
      sizes: ['needs-medium', 'needs-large'],
    },
  };

  // Geometry
  private arcLines!: THREE.LineSegments;
  private tickLines!: THREE.LineSegments;
  private majorTickLines!: THREE.LineSegments;
  private redlineArc!: THREE.LineSegments;
  private needle!: THREE.LineSegments;
  private hubDot!: THREE.Mesh;
  private hubRing!: THREE.LineSegments;

  // Readout canvas
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private texture!: THREE.CanvasTexture;
  private labelMesh!: THREE.Mesh;
  private renderAccum: number = 0;

  // Simulation
  private value: number = 0;
  private target: number = 0;
  private velocity: number = 0;
  private springK: number = 0;
  private springDamp: number = 0;
  private updateTimer: number = 0;
  private updateInterval: number = 0;
  private redlineThreshold: number = 0;

  // Variant config
  private unit: string = '';
  private maxReading: number = 0;
  private arcStart: number = 0;
  private arcSpan: number = 0;
  private cx: number = 0;
  private cy: number = 0;
  private radius: number = 0;
  private majorCount: number = 0;

  build(): void {
    const variant = this.rng.int(0, 2);
    const { x, y, w, h } = this.px;

    const configs = [
      { unit: 'MPH', max: 160, arcDeg: 270, startDeg: 135, ticks: 32, majorEvery: 4, redline: 0.85, springK: 12, damp: 3.5, interval: [2.0, 5.0] as const },
      { unit: 'KPH', max: 260, arcDeg: 270, startDeg: 135, ticks: 26, majorEvery: 2, redline: 0.88, springK: 10, damp: 4.0, interval: [2.0, 5.0] as const },
      { unit: 'RPM x1000', max: 8, arcDeg: 240, startDeg: 150, ticks: 32, majorEvery: 4, redline: 0.78, springK: 25, damp: 2.5, interval: [1.0, 3.0] as const },
    ];
    const c = configs[variant];

    this.unit = c.unit;
    this.maxReading = c.max;
    this.redlineThreshold = c.redline;
    this.springK = c.springK + this.rng.float(-2, 2);
    this.springDamp = c.damp + this.rng.float(-0.5, 0.5);
    this.updateInterval = this.rng.float(c.interval[0], c.interval[1]);

    this.arcStart = (c.startDeg * Math.PI) / 180;
    this.arcSpan = (c.arcDeg * Math.PI) / 180;
    this.radius = Math.min(w, h) * 0.42;
    this.cx = x + w / 2;
    this.cy = y + h / 2;

    this.value = this.rng.float(0.1, 0.5);
    this.target = this.value;
    this.majorCount = Math.floor(c.ticks / c.majorEvery) + 1;

    const arcEnd = this.arcStart + this.arcSpan;
    const segments = 80;

    // Outer arc
    const arcVerts: number[] = [];
    for (let i = 0; i < segments; i++) {
      const a1 = this.arcStart + this.arcSpan * (i / segments);
      const a2 = this.arcStart + this.arcSpan * ((i + 1) / segments);
      arcVerts.push(
        this.cx + Math.cos(a1) * this.radius, this.cy + Math.sin(a1) * this.radius, 0,
        this.cx + Math.cos(a2) * this.radius, this.cy + Math.sin(a2) * this.radius, 0,
      );
    }
    // Inner ring
    const innerR = this.radius * 0.9;
    for (let i = 0; i < segments; i++) {
      const a1 = this.arcStart + this.arcSpan * (i / segments);
      const a2 = this.arcStart + this.arcSpan * ((i + 1) / segments);
      arcVerts.push(
        this.cx + Math.cos(a1) * innerR, this.cy + Math.sin(a1) * innerR, 0,
        this.cx + Math.cos(a2) * innerR, this.cy + Math.sin(a2) * innerR, 0,
      );
    }
    // End caps
    arcVerts.push(
      this.cx + Math.cos(this.arcStart) * innerR, this.cy + Math.sin(this.arcStart) * innerR, 0,
      this.cx + Math.cos(this.arcStart) * this.radius, this.cy + Math.sin(this.arcStart) * this.radius, 0,
    );
    arcVerts.push(
      this.cx + Math.cos(arcEnd) * innerR, this.cy + Math.sin(arcEnd) * innerR, 0,
      this.cx + Math.cos(arcEnd) * this.radius, this.cy + Math.sin(arcEnd) * this.radius, 0,
    );

    const arcGeo = new THREE.BufferGeometry();
    arcGeo.setAttribute('position', new THREE.Float32BufferAttribute(arcVerts, 3));
    this.arcLines = new THREE.LineSegments(arcGeo, new THREE.LineBasicMaterial({
      color: this.palette.dim, transparent: true, opacity: 0,
    }));
    this.group.add(this.arcLines);

    // Redline arc
    const redlineVerts: number[] = [];
    const redlineStart = this.arcStart + this.arcSpan * this.redlineThreshold;
    const redlineSegs = 20;
    for (let i = 0; i < redlineSegs; i++) {
      const a1 = redlineStart + (arcEnd - redlineStart) * (i / redlineSegs);
      const a2 = redlineStart + (arcEnd - redlineStart) * ((i + 1) / redlineSegs);
      redlineVerts.push(
        this.cx + Math.cos(a1) * this.radius * 0.95, this.cy + Math.sin(a1) * this.radius * 0.95, 0,
        this.cx + Math.cos(a2) * this.radius * 0.95, this.cy + Math.sin(a2) * this.radius * 0.95, 0,
      );
    }
    const redlineGeo = new THREE.BufferGeometry();
    redlineGeo.setAttribute('position', new THREE.Float32BufferAttribute(redlineVerts, 3));
    this.redlineArc = new THREE.LineSegments(redlineGeo, new THREE.LineBasicMaterial({
      color: this.palette.alert, transparent: true, opacity: 0,
    }));
    this.group.add(this.redlineArc);

    // Tick marks
    const tickCount = c.ticks + this.rng.int(-2, 2);
    const tickVerts: number[] = [];
    const majorVerts: number[] = [];
    for (let i = 0; i <= tickCount; i++) {
      const t = i / tickCount;
      const a = this.arcStart + this.arcSpan * t;
      const isMajor = i % c.majorEvery === 0;
      const tickInner = isMajor ? 0.72 : 0.83;
      const verts = isMajor ? majorVerts : tickVerts;
      verts.push(
        this.cx + Math.cos(a) * this.radius * tickInner, this.cy + Math.sin(a) * this.radius * tickInner, 0,
        this.cx + Math.cos(a) * this.radius * 0.97, this.cy + Math.sin(a) * this.radius * 0.97, 0,
      );
    }

    const tickGeo = new THREE.BufferGeometry();
    tickGeo.setAttribute('position', new THREE.Float32BufferAttribute(tickVerts, 3));
    this.tickLines = new THREE.LineSegments(tickGeo, new THREE.LineBasicMaterial({
      color: this.palette.dim, transparent: true, opacity: 0,
    }));
    this.group.add(this.tickLines);

    const majorGeo = new THREE.BufferGeometry();
    majorGeo.setAttribute('position', new THREE.Float32BufferAttribute(majorVerts, 3));
    this.majorTickLines = new THREE.LineSegments(majorGeo, new THREE.LineBasicMaterial({
      color: this.palette.secondary, transparent: true, opacity: 0,
    }));
    this.group.add(this.majorTickLines);

    // Needle — built pointing up (+Y), rotated around hub
    const needleLen = this.radius * 0.82;
    const tailLen = this.radius * 0.14;
    const needleVerts = [
      // Main
      0, 0, 1, 0, needleLen, 1,
      // Left edge
      -1.5, 0, 1, -0.5, needleLen, 1,
      // Right edge
      1.5, 0, 1, 0.5, needleLen, 1,
      // Counterweight tail
      0, 0, 1, 0, -tailLen, 1,
    ];
    const needleGeo = new THREE.BufferGeometry();
    needleGeo.setAttribute('position', new THREE.Float32BufferAttribute(needleVerts, 3));
    this.needle = new THREE.LineSegments(needleGeo, new THREE.LineBasicMaterial({
      color: this.palette.primary, transparent: true, opacity: 0,
    }));
    this.needle.position.set(this.cx, this.cy, 0);
    this.group.add(this.needle);

    // Hub dot
    const hubSize = this.radius * 0.05;
    this.hubDot = new THREE.Mesh(
      new THREE.PlaneGeometry(hubSize, hubSize),
      new THREE.MeshBasicMaterial({ color: this.palette.primary, transparent: true, opacity: 0 }),
    );
    this.hubDot.position.set(this.cx, this.cy, 2);
    this.group.add(this.hubDot);

    // Hub ring
    const hubR = this.radius * 0.06;
    const hubVerts: number[] = [];
    for (let i = 0; i < 16; i++) {
      const a1 = (i / 16) * Math.PI * 2;
      const a2 = ((i + 1) / 16) * Math.PI * 2;
      hubVerts.push(
        this.cx + Math.cos(a1) * hubR, this.cy + Math.sin(a1) * hubR, 1.5,
        this.cx + Math.cos(a2) * hubR, this.cy + Math.sin(a2) * hubR, 1.5,
      );
    }
    const hubGeo = new THREE.BufferGeometry();
    hubGeo.setAttribute('position', new THREE.Float32BufferAttribute(hubVerts, 3));
    this.hubRing = new THREE.LineSegments(hubGeo, new THREE.LineBasicMaterial({
      color: this.palette.secondary, transparent: true, opacity: 0,
    }));
    this.group.add(this.hubRing);

    // Readout canvas — aspect ratio must match mesh exactly
    const labelW = this.radius * 1.4;
    const labelH = this.radius * 0.5;
    const maxCanvasW = 200;
    const canvasScale = Math.min(1, maxCanvasW / labelW);
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.max(1, Math.round(labelW * canvasScale));
    this.canvas.height = Math.max(1, Math.round(labelH * canvasScale));
    this.ctx = this.get2DContext(this.canvas);
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.magFilter = THREE.NearestFilter;

    const labelGeo = new THREE.PlaneGeometry(labelW, labelH);
    this.labelMesh = new THREE.Mesh(labelGeo, new THREE.MeshBasicMaterial({
      map: this.texture, transparent: true, opacity: 0,
    }));
    // Position readout below center hub
    this.labelMesh.position.set(this.cx, this.cy - this.radius * 0.38, 2);
    this.group.add(this.labelMesh);
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);

    // Cycle target
    this.updateTimer += dt;
    if (this.updateTimer >= this.updateInterval) {
      this.updateTimer = 0;
      this.target = this.rng.float(0.05, 0.95);
    }

    // Spring physics
    const force = (this.target - this.value) * this.springK;
    this.velocity += force * dt;
    this.velocity *= Math.exp(-this.springDamp * dt);
    this.value += this.velocity * dt;
    this.value = Math.max(-0.02, Math.min(1.05, this.value));

    // Rotate needle
    const clamped = Math.max(0, Math.min(1, this.value));
    const needleAngle = this.arcStart + this.arcSpan * clamped;
    this.needle.rotation.z = needleAngle - Math.PI / 2;

    // Colors
    const inRedline = this.value > this.redlineThreshold;
    const needleMat = this.needle.material as THREE.LineBasicMaterial;
    needleMat.color.copy(inRedline ? this.palette.alert : this.palette.primary);
    needleMat.opacity = opacity;

    (this.arcLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.3;
    (this.tickLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.35;
    (this.majorTickLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.6;
    (this.redlineArc.material as THREE.LineBasicMaterial).opacity = opacity * (inRedline ? 0.9 : 0.4);
    (this.hubDot.material as THREE.MeshBasicMaterial).opacity = opacity * 0.9;
    (this.hubRing.material as THREE.LineBasicMaterial).opacity = opacity * 0.6;

    // Subtle hub pulse
    this.hubRing.scale.setScalar(1 + 0.04 * Math.sin(time * 2.5));

    // Render readout at reduced rate
    this.renderAccum += dt;
    if (this.renderAccum >= 1 / 8) {
      this.renderAccum %= 1 / 8;
      this.renderReadout();
    }
    (this.labelMesh.material as THREE.MeshBasicMaterial).opacity = opacity * 0.8;
  }

  private renderReadout(): void {
    const { ctx, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const clamped = Math.max(0, Math.min(1, this.value));
    const reading = Math.round(clamped * this.maxReading);
    const inRedline = this.value > this.redlineThreshold;

    const bigSize = Math.floor(canvas.height * 0.52);
    const smallSize = Math.floor(canvas.height * 0.24);

    const primaryHex = '#' + this.palette.primary.getHexString();
    const alertHex = '#' + this.palette.alert.getHexString();
    const dimHex = '#' + this.palette.dim.getHexString();

    // Speed reading
    ctx.font = `bold ${bigSize}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const valueColor = inRedline ? alertHex : primaryHex;
    drawGlowText(ctx, String(reading), canvas.width / 2, canvas.height * 0.38, valueColor, 6);

    // Unit label
    ctx.font = `${smallSize}px monospace`;
    drawGlowText(ctx, this.unit, canvas.width / 2, canvas.height * 0.78, dimHex, 2);

    this.texture.needsUpdate = true;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'pulse') {
      this.velocity += this.rng.float(2, 5);
    }
    if (action === 'glitch') {
      this.value = this.rng.float(0, 1);
      this.velocity = this.rng.float(-6, 6);
    }
    if (action === 'alert') {
      this.target = 1.0;
      this.velocity += 4;
    }
    if (action === 'activate') {
      this.value = 0;
      this.velocity = 0;
      this.target = this.rng.float(0.1, 0.5);
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) return;
    this.velocity += level * (level >= 4 ? 2.5 : 1.2);
    if (level >= 5) {
      this.target = 1.0;
    }
  }

  dispose(): void {
    this.texture.dispose();
    super.dispose();
  }
}
