import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';
import { hexCornersPixel, hexPerimeterPoint } from '../layout/hex-grid';

/**
 * Signal border — a tiny waveform (sine/square/sawtooth/heartbeat) that runs
 * continuously along the perimeter like a signal trace on an oscilloscope.
 * Uses a Line mesh that follows the perimeter with perpendicular displacement.
 */
export class SignalBorderElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'signal-border',
    meta: {
      shape: 'rectangular',
      roles: ['decorative', 'border'],
      moods: ['diagnostic', 'tactical'],
      bandAffinity: 'mid',
      sizes: ['works-small', 'needs-medium'],
    } satisfies ElementMeta,
  };

  private variant = 0;
  private line!: THREE.Line;
  private positionAttr!: THREE.BufferAttribute;
  private sampleCount = 0;
  private perimeterLength = 0;
  private isHex = false;
  private hexCorners: THREE.Vector3[] | null = null;
  private waveSpeed = 0;
  private waveFreq = 0;
  private amplitude = 0;
  private scrollOffset = 0;

  build(): void {
    this.variant = this.rng.int(0, 3);
    const { x, y, w, h } = this.px;
    const minDim = Math.min(w, h);

    const hexCell = this.region.hexCell;
    if (hexCell) {
      this.isHex = true;
      this.hexCorners = hexCornersPixel(hexCell, this.screenWidth, this.screenHeight);
      // Approximate hex perimeter
      const c = this.hexCorners;
      this.perimeterLength = 0;
      for (let i = 0; i < 6; i++) {
        const a = c[i], b = c[(i + 1) % 6];
        this.perimeterLength += Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
      }
    } else {
      this.perimeterLength = 2 * (w + h);
    }

    // Amplitude is small — this is a subtle overlay
    this.amplitude = minDim * 0.02;
    // Number of sample points around the perimeter
    this.sampleCount = Math.max(64, Math.floor(this.perimeterLength / Math.max(1, minDim * 0.015)));
    this.waveSpeed = this.rng.float(0.3, 0.8);
    this.waveFreq = this.rng.float(15, 40);

    // Build initial line geometry
    const positions = new Float32Array(this.sampleCount * 3);
    // Initialize all to tile center to avoid lines-to-origin
    const cx = x + w / 2;
    const cy = y + h / 2;
    for (let i = 0; i < this.sampleCount; i++) {
      positions[i * 3] = cx;
      positions[i * 3 + 1] = cy;
      positions[i * 3 + 2] = 0;
    }

    const geo = new THREE.BufferGeometry();
    this.positionAttr = new THREE.BufferAttribute(positions, 3);
    geo.setAttribute('position', this.positionAttr);

    const mat = new THREE.LineBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
    });
    this.line = new THREE.Line(geo, mat);
    this.group.add(this.line);
  }

  private perimeterPoint(t: number): { px: number; py: number } {
    if (this.isHex && this.hexCorners) {
      return hexPerimeterPoint(this.hexCorners, t);
    }
    const { x, y, w, h } = this.px;
    t = ((t % 1) + 1) % 1;
    const dist = t * this.perimeterLength;
    if (dist <= w) return { px: x + dist, py: y };
    if (dist <= w + h) return { px: x + w, py: y + (dist - w) };
    if (dist <= 2 * w + h) return { px: x + w - (dist - w - h), py: y + h };
    return { px: x, py: y + h - (dist - 2 * w - h) };
  }

  /** Compute the outward-facing normal at perimeter position t. */
  private perimeterNormal(t: number): { nx: number; ny: number } {
    const dt = 0.001;
    const p1 = this.perimeterPoint(t - dt);
    const p2 = this.perimeterPoint(t + dt);
    const dx = p2.px - p1.px;
    const dy = p2.py - p1.py;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    // Perpendicular (inward — toward center)
    return { nx: dy / len, ny: -dx / len };
  }

  private waveValue(phase: number): number {
    const p = ((phase % 1) + 1) % 1;
    switch (this.variant) {
      case 0: // Sine
        return Math.sin(p * Math.PI * 2);
      case 1: // Square
        return p < 0.5 ? 1 : -1;
      case 2: { // Noise / static
        // Deterministic-ish noise using sine hash
        const h = Math.sin(phase * 127.1 + 311.7) * 43758.5453;
        return (h - Math.floor(h)) * 2 - 1;
      }
      case 3: { // Heartbeat pulse
        // Two sharp peaks then flat
        if (p < 0.1) return Math.sin(p / 0.1 * Math.PI) * 1.0;
        if (p < 0.15) return 0;
        if (p < 0.25) return Math.sin((p - 0.15) / 0.1 * Math.PI) * 0.6;
        return 0;
      }
      default:
        return 0;
    }
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    this.scrollOffset += dt * this.waveSpeed;

    const positions = this.positionAttr.array as Float32Array;
    for (let i = 0; i < this.sampleCount; i++) {
      const t = i / this.sampleCount;
      const pt = this.perimeterPoint(t);
      const norm = this.perimeterNormal(t);
      const wavePhase = t * this.waveFreq + this.scrollOffset;
      const displacement = this.waveValue(wavePhase) * this.amplitude;
      positions[i * 3] = pt.px + norm.nx * displacement;
      positions[i * 3 + 1] = pt.py + norm.ny * displacement;
      positions[i * 3 + 2] = 0;
    }
    this.positionAttr.needsUpdate = true;

    const mat = this.line.material as THREE.LineBasicMaterial;
    mat.opacity = opacity * 0.15;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'alert') {
      (this.line.material as THREE.LineBasicMaterial).color.copy(this.palette.alert);
    }
    if (action === 'pulse') {
      this.waveFreq *= 1.5;
      setTimeout(() => { this.waveFreq /= 1.5; }, 500);
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level >= 3) {
      this.amplitude = Math.min(this.px.w, this.px.h) * 0.02 * (1 + level * 0.15);
    }
  }
}
