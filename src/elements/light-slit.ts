import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Venetian blind / light slit effect. Horizontal bars with gaps that shift,
 * creating a light-through-blinds look. Bars tilt/rotate slightly over time.
 * Variants: uniform slits, varying widths, opening/closing animation, angled.
 */
export class LightSlitElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'light-slit',
    meta: {
      shape: 'rectangular',
      roles: ['decorative', 'structural'],
      moods: ['tactical', 'ambient'],
      sizes: ['works-small', 'needs-medium'],
      bandAffinity: 'mid',
      audioSensitivity: 1.0,
    },
  };

  // One LineSegments object per bar (for easy per-bar tilt control)
  private bars: THREE.LineSegments[] = [];
  // Filled mesh slabs for the light-gap regions
  private lightSlabs: THREE.Mesh[] = [];
  // Outer frame
  private frame!: THREE.LineSegments;

  private numBars: number = 0;
  // Per-bar state
  private barHeights!: Float32Array;   // pixel height of each bar
  private barYBase!: Float32Array;     // resting Y top of each bar
  private barTiltPhase!: Float32Array; // individual tilt phase offset
  private barTiltAmp!: Float32Array;   // individual tilt amplitude (radians)

  private tiltSpeed: number = 0.4;
  private shiftSpeed: number = 0;
  private shiftPhase: number = 0;

  // Variant controls
  private variantOpenClose: boolean = false;
  private variantAngled: boolean = false;
  private openClosePhase: number = 0;
  private openCloseSpeed: number = 0.6;

  private intensityBoost: number = 0;
  private alertFlash: number = 0;

  build(): void {
    const variant = this.rng.int(0, 3);
    const presets = [
      // 0: uniform slits — evenly spaced, subtle tilt
      { bars: 8, barFrac: 0.55, gapFrac: 0.45, tiltAmp: 0.06, tiltSpd: 0.35, shiftSpd: 0, openClose: false, angled: false },
      // 1: varying widths — bars have random widths
      { bars: 10, barFrac: 0.50, gapFrac: 0.50, tiltAmp: 0.10, tiltSpd: 0.50, shiftSpd: 12, openClose: false, angled: false },
      // 2: opening/closing — bars animate open and shut
      { bars: 7, barFrac: 0.60, gapFrac: 0.40, tiltAmp: 0.04, tiltSpd: 0.25, shiftSpd: 6, openClose: true, angled: false },
      // 3: angled — bars are drawn at a fixed diagonal slant
      { bars: 9, barFrac: 0.52, gapFrac: 0.48, tiltAmp: 0.18, tiltSpd: 0.55, shiftSpd: 8, openClose: false, angled: true },
    ];
    const p = presets[variant];

    this.numBars = p.bars + this.rng.int(-1, 1);
    this.tiltSpeed = p.tiltSpd + this.rng.float(-0.05, 0.05);
    this.shiftSpeed = p.shiftSpd;
    this.variantOpenClose = p.openClose;
    this.variantAngled = p.angled;
    this.openCloseSpeed = 0.5 + this.rng.float(-0.1, 0.2);

    const { x, y, w, h } = this.px;

    // Compute bar and gap heights
    const totalSlots = this.numBars;
    const slotH = h / totalSlots;

    this.barHeights = new Float32Array(this.numBars);
    this.barYBase = new Float32Array(this.numBars);
    this.barTiltPhase = new Float32Array(this.numBars);
    this.barTiltAmp = new Float32Array(this.numBars);

    for (let i = 0; i < this.numBars; i++) {
      // Variant 1: varying bar heights
      const barFrac = variant === 1
        ? p.barFrac + this.rng.float(-0.2, 0.2)
        : p.barFrac;
      this.barHeights[i] = slotH * Math.max(0.1, Math.min(0.9, barFrac));
      this.barYBase[i] = y + i * slotH;
      this.barTiltPhase[i] = this.rng.float(0, Math.PI * 2);
      this.barTiltAmp[i] = p.tiltAmp * this.rng.float(0.6, 1.4);
    }

    // Create geometry for each bar (as LineSegments rectangle outline)
    for (let i = 0; i < this.numBars; i++) {
      const barVerts = new Float32Array(8 * 3); // 4 edges × 2 verts
      const barGeo = new THREE.BufferGeometry();
      barGeo.setAttribute('position', new THREE.BufferAttribute(barVerts, 3));

      const barLine = new THREE.LineSegments(barGeo, new THREE.LineBasicMaterial({
        color: this.palette.dim,
        transparent: true,
        opacity: 0,
      }));
      this.bars.push(barLine);
      this.group.add(barLine);

      // Light slab (the gap below bar — the "light shaft")
      const slabGeo = new THREE.PlaneGeometry(1, 1); // will be scaled via vertices
      const slab = new THREE.Mesh(slabGeo, new THREE.MeshBasicMaterial({
        color: this.palette.primary,
        transparent: true,
        opacity: 0,
      }));
      this.lightSlabs.push(slab);
      this.group.add(slab);
    }

    // Outer frame
    const fv = new Float32Array([
      x, y, 0, x + w, y, 0,
      x + w, y, 0, x + w, y + h, 0,
      x + w, y + h, 0, x, y + h, 0,
      x, y + h, 0, x, y, 0,
    ]);
    const frameGeo = new THREE.BufferGeometry();
    frameGeo.setAttribute('position', new THREE.BufferAttribute(fv, 3));
    this.frame = new THREE.LineSegments(frameGeo, new THREE.LineBasicMaterial({
      color: this.palette.secondary,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.frame);
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);

    if (this.intensityBoost > 0) this.intensityBoost = Math.max(0, this.intensityBoost - dt * 2.0);
    if (this.alertFlash > 0) this.alertFlash = Math.max(0, this.alertFlash - dt * 1.5);

    this.shiftPhase += this.shiftSpeed * dt;
    if (this.variantOpenClose) {
      this.openClosePhase += this.openCloseSpeed * dt;
    }

    const { x, y, w, h } = this.px;
    const totalSlots = this.numBars;
    const slotH = h / totalSlots;

    // Global shift — the whole blind system drifts up/down slowly
    const globalShift = Math.sin(this.shiftPhase * 0.3) * slotH * 0.15;

    const flashMul = this.alertFlash > 0
      ? (0.5 + 0.5 * Math.abs(Math.sin(time * 10)))
      : 1.0;

    for (let i = 0; i < this.numBars; i++) {
      const tilt = Math.sin(time * this.tiltSpeed + this.barTiltPhase[i]) * this.barTiltAmp[i];
      const angleMul = this.variantAngled ? 0.35 : 1.0;
      const effectiveTilt = Math.max(-0.2, Math.min(0.2, tilt * angleMul + (this.variantAngled ? 0.22 : 0)));

      // Open/close: barHeight oscillates
      let bh = this.barHeights[i];
      if (this.variantOpenClose) {
        const oc = 0.5 + 0.5 * Math.sin(this.openClosePhase + i * 0.4);
        bh = slotH * 0.1 + bh * oc;
      }
      // Intensity shrinks bars (opens the gaps for more light)
      bh = Math.max(2, bh * (1 - this.intensityBoost * 0.3));

      const topY = this.barYBase[i] + globalShift;
      const botY = topY + bh;
      const halfW = w / 2;

      // Tilt offset: left edge up, right edge down (or vice versa)
      const tiltOff = halfW * Math.tan(effectiveTilt);

      // Bar rectangle corners (tilted)
      const lx = x;
      const rx = x + w;
      const ltY = topY - tiltOff;
      const lbY = botY - tiltOff;
      const rtY = topY + tiltOff;
      const rbY = botY + tiltOff;

      const pos = this.bars[i].geometry.getAttribute('position') as THREE.BufferAttribute;
      // Top edge
      pos.setXYZ(0, lx, ltY, 0.2);
      pos.setXYZ(1, rx, rtY, 0.2);
      // Right edge
      pos.setXYZ(2, rx, rtY, 0.2);
      pos.setXYZ(3, rx, rbY, 0.2);
      // Bottom edge
      pos.setXYZ(4, rx, rbY, 0.2);
      pos.setXYZ(5, lx, lbY, 0.2);
      // Left edge
      pos.setXYZ(6, lx, lbY, 0.2);
      pos.setXYZ(7, lx, ltY, 0.2);
      pos.needsUpdate = true;

      (this.bars[i].material as THREE.LineBasicMaterial).opacity =
        opacity * (0.4 + this.intensityBoost * 0.15) * flashMul;

      // Light slab — fills the gap between this bar's bottom and next bar's top
      const nextTop = i + 1 < this.numBars
        ? this.barYBase[i + 1] + globalShift
        : y + h;
      const gapTop = botY;
      const gapBot = nextTop;
      const gapH = Math.max(0, gapBot - gapTop);
      const gapCy = (gapTop + gapBot) / 2;
      const gapCx = x + w / 2;

      const slab = this.lightSlabs[i];
      slab.position.set(gapCx, gapCy, 0.1);
      slab.scale.set(w, Math.max(0.5, gapH), 1);

      const slabBrightness = 0.04 + this.intensityBoost * 0.06;
      (slab.material as THREE.MeshBasicMaterial).opacity =
        opacity * slabBrightness * flashMul;
    }

    (this.frame.material as THREE.LineBasicMaterial).opacity = opacity * 0.3 * flashMul;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'alert') {
      this.alertFlash = 2.0;
      this.pulseTimer = 1.5;
      this.intensityBoost = 1.5;
    }
    if (action === 'glitch') {
      // Rapidly shuffle bar positions briefly
      this.intensityBoost = 2.0;
      for (let i = 0; i < this.numBars; i++) {
        this.barTiltPhase[i] = this.rng.float(0, Math.PI * 2);
      }
    }
    if (action === 'pulse') {
      this.intensityBoost = 0.8;
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) {
      this.intensityBoost = 0;
      return;
    }
    this.intensityBoost = level * 0.3;
    if (level >= 4) {
      this.alertFlash = 0.5;
    }
  }
}
