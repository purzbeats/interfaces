import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Liquid level indicator. A wave surface that sloshes back and forth inside
 * a container outline. Level rises and falls. Variants: calm, choppy,
 * bubbles rising, with level markings.
 */
export class WaterLevelElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'water-level',
    meta: {
      shape: 'rectangular',
      roles: ['gauge', 'data-display'],
      moods: ['diagnostic', 'ambient'],
      sizes: ['works-small', 'needs-medium'],
      bandAffinity: 'sub',
      audioSensitivity: 1.3,
    },
  };

  // Wave surface geometry (line strip of wave top)
  private waveLine!: THREE.Line;
  // Filled liquid body (mesh covering below the wave)
  private liquidMesh!: THREE.Mesh;
  // Container outline
  private containerFrame!: THREE.LineSegments;
  // Level markers (tick marks on side)
  private levelTicks!: THREE.LineSegments;
  // Bubble particles
  private bubbles!: THREE.Points;
  // Glint highlight on wave surface
  private glintLine!: THREE.Line;

  // Wave resolution
  private readonly WAVE_SEGS = 40;

  // Liquid state
  private currentLevel: number = 0.55;    // 0..1 (fill fraction from bottom)
  private targetLevel: number = 0.55;
  private levelSpeed: number = 0.08;
  private sloshePhase: number = 0;
  private sloshSpeed: number = 0.9;
  private sloshAmp: number = 0;
  private baseSloshAmp: number = 0;

  // Wave parameters
  private waveFreq: number = 2.5;
  private waveAmp: number = 0;
  private baseWaveAmp: number = 0;

  // Bubbles
  private hasBubbles: boolean = false;
  private bubbleCount: number = 0;
  private bubbleX!: Float32Array;
  private bubbleY!: Float32Array;
  private bubbleVY!: Float32Array;
  private bubblePhase!: Float32Array;
  private bubbleLife!: Float32Array;

  // Markers
  private hasMarkers: boolean = false;

  private intensityBoost: number = 0;
  private alertFlash: number = 0;
  private levelRiseTimer: number = 0;

  build(): void {
    const variant = this.rng.int(0, 3);
    const presets = [
      // 0: calm — gentle wave, slow sloshing
      { level: 0.55, sloshAmp: 0.025, waveAmp: 2.5, waveFreq: 2.0, sloshSpd: 0.7, bubbles: false, markers: false, levelSpd: 0.06 },
      // 1: choppy — faster wave, more turbulent
      { level: 0.50, sloshAmp: 0.060, waveAmp: 5.5, waveFreq: 3.5, sloshSpd: 1.4, bubbles: false, markers: false, levelSpd: 0.10 },
      // 2: bubbles rising — calm surface, many rising particles
      { level: 0.60, sloshAmp: 0.020, waveAmp: 2.0, waveFreq: 2.2, sloshSpd: 0.6, bubbles: true, markers: false, levelSpd: 0.05 },
      // 3: level markings — calm with ruler on side and precise level
      { level: 0.45, sloshAmp: 0.015, waveAmp: 1.5, waveFreq: 1.8, sloshSpd: 0.5, bubbles: false, markers: true, levelSpd: 0.04 },
    ];
    const p = presets[variant];

    this.currentLevel = p.level + this.rng.float(-0.1, 0.1);
    this.targetLevel = this.currentLevel;
    this.baseSloshAmp = p.sloshAmp;
    this.sloshAmp = p.sloshAmp;
    this.baseWaveAmp = p.waveAmp;
    this.waveAmp = p.waveAmp;
    this.waveFreq = p.waveFreq + this.rng.float(-0.3, 0.3);
    this.sloshSpeed = p.sloshSpd + this.rng.float(-0.1, 0.1);
    this.hasBubbles = p.bubbles;
    this.hasMarkers = p.markers;
    this.levelSpeed = p.levelSpd;

    const { x, y, w, h } = this.px;
    const inset = 3;
    const ix = x + inset;
    const iy = y + inset;
    const iw = w - inset * 2;
    const ih = h - inset * 2;

    // --- Wave surface line ---
    const wavePts = new Float32Array((this.WAVE_SEGS + 1) * 3);
    const waveGeo = new THREE.BufferGeometry();
    waveGeo.setAttribute('position', new THREE.BufferAttribute(wavePts, 3));
    this.waveLine = new THREE.Line(waveGeo, new THREE.LineBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.waveLine);

    // --- Glint line (bright highlight strip slightly above wave crest) ---
    const glintPts = new Float32Array((this.WAVE_SEGS + 1) * 3);
    const glintGeo = new THREE.BufferGeometry();
    glintGeo.setAttribute('position', new THREE.BufferAttribute(glintPts, 3));
    this.glintLine = new THREE.Line(glintGeo, new THREE.LineBasicMaterial({
      color: this.palette.bg,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.glintLine);

    // --- Liquid body mesh (flat quad that we'll update vertices for) ---
    // We use a PlaneGeometry but manipulate it. Actually, build a simple mesh
    // using a flat BufferGeometry with a triangle strip pattern.
    // Points: top = wave, bottom = container floor. Left-to-right columns.
    const meshVerts = new Float32Array((this.WAVE_SEGS + 1) * 2 * 3);
    const meshIndices: number[] = [];
    for (let s = 0; s < this.WAVE_SEGS; s++) {
      const tl = s * 2;
      const tr = (s + 1) * 2;
      const bl = s * 2 + 1;
      const br = (s + 1) * 2 + 1;
      meshIndices.push(tl, bl, tr, tr, bl, br);
    }
    const liquidGeo = new THREE.BufferGeometry();
    liquidGeo.setAttribute('position', new THREE.BufferAttribute(meshVerts, 3));
    liquidGeo.setIndex(meshIndices);
    this.liquidMesh = new THREE.Mesh(liquidGeo, new THREE.MeshBasicMaterial({
      color: this.palette.secondary,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
    }));
    this.group.add(this.liquidMesh);

    // --- Container frame ---
    const fv = new Float32Array([
      ix, iy, 0,  ix + iw, iy, 0,
      ix + iw, iy, 0,  ix + iw, iy + ih, 0,
      ix + iw, iy + ih, 0,  ix, iy + ih, 0,
      ix, iy + ih, 0,  ix, iy, 0,
    ]);
    const frameGeo = new THREE.BufferGeometry();
    frameGeo.setAttribute('position', new THREE.BufferAttribute(fv, 3));
    this.containerFrame = new THREE.LineSegments(frameGeo, new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.containerFrame);

    // --- Level tick marks (right side ruler) ---
    const tickCount = 10;
    const tickVerts = new Float32Array(tickCount * 2 * 3);
    for (let i = 0; i < tickCount; i++) {
      const ty = iy + ih - (i / tickCount) * ih;
      const isMajor = i % 5 === 0;
      const tickLen = isMajor ? iw * 0.10 : iw * 0.05;
      const tx = ix + iw - tickLen;
      tickVerts[i * 6 + 0] = tx;
      tickVerts[i * 6 + 1] = ty;
      tickVerts[i * 6 + 2] = 0.5;
      tickVerts[i * 6 + 3] = ix + iw;
      tickVerts[i * 6 + 4] = ty;
      tickVerts[i * 6 + 5] = 0.5;
    }
    const tickGeo = new THREE.BufferGeometry();
    tickGeo.setAttribute('position', new THREE.BufferAttribute(tickVerts, 3));
    this.levelTicks = new THREE.LineSegments(tickGeo, new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.levelTicks);

    // --- Bubbles ---
    if (this.hasBubbles) {
      this.bubbleCount = 40;
      this.bubbleX = new Float32Array(this.bubbleCount);
      this.bubbleY = new Float32Array(this.bubbleCount);
      this.bubbleVY = new Float32Array(this.bubbleCount);
      this.bubblePhase = new Float32Array(this.bubbleCount);
      this.bubbleLife = new Float32Array(this.bubbleCount);

      const bPos = new Float32Array(this.bubbleCount * 3);
      for (let i = 0; i < this.bubbleCount; i++) {
        this.bubbleX[i] = ix + this.rng.float(0, iw);
        this.bubbleY[i] = iy + ih - this.rng.float(0, ih * this.currentLevel);
        this.bubbleVY[i] = this.rng.float(12, 40);
        this.bubblePhase[i] = this.rng.float(0, Math.PI * 2);
        this.bubbleLife[i] = this.rng.float(0, 2.0);
        bPos[i * 3] = this.bubbleX[i];
        bPos[i * 3 + 1] = this.bubbleY[i];
        bPos[i * 3 + 2] = 0.4;
      }

      const bGeo = new THREE.BufferGeometry();
      bGeo.setAttribute('position', new THREE.BufferAttribute(bPos, 3));
      this.bubbles = new THREE.Points(bGeo, new THREE.PointsMaterial({
        color: this.palette.primary,
        transparent: true,
        opacity: 0,
        size: 2.0,
        sizeAttenuation: false,
      }));
      this.group.add(this.bubbles);
    }
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);

    if (this.intensityBoost > 0) this.intensityBoost = Math.max(0, this.intensityBoost - dt * 1.0);
    if (this.alertFlash > 0) this.alertFlash = Math.max(0, this.alertFlash - dt * 1.5);
    if (this.levelRiseTimer > 0) {
      this.levelRiseTimer -= dt;
      this.targetLevel = Math.min(0.95, this.targetLevel);
    }

    // Interpolate level toward target
    this.currentLevel += (this.targetLevel - this.currentLevel) * this.levelSpeed * 10 * dt;

    // Animate level gently oscillating (slow rise/fall cycle)
    const levelOsc = Math.sin(time * 0.18) * 0.08;
    const effectiveLevel = Math.max(0.05, Math.min(0.95, this.currentLevel + levelOsc));

    // Slosh: horizontal phase offset based on oscillation
    this.sloshePhase += this.sloshSpeed * dt;
    const sloshOffset = Math.sin(this.sloshePhase) * this.sloshAmp;

    // Effective wave amp boosted by intensity
    const effectiveWaveAmp = this.waveAmp * (1 + this.intensityBoost * 1.5);
    const effectiveSlosh = sloshOffset * (1 + this.intensityBoost * 2);

    const { x, y, w, h } = this.px;
    const inset = 3;
    const ix = x + inset;
    const iy = y + inset;
    const iw = w - inset * 2;
    const ih = h - inset * 2;

    // Compute baseline water top Y
    const waterTopY = iy + ih - effectiveLevel * ih;
    const floorY = iy + ih;

    const flashMul = this.alertFlash > 0
      ? (0.6 + 0.4 * Math.abs(Math.sin(time * 8)))
      : 1.0;

    // --- Wave surface ---
    const wavePos = this.waveLine.geometry.getAttribute('position') as THREE.BufferAttribute;
    const glintPos = this.glintLine.geometry.getAttribute('position') as THREE.BufferAttribute;
    const meshPos = this.liquidMesh.geometry.getAttribute('position') as THREE.BufferAttribute;

    for (let s = 0; s <= this.WAVE_SEGS; s++) {
      const t = s / this.WAVE_SEGS;
      const wx = ix + t * iw;

      // Wave: sine wave + secondary harmonic + slosh tilt
      const wave = Math.sin(t * Math.PI * 2 * this.waveFreq + time * 2.2) * effectiveWaveAmp
        + Math.sin(t * Math.PI * 2 * this.waveFreq * 0.5 + time * 1.1 + 0.8) * effectiveWaveAmp * 0.4;
      const tilt = effectiveSlosh * iw * (t - 0.5) * 2; // linear tilt from slosh
      const wy = waterTopY + wave + tilt;

      // Clamp wave inside container
      const clampedWy = Math.max(iy + 1, Math.min(floorY - 1, wy));

      wavePos.setXYZ(s, wx, clampedWy, 0.3);
      glintPos.setXYZ(s, wx, clampedWy - 1.5, 0.35);

      // Liquid body — top = wave, bottom = floor
      meshPos.setXYZ(s * 2, wx, clampedWy, 0.2);       // top vertex
      meshPos.setXYZ(s * 2 + 1, wx, floorY, 0.2);     // bottom vertex
    }

    wavePos.needsUpdate = true;
    glintPos.needsUpdate = true;
    meshPos.needsUpdate = true;
    this.liquidMesh.geometry.computeBoundingSphere();

    // --- Set opacities ---
    (this.waveLine.material as THREE.LineBasicMaterial).opacity = opacity * 0.9 * flashMul;
    (this.glintLine.material as THREE.LineBasicMaterial).opacity = opacity * 0.35 * flashMul;
    (this.liquidMesh.material as THREE.MeshBasicMaterial).opacity = opacity * 0.12 * flashMul;
    (this.containerFrame.material as THREE.LineBasicMaterial).opacity = opacity * 0.5 * flashMul;
    (this.levelTicks.material as THREE.LineBasicMaterial).opacity =
      opacity * (this.hasMarkers ? 0.45 : 0.15) * flashMul;

    // --- Bubbles ---
    if (this.hasBubbles && this.bubbles) {
      const bPos = this.bubbles.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < this.bubbleCount; i++) {
        this.bubbleY[i] -= this.bubbleVY[i] * dt;
        // Wobble sideways
        this.bubbleX[i] += Math.sin(time * 3 + this.bubblePhase[i]) * dt * 8;

        // Respawn when bubble exits the water surface
        if (this.bubbleY[i] < waterTopY || this.bubbleX[i] < ix || this.bubbleX[i] > ix + iw) {
          this.bubbleX[i] = ix + this.rng.float(0.05, 0.95) * iw;
          this.bubbleY[i] = floorY - this.rng.float(2, 8);
          this.bubbleVY[i] = this.rng.float(12, 40) * (1 + this.intensityBoost * 0.8);
          this.bubblePhase[i] = this.rng.float(0, Math.PI * 2);
        }

        bPos.setXYZ(i, this.bubbleX[i], this.bubbleY[i], 0.4);
      }
      bPos.needsUpdate = true;
      (this.bubbles.material as THREE.PointsMaterial).opacity = opacity * 0.55 * flashMul;
    }
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'alert') {
      // Level surges up rapidly
      this.targetLevel = 0.88;
      this.levelRiseTimer = 3.0;
      this.alertFlash = 2.5;
      this.pulseTimer = 2.0;
      this.sloshAmp = this.baseSloshAmp * 5;
      this.waveAmp = this.baseWaveAmp * 3;
      this.intensityBoost = 2.0;
    }
    if (action === 'glitch') {
      // Sudden level drop with choppy waves
      this.targetLevel = Math.max(0.1, this.currentLevel - 0.35);
      this.sloshAmp = this.baseSloshAmp * 4;
      this.waveAmp = this.baseWaveAmp * 3;
      this.intensityBoost = 1.5;
    }
    if (action === 'pulse') {
      // Level rises briefly
      this.targetLevel = Math.min(0.92, this.currentLevel + 0.12);
      this.sloshAmp = this.baseSloshAmp * 2.5;
      this.intensityBoost = 0.8;
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) {
      this.intensityBoost = 0;
      this.sloshAmp = this.baseSloshAmp;
      this.waveAmp = this.baseWaveAmp;
      return;
    }
    this.intensityBoost = level * 0.3;
    this.sloshAmp = this.baseSloshAmp * (1 + level * 0.6);
    this.waveAmp = this.baseWaveAmp * (1 + level * 0.5);
    if (level >= 5) {
      this.alertFlash = 0.8;
      this.targetLevel = Math.min(0.95, this.currentLevel + 0.15);
    }
  }
}
