import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';

/**
 * Animated eye with concentric iris rings, drifting pupil, and periodic blinks.
 * Evokes the sense of being observed — a core weirdcore motif.
 */
export class WatchingEyeElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'watching-eye',
    meta: { shape: 'radial', roles: ['decorative', 'scanner'], moods: ['ambient', 'tactical'], sizes: ['needs-medium', 'needs-large'], bandAffinity: 'mid' },
  };
  private irisRings!: THREE.LineSegments;
  private pupil!: THREE.Mesh;
  private eyelidLines!: THREE.LineSegments;
  private outlineLine!: THREE.Line;
  private cx: number = 0;
  private cy: number = 0;
  private rx: number = 0;
  private ry: number = 0;
  private ringCount: number = 0;
  private irisRadius: number = 0;
  private pupilBaseScale: number = 0;
  // Pupil wander
  private pupilX: number = 0;
  private pupilY: number = 0;
  private pupilTargetX: number = 0;
  private pupilTargetY: number = 0;
  private pupilRetargetTimer: number = 0;
  // Blink
  private blinkProgress: number = 1; // 1 = open, 0 = closed
  private blinkTimer: number = 0;
  private blinkInterval: number = 0;
  private blinkClosing: boolean = false;
  private blinkOpening: boolean = false;
  // Variant params
  private blinkFreqMin: number = 0;
  private blinkFreqMax: number = 0;
  private dilationSpeed: number = 0;
  private dilationRange: [number, number] = [0.3, 0.6];
  private alertMode: boolean = false;

  build(): void {
    const variant = this.rng.int(0, 4);
    const presets = [
      { rings: 4, pupilScale: 0.22, blinkMin: 5, blinkMax: 15, dilSpeed: 1.2, dilRange: [0.3, 0.6] as [number, number] },      // Standard
      { rings: 3, pupilScale: 0.15, blinkMin: 2, blinkMax: 6,  dilSpeed: 2.0, dilRange: [0.15, 0.35] as [number, number] },     // Paranoid
      { rings: 4, pupilScale: 0.35, blinkMin: 8, blinkMax: 20, dilSpeed: 0.5, dilRange: [0.4, 0.7] as [number, number] },       // Drowsy
      { rings: 6, pupilScale: 0.20, blinkMin: 6, blinkMax: 12, dilSpeed: 1.5, dilRange: [0.2, 0.5] as [number, number] },       // Mechanical
    ];
    const p = presets[variant];

    this.glitchAmount = 5;
    const { x, y, w, h } = this.px;
    this.cx = x + w / 2;
    this.cy = y + h / 2;
    this.rx = w * 0.42;
    this.ry = h * 0.30;
    this.irisRadius = Math.min(this.rx, this.ry) * 0.75;
    this.ringCount = p.rings;
    this.pupilBaseScale = p.pupilScale;
    this.blinkFreqMin = p.blinkMin;
    this.blinkFreqMax = p.blinkMax;
    this.dilationSpeed = p.dilSpeed;
    this.dilationRange = p.dilRange;
    this.blinkInterval = this.rng.float(this.blinkFreqMin, this.blinkFreqMax);
    this.blinkTimer = this.blinkInterval;

    this.pupilX = this.cx;
    this.pupilY = this.cy;
    this.pupilTargetX = this.cx;
    this.pupilTargetY = this.cy;
    this.pupilRetargetTimer = this.rng.float(1, 4);

    // Iris rings as line segments (each ring = circleSegs segments)
    const circleSegs = 48;
    const irisVerts = new Float32Array(this.ringCount * circleSegs * 2 * 3);
    const irisGeo = new THREE.BufferGeometry();
    irisGeo.setAttribute('position', new THREE.BufferAttribute(irisVerts, 3));
    this.irisRings = new THREE.LineSegments(irisGeo, new THREE.LineBasicMaterial({
      color: this.palette.secondary,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.irisRings);

    // Pupil disc
    const pupilGeo = new THREE.CircleGeometry(this.irisRadius * this.pupilBaseScale, 32);
    this.pupil = new THREE.Mesh(pupilGeo, new THREE.MeshBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
    }));
    this.pupil.position.set(this.cx, this.cy, 1);
    this.group.add(this.pupil);

    // Eyelid arcs (top + bottom, will animate closed via vertex positions)
    // Each lid is a curved arc: 32 segments = 64 verts
    const lidSegs = 32;
    const eyelidVerts = new Float32Array(lidSegs * 2 * 2 * 3); // top + bottom
    const eyelidGeo = new THREE.BufferGeometry();
    eyelidGeo.setAttribute('position', new THREE.BufferAttribute(eyelidVerts, 3));
    this.eyelidLines = new THREE.LineSegments(eyelidGeo, new THREE.LineBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.eyelidLines);

    // Outer eye outline (lenticular shape)
    const outlinePts = 64;
    const outlinePos = new Float32Array((outlinePts + 1) * 3);
    for (let i = 0; i <= outlinePts; i++) {
      const t = i / outlinePts;
      const angle = t * Math.PI * 2;
      // Lenticular: wider horizontally, flatter vertically
      outlinePos[i * 3] = this.cx + Math.cos(angle) * this.rx;
      outlinePos[i * 3 + 1] = this.cy + Math.sin(angle) * this.ry;
      outlinePos[i * 3 + 2] = 0;
    }
    const outlineGeo = new THREE.BufferGeometry();
    outlineGeo.setAttribute('position', new THREE.BufferAttribute(outlinePos, 3));
    this.outlineLine = new THREE.Line(outlineGeo, new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.outlineLine);
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);

    // Pupil wander
    this.pupilRetargetTimer -= dt;
    if (this.pupilRetargetTimer <= 0) {
      const wanderR = this.irisRadius * 0.3;
      this.pupilTargetX = this.cx + this.rng.float(-wanderR, wanderR);
      this.pupilTargetY = this.cy + this.rng.float(-wanderR * 0.5, wanderR * 0.5);
      this.pupilRetargetTimer = this.rng.float(1.5, 5);
    }
    this.pupilX += (this.pupilTargetX - this.pupilX) * dt * 2;
    this.pupilY += (this.pupilTargetY - this.pupilY) * dt * 2;

    // Dilation
    const dilation = this.dilationRange[0] + (this.dilationRange[1] - this.dilationRange[0]) *
      (0.5 + 0.5 * Math.sin(time * this.dilationSpeed));
    const pupilR = this.irisRadius * dilation;
    this.pupil.scale.set(dilation / this.pupilBaseScale, dilation / this.pupilBaseScale, 1);
    this.pupil.position.set(this.pupilX, this.pupilY, 1);

    // Blink logic
    this.blinkTimer -= dt;
    if (this.blinkTimer <= 0 && !this.blinkClosing && !this.blinkOpening) {
      this.blinkClosing = true;
    }
    if (this.blinkClosing) {
      this.blinkProgress -= dt / 0.15; // close in 0.15s
      if (this.blinkProgress <= 0) {
        this.blinkProgress = 0;
        this.blinkClosing = false;
        this.blinkOpening = true;
      }
    }
    if (this.blinkOpening) {
      this.blinkProgress += dt / 0.1; // open in 0.1s
      if (this.blinkProgress >= 1) {
        this.blinkProgress = 1;
        this.blinkOpening = false;
        this.blinkTimer = this.rng.float(this.blinkFreqMin, this.blinkFreqMax);
      }
    }

    // Update iris rings
    const circleSegs = 48;
    const irisPos = this.irisRings.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let ring = 0; ring < this.ringCount; ring++) {
      const r = this.irisRadius * (0.4 + 0.6 * (ring + 1) / this.ringCount);
      const offset = ring * circleSegs * 2;
      for (let s = 0; s < circleSegs; s++) {
        const a1 = (s / circleSegs) * Math.PI * 2;
        const a2 = ((s + 1) / circleSegs) * Math.PI * 2;
        irisPos.setXYZ(offset + s * 2,     this.pupilX + Math.cos(a1) * r, this.pupilY + Math.sin(a1) * r * this.blinkProgress, 0);
        irisPos.setXYZ(offset + s * 2 + 1, this.pupilX + Math.cos(a2) * r, this.pupilY + Math.sin(a2) * r * this.blinkProgress, 0);
      }
    }
    irisPos.needsUpdate = true;

    // Update eyelid arcs
    const lidSegs = 32;
    const lidPos = this.eyelidLines.geometry.getAttribute('position') as THREE.BufferAttribute;
    const lidClose = 1 - this.blinkProgress; // 0 = open, 1 = closed
    for (let s = 0; s < lidSegs; s++) {
      const t = s / (lidSegs - 1);
      const angle = t * Math.PI; // semicircle
      const ex = this.cx + Math.cos(angle) * this.rx * (t * 2 - 1) * 0.5;
      const topBase = this.cy - this.ry;
      const botBase = this.cy + this.ry;
      // Top lid descends, bottom lid ascends
      const topY = topBase + (this.cy - topBase) * lidClose * Math.sin(t * Math.PI);
      const botY = botBase - (botBase - this.cy) * lidClose * Math.sin(t * Math.PI);
      const lx = this.cx + (t * 2 - 1) * this.rx;
      // Top lid
      lidPos.setXYZ(s * 2,     lx, topY, 2);
      lidPos.setXYZ(s * 2 + 1, s < lidSegs - 1 ? this.cx + ((s + 1) / (lidSegs - 1) * 2 - 1) * this.rx : lx, topY, 2);
      // Bottom lid
      const bi = lidSegs * 2 + s * 2;
      lidPos.setXYZ(bi,     lx, botY, 2);
      lidPos.setXYZ(bi + 1, s < lidSegs - 1 ? this.cx + ((s + 1) / (lidSegs - 1) * 2 - 1) * this.rx : lx, botY, 2);
    }
    lidPos.needsUpdate = true;

    // Colors
    const irisColor = this.alertMode ? this.palette.alert : this.palette.secondary;
    (this.irisRings.material as THREE.LineBasicMaterial).color.copy(irisColor);
    (this.irisRings.material as THREE.LineBasicMaterial).opacity = opacity * 0.6;
    (this.pupil.material as THREE.MeshBasicMaterial).opacity = opacity * 0.9 * this.blinkProgress;
    (this.eyelidLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.8;
    (this.outlineLine.material as THREE.LineBasicMaterial).opacity = opacity * 0.35;
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) { this.alertMode = false; return; }
    if (level >= 3) {
      // Rapid micro-blinks
      this.blinkTimer = 0.1;
    }
    if (level >= 5) {
      this.alertMode = true;
    }
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      this.pupilTargetX = this.cx + this.rng.float(-this.irisRadius * 0.6, this.irisRadius * 0.6);
      this.pupilTargetY = this.cy + this.rng.float(-this.irisRadius * 0.3, this.irisRadius * 0.3);
      this.pupilRetargetTimer = 0.3;
    }
    if (action === 'alert') {
      this.alertMode = true;
      setTimeout(() => { this.alertMode = false; }, 3000);
    }
  }
}
