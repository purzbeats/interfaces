import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Animated chain made of interlocking oval links. Chain sways or flows.
 * Built from elliptical line loops connected in sequence.
 * Variants: horizontal chain, vertical, draped/catenary curve, vibrating.
 */
export class ChainLinkElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'chain-link',
    meta: {
      shape: 'linear',
      roles: ['decorative', 'structural'],
      moods: ['tactical', 'diagnostic'],
      sizes: ['works-small', 'needs-medium'],
      bandAffinity: 'bass',
      audioSensitivity: 1.1,
    },
  };

  // Per-link line loops (each is a closed ellipse approximated by line segments)
  private links: THREE.LineLoop[] = [];
  // Highlight accent lines along each link
  private linkHighlights: THREE.LineSegments[] = [];

  // Chain configuration
  private numLinks: number = 0;
  private linkW: number = 0;   // ellipse semi-axis X (pixels)
  private linkH: number = 0;   // ellipse semi-axis Y (pixels)
  private isVertical: boolean = false;
  private isCatenary: boolean = false;
  private isVibrating: boolean = false;

  // Per-link sway state
  private linkSwayPhase!: Float32Array;
  private linkSwayAmp!: Float32Array;
  private swaySpeed: number = 0.8;
  private vibPhase!: Float32Array;

  private intensityBoost: number = 0;
  private alertFlash: number = 0;
  private alertTimer: number = 0;

  // Ellipse resolution (segments per link)
  private readonly SEGS = 18;

  build(): void {
    const variant = this.rng.int(0, 3);
    const presets = [
      // 0: horizontal chain — links side by side, gentle sway
      { vertical: false, catenary: false, vibrating: false, numLinks: 7, linkWFrac: 0.065, linkHFrac: 0.12, swaySpd: 0.7 },
      // 1: vertical chain — links stacked, gravity sag
      { vertical: true, catenary: false, vibrating: false, numLinks: 8, linkWFrac: 0.12, linkHFrac: 0.065, swaySpd: 0.5 },
      // 2: draped/catenary — hangs in a natural curve
      { vertical: false, catenary: true, vibrating: false, numLinks: 9, linkWFrac: 0.055, linkHFrac: 0.10, swaySpd: 0.4 },
      // 3: vibrating — chain shakes like plucked string
      { vertical: false, catenary: false, vibrating: true, numLinks: 8, linkWFrac: 0.060, linkHFrac: 0.11, swaySpd: 1.4 },
    ];
    const p = presets[variant];

    this.isVertical = p.vertical;
    this.isCatenary = p.catenary;
    this.isVibrating = p.vibrating;
    this.swaySpeed = p.swaySpd + this.rng.float(-0.1, 0.1);

    const { x, y, w, h } = this.px;
    this.numLinks = p.numLinks + this.rng.int(-1, 1);

    this.linkW = (this.isVertical ? w : w / this.numLinks) * p.linkWFrac * this.numLinks;
    this.linkH = (this.isVertical ? h / this.numLinks : h) * p.linkHFrac * this.numLinks;

    // Clamp link dimensions sensibly
    if (this.isVertical) {
      this.linkH = Math.min(h / this.numLinks * 0.85, Math.max(8, h * p.linkHFrac));
      this.linkW = Math.min(w * 0.6, Math.max(10, w * p.linkWFrac * 4));
    } else {
      this.linkW = Math.min(w / this.numLinks * 0.85, Math.max(8, w * p.linkWFrac * 4));
      this.linkH = Math.min(h * 0.6, Math.max(10, h * p.linkHFrac * 4));
    }

    this.linkSwayPhase = new Float32Array(this.numLinks);
    this.linkSwayAmp = new Float32Array(this.numLinks);
    this.vibPhase = new Float32Array(this.numLinks);

    for (let i = 0; i < this.numLinks; i++) {
      this.linkSwayPhase[i] = this.rng.float(0, Math.PI * 2);
      this.linkSwayAmp[i] = this.rng.float(0.6, 1.4);
      this.vibPhase[i] = (i / this.numLinks) * Math.PI;
    }

    // Build ellipse vertex positions (shared buffer shape, updated in update())
    for (let i = 0; i < this.numLinks; i++) {
      const pts = new Float32Array((this.SEGS + 1) * 3);
      for (let s = 0; s <= this.SEGS; s++) {
        const angle = (s / this.SEGS) * Math.PI * 2;
        pts[s * 3] = Math.cos(angle);
        pts[s * 3 + 1] = Math.sin(angle);
        pts[s * 3 + 2] = 0;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pts, 3));

      // Alternating colors: primary / secondary for interlock feel
      const color = i % 2 === 0 ? this.palette.primary : this.palette.secondary;
      const mat = new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity: 0,
      });
      const loop = new THREE.LineLoop(geo, mat);
      this.links.push(loop);
      this.group.add(loop);

      // Highlight accent — a short bright arc on each link
      const hlPts = new Float32Array(6 * 3); // 5-segment arc
      const hlGeo = new THREE.BufferGeometry();
      hlGeo.setAttribute('position', new THREE.BufferAttribute(hlPts, 3));
      const hl = new THREE.LineSegments(hlGeo, new THREE.LineBasicMaterial({
        color: i % 2 === 0 ? this.palette.bg : this.palette.dim,
        transparent: true,
        opacity: 0,
      }));
      this.linkHighlights.push(hl);
      this.group.add(hl);
    }
  }

  /**
   * Compute the center position for link i at the given time.
   */
  private getLinkCenter(i: number, time: number): { cx: number; cy: number; tiltAngle: number } {
    const { x, y, w, h } = this.px;
    const cx0 = x + w / 2;
    const cy0 = y + h / 2;

    // Sway displacement (perpendicular to chain axis)
    const swayAmt = this.linkSwayAmp[i] * (this.isVibrating ? 1.8 : 0.8);
    const swayDisp = Math.sin(time * this.swaySpeed + this.linkSwayPhase[i]) *
      (this.isVertical ? this.linkW : this.linkH) * 0.15 * swayAmt;

    // Catenary: links droop in a parabolic arc
    let sag = 0;
    if (this.isCatenary) {
      const t = (i / (this.numLinks - 1)) * 2 - 1; // -1 to 1
      sag = t * t * h * 0.28; // parabolic sag
    }

    // Vibration: standing wave
    let vibDisp = 0;
    if (this.isVibrating) {
      const t = i / (this.numLinks - 1);
      vibDisp = Math.sin(Math.PI * t) * Math.sin(time * this.swaySpeed * 2 + this.vibPhase[i]) *
        (this.isVertical ? this.linkW : this.linkH) * 0.25 *
        (1 + this.intensityBoost * 0.5);
    }

    // Intensity boost adds extra jitter
    const jitter = this.intensityBoost > 0
      ? Math.sin(time * 14 + i * 1.7) * this.linkW * 0.06 * this.intensityBoost
      : 0;

    if (this.isVertical) {
      const step = h / (this.numLinks + 1);
      const cx = cx0 + swayDisp + vibDisp + jitter;
      const cy = y + step * (i + 1) + sag;
      const tiltAngle = Math.atan2(swayDisp + vibDisp, step) * 0.5;
      return { cx, cy, tiltAngle };
    } else {
      const step = w / (this.numLinks + 1);
      const cx = x + step * (i + 1);
      const cy = cy0 + swayDisp + sag + vibDisp + jitter;
      const tiltAngle = Math.atan2(swayDisp + vibDisp, step) * 0.5;
      return { cx, cy, tiltAngle };
    }
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);

    if (this.intensityBoost > 0) this.intensityBoost = Math.max(0, this.intensityBoost - dt * 1.5);
    if (this.alertFlash > 0) this.alertFlash = Math.max(0, this.alertFlash - dt * 1.5);
    if (this.alertTimer > 0) this.alertTimer -= dt;

    const flashMul = this.alertFlash > 0
      ? (0.6 + 0.4 * Math.abs(Math.sin(time * 9)))
      : 1.0;

    // Whether links are interlocked — every other link is rotated 90deg
    const interlockRot = Math.PI / 2;

    for (let i = 0; i < this.numLinks; i++) {
      const { cx, cy, tiltAngle } = this.getLinkCenter(i, time);

      // Links alternate between horizontal and vertical ellipses for interlock
      const baseRot = (i % 2 === 0) ? tiltAngle : tiltAngle + interlockRot;
      const cosR = Math.cos(baseRot);
      const sinR = Math.sin(baseRot);

      const pos = this.links[i].geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let s = 0; s <= this.SEGS; s++) {
        const angle = (s / this.SEGS) * Math.PI * 2;
        const lx = Math.cos(angle) * this.linkW;
        const ly = Math.sin(angle) * this.linkH;
        // Apply rotation
        const rx = lx * cosR - ly * sinR;
        const ry = lx * sinR + ly * cosR;
        pos.setXYZ(s, cx + rx, cy + ry, i % 2 === 0 ? 0.3 : 0.1);
      }
      pos.needsUpdate = true;

      // Depth cue: front-facing links (even) brighter
      const depthOpacity = i % 2 === 0 ? 0.85 : 0.55;
      (this.links[i].material as THREE.LineBasicMaterial).opacity =
        opacity * depthOpacity * flashMul;

      // Highlight arc — top portion of ellipse
      const hlPos = this.linkHighlights[i].geometry.getAttribute('position') as THREE.BufferAttribute;
      const arcStart = Math.PI * 0.65;
      const arcEnd = Math.PI * 1.35;
      const arcSegs = 5;
      for (let s = 0; s < arcSegs; s++) {
        const a0 = arcStart + (arcEnd - arcStart) * (s / arcSegs);
        const a1 = arcStart + (arcEnd - arcStart) * ((s + 1) / arcSegs);
        const lx0 = Math.cos(a0) * this.linkW * 0.85;
        const ly0 = Math.sin(a0) * this.linkH * 0.85;
        const lx1 = Math.cos(a1) * this.linkW * 0.85;
        const ly1 = Math.sin(a1) * this.linkH * 0.85;
        const rx0 = lx0 * cosR - ly0 * sinR;
        const ry0 = lx0 * sinR + ly0 * cosR;
        const rx1 = lx1 * cosR - ly1 * sinR;
        const ry1 = lx1 * sinR + ly1 * cosR;
        hlPos.setXYZ(s * 2, cx + rx0, cy + ry0, i % 2 === 0 ? 0.4 : 0.2);
        hlPos.setXYZ(s * 2 + 1, cx + rx1, cy + ry1, i % 2 === 0 ? 0.4 : 0.2);
      }
      hlPos.needsUpdate = true;
      (this.linkHighlights[i].material as THREE.LineBasicMaterial).opacity =
        opacity * 0.35 * flashMul;
    }
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'alert') {
      this.alertFlash = 2.0;
      this.alertTimer = 2.0;
      this.pulseTimer = 1.5;
      this.intensityBoost = 1.5;
    }
    if (action === 'glitch') {
      // Scramble sway phases — chain rattles
      for (let i = 0; i < this.numLinks; i++) {
        this.linkSwayPhase[i] = this.rng.float(0, Math.PI * 2);
      }
      this.intensityBoost = 2.0;
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
    this.intensityBoost = level * 0.35;
    if (level >= 5) {
      this.alertFlash = 1.0;
      // Speed up sway
      for (let i = 0; i < this.numLinks; i++) {
        this.linkSwayAmp[i] = this.rng.float(1.5, 2.5);
      }
    } else if (level >= 3) {
      for (let i = 0; i < this.numLinks; i++) {
        this.linkSwayAmp[i] = 1.0 + level * 0.2;
      }
    }
  }
}
