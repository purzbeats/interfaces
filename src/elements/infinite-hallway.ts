import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';

/**
 * Nested rectangles converging toward a drifting vanishing point,
 * evoking an infinite liminal corridor. Nonlinear depth scaling
 * creates an accelerating sense of distance.
 */
export class InfiniteHallwayElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'infinite-hallway',
    meta: { shape: 'rectangular', roles: ['decorative'], moods: ['ambient'], sizes: ['needs-medium', 'needs-large'], bandAffinity: 'sub' },
  };
  private rectLines!: THREE.LineSegments;
  private vanishDot!: THREE.Points;
  private rectCount: number = 0;
  private cx: number = 0;
  private cy: number = 0;
  private hw: number = 0;
  private hh: number = 0;
  private vpX: number = 0;
  private vpY: number = 0;
  private vpFreqX: number = 0;
  private vpFreqY: number = 0;
  private vpPhaseX: number = 0;
  private vpPhaseY: number = 0;
  private vpDriftR: number = 0;
  private breathSpeed: number = 0;
  private breathAmp: number = 0;
  private altColor: boolean = false;

  build(): void {
    const variant = this.rng.int(0, 4);
    const presets = [
      { rects: 12, breathSpeed: 0.8, breathAmp: 0.03, driftR: 0.08, altColor: false },   // Standard
      { rects: 15, breathSpeed: 0.4, breathAmp: 0.02, driftR: 0.05, altColor: false },   // Deep
      { rects: 8,  breathSpeed: 1.5, breathAmp: 0.06, driftR: 0.15, altColor: false },   // Unstable
      { rects: 12, breathSpeed: 0.6, breathAmp: 0.04, driftR: 0.06, altColor: true },    // Claustrophobic
    ];
    const p = presets[variant];

    this.glitchAmount = 5;
    const { x, y, w, h } = this.px;
    this.cx = x + w / 2;
    this.cy = y + h / 2;
    this.hw = w / 2;
    this.hh = h / 2;
    this.rectCount = p.rects;
    this.breathSpeed = p.breathSpeed;
    this.breathAmp = p.breathAmp;
    this.vpDriftR = p.driftR;
    this.altColor = p.altColor;

    this.vpX = this.cx;
    this.vpY = this.cy;
    this.vpFreqX = this.rng.float(0.2, 0.6);
    this.vpFreqY = this.rng.float(0.3, 0.7);
    this.vpPhaseX = this.rng.float(0, Math.PI * 2);
    this.vpPhaseY = this.rng.float(0, Math.PI * 2);

    // Each rectangle = 4 line segments = 8 vertices
    const verts = new Float32Array(this.rectCount * 8 * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    this.rectLines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
      vertexColors: this.altColor,
    }));
    if (this.altColor) {
      const colors = new Float32Array(this.rectCount * 8 * 3);
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    }
    this.group.add(this.rectLines);

    // Vanishing point dot
    const dotGeo = new THREE.BufferGeometry();
    dotGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([this.cx, this.cy, 0]), 3));
    this.vanishDot = new THREE.Points(dotGeo, new THREE.PointsMaterial({
      color: this.palette.secondary,
      transparent: true,
      opacity: 0,
      size: 3,
      sizeAttenuation: false,
    }));
    this.group.add(this.vanishDot);
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    const { x, y, w, h } = this.px;

    // Lissajous drift for vanishing point
    this.vpX = this.cx + Math.sin(time * this.vpFreqX + this.vpPhaseX) * this.hw * this.vpDriftR;
    this.vpY = this.cy + Math.sin(time * this.vpFreqY + this.vpPhaseY) * this.hh * this.vpDriftR;

    const breath = Math.sin(time * this.breathSpeed) * this.breathAmp;

    const pos = this.rectLines.geometry.getAttribute('position') as THREE.BufferAttribute;
    const colors = this.altColor ? this.rectLines.geometry.getAttribute('color') as THREE.BufferAttribute : null;

    const pr = this.palette.primary;
    const sec = this.palette.secondary;

    for (let i = 0; i < this.rectCount; i++) {
      const t = Math.pow((i + 1) / this.rectCount, 1.5);
      const scale = 1 - t + breath * (1 - t);

      // Interpolate from outer rect to vanishing point
      const rx = x + (this.vpX - x) * t;
      const ry = y + (this.vpY - y) * t;
      const rw = w * scale;
      const rh = h * scale;

      const lx = rx + (w - rw) * (t * 0.5);
      const ly = ry + (h - rh) * (t * 0.5);

      // Recenter toward vanishing point
      const centerX = lx + rw / 2;
      const centerY = ly + rh / 2;
      const offX = (this.vpX - centerX) * t * 0.5;
      const offY = (this.vpY - centerY) * t * 0.5;

      const x0 = lx + offX;
      const y0 = ly + offY;
      const x1 = x0 + rw;
      const y1 = y0 + rh;

      const vi = i * 8;
      // Top edge
      pos.setXYZ(vi,     x0, y0, 0);
      pos.setXYZ(vi + 1, x1, y0, 0);
      // Right edge
      pos.setXYZ(vi + 2, x1, y0, 0);
      pos.setXYZ(vi + 3, x1, y1, 0);
      // Bottom edge
      pos.setXYZ(vi + 4, x1, y1, 0);
      pos.setXYZ(vi + 5, x0, y1, 0);
      // Left edge
      pos.setXYZ(vi + 6, x0, y1, 0);
      pos.setXYZ(vi + 7, x0, y0, 0);

      if (colors) {
        const useAlt = i % 2 === 0;
        const cr = useAlt ? sec.r : pr.r;
        const cg = useAlt ? sec.g : pr.g;
        const cb = useAlt ? sec.b : pr.b;
        for (let j = 0; j < 8; j++) {
          colors.setXYZ(vi + j, cr, cg, cb);
        }
      }
    }
    pos.needsUpdate = true;
    if (colors) colors.needsUpdate = true;

    // Vanishing point dot
    const dotPos = this.vanishDot.geometry.getAttribute('position') as THREE.BufferAttribute;
    dotPos.setXYZ(0, this.vpX, this.vpY, 0);
    dotPos.needsUpdate = true;

    (this.rectLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.7;
    (this.vanishDot.material as THREE.PointsMaterial).opacity = opacity * 0.5;
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) return;
    this.breathAmp += level * 0.01;
    if (level >= 5) {
      this.breathAmp = 0.15;
      setTimeout(() => { this.breathAmp = 0.03; }, 1500);
    }
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      this.vpPhaseX += Math.PI;
      this.vpPhaseY += Math.PI;
    }
  }
}
