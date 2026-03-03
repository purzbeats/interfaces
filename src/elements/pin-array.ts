import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Grid of vertical pins/columns with varying heights, like a pin art toy.
 * Heights animate in wave patterns: radial wave, linear sweep, random bounce,
 * and ripple from center. Each pin is a vertical rectangle that scales on Y.
 */
export class PinArrayElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'pin-array',
    meta: { shape: 'rectangular', roles: ['data-display', 'decorative'], moods: ['diagnostic', 'ambient'], bandAffinity: 'mid', sizes: ['works-small', 'needs-medium', 'needs-large'] },
  };

  private pins: THREE.Mesh[] = [];
  private pinMaterials: THREE.MeshBasicMaterial[] = [];
  private borderLines!: THREE.LineSegments;
  private cols: number = 0;
  private rows: number = 0;
  private waveMode: number = 0;
  private waveSpeed: number = 0;
  private waveFreq: number = 0;
  private pinW: number = 0;
  private pinMaxH: number = 0;
  private pinBaseY: number = 0;
  private cellW: number = 0;
  private cellH: number = 0;
  /** Per-pin random phase offsets for bounce mode */
  private pinPhases: number[] = [];
  /** Per-pin spring velocities and current heights for bounce mode */
  private pinHeights: number[] = [];
  private pinVelocities: number[] = [];
  private pinTargets: number[] = [];
  private bounceUpdateTimer: number = 0;
  private bounceUpdateInterval: number = 0;
  private intensityBoost: number = 1.0;
  private rippleCenter: [number, number] = [0, 0];
  private rippleTime: number = -999;

  build(): void {
    this.waveMode = this.rng.int(0, 3);
    const presets = [
      { cols: 16, rows: 8, speedRange: [1.5, 3.0] as const, freqRange: [2.0, 4.0] as const },  // radial wave
      { cols: 20, rows: 1, speedRange: [2.0, 4.0] as const, freqRange: [1.5, 3.5] as const },  // linear sweep (single row)
      { cols: 12, rows: 6, speedRange: [0.5, 1.5] as const, freqRange: [1.0, 2.0] as const },  // random bounce
      { cols: 18, rows: 10, speedRange: [1.8, 3.5] as const, freqRange: [3.0, 5.0] as const }, // ripple from center
    ];
    const p = presets[this.waveMode];

    this.glitchAmount = 4;
    this.cols = p.cols;
    this.rows = p.rows;
    this.waveSpeed = this.rng.float(p.speedRange[0], p.speedRange[1]);
    this.waveFreq = this.rng.float(p.freqRange[0], p.freqRange[1]);
    this.bounceUpdateInterval = this.rng.float(0.3, 0.8);

    const { x, y, w, h } = this.px;
    this.cellW = w / this.cols;
    this.cellH = h / this.rows;
    this.pinMaxH = this.cellH * 0.85;
    this.pinW = this.cellW * 0.55;
    this.pinBaseY = y; // pins grow upward from base

    // Ripple center defaults to center of grid
    this.rippleCenter = [this.cols / 2, this.rows / 2];

    const totalPins = this.cols * this.rows;
    for (let i = 0; i < totalPins; i++) {
      const col = i % this.cols;
      const row = Math.floor(i / this.cols);

      const pinX = x + col * this.cellW + this.cellW / 2;
      const pinY = y + row * this.cellH + this.cellH / 2;

      // Pin geometry: a tall thin rectangle, anchored at bottom
      const geo = new THREE.PlaneGeometry(this.pinW, 1); // height=1, scaled dynamically
      // Determine color — vary slightly per row
      const rowFraction = row / Math.max(this.rows - 1, 1);
      const useSecondary = rowFraction > 0.75 && this.rng.chance(0.35);
      const useDim = this.rng.chance(0.15);
      const color = useDim
        ? new THREE.Color().copy(this.palette.dim)
        : useSecondary
          ? new THREE.Color().copy(this.palette.secondary)
          : new THREE.Color().copy(this.palette.primary);

      const mat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0,
      });
      const mesh = new THREE.Mesh(geo, mat);
      // Position: centered on cell, will scale vertically in update
      mesh.position.set(pinX, pinY, 1);

      this.pins.push(mesh);
      this.pinMaterials.push(mat);
      this.group.add(mesh);

      // Random phase per pin for bounce mode
      this.pinPhases.push(this.rng.float(0, Math.PI * 2));
      this.pinHeights.push(0.3);
      this.pinVelocities.push(0);
      this.pinTargets.push(this.rng.float(0.1, 1.0));
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
  }

  private computePinHeight(col: number, row: number, time: number): number {
    const cx = col / Math.max(this.cols - 1, 1);
    const cy = row / Math.max(this.rows - 1, 1);
    const midX = this.rippleCenter[0] / Math.max(this.cols - 1, 1);
    const midY = this.rippleCenter[1] / Math.max(this.rows - 1, 1);

    switch (this.waveMode) {
      case 0: { // radial wave from center
        const dist = Math.sqrt((cx - 0.5) ** 2 + (cy - 0.5) ** 2) * 2;
        return (Math.sin(dist * this.waveFreq * Math.PI - time * this.waveSpeed) + 1) * 0.5;
      }
      case 1: { // linear sweep (horizontal traveling wave)
        const wave = Math.sin(cx * this.waveFreq * Math.PI * 2 - time * this.waveSpeed);
        return (wave + 1) * 0.5;
      }
      case 2: { // random bounce — handled via spring physics, return target
        const i = row * this.cols + col;
        return this.pinHeights[i];
      }
      default: { // ripple from center (can shift)
        const dist = Math.sqrt((cx - midX) ** 2 + (cy - midY) ** 2) * 2.8;
        const ripple = Math.sin(dist * this.waveFreq * Math.PI - time * this.waveSpeed);
        // Secondary gentle wave
        const secondary = Math.sin(cx * 1.5 * Math.PI + cy * 1.2 * Math.PI - time * this.waveSpeed * 0.5) * 0.3;
        return Math.max(0, (ripple + secondary + 1) * 0.5);
      }
    }
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    const { y } = this.px;

    // Spring physics update for bounce mode
    if (this.waveMode === 2) {
      this.bounceUpdateTimer += dt;
      if (this.bounceUpdateTimer >= this.bounceUpdateInterval) {
        this.bounceUpdateTimer = 0;
        // Assign new random targets in wave-like spatial pattern
        const t = time;
        for (let i = 0; i < this.cols * this.rows; i++) {
          const col = i % this.cols;
          const row = Math.floor(i / this.cols);
          const cx = col / Math.max(this.cols - 1, 1);
          // Target influenced by position for organic look
          const base = (Math.sin(cx * 3 + t * 0.5 + this.pinPhases[i] * 0.3) + 1) * 0.5;
          this.pinTargets[i] = this.rng.float(0, 1) < 0.3 ? this.rng.float(0, 1) : base;
        }
      }

      // Spring update
      const springK = 18;
      const damping = 3.5;
      for (let i = 0; i < this.cols * this.rows; i++) {
        const force = (this.pinTargets[i] - this.pinHeights[i]) * springK;
        this.pinVelocities[i] += force * dt;
        this.pinVelocities[i] *= Math.exp(-damping * dt);
        this.pinHeights[i] += this.pinVelocities[i] * dt;
        this.pinHeights[i] = Math.max(0.02, Math.min(1.15, this.pinHeights[i]));
      }
    }

    // Decay intensity boost
    if (this.intensityBoost > 1.0) {
      this.intensityBoost += (1.0 - this.intensityBoost) * dt * 1.5;
    }

    // Update each pin
    for (let i = 0; i < this.pins.length; i++) {
      const col = i % this.cols;
      const row = Math.floor(i / this.cols);
      const pin = this.pins[i];
      const mat = this.pinMaterials[i];

      const rawH = this.computePinHeight(col, row, time) * this.intensityBoost;
      const clampedH = Math.max(0.02, Math.min(rawH, 1.2));
      const pinH = clampedH * this.pinMaxH;

      // Anchor pin at cell bottom, scale upward
      const cellBottomY = y + row * this.cellH;
      pin.scale.y = pinH;
      pin.position.y = cellBottomY + pinH / 2;

      // Color shifts to secondary/alert at high heights
      if (clampedH > 0.9) {
        mat.color.copy(this.palette.secondary);
      } else if (clampedH > 0.7) {
        mat.color.lerpColors(this.palette.primary, this.palette.secondary, (clampedH - 0.7) / 0.2);
      }

      // Opacity reflects height (taller = brighter)
      const heightBrightness = 0.3 + clampedH * 0.7;
      mat.opacity = opacity * heightBrightness * 0.85;
    }

    (this.borderLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.25;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'pulse') {
      // Kick all pins to max height
      if (this.waveMode === 2) {
        for (let i = 0; i < this.pinVelocities.length; i++) {
          this.pinVelocities[i] += this.rng.float(3, 6);
          this.pinTargets[i] = 1.0;
        }
      } else {
        this.intensityBoost = 2.0;
      }
    }
    if (action === 'glitch') {
      // Scramble heights randomly
      if (this.waveMode === 2) {
        for (let i = 0; i < this.pinHeights.length; i++) {
          this.pinHeights[i] = this.rng.float(0, 1);
          this.pinVelocities[i] = this.rng.float(-3, 3);
        }
      } else {
        this.waveMode = (this.waveMode + 1) % 4;
        this.waveFreq = this.rng.float(2.0, 6.0);
      }
    }
    if (action === 'alert') {
      // Move ripple center and flash alert color
      this.rippleCenter = [
        this.rng.float(0, this.cols),
        this.rng.float(0, this.rows),
      ];
      this.rippleTime = Date.now() / 1000;
      for (const mat of this.pinMaterials) {
        mat.color.copy(this.palette.alert);
      }
      this.intensityBoost = 2.5;
      setTimeout(() => {
        for (let i = 0; i < this.pinMaterials.length; i++) {
          const col = i % this.cols;
          const row = Math.floor(i / this.cols);
          const rowFraction = row / Math.max(this.rows - 1, 1);
          const color = rowFraction > 0.75 ? this.palette.secondary : this.palette.primary;
          this.pinMaterials[i].color.copy(color);
        }
      }, 2500);
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) {
      this.intensityBoost = 1.0;
      return;
    }
    this.intensityBoost = 1.0 + level * 0.35;
    if (level >= 3 && this.waveMode === 2) {
      // Bounce mode: kick all pins
      for (let i = 0; i < this.pinVelocities.length; i++) {
        this.pinVelocities[i] += level * 0.8;
      }
    }
    if (level >= 4) {
      // Shift ripple center on big hits
      this.rippleCenter = [
        this.rng.float(0, this.cols),
        this.rng.float(0, this.rows),
      ];
    }
  }
}
