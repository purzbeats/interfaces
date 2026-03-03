import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';
import type { AudioFrame } from '../audio/audio-reactive';

/**
 * Seismograph-style scrolling earthquake trace.
 * Calm baseline with small noise; periodic major quake spikes.
 * Variants: single trace, dual trace, with grid backdrop, with magnitude markers.
 */
export class QuakeLineElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'quake-line',
    meta: { shape: 'rectangular', roles: ['data-display', 'gauge'], moods: ['diagnostic', 'tactical'], bandAffinity: 'bass', audioSensitivity: 0.6, sizes: ['works-small', 'needs-medium'] },
  };

  private traces!: THREE.Line[];
  private gridLines!: THREE.LineSegments | null;
  private magnitudeMarkers!: THREE.LineSegments | null;
  private penDots!: THREE.Points;

  private variant: number = 0;
  private numPoints: number = 0;
  private traceCount: number = 1;
  private noiseScale: number = 0;
  private quakeTimer: number = 0;
  private quakeInterval: number = 0;
  private quakeDuration: number = 0;
  private quakePhase: number = 0;
  private quakeMagnitude: number = 0;
  private alertMode: boolean = false;
  private liveWaveform: Float32Array | null = null;
  private traceOffsets: number[] = []; // y center offsets for each trace
  private traceNoiseScales: number[] = [];

  build(): void {
    this.variant = this.rng.int(0, 3);
    this.glitchAmount = 5;
    const { x, y, w, h } = this.px;

    const presets = [
      // 0: single trace, standard
      { traceCount: 1, pointsDivisor: 1.5, noiseMin: 0.06, noiseMax: 0.12, grid: false, markers: false },
      // 1: dual trace
      { traceCount: 2, pointsDivisor: 2, noiseMin: 0.05, noiseMax: 0.10, grid: false, markers: false },
      // 2: single trace with grid backdrop
      { traceCount: 1, pointsDivisor: 1.5, noiseMin: 0.06, noiseMax: 0.14, grid: true, markers: false },
      // 3: single trace with magnitude markers
      { traceCount: 1, pointsDivisor: 1.5, noiseMin: 0.06, noiseMax: 0.12, grid: false, markers: true },
    ];
    const p = presets[this.variant];
    this.traceCount = p.traceCount;
    this.numPoints = Math.max(48, Math.floor(w / p.pointsDivisor));
    this.noiseScale = this.rng.float(p.noiseMin, p.noiseMax);
    this.quakeInterval = this.rng.float(4.0, 9.0);
    this.quakeDuration = this.rng.float(1.2, 2.5);
    this.quakeMagnitude = this.rng.float(0.5, 0.9);

    // Trace colors and vertical positions
    const traceColors = [this.palette.secondary, this.palette.primary];
    const traceY = this.traceCount === 1
      ? [y + h * 0.5]
      : [y + h * 0.32, y + h * 0.68];

    this.traces = [];
    this.traceOffsets = [];
    this.traceNoiseScales = [];

    for (let ti = 0; ti < this.traceCount; ti++) {
      const cy = traceY[ti];
      this.traceOffsets.push(cy);
      this.traceNoiseScales.push(this.rng.float(p.noiseMin, p.noiseMax));

      const positions = new Float32Array(this.numPoints * 3);
      for (let i = 0; i < this.numPoints; i++) {
        positions[i * 3] = x + (i / (this.numPoints - 1)) * w;
        positions[i * 3 + 1] = cy;
        positions[i * 3 + 2] = 1;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const trace = new THREE.Line(geo, new THREE.LineBasicMaterial({
        color: traceColors[ti % 2],
        transparent: true,
        opacity: 0,
      }));
      this.group.add(trace);
      this.traces.push(trace);
    }

    // Pen dots (the "writing head" at the right edge)
    const penPos = new Float32Array(this.traceCount * 3);
    for (let ti = 0; ti < this.traceCount; ti++) {
      penPos[ti * 3] = x + w;
      penPos[ti * 3 + 1] = traceY[ti];
      penPos[ti * 3 + 2] = 2;
    }
    const penGeo = new THREE.BufferGeometry();
    penGeo.setAttribute('position', new THREE.BufferAttribute(penPos, 3));
    this.penDots = new THREE.Points(penGeo, new THREE.PointsMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
      size: 4,
      sizeAttenuation: false,
    }));
    this.group.add(this.penDots);

    // Grid backdrop (variant 2)
    this.gridLines = null;
    if (p.grid) {
      const gridVerts: number[] = [];
      const gridCols = 8;
      const gridRows = 4;

      // Vertical grid lines
      for (let gc = 0; gc <= gridCols; gc++) {
        const gx = x + (gc / gridCols) * w;
        gridVerts.push(gx, y, 0, gx, y + h, 0);
      }
      // Horizontal grid lines
      for (let gr = 0; gr <= gridRows; gr++) {
        const gy = y + (gr / gridRows) * h;
        gridVerts.push(x, gy, 0, x + w, gy, 0);
      }

      const gridGeo = new THREE.BufferGeometry();
      gridGeo.setAttribute('position', new THREE.Float32BufferAttribute(gridVerts, 3));
      this.gridLines = new THREE.LineSegments(gridGeo, new THREE.LineBasicMaterial({
        color: this.palette.dim,
        transparent: true,
        opacity: 0,
      }));
      this.group.add(this.gridLines);
    }

    // Magnitude markers (variant 3) - horizontal threshold lines with tick marks
    this.magnitudeMarkers = null;
    if (p.markers) {
      const cy = y + h * 0.5;
      const levels = [0.3, 0.6, 0.85]; // fraction of half-height
      const markerVerts: number[] = [];

      for (const lvl of levels) {
        const dy = (h * 0.48) * lvl;
        // Upper threshold line (dashed via short segments)
        const segCount = 20;
        for (let s = 0; s < segCount; s += 2) {
          const sx = x + (s / segCount) * w;
          const ex = x + ((s + 1) / segCount) * w;
          markerVerts.push(sx, cy - dy, 0, ex, cy - dy, 0);
          markerVerts.push(sx, cy + dy, 0, ex, cy + dy, 0);
        }
        // Left tick label marks
        markerVerts.push(x, cy - dy, 0, x + w * 0.04, cy - dy, 0);
        markerVerts.push(x, cy + dy, 0, x + w * 0.04, cy + dy, 0);
      }

      const markGeo = new THREE.BufferGeometry();
      markGeo.setAttribute('position', new THREE.Float32BufferAttribute(markerVerts, 3));
      this.magnitudeMarkers = new THREE.LineSegments(markGeo, new THREE.LineBasicMaterial({
        color: this.palette.dim,
        transparent: true,
        opacity: 0,
      }));
      this.group.add(this.magnitudeMarkers);
    }
  }

  tickAudio(frame: AudioFrame): void {
    this.liveWaveform = frame.waveform;
  }

  private getQuakeValue(time: number, traceIdx: number): number {
    const baseNoise = Math.sin(time * 2.1 + traceIdx * 1.7) * 0.25
      + Math.sin(time * 5.3 + traceIdx * 2.3) * 0.15
      + Math.sin(time * 11.7 + traceIdx) * 0.07;

    let quakeContrib = 0;
    if (this.quakePhase > 0) {
      // Quake: decaying oscillation
      const envelope = Math.exp(-this.quakePhase * 2.5) * this.quakeMagnitude;
      const freq = 8 + traceIdx * 3;
      quakeContrib = Math.sin(this.quakePhase * freq + traceIdx * Math.PI * 0.5) * envelope;
      quakeContrib += Math.sin(this.quakePhase * (freq * 1.6) + 1.2) * envelope * 0.5;
    }

    return baseNoise * this.traceNoiseScales[traceIdx] / this.noiseScale + quakeContrib;
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    const { x, y, w, h } = this.px;

    // Advance quake timers
    this.quakeTimer += dt;
    if (this.quakeTimer >= this.quakeInterval) {
      this.quakeTimer = 0;
      this.quakeInterval = this.rng.float(4.0, 9.0);
      this.quakeMagnitude = this.rng.float(0.5, 0.9) * (this.alertMode ? 1.5 : 1.0);
      this.quakeDuration = this.rng.float(1.2, 2.5);
      this.quakePhase = this.quakeDuration;
      this.emitAudio('impact', this.quakeMagnitude);
    }

    if (this.quakePhase > 0) {
      this.quakePhase -= dt;
    }

    for (let ti = 0; ti < this.traceCount; ti++) {
      const cy = this.traceOffsets[ti];
      const amp = h * (this.traceCount === 1 ? 0.42 : 0.22) * this.traceNoiseScales[ti] / this.noiseScale;

      const positions = this.traces[ti].geometry.getAttribute('position') as THREE.BufferAttribute;

      // Scroll left: shift all Y values one slot
      for (let i = 0; i < this.numPoints - 1; i++) {
        positions.setY(i, positions.getY(i + 1));
      }

      let value: number;
      if (this.liveWaveform && ti === 0) {
        // Primary trace uses live audio
        let sum = 0;
        for (let i = 0; i < this.liveWaveform.length; i++) {
          sum += Math.abs(this.liveWaveform[i]);
        }
        value = (sum / this.liveWaveform.length) * 3 * Math.sign(this.liveWaveform[0] ?? 1);
        // Add quake contribution
        if (this.quakePhase > 0) {
          const envelope = Math.exp(-this.quakePhase * 2.5) * this.quakeMagnitude;
          value += Math.sin(this.quakePhase * 8) * envelope;
        }
      } else {
        value = this.getQuakeValue(time, ti);
      }

      // Extra jitter during glitch
      if (this.glitchTimer > 0) {
        value += Math.sin(time * 73 + ti * 2.1) * 0.6 * (this.glitchTimer / 0.5);
      }

      positions.setY(this.numPoints - 1, cy + value * amp);

      // Update x positions (in case of resize)
      for (let i = 0; i < this.numPoints; i++) {
        positions.setX(i, x + (i / (this.numPoints - 1)) * w);
      }
      positions.needsUpdate = true;

      // Color: alert during big quake
      const isActive = this.quakePhase > 0 && this.quakeMagnitude > 0.7;
      const traceColor = (this.alertMode || isActive)
        ? this.palette.alert
        : (ti === 0 ? this.palette.secondary : this.palette.primary);
      (this.traces[ti].material as THREE.LineBasicMaterial).color.copy(traceColor);
      (this.traces[ti].material as THREE.LineBasicMaterial).opacity = opacity;

      // Update pen dot
      const penPos = this.penDots.geometry.getAttribute('position') as THREE.BufferAttribute;
      penPos.setXYZ(ti, x + w, cy + value * amp, 2);
      penPos.needsUpdate = true;
    }

    // Pen dot flicker
    const penFlicker = 0.8 + Math.sin(time * 23) * 0.2;
    (this.penDots.material as THREE.PointsMaterial).opacity = opacity * penFlicker;
    (this.penDots.material as THREE.PointsMaterial).color.copy(
      this.quakePhase > 0 ? this.palette.alert : this.palette.primary
    );

    if (this.gridLines) {
      (this.gridLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.15;
    }

    if (this.magnitudeMarkers) {
      // Flash markers when quake is active
      const markerFlash = this.quakePhase > 0
        ? 0.3 + 0.4 * Math.sin(time * 12)
        : 0.25;
      const markerColor = this.quakePhase > 0 && this.quakeMagnitude > 0.6
        ? this.palette.alert
        : this.palette.dim;
      (this.magnitudeMarkers.material as THREE.LineBasicMaterial).color.copy(markerColor);
      (this.magnitudeMarkers.material as THREE.LineBasicMaterial).opacity = opacity * markerFlash;
    }
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Trigger an immediate large quake
      this.quakePhase = this.quakeDuration;
      this.quakeMagnitude = 1.0;
    }
    if (action === 'alert') {
      this.alertMode = true;
      // Force quake
      this.quakePhase = this.quakeDuration * 1.5;
      this.quakeMagnitude = 1.2;
      this.pulseTimer = 2.0;
      setTimeout(() => { this.alertMode = false; }, 4000);
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) {
      this.alertMode = false;
      return;
    }
    // Higher intensity = bigger baseline noise
    this.traceNoiseScales = this.traceNoiseScales.map(() =>
      this.noiseScale * (1 + level * 0.3)
    );
    if (level >= 4) {
      this.alertMode = true;
      // Trigger a quake on high intensity
      if (this.quakePhase <= 0) {
        this.quakePhase = this.quakeDuration;
        this.quakeMagnitude = 0.5 + level * 0.15;
      }
    }
    if (level >= 5) {
      this.quakeMagnitude = 1.3;
      this.quakePhase = this.quakeDuration * 1.5;
    }
  }
}
