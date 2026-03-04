import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Spiral galaxy arm pattern. Points arranged along logarithmic spiral arms
 * slowly rotating around the center. Dust lanes, star clusters, and core glow
 * create a sci-fi deep-space visualization.
 * Variants: 2-arm, 3-arm, tight spiral, loose with dust cloud.
 */
export class SpiralArmElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'spiral-arm',
    meta: {
      shape: 'radial',
      roles: ['decorative'],
      moods: ['ambient'],
      sizes: ['needs-medium', 'needs-large'],
      bandAffinity: 'bass',
      audioSensitivity: 1.2,
    },
  };

  private armPoints!: THREE.Points;
  private dustPoints!: THREE.Points;
  private coreGlow!: THREE.Mesh;
  private coreDots!: THREE.Points;

  private numArms: number = 2;
  private totalPoints: number = 0;
  private totalDust: number = 0;
  private pointPhases!: Float32Array;
  private pointRadii!: Float32Array;
  private pointArmAngles!: Float32Array;
  private pointTwinkle!: Float32Array;
  private pointTwinkleSpeed!: Float32Array;

  private dustPhases!: Float32Array;
  private dustRadii!: Float32Array;

  private rotationSpeed: number = 0.12;
  private spiralTightness: number = 0.35;
  private rotationAngle: number = 0;

  private intensityBoost: number = 0;
  private alertFlash: number = 0;

  build(): void {
    const variant = this.rng.int(0, 3);
    const presets = [
      // 0: 2-arm classic
      { arms: 2, points: 300, dust: 120, tightness: 0.38, rotSpeed: 0.10, coreSize: 0.12, spread: 0.18 },
      // 1: 3-arm wide
      { arms: 3, points: 360, dust: 100, tightness: 0.28, rotSpeed: 0.14, coreSize: 0.10, spread: 0.22 },
      // 2: tight spiral — many points, close-wound
      { arms: 2, points: 450, dust: 80, tightness: 0.55, rotSpeed: 0.18, coreSize: 0.08, spread: 0.12 },
      // 3: loose with heavy dust cloud
      { arms: 2, points: 200, dust: 280, tightness: 0.22, rotSpeed: 0.08, coreSize: 0.15, spread: 0.30 },
    ];
    const p = presets[variant];

    this.numArms = p.arms;
    this.totalPoints = p.points;
    this.totalDust = p.dust;
    this.spiralTightness = p.tightness + this.rng.float(-0.04, 0.04);
    this.rotationSpeed = p.rotSpeed + this.rng.float(-0.02, 0.02);

    const { x, y, w, h } = this.px;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const maxR = Math.min(w, h) * 0.46;
    const coreR = Math.min(w, h) * p.coreSize;

    // --- Arm star points ---
    this.pointPhases = new Float32Array(this.totalPoints);
    this.pointRadii = new Float32Array(this.totalPoints);
    this.pointArmAngles = new Float32Array(this.totalPoints);
    this.pointTwinkle = new Float32Array(this.totalPoints);
    this.pointTwinkleSpeed = new Float32Array(this.totalPoints);

    const positions = new Float32Array(this.totalPoints * 3);
    const colors = new Float32Array(this.totalPoints * 3);

    for (let i = 0; i < this.totalPoints; i++) {
      const arm = i % this.numArms;
      const armOffset = (arm / this.numArms) * Math.PI * 2;
      // Distribute points along spiral — more concentrated at middle radii
      const t = this.rng.float(0.05, 1.0);
      const r = t * maxR;
      const logSpiral = Math.log(1 + t * 4) * this.spiralTightness * Math.PI * 2 * 1.5;
      const angle = armOffset + logSpiral + this.rng.float(-p.spread, p.spread);

      this.pointRadii[i] = r;
      this.pointArmAngles[i] = angle;
      this.pointPhases[i] = this.rng.float(0, Math.PI * 2);
      this.pointTwinkle[i] = this.rng.float(0, Math.PI * 2);
      this.pointTwinkleSpeed[i] = this.rng.float(2.0, 6.0);

      positions[i * 3] = cx + Math.cos(angle) * r;
      positions[i * 3 + 1] = cy + Math.sin(angle) * r;
      positions[i * 3 + 2] = 0.3;

      // Color: bright near center, dim and slightly secondary at edges
      const radFrac = r / maxR;
      const bright = 1.0 - radFrac * 0.6;
      const useSecondary = radFrac > 0.6 && this.rng.chance(0.3);
      const col = useSecondary ? this.palette.secondary : this.palette.primary;
      colors[i * 3] = col.r * bright;
      colors[i * 3 + 1] = col.g * bright;
      colors[i * 3 + 2] = col.b * bright;
    }

    const armGeo = new THREE.BufferGeometry();
    armGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    armGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    this.armPoints = new THREE.Points(armGeo, new THREE.PointsMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0,
      size: 1.8,
      sizeAttenuation: false,
    }));
    this.group.add(this.armPoints);

    // --- Dust cloud points ---
    this.dustPhases = new Float32Array(this.totalDust);
    this.dustRadii = new Float32Array(this.totalDust);

    const dustPos = new Float32Array(this.totalDust * 3);
    const dustCol = new Float32Array(this.totalDust * 3);

    for (let i = 0; i < this.totalDust; i++) {
      const arm = i % this.numArms;
      const armOffset = (arm / this.numArms) * Math.PI * 2;
      const t = this.rng.float(0.1, 1.0);
      const r = t * maxR * this.rng.float(0.8, 1.0);
      const logSpiral = Math.log(1 + t * 4) * this.spiralTightness * Math.PI * 2 * 1.5;
      const angle = armOffset + logSpiral + this.rng.float(-p.spread * 2.5, p.spread * 2.5);

      this.dustRadii[i] = r;
      this.dustPhases[i] = angle;

      dustPos[i * 3] = cx + Math.cos(angle) * r;
      dustPos[i * 3 + 1] = cy + Math.sin(angle) * r;
      dustPos[i * 3 + 2] = 0.1;

      const dim = this.palette.dim;
      const sec = this.palette.secondary;
      const mix = this.rng.float(0, 0.4);
      dustCol[i * 3] = dim.r + (sec.r - dim.r) * mix;
      dustCol[i * 3 + 1] = dim.g + (sec.g - dim.g) * mix;
      dustCol[i * 3 + 2] = dim.b + (sec.b - dim.b) * mix;
    }

    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
    dustGeo.setAttribute('color', new THREE.BufferAttribute(dustCol, 3));

    this.dustPoints = new THREE.Points(dustGeo, new THREE.PointsMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0,
      size: 1.2,
      sizeAttenuation: false,
    }));
    this.group.add(this.dustPoints);

    // --- Core glow (bright central nucleus) ---
    const coreGeo = new THREE.CircleGeometry(coreR, 32);
    this.coreGlow = new THREE.Mesh(coreGeo, new THREE.MeshBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
    }));
    this.coreGlow.position.set(cx, cy, 0.5);
    this.group.add(this.coreGlow);

    // --- Core dot cluster ---
    const coreCount = 40;
    const corePos = new Float32Array(coreCount * 3);
    for (let i = 0; i < coreCount; i++) {
      const angle = this.rng.float(0, Math.PI * 2);
      const r = this.rng.float(0, coreR * 1.8);
      corePos[i * 3] = cx + Math.cos(angle) * r;
      corePos[i * 3 + 1] = cy + Math.sin(angle) * r;
      corePos[i * 3 + 2] = 0.6;
    }
    const coreDotGeo = new THREE.BufferGeometry();
    coreDotGeo.setAttribute('position', new THREE.BufferAttribute(corePos, 3));
    this.coreDots = new THREE.Points(coreDotGeo, new THREE.PointsMaterial({
      color: this.palette.bg,
      transparent: true,
      opacity: 0,
      size: 2.5,
      sizeAttenuation: false,
    }));
    this.group.add(this.coreDots);
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);

    if (this.intensityBoost > 0) this.intensityBoost = Math.max(0, this.intensityBoost - dt * 1.5);
    if (this.alertFlash > 0) this.alertFlash = Math.max(0, this.alertFlash - dt * 2.0);

    const effectiveSpeed = this.rotationSpeed * (1 + this.intensityBoost * 1.5);
    this.rotationAngle += effectiveSpeed * dt;

    const { x, y, w, h } = this.px;
    const cx = x + w / 2;
    const cy = y + h / 2;

    // Rotate arm star positions
    const armPos = this.armPoints.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < this.totalPoints; i++) {
      const angle = this.pointArmAngles[i] + this.rotationAngle;
      const r = this.pointRadii[i];
      armPos.setXYZ(i, cx + Math.cos(angle) * r, cy + Math.sin(angle) * r, 0.3);
    }
    armPos.needsUpdate = true;

    // Twinkle via opacity — recompute each frame through averaged twinkle
    let twinkleSum = 0;
    for (let i = 0; i < this.totalPoints; i++) {
      twinkleSum += 0.6 + 0.4 * Math.sin(time * this.pointTwinkleSpeed[i] + this.pointTwinkle[i]);
    }
    const avgTwinkle = this.totalPoints > 0 ? twinkleSum / this.totalPoints : 1;

    // Rotate dust
    const dustPos = this.dustPoints.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < this.totalDust; i++) {
      // Dust rotates slightly slower (differential rotation)
      const dustAngle = this.dustPhases[i] + this.rotationAngle * 0.7;
      const r = this.dustRadii[i];
      dustPos.setXYZ(i, cx + Math.cos(dustAngle) * r, cy + Math.sin(dustAngle) * r, 0.1);
    }
    dustPos.needsUpdate = true;

    // Alert flash wave across arms
    const flashMul = this.alertFlash > 0
      ? (0.7 + 0.3 * Math.abs(Math.sin(time * 8)))
      : 1.0;

    // Core pulse
    const corePulse = 0.08 + Math.sin(time * 1.8) * 0.03 + this.intensityBoost * 0.06;
    (this.coreGlow.material as THREE.MeshBasicMaterial).opacity = opacity * corePulse * flashMul;
    (this.coreDots.material as THREE.PointsMaterial).opacity = opacity * (0.3 + this.intensityBoost * 0.2) * flashMul;

    (this.armPoints.material as THREE.PointsMaterial).opacity =
      opacity * Math.max(0.3, avgTwinkle) * flashMul;
    (this.dustPoints.material as THREE.PointsMaterial).opacity =
      opacity * 0.25 * flashMul;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'alert') {
      this.alertFlash = 2.0;
      this.pulseTimer = 1.5;
      this.intensityBoost = 2.0;
    }
    if (action === 'glitch') {
      // Spin faster briefly
      this.intensityBoost = 3.0;
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) {
      this.intensityBoost = 0;
      return;
    }
    this.intensityBoost = level * 0.4;
    if (level >= 5) {
      this.alertFlash = 1.0;
    }
  }
}
