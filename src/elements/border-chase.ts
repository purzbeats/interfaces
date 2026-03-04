import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';
import { hexCornersPixel, hexPerimeterPoint } from '../layout/hex-grid';

/**
 * Border chase — animated dashes that flow continuously around the region
 * perimeter like "marching ants". Four variants: single chase, double opposing,
 * varying dash lengths, and dashes with corner accent decorations.
 */
export class BorderChaseElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'border-chase',
    meta: {
      shape: 'rectangular',
      roles: ['structural', 'decorative', 'border'],
      moods: ['tactical', 'ambient'],
      bandAffinity: 'bass',
      sizes: ['works-small', 'needs-medium', 'needs-large'],
    },
  };

  private variant: number = 0;

  // Primary chase line (all variants)
  private chaseLine!: THREE.Points;
  private chaseOffset: number = 0;
  private chaseSpeed: number = 0.3;

  // Secondary opposing chase (variant 1)
  private chaseLine2!: THREE.Points;
  private chaseOffset2: number = 0;

  // Base border (static dim outline)
  private borderOutline!: THREE.LineSegments;

  // Corner accents (variant 3)
  private cornerAccents: THREE.LineSegments[] = [];
  private cornerPulseTimer: number = 0;

  // Perimeter data
  private perimeterLength: number = 0;
  private dashSpacing: number = 0;
  private dashLength: number = 0;
  private dashCount: number = 0;

  // Dot positions along perimeter (normalized 0..1)
  private dotPositions: Float32Array = new Float32Array(0);

  private isHex: boolean = false;
  private hexCorners: THREE.Vector3[] | null = null;

  private alertActive: boolean = false;
  private speedBoost: number = 1;
  private alertTimer: number = 0;

  build(): void {
    this.variant = this.rng.int(0, 3);
    const { x, y, w, h } = this.px;

    const presets = [
      { speed: 0.25 + this.rng.float(-0.05, 0.05), dashLen: 0.04, gapLen: 0.025, dotSize: 2.5 },   // single chase
      { speed: 0.2 + this.rng.float(-0.05, 0.05), dashLen: 0.035, gapLen: 0.02, dotSize: 2.0 },     // double opposing
      { speed: 0.3 + this.rng.float(-0.05, 0.05), dashLen: 0.0, gapLen: 0.02, dotSize: 2.2 },       // varying dash lengths
      { speed: 0.22 + this.rng.float(-0.05, 0.05), dashLen: 0.03, gapLen: 0.018, dotSize: 2.3 },    // corner accents
    ];
    const p = presets[this.variant];

    const hexCell = this.region.hexCell;
    if (hexCell) {
      this.isHex = true;
      this.hexCorners = hexCornersPixel(hexCell, this.screenWidth, this.screenHeight);
      // Sum of 6 edge lengths
      let perim = 0;
      for (let i = 0; i < 6; i++) {
        const c1 = this.hexCorners[i], c2 = this.hexCorners[(i + 1) % 6];
        perim += Math.sqrt((c2.x - c1.x) ** 2 + (c2.y - c1.y) ** 2);
      }
      this.perimeterLength = perim;
    } else {
      this.perimeterLength = 2 * (w + h);
    }
    this.chaseSpeed = p.speed;

    // Dash layout
    const dashFrac = p.dashLen > 0 ? p.dashLen : (0.03 + this.rng.float(0, 0.04));
    const gapFrac = p.gapLen;
    const period = dashFrac + gapFrac;
    this.dashLength = dashFrac;
    this.dashSpacing = period;

    // How many dots make up each dash
    const dotsPerDash = Math.max(3, Math.floor(dashFrac * this.perimeterLength / 3));
    this.dashCount = Math.floor(1 / period);
    const totalDots = this.dashCount * dotsPerDash;

    // Build dot t-positions for one full revolution
    this.dotPositions = new Float32Array(totalDots);
    let idx = 0;
    for (let d = 0; d < this.dashCount; d++) {
      const dashStart = d * period;
      for (let p2 = 0; p2 < dotsPerDash; p2++) {
        this.dotPositions[idx++] = dashStart + (p2 / (dotsPerDash - 1)) * dashFrac;
      }
    }

    // For variant 2 (varying dash lengths), vary each dash
    if (this.variant === 2) {
      idx = 0;
      for (let d = 0; d < this.dashCount; d++) {
        const varLen = (0.015 + this.rng.float(0, 0.06));
        const dashStart = d * period;
        for (let p2 = 0; p2 < dotsPerDash; p2++) {
          this.dotPositions[idx++] = dashStart + (p2 / (dotsPerDash - 1)) * varLen;
        }
      }
    }

    // --- Static dim border ---
    let bv: Float32Array;
    if (this.isHex && this.hexCorners) {
      const hc = this.hexCorners;
      const borderVerts: number[] = [];
      for (let i = 0; i < 6; i++) {
        borderVerts.push(hc[i].x, hc[i].y, 0, hc[(i + 1) % 6].x, hc[(i + 1) % 6].y, 0);
      }
      bv = new Float32Array(borderVerts);
    } else {
      bv = new Float32Array([
        x, y, 0,       x + w, y, 0,
        x + w, y, 0,   x + w, y + h, 0,
        x + w, y + h, 0, x, y + h, 0,
        x, y + h, 0,   x, y, 0,
      ]);
    }
    const borderGeo = new THREE.BufferGeometry();
    borderGeo.setAttribute('position', new THREE.BufferAttribute(bv, 3));
    this.borderOutline = new THREE.LineSegments(borderGeo, new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.borderOutline);

    // --- Primary chase dots ---
    const pos1 = new Float32Array(totalDots * 3);
    const geo1 = new THREE.BufferGeometry();
    geo1.setAttribute('position', new THREE.BufferAttribute(pos1, 3));
    this.chaseLine = new THREE.Points(geo1, new THREE.PointsMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
      size: p.dotSize,
      sizeAttenuation: false,
    }));
    this.group.add(this.chaseLine);

    // --- Secondary opposing chase (variant 1) ---
    if (this.variant === 1) {
      const pos2 = new Float32Array(totalDots * 3);
      const geo2 = new THREE.BufferGeometry();
      geo2.setAttribute('position', new THREE.BufferAttribute(pos2, 3));
      this.chaseLine2 = new THREE.Points(geo2, new THREE.PointsMaterial({
        color: this.palette.secondary,
        transparent: true,
        opacity: 0,
        size: p.dotSize * 0.8,
        sizeAttenuation: false,
      }));
      this.chaseOffset2 = 0.5; // start on opposite side
      this.group.add(this.chaseLine2);
    }

    // --- Corner accents (variant 3) ---
    if (this.variant === 3) {
      const accentLen = Math.min(w, h) * 0.08;
      if (this.isHex && this.hexCorners) {
        // V-brackets at 6 hex vertices
        const hc = this.hexCorners;
        for (let i = 0; i < 6; i++) {
          const v = hc[i];
          const prev = hc[(i + 5) % 6], next = hc[(i + 1) % 6];
          const toPrevX = prev.x - v.x, toPrevY = prev.y - v.y;
          const toNextX = next.x - v.x, toNextY = next.y - v.y;
          const pl = Math.sqrt(toPrevX ** 2 + toPrevY ** 2);
          const nl = Math.sqrt(toNextX ** 2 + toNextY ** 2);
          const arm = Math.min(accentLen, pl * 0.25);
          const av = new Float32Array([
            v.x, v.y, 1,
            v.x + (toPrevX / pl) * arm, v.y + (toPrevY / pl) * arm, 1,
            v.x, v.y, 1,
            v.x + (toNextX / nl) * arm, v.y + (toNextY / nl) * arm, 1,
          ]);
          const ageo = new THREE.BufferGeometry();
          ageo.setAttribute('position', new THREE.Float32BufferAttribute(av, 3));
          const accent = new THREE.LineSegments(ageo, new THREE.LineBasicMaterial({
            color: this.palette.secondary,
            transparent: true,
            opacity: 0,
          }));
          this.cornerAccents.push(accent);
          this.group.add(accent);
        }
      } else {
        const corners = [
          { cx: x, cy: y, dx: 1, dy: 1 },
          { cx: x + w, cy: y, dx: -1, dy: 1 },
          { cx: x + w, cy: y + h, dx: -1, dy: -1 },
          { cx: x, cy: y + h, dx: 1, dy: -1 },
        ];
        for (const c of corners) {
          const av = new Float32Array([
            c.cx, c.cy, 1,
            c.cx + c.dx * accentLen, c.cy, 1,
            c.cx, c.cy, 1,
            c.cx, c.cy + c.dy * accentLen, 1,
          ]);
          const ageo = new THREE.BufferGeometry();
          ageo.setAttribute('position', new THREE.Float32BufferAttribute(av, 3));
          const accent = new THREE.LineSegments(ageo, new THREE.LineBasicMaterial({
            color: this.palette.secondary,
            transparent: true,
            opacity: 0,
          }));
          this.cornerAccents.push(accent);
          this.group.add(accent);
        }
      }
    }
  }

  /**
   * Map a normalized perimeter position t in [0,1] to world coords.
   */
  private perimeterPoint(t: number): { px: number; py: number } {
    if (this.isHex && this.hexCorners) {
      return hexPerimeterPoint(this.hexCorners, t);
    }
    const { x, y, w, h } = this.px;
    const perim = this.perimeterLength;
    t = ((t % 1) + 1) % 1;
    const dist = t * perim;

    if (dist <= w) {
      return { px: x + dist, py: y };
    }
    if (dist <= w + h) {
      return { px: x + w, py: y + (dist - w) };
    }
    if (dist <= 2 * w + h) {
      return { px: x + w - (dist - w - h), py: y + h };
    }
    return { px: x, py: y + h - (dist - 2 * w - h) };
  }

  private updateChasePoints(
    mesh: THREE.Points, offset: number, direction: number = 1
  ): void {
    const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const n = this.dotPositions.length;

    for (let i = 0; i < n; i++) {
      let t = direction > 0
        ? (offset + this.dotPositions[i]) % 1
        : (offset - this.dotPositions[i] + 1) % 1;
      t = ((t % 1) + 1) % 1;
      const pt = this.perimeterPoint(t);
      pos.setXYZ(i, pt.px, pt.py, 0.5);
    }
    pos.needsUpdate = true;
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);

    if (this.alertTimer > 0) {
      this.alertTimer -= dt;
      this.speedBoost = 4.0;
      if (this.alertTimer <= 0) this.speedBoost = 1;
    }

    const speed = this.chaseSpeed * this.speedBoost;
    this.chaseOffset = (this.chaseOffset + dt * speed) % 1;

    // Update primary chase
    this.updateChasePoints(this.chaseLine, this.chaseOffset, 1);

    // Pulsing brightness on the chase dots
    const brightness = 0.8 + Math.sin(time * 5) * 0.2;
    (this.chaseLine.material as THREE.PointsMaterial).opacity = opacity * brightness;
    (this.borderOutline.material as THREE.LineBasicMaterial).opacity = opacity * 0.2;

    if (this.variant === 1 && this.chaseLine2) {
      this.chaseOffset2 = (this.chaseOffset2 - dt * speed * 1.1 + 1) % 1;
      this.updateChasePoints(this.chaseLine2, this.chaseOffset2, -1);
      (this.chaseLine2.material as THREE.PointsMaterial).opacity = opacity * brightness * 0.7;
    }

    if (this.variant === 3) {
      this.cornerPulseTimer += dt;
      // Corner accents pulse at a slower rate
      const cornerBrightness = 0.4 + Math.sin(this.cornerPulseTimer * 2.5) * 0.5;
      for (const accent of this.cornerAccents) {
        (accent.material as THREE.LineBasicMaterial).opacity = opacity * Math.max(0, cornerBrightness);
      }
    }
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'activate') {
      this.chaseOffset = 0;
      this.chaseOffset2 = 0.5;
      this.speedBoost = 1;
    }
    if (action === 'alert') {
      this.alertTimer = 2.0;
      this.pulseTimer = 2.0;
      (this.chaseLine.material as THREE.PointsMaterial).color.copy(this.palette.alert);
      (this.borderOutline.material as THREE.LineBasicMaterial).color.copy(this.palette.alert);
      if (this.variant === 3) {
        for (const a of this.cornerAccents) {
          (a.material as THREE.LineBasicMaterial).color.copy(this.palette.alert);
        }
      }
    }
    if (action === 'pulse') {
      this.speedBoost = 3.0;
      setTimeout(() => { this.speedBoost = 1; }, 500);
    }
    if (action === 'glitch') {
      // Random offset jump
      this.chaseOffset = this.rng.float(0, 1);
      if (this.variant === 1) this.chaseOffset2 = this.rng.float(0, 1);
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) {
      this.speedBoost = 1;
      return;
    }
    if (level >= 5) {
      this.speedBoost = 5.0;
    } else if (level >= 3) {
      this.speedBoost = 2.5 + (level - 3) * 0.5;
    } else {
      this.speedBoost = 1.0 + level * 0.3;
    }
  }
}
