import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';
import { hexCornersPixel, hexPerimeterPoint } from '../layout/hex-grid';

/**
 * Corner pip — small decorative dots/squares placed at corners, midpoints,
 * or full perimeter of the region. Pulses and breathes with staggered timing.
 */
export class CornerPipElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'corner-pip',
    meta: {
      shape: 'rectangular',
      roles: ['decorative', 'structural'],
      moods: ['tactical', 'diagnostic'],
      bandAffinity: 'high',
      sizes: ['works-small', 'needs-medium'],
    },
  };

  private pips: THREE.Mesh[] = [];
  private pipPhases: number[] = [];
  private pipBaseOpacity: number[] = [];
  private connectorLines!: THREE.LineSegments;
  private hasConnectors: boolean = false;
  private variant: number = 0;
  private pipSize: number = 0;
  private breatheSpeed: number = 0;
  private breatheDepth: number = 0;
  private sequenceTimer: number = 0;
  private sequenceInterval: number = 0;
  private activeSequence: number = 0;
  private useSquares: boolean = false;

  build(): void {
    this.variant = this.rng.int(0, 3);
    const { x, y, w, h } = this.px;

    const presets = [
      // Variant 0: Corners only — 4 dots, slow breathe, no connectors
      { positions: 'corners', pipCount: 4, sizeRange: [4, 8] as const, breatheSpeed: 0.8, breatheDepth: 0.4, connectors: false, squares: false, sequenceInterval: 0 },
      // Variant 1: Corners + midpoints — 8 dots, staggered pulse
      { positions: 'corners+mid', pipCount: 8, sizeRange: [3, 6] as const, breatheSpeed: 1.4, breatheDepth: 0.5, connectors: true, squares: false, sequenceInterval: 0.3 },
      // Variant 2: Full perimeter dots — 16 dots, sequential lighting
      { positions: 'perimeter', pipCount: 16, sizeRange: [2, 4] as const, breatheSpeed: 2.0, breatheDepth: 0.3, connectors: false, squares: true, sequenceInterval: 0.12 },
      // Variant 3: Corner squares with accent dots — mixed, fast pulse
      { positions: 'corners+accent', pipCount: 12, sizeRange: [3, 7] as const, breatheSpeed: 3.0, breatheDepth: 0.6, connectors: true, squares: true, sequenceInterval: 0.08 },
    ];

    const p = presets[this.variant];
    this.breatheSpeed = p.breatheSpeed + this.rng.float(-0.2, 0.2);
    this.breatheDepth = p.breatheDepth;
    this.hasConnectors = p.connectors;
    this.useSquares = p.squares;
    this.sequenceInterval = p.sequenceInterval;
    this.pipSize = this.rng.float(p.sizeRange[0], p.sizeRange[1]);

    // Build pip positions based on variant
    const positions: Array<{ px: number; py: number; isAccent: boolean }> = [];
    const hexCell = this.region.hexCell;
    const hexCorners = hexCell
      ? hexCornersPixel(hexCell, this.screenWidth, this.screenHeight)
      : null;

    if (hexCorners) {
      // --- Hex mode ---
      if (p.positions === 'corners') {
        for (const c of hexCorners) positions.push({ px: c.x, py: c.y, isAccent: false });
      } else if (p.positions === 'corners+mid') {
        for (const c of hexCorners) positions.push({ px: c.x, py: c.y, isAccent: false });
        // Midpoints of each hex edge
        for (let i = 0; i < 6; i++) {
          const mid = hexPerimeterPoint(hexCorners, (i + 0.5) / 6);
          positions.push({ px: mid.px, py: mid.py, isAccent: true });
        }
      } else if (p.positions === 'perimeter') {
        for (let i = 0; i < p.pipCount; i++) {
          const pt = hexPerimeterPoint(hexCorners, i / p.pipCount);
          positions.push({ px: pt.px, py: pt.py, isAccent: i % 4 === 0 });
        }
      } else {
        // corners+accent: 6 vertex pips + accent dots at 1/3 and 2/3 along each edge
        for (const c of hexCorners) positions.push({ px: c.x, py: c.y, isAccent: false });
        for (let edge = 0; edge < 6; edge++) {
          for (const frac of [1 / 3, 2 / 3]) {
            const pt = hexPerimeterPoint(hexCorners, (edge + frac) / 6);
            positions.push({ px: pt.px, py: pt.py, isAccent: true });
          }
        }
      }
    } else {
      // --- Rect mode ---
      const corners = [
        { px: x, py: y },
        { px: x + w, py: y },
        { px: x + w, py: y + h },
        { px: x, py: y + h },
      ];

      if (p.positions === 'corners') {
        for (const c of corners) positions.push({ px: c.px, py: c.py, isAccent: false });
      } else if (p.positions === 'corners+mid') {
        for (const c of corners) positions.push({ px: c.px, py: c.py, isAccent: false });
        positions.push({ px: x + w / 2, py: y, isAccent: true });
        positions.push({ px: x + w, py: y + h / 2, isAccent: true });
        positions.push({ px: x + w / 2, py: y + h, isAccent: true });
        positions.push({ px: x, py: y + h / 2, isAccent: true });
      } else if (p.positions === 'perimeter') {
        const perimeter = 2 * (w + h);
        for (let i = 0; i < p.pipCount; i++) {
          const t = (i / p.pipCount) * perimeter;
          let px2: number, py2: number;
          if (t < w) {
            px2 = x + t; py2 = y;
          } else if (t < w + h) {
            px2 = x + w; py2 = y + (t - w);
          } else if (t < 2 * w + h) {
            px2 = x + w - (t - w - h); py2 = y + h;
          } else {
            px2 = x; py2 = y + h - (t - 2 * w - h);
          }
          positions.push({ px: px2, py: py2, isAccent: i % 4 === 0 });
        }
      } else {
        for (const c of corners) positions.push({ px: c.px, py: c.py, isAccent: false });
        for (let edge = 0; edge < 4; edge++) {
          for (const frac of [1 / 3, 2 / 3]) {
            let px2: number, py2: number;
            if (edge === 0) { px2 = x + w * frac; py2 = y; }
            else if (edge === 1) { px2 = x + w; py2 = y + h * frac; }
            else if (edge === 2) { px2 = x + w * (1 - frac); py2 = y + h; }
            else { px2 = x; py2 = y + h * (1 - frac); }
            positions.push({ px: px2, py: py2, isAccent: true });
          }
        }
      }
    }

    // Create pip meshes
    for (let i = 0; i < positions.length; i++) {
      const { px: px2, py: py2, isAccent } = positions[i];
      const sz = isAccent ? this.pipSize * 0.6 : this.pipSize;
      const geo = this.useSquares && !isAccent
        ? new THREE.PlaneGeometry(sz, sz)
        : new THREE.PlaneGeometry(sz * 0.85, sz * 0.85);
      const mat = new THREE.MeshBasicMaterial({
        color: isAccent ? this.palette.secondary : this.palette.primary,
        transparent: true,
        opacity: 0,
      });
      const pip = new THREE.Mesh(geo, mat);
      pip.position.set(px2, py2, 1);
      this.group.add(pip);
      this.pips.push(pip);
      this.pipPhases.push(this.rng.float(0, Math.PI * 2));
      this.pipBaseOpacity.push(isAccent ? 0.5 : 0.85);
    }

    // Optional connector lines between corner/vertex pips
    const vertexCount = hexCorners ? 6 : 4;
    if (this.hasConnectors && positions.length >= vertexCount) {
      const connVerts: number[] = [];
      for (let i = 0; i < vertexCount; i++) {
        const a = positions[i];
        const b = positions[(i + 1) % vertexCount];
        connVerts.push(a.px, a.py, 0, b.px, b.py, 0);
      }
      const connGeo = new THREE.BufferGeometry();
      connGeo.setAttribute('position', new THREE.Float32BufferAttribute(connVerts, 3));
      this.connectorLines = new THREE.LineSegments(connGeo, new THREE.LineBasicMaterial({
        color: this.palette.dim,
        transparent: true,
        opacity: 0,
      }));
      this.group.add(this.connectorLines);
    }
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);

    // Advance sequence timer
    if (this.sequenceInterval > 0) {
      this.sequenceTimer += dt;
      if (this.sequenceTimer >= this.sequenceInterval) {
        this.sequenceTimer = 0;
        this.activeSequence = (this.activeSequence + 1) % this.pips.length;
      }
    }

    for (let i = 0; i < this.pips.length; i++) {
      const pip = this.pips[i];
      const mat = pip.material as THREE.MeshBasicMaterial;
      const phase = this.pipPhases[i];
      const base = this.pipBaseOpacity[i];

      let pipOpacity: number;
      if (this.variant === 2) {
        // Sequential lighting sweep
        const dist = Math.abs(i - this.activeSequence);
        const normalDist = Math.min(dist, this.pips.length - dist) / this.pips.length;
        const seqBrightness = Math.max(0.15, 1 - normalDist * 4);
        pipOpacity = opacity * base * seqBrightness;
      } else if (this.variant === 3) {
        // Fast staggered pulse
        const wave = 0.5 + 0.5 * Math.sin(time * this.breatheSpeed + phase);
        const seqHighlight = i === this.activeSequence ? 1.3 : 1.0;
        pipOpacity = opacity * base * (0.4 + 0.6 * wave) * seqHighlight;
      } else {
        // Standard breathe with phase offset
        const wave = 0.5 + 0.5 * Math.sin(time * this.breatheSpeed + phase);
        pipOpacity = opacity * base * (1 - this.breatheDepth + this.breatheDepth * wave);
      }

      mat.opacity = Math.min(1, pipOpacity);

      // Subtle scale pulse on accent pips
      const scalePulse = 1 + 0.08 * Math.sin(time * this.breatheSpeed * 1.3 + phase);
      pip.scale.setScalar(scalePulse);
    }

    // Connector lines
    if (this.hasConnectors && this.connectorLines) {
      const connMat = this.connectorLines.material as THREE.LineBasicMaterial;
      const connWave = 0.5 + 0.5 * Math.sin(time * 0.5);
      connMat.opacity = opacity * 0.12 * connWave;
    }
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'pulse') {
      // Flash all pips bright
      for (const pip of this.pips) {
        (pip.material as THREE.MeshBasicMaterial).color.copy(this.palette.secondary);
      }
      setTimeout(() => {
        for (let i = 0; i < this.pips.length; i++) {
          const isAccent = this.pipBaseOpacity[i] < 0.8;
          (this.pips[i].material as THREE.MeshBasicMaterial).color.copy(
            isAccent ? this.palette.secondary : this.palette.primary
          );
        }
      }, 300);
    }
    if (action === 'alert') {
      for (const pip of this.pips) {
        (pip.material as THREE.MeshBasicMaterial).color.copy(this.palette.alert);
      }
    }
    if (action === 'glitch') {
      // Scramble phases
      for (let i = 0; i < this.pipPhases.length; i++) {
        this.pipPhases[i] = this.rng.float(0, Math.PI * 2);
      }
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) return;
    // Snap active sequence forward
    this.activeSequence = (this.activeSequence + level) % Math.max(1, this.pips.length);
  }
}
