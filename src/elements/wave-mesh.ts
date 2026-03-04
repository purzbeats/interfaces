import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * 3D wireframe wave surface viewed from a slight angle.
 * A grid of points connected by horizontal and vertical lines,
 * with sine wave displacement on the Z/Y axis. Four wave modes:
 * calm, choppy, standing wave, and interference pattern.
 */
export class WaveMeshElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'wave-mesh',
    meta: { shape: 'rectangular', roles: ['decorative', 'data-display'], moods: ['ambient', 'diagnostic'], bandAffinity: 'bass', sizes: ['needs-medium', 'needs-large'] },
  };

  private hLines: THREE.Line[] = [];  // horizontal grid lines (along X)
  private vLines: THREE.Line[] = [];  // vertical grid lines (along Y)
  private borderLines!: THREE.LineSegments;
  private gridCols: number = 0;
  private gridRows: number = 0;
  private waveMode: number = 0;
  private waveFreq: number = 0;
  private waveSpeed: number = 0;
  private waveAmp: number = 0;
  private freq2: number = 0;
  private speed2: number = 0;
  private perspectiveTilt: number = 0;
  private intensityBoost: number = 1.0;
  /** Cached flat Y positions for each grid point (screen space) */
  private baseY: number[] = [];
  /** Cached flat X positions for each grid point (screen space) */
  private baseX: number[] = [];

  build(): void {
    this.waveMode = this.rng.int(0, 3);
    const presets = [
      { cols: 20, rows: 12, freqRange: [1.5, 3.0] as const, speedRange: [0.8, 1.5] as const, ampFraction: 0.06, tiltRange: [0.25, 0.4] as const },  // calm
      { cols: 24, rows: 14, freqRange: [3.0, 6.0] as const, speedRange: [2.0, 4.0] as const, ampFraction: 0.05, tiltRange: [0.2, 0.35] as const }, // choppy
      { cols: 18, rows: 10, freqRange: [2.0, 4.0] as const, speedRange: [1.5, 2.5] as const, ampFraction: 0.07, tiltRange: [0.3, 0.45] as const }, // standing wave
      { cols: 22, rows: 12, freqRange: [2.5, 5.0] as const, speedRange: [1.0, 2.0] as const, ampFraction: 0.055, tiltRange: [0.25, 0.4] as const }, // interference
    ];
    const p = presets[this.waveMode];

    this.glitchAmount = 5;
    this.gridCols = p.cols;
    this.gridRows = p.rows;
    this.waveFreq = this.rng.float(p.freqRange[0], p.freqRange[1]);
    this.waveSpeed = this.rng.float(p.speedRange[0], p.speedRange[1]);
    this.perspectiveTilt = this.rng.float(p.tiltRange[0], p.tiltRange[1]);
    this.freq2 = this.waveFreq * this.rng.float(1.3, 2.1);
    this.speed2 = this.waveSpeed * this.rng.float(0.6, 1.4);

    const { x, y, w, h } = this.px;
    this.waveAmp = h * p.ampFraction;

    // Perspective-compressed view: top of grid appears narrower/higher
    // We map a 3D grid onto 2D by tilting the Y axis
    const perspDepth = this.perspectiveTilt; // fraction of h used for depth compression

    // Precompute base positions for all grid points
    for (let row = 0; row <= this.gridRows; row++) {
      const rowT = row / this.gridRows; // 0 = back/top, 1 = front/bottom
      const perspScale = 0.4 + 0.6 * rowT; // front rows are wider
      const baseRowY = y + rowT * h * (1 - perspDepth) + perspDepth * h * rowT * rowT;

      for (let col = 0; col <= this.gridCols; col++) {
        const colT = col / this.gridCols;
        // X position is compressed toward center at back
        const rowW = w * perspScale;
        const rowX = x + (w - rowW) / 2 + colT * rowW;
        this.baseX.push(rowX);
        this.baseY.push(baseRowY);
      }
    }

    // Build horizontal lines (one per row, pointsPerLine = cols+1)
    const pointsPerHLine = this.gridCols + 1;
    for (let row = 0; row <= this.gridRows; row++) {
      const positions = new Float32Array(pointsPerHLine * 3);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

      // Depth-based color: back rows are dim, front rows are primary
      const depth = row / this.gridRows;
      const color = new THREE.Color().copy(this.palette.dim).lerp(this.palette.primary, depth * depth);

      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity: 0,
      }));
      this.hLines.push(line);
      this.group.add(line);
    }

    // Build vertical lines (one per col, pointsPerLine = rows+1)
    const pointsPerVLine = this.gridRows + 1;
    for (let col = 0; col <= this.gridCols; col++) {
      const positions = new Float32Array(pointsPerVLine * 3);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

      // Vertical lines use a dimmer color
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
        color: new THREE.Color().copy(this.palette.dim),
        transparent: true,
        opacity: 0,
      }));
      this.vLines.push(line);
      this.group.add(line);
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

  private computeDisplacement(col: number, row: number, time: number): number {
    const cx = col / this.gridCols;
    const cy = row / this.gridRows;
    const midX = 0.5;
    const midY = 0.5;

    switch (this.waveMode) {
      case 0: { // calm — single traveling wave along X
        return Math.sin(cx * this.waveFreq * Math.PI * 2 - time * this.waveSpeed)
          * Math.sin(cy * Math.PI); // envelope: zero at edges
      }
      case 1: { // choppy — two waves at different angles
        const w1 = Math.sin(cx * this.waveFreq * Math.PI * 2 - time * this.waveSpeed);
        const w2 = Math.sin(cy * this.freq2 * Math.PI * 2 + time * this.speed2 * 0.7);
        return (w1 * 0.6 + w2 * 0.4) * Math.sin(cy * Math.PI);
      }
      case 2: { // standing wave — superposition of left+right traveling waves
        const traveling = Math.sin(cx * this.waveFreq * Math.PI * 2 - time * this.waveSpeed);
        const reflected = Math.sin(cx * this.waveFreq * Math.PI * 2 + time * this.waveSpeed);
        return (traveling + reflected) * 0.5 * Math.sin(cy * Math.PI * 2);
      }
      default: { // interference — two point sources
        const d1 = Math.sqrt((cx - 0.3) ** 2 + (cy - midY) ** 2);
        const d2 = Math.sqrt((cx - 0.7) ** 2 + (cy - midY) ** 2);
        const w1 = Math.sin(d1 * this.waveFreq * Math.PI * 4 - time * this.waveSpeed);
        const w2 = Math.sin(d2 * this.freq2 * Math.PI * 4 - time * this.speed2);
        return (w1 + w2) * 0.5;
      }
    }
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);

    // Animate horizontal lines
    for (let row = 0; row <= this.gridRows; row++) {
      const line = this.hLines[row];
      const positions = line.geometry.getAttribute('position') as THREE.BufferAttribute;
      const depth = row / this.gridRows;

      for (let col = 0; col <= this.gridCols; col++) {
        const ptIdx = row * (this.gridCols + 1) + col;
        const bx = this.baseX[ptIdx];
        const by = this.baseY[ptIdx];
        const disp = this.computeDisplacement(col, row, time) * this.waveAmp * this.intensityBoost;
        positions.setXYZ(col, bx, by + disp, depth);
      }
      positions.needsUpdate = true;

      // Opacity based on depth
      (line.material as THREE.LineBasicMaterial).opacity = opacity * (0.15 + depth * 0.7);
    }

    // Animate vertical lines
    for (let col = 0; col <= this.gridCols; col++) {
      const line = this.vLines[col];
      const positions = line.geometry.getAttribute('position') as THREE.BufferAttribute;

      for (let row = 0; row <= this.gridRows; row++) {
        const ptIdx = row * (this.gridCols + 1) + col;
        const bx = this.baseX[ptIdx];
        const by = this.baseY[ptIdx];
        const depth = row / this.gridRows;
        const disp = this.computeDisplacement(col, row, time) * this.waveAmp * this.intensityBoost;
        positions.setXYZ(row, bx, by + disp, depth);
      }
      positions.needsUpdate = true;

      // Edge columns are dimmer
      const edgeFade = 1 - Math.abs((col / this.gridCols) - 0.5) * 0.8;
      (line.material as THREE.LineBasicMaterial).opacity = opacity * 0.15 * edgeFade;
    }

    // Decay intensity boost
    if (this.intensityBoost > 1.0) {
      this.intensityBoost += (1.0 - this.intensityBoost) * dt * 2.0;
    }

    (this.borderLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.2;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      this.waveMode = (this.waveMode + 1) % 4;
      this.waveFreq = this.rng.float(2.0, 6.0);
      this.waveSpeed = this.rng.float(1.5, 4.0);
    }
    if (action === 'pulse') {
      this.intensityBoost = 2.5;
    }
    if (action === 'alert') {
      // Switch to interference mode and boost amplitude
      this.waveMode = 3;
      this.intensityBoost = 3.0;
      // Tint front lines alert
      for (let row = 0; row <= this.gridRows; row++) {
        const depth = row / this.gridRows;
        if (depth > 0.6) {
          (this.hLines[row].material as THREE.LineBasicMaterial).color.copy(this.palette.alert);
        }
      }
      setTimeout(() => {
        for (let row = 0; row <= this.gridRows; row++) {
          const depth = row / this.gridRows;
          const color = new THREE.Color().copy(this.palette.dim).lerp(this.palette.primary, depth * depth);
          (this.hLines[row].material as THREE.LineBasicMaterial).color.copy(color);
        }
      }, 3000);
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) {
      this.intensityBoost = 1.0;
      return;
    }
    this.intensityBoost = Math.min(2.0, 1.0 + level * 0.4);
    if (level >= 4) {
      this.waveSpeed *= 1.5;
    }
  }
}
