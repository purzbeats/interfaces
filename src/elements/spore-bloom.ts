import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

interface SporeVariant {
  puffInterval: number;
  sporesPerPuff: number;
  poolSize: number;
  drift: number;
  gravity: number;
  mycelial: boolean;
}

/**
 * Biotech HUD element — fruiting body that periodically puffs spore particles.
 * Spores drift downward with gravity and sinusoidal horizontal motion,
 * settling on the substrate line at the bottom of the region.
 */
export class SporeBloomElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'spore-bloom',
    meta: {
      shape: 'rectangular',
      roles: ['decorative'],
      moods: ['ambient'],
      sizes: ['works-small', 'needs-medium'],
      bandAffinity: 'high',
    } satisfies ElementMeta,
  };

  // Three.js objects
  private fruitingBody!: THREE.Line;
  private fruitingBodyMat!: THREE.LineBasicMaterial;
  private substrateLine!: THREE.Line;
  private substrateMat!: THREE.LineBasicMaterial;
  private sporePoints!: THREE.Points;
  private settledMarks!: THREE.LineSegments;
  private settledMat!: THREE.LineBasicMaterial;

  // Variant config
  private puffInterval = 3;
  private sporesPerPuff = 15;
  private poolSize = 150;
  private driftStrength = 1;
  private gravityStrength = 40;
  private isMycelial = false;

  // Spore parallel arrays (SoA for perf)
  private sporeX!: Float32Array;
  private sporeY!: Float32Array;
  private sporeVX!: Float32Array;
  private sporeVY!: Float32Array;
  private sporeLife!: Float32Array;
  private sporeMaxLife!: Float32Array;
  private sporeActive!: Uint8Array;
  private sporeOffset!: Float32Array; // per-spore phase offset for sin drift

  // Settled spore tick marks
  private maxSettled = 200;
  private settledCount = 0;
  private settledThreshold = 40;

  // Timing
  private puffTimer = 0;

  // Fruiting body position and scale
  private capX = 0;
  private capY = 0;
  private capScale = 1;
  private substrateY = 0;

  // Intensity state
  private intensityLevel = 0;

  build(): void {
    const variant = this.rng.int(0, 3);
    const presets: SporeVariant[] = [
      { puffInterval: 3, sporesPerPuff: 15, poolSize: 150, drift: 1, gravity: 40, mycelial: false },     // Standard
      { puffInterval: 1.5, sporesPerPuff: 30, poolSize: 300, drift: 1.5, gravity: 50, mycelial: false }, // Explosive
      { puffInterval: 5, sporesPerPuff: 10, poolSize: 100, drift: 0.5, gravity: 25, mycelial: false },   // Delicate
      { puffInterval: 3, sporesPerPuff: 20, poolSize: 200, drift: 1, gravity: 40, mycelial: true },      // Mycelial
    ];
    const p = presets[variant];

    this.puffInterval = p.puffInterval;
    this.sporesPerPuff = p.sporesPerPuff;
    this.poolSize = p.poolSize;
    this.driftStrength = p.drift;
    this.gravityStrength = p.gravity;
    this.isMycelial = p.mycelial;
    this.settledThreshold = this.isMycelial ? 30 : 40;

    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;
    const scale = Math.min(w, h);

    // Fruiting body at top-center
    this.capX = x + w / 2;
    this.capY = y + h * 0.15; // y=0 is top, so 0.15 from top
    this.capScale = scale * 0.12;

    // Substrate at bottom
    this.substrateY = y + h * 0.92;

    // ── Fruiting body (mushroom dome shape) ──
    const capVerts: number[] = [];
    const numCapVerts = 12;
    // Left stem base
    capVerts.push(this.capX - this.capScale * 0.15, this.capY + this.capScale * 0.5, 1);
    // Left stem up to cap
    capVerts.push(this.capX - this.capScale * 0.15, this.capY + this.capScale * 0.1, 1);
    // Cap dome arc (left to right)
    for (let i = 0; i <= numCapVerts - 4; i++) {
      const t = i / (numCapVerts - 4);
      const angle = Math.PI + t * Math.PI; // semicircle from left to right
      const rx = this.capScale * 0.5;
      const ry = this.capScale * 0.35;
      capVerts.push(
        this.capX + Math.cos(angle) * rx,
        this.capY - Math.sin(angle) * ry,
        1,
      );
    }
    // Right stem down
    capVerts.push(this.capX + this.capScale * 0.15, this.capY + this.capScale * 0.1, 1);
    // Right stem base
    capVerts.push(this.capX + this.capScale * 0.15, this.capY + this.capScale * 0.5, 1);

    const capGeo = new THREE.BufferGeometry();
    capGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(capVerts), 3));
    this.fruitingBodyMat = new THREE.LineBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
    });
    this.fruitingBody = new THREE.Line(capGeo, this.fruitingBodyMat);
    this.group.add(this.fruitingBody);

    // ── Substrate line ──
    const subVerts = new Float32Array([
      x + w * 0.05, this.substrateY, 0,
      x + w * 0.95, this.substrateY, 0,
    ]);
    const subGeo = new THREE.BufferGeometry();
    subGeo.setAttribute('position', new THREE.BufferAttribute(subVerts, 3));
    this.substrateMat = new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    });
    this.substrateLine = new THREE.Line(subGeo, this.substrateMat);
    this.group.add(this.substrateLine);

    // ── Spore particles (pre-allocated pool) ──
    this.sporeX = new Float32Array(this.poolSize);
    this.sporeY = new Float32Array(this.poolSize);
    this.sporeVX = new Float32Array(this.poolSize);
    this.sporeVY = new Float32Array(this.poolSize);
    this.sporeLife = new Float32Array(this.poolSize);
    this.sporeMaxLife = new Float32Array(this.poolSize);
    this.sporeActive = new Uint8Array(this.poolSize);
    this.sporeOffset = new Float32Array(this.poolSize);
    for (let i = 0; i < this.poolSize; i++) {
      this.sporeOffset[i] = this.rng.float(0, Math.PI * 2);
    }

    const sporePos = new Float32Array(this.poolSize * 3);
    const sporeCol = new Float32Array(this.poolSize * 3);
    const sporeGeo = new THREE.BufferGeometry();
    sporeGeo.setAttribute('position', new THREE.BufferAttribute(sporePos, 3));
    sporeGeo.setAttribute('color', new THREE.BufferAttribute(sporeCol, 3));
    sporeGeo.setDrawRange(0, 0);
    this.sporePoints = new THREE.Points(sporeGeo, new THREE.PointsMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0,
      size: Math.max(2, scale * 0.006),
      sizeAttenuation: false,
    }));
    this.group.add(this.sporePoints);

    // ── Settled spore tick marks (LineSegments pool) ──
    // Each tick mark = 2 vertices (6 floats). Mycelial variant uses longer angled marks.
    this.maxSettled = this.isMycelial ? 120 : 200;
    const settledPos = new Float32Array(this.maxSettled * 6);
    const settledGeo = new THREE.BufferGeometry();
    settledGeo.setAttribute('position', new THREE.BufferAttribute(settledPos, 3));
    settledGeo.setDrawRange(0, 0);
    this.settledMat = new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    });
    this.settledMarks = new THREE.LineSegments(settledGeo, this.settledMat);
    this.group.add(this.settledMarks);

    // Start puff timer with some randomness
    this.puffTimer = this.rng.float(0, this.puffInterval);
  }

  /** Emit a burst of spores from the fruiting body cap */
  private emitSpores(count: number): void {
    const { w } = this.px;
    let emitted = 0;
    for (let i = 0; i < this.poolSize && emitted < count; i++) {
      if (this.sporeActive[i]) continue;

      // Emit from cap area with random spread
      const spreadX = this.rng.float(-this.capScale * 0.4, this.capScale * 0.4);
      this.sporeX[i] = this.capX + spreadX;
      this.sporeY[i] = this.capY - this.capScale * 0.2 + this.rng.float(-this.capScale * 0.1, this.capScale * 0.05);

      // Random outward + downward velocity
      const speed = this.rng.float(10, 40) * (w / 300);
      const angle = this.rng.float(Math.PI * 0.1, Math.PI * 0.9); // mostly downward spread
      this.sporeVX[i] = Math.cos(angle) * speed * (spreadX > 0 ? 1 : -1);
      this.sporeVY[i] = Math.sin(angle) * speed; // positive = downward in this coord system

      this.sporeLife[i] = this.rng.float(2.0, 5.0);
      this.sporeMaxLife[i] = this.sporeLife[i];
      this.sporeActive[i] = 1;
      this.sporeOffset[i] = this.rng.float(0, Math.PI * 2);

      emitted++;
    }
  }

  /** Add a settled tick mark at the substrate level */
  private addSettledMark(sx: number): void {
    if (this.settledCount >= this.maxSettled) return;

    const pos = this.settledMarks.geometry.getAttribute('position') as THREE.BufferAttribute;
    const idx = this.settledCount * 2; // 2 vertices per mark
    const tickH = this.isMycelial
      ? this.rng.float(3, 12) // mycelial: longer "hyphae"
      : this.rng.float(1.5, 4);

    if (this.isMycelial) {
      // Hyphae: radiating at angles
      const angle = this.rng.float(-Math.PI * 0.8, -Math.PI * 0.2); // mostly upward
      pos.setXYZ(idx, sx, this.substrateY, 0.5);
      pos.setXYZ(idx + 1, sx + Math.cos(angle) * tickH, this.substrateY + Math.sin(angle) * tickH, 0.5);
    } else {
      // Simple vertical tick mark upward from substrate
      pos.setXYZ(idx, sx, this.substrateY, 0.5);
      pos.setXYZ(idx + 1, sx, this.substrateY - tickH, 0.5);
    }
    pos.needsUpdate = true;
    this.settledCount++;
    this.settledMarks.geometry.setDrawRange(0, this.settledCount * 2);

    // Clear all settled marks when threshold is reached
    if (this.settledCount >= this.settledThreshold) {
      this.settledCount = 0;
      this.settledMarks.geometry.setDrawRange(0, 0);
    }
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    const { x, w } = this.px;

    // ── Puff timer ──
    const effectiveInterval = this.intensityLevel >= 5
      ? 0.2
      : this.puffInterval / Math.max(1, this.intensityLevel * 0.5 + 0.5);
    this.puffTimer -= dt;
    if (this.puffTimer <= 0) {
      this.puffTimer = effectiveInterval;
      const count = this.intensityLevel >= 5
        ? this.sporesPerPuff * 2
        : this.sporesPerPuff;
      this.emitSpores(count);
    }

    // ── Fruiting body breathing animation ──
    const breathe = 1 + 0.03 * Math.sin(time * 1.5);
    this.fruitingBody.scale.set(breathe, breathe, 1);
    // Keep scale centered on cap position
    this.fruitingBody.position.x = this.capX * (1 - breathe);
    this.fruitingBody.position.y = this.capY * (1 - breathe);

    // ── Update spore particles ──
    const sporePos = this.sporePoints.geometry.getAttribute('position') as THREE.BufferAttribute;
    const sporeCol = this.sporePoints.geometry.getAttribute('color') as THREE.BufferAttribute;
    const priR = this.palette.primary.r, priG = this.palette.primary.g, priB = this.palette.primary.b;
    const secR = this.palette.secondary.r, secG = this.palette.secondary.g, secB = this.palette.secondary.b;
    const alertR = this.palette.alert.r, alertG = this.palette.alert.g, alertB = this.palette.alert.b;

    let activeCount = 0;
    for (let i = 0; i < this.poolSize; i++) {
      if (!this.sporeActive[i]) continue;

      // Apply gravity (positive = downward in this coord system)
      this.sporeVY[i] += this.gravityStrength * dt;
      // Apply sinusoidal horizontal drift
      this.sporeVX[i] += Math.sin(time * 2 + this.sporeOffset[i]) * this.driftStrength * 20 * dt;

      this.sporeX[i] += this.sporeVX[i] * dt;
      this.sporeY[i] += this.sporeVY[i] * dt;
      this.sporeLife[i] -= dt;

      // Check if spore hit substrate
      if (this.sporeY[i] >= this.substrateY) {
        this.sporeActive[i] = 0;
        // Clamp x to substrate bounds
        const settleX = Math.max(x + w * 0.05, Math.min(x + w * 0.95, this.sporeX[i]));
        this.addSettledMark(settleX);
        continue;
      }

      // Check if lifetime expired
      if (this.sporeLife[i] <= 0) {
        this.sporeActive[i] = 0;
        continue;
      }

      // Compute fade based on remaining lifetime
      const lifeFrac = Math.max(0, this.sporeLife[i] / this.sporeMaxLife[i]);

      // Write position into compacted active array
      sporePos.setXYZ(activeCount, this.sporeX[i], this.sporeY[i], 1);

      // Alternate color between primary and secondary; alert at high intensity
      let cr: number, cg: number, cb: number;
      if (this.intensityLevel >= 3 && (i % 3 === 0)) {
        cr = alertR * lifeFrac;
        cg = alertG * lifeFrac;
        cb = alertB * lifeFrac;
      } else if (i % 2 === 0) {
        cr = priR * lifeFrac;
        cg = priG * lifeFrac;
        cb = priB * lifeFrac;
      } else {
        cr = secR * lifeFrac;
        cg = secG * lifeFrac;
        cb = secB * lifeFrac;
      }
      sporeCol.setXYZ(activeCount, cr, cg, cb);

      activeCount++;
    }
    sporePos.needsUpdate = true;
    sporeCol.needsUpdate = true;
    this.sporePoints.geometry.setDrawRange(0, activeCount);

    // ── Apply opacity to all materials ──
    this.fruitingBodyMat.opacity = opacity;
    this.substrateMat.opacity = opacity * 0.3;
    (this.sporePoints.material as THREE.PointsMaterial).opacity = opacity;
    this.settledMat.opacity = opacity * 0.4;
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    this.intensityLevel = level;

    if (level === 0) {
      this.intensityLevel = 0;
      return;
    }

    // Immediate burst at high levels
    if (level >= 3) {
      this.emitSpores(level * 5);
    }
    if (level >= 5) {
      // Spore storm: emit a massive burst immediately
      this.emitSpores(this.sporesPerPuff * 3);
    }
  }
}
