import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

interface SineWave {
  frequency: number;
  amplitude: number;
  phase: number;
}

interface Channel {
  /** Normalized x position along the membrane (0..1) */
  t: number;
  /** Horizontal drift speed (variant 4 only) */
  driftSpeed: number;
}

interface Ion {
  active: boolean;
  /** Index into channels array */
  channelIdx: number;
  /** 0 = start side, 1 = end side */
  progress: number;
  /** Transit duration in seconds */
  duration: number;
  /** Elapsed time */
  elapsed: number;
  /** true = upper→lower, false = lower→upper */
  downward: boolean;
}

/**
 * Pulsing lipid bilayer membrane with protein channels and ion transport.
 * Two wavy parallel lines (leaflets) connected by channel pore segments,
 * with ions transiting through the channels.
 */
export class PulseMembraneElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'pulse-membrane',
    meta: {
      shape: 'linear',
      roles: ['data-display', 'decorative'],
      moods: ['ambient', 'diagnostic'],
      sizes: ['works-small', 'needs-medium'],
      bandAffinity: 'mid',
    } satisfies ElementMeta,
  };

  private upperLeaflet!: THREE.Line;
  private lowerLeaflet!: THREE.Line;
  private channelPores!: THREE.LineSegments;
  private channelMarkers!: THREE.Points;
  private ionPoints!: THREE.Points;

  private vertexCount: number = 0;
  private sineWaves: SineWave[] = [];
  private channels: Channel[] = [];
  private ions: Ion[] = [];
  private ionPoolSize: number = 30;

  private breatheSpeed: number = 0;
  private ionInterval: number = 0;
  private ionTransitTime: number = 0;
  private ionTimer: number = 0;
  private gapMultiplier: number = 1;
  private channelDrift: boolean = false;

  private intensityLevel: number = 0;
  private ruptured: boolean = false;
  private amplitudeScale: number = 1;

  build(): void {
    const variant = this.rng.int(0, 3);
    const presets = [
      { sines: 3, channels: 6, ionSpeed: 0.7, ionInterval: 0.5, breathe: 0.8, ampBase: 0.03, drift: false },   // Standard
      { sines: 4, channels: 10, ionSpeed: 0.3, ionInterval: 0.2, breathe: 1.2, ampBase: 0.035, drift: false },  // Active-transport
      { sines: 2, channels: 5, ionSpeed: 1.0, ionInterval: 0.8, breathe: 0.4, ampBase: 0.015, drift: false },   // Rigid
      { sines: 5, channels: 8, ionSpeed: 0.6, ionInterval: 0.35, breathe: 1.0, ampBase: 0.04, drift: true },    // Chaotic
    ];
    const p = presets[variant];

    this.glitchAmount = 4;
    const { w, h } = this.px;

    this.breatheSpeed = p.breathe;
    this.ionTransitTime = p.ionSpeed;
    this.ionInterval = p.ionInterval;
    this.channelDrift = p.drift;

    // Generate sine waves for membrane deformation
    this.sineWaves = [];
    for (let i = 0; i < p.sines; i++) {
      this.sineWaves.push({
        frequency: this.rng.float(1.5, 6.0),
        amplitude: p.ampBase * h * this.rng.float(0.5, 1.5),
        phase: this.rng.float(0, Math.PI * 2),
      });
    }

    // Vertex count for leaflets
    this.vertexCount = Math.max(60, Math.min(100, Math.floor(w * 0.15)));

    // Generate channels
    this.channels = [];
    for (let i = 0; i < p.channels; i++) {
      this.channels.push({
        t: (i + 0.5) / p.channels,
        driftSpeed: this.channelDrift ? this.rng.float(-0.03, 0.03) : 0,
      });
    }

    // --- Upper leaflet ---
    const upperPos = new Float32Array(this.vertexCount * 3);
    const upperGeo = new THREE.BufferGeometry();
    upperGeo.setAttribute('position', new THREE.BufferAttribute(upperPos, 3));
    this.upperLeaflet = new THREE.Line(upperGeo, new THREE.LineBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
      linewidth: 1,
    }));
    this.group.add(this.upperLeaflet);

    // --- Lower leaflet ---
    const lowerPos = new Float32Array(this.vertexCount * 3);
    const lowerGeo = new THREE.BufferGeometry();
    lowerGeo.setAttribute('position', new THREE.BufferAttribute(lowerPos, 3));
    this.lowerLeaflet = new THREE.Line(lowerGeo, new THREE.LineBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
      linewidth: 1,
    }));
    this.group.add(this.lowerLeaflet);

    // --- Channel pore outlines (LineSegments: pairs of vertices connecting leaflets) ---
    const porePos = new Float32Array(p.channels * 2 * 3);
    const poreGeo = new THREE.BufferGeometry();
    poreGeo.setAttribute('position', new THREE.BufferAttribute(porePos, 3));
    this.channelPores = new THREE.LineSegments(poreGeo, new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
      linewidth: 1,
    }));
    this.group.add(this.channelPores);

    // --- Channel marker points (dot on upper + dot on lower per channel) ---
    const markerPos = new Float32Array(p.channels * 2 * 3);
    const markerGeo = new THREE.BufferGeometry();
    markerGeo.setAttribute('position', new THREE.BufferAttribute(markerPos, 3));
    this.channelMarkers = new THREE.Points(markerGeo, new THREE.PointsMaterial({
      color: this.palette.secondary,
      transparent: true,
      opacity: 0,
      size: Math.max(3, Math.min(w, h) * 0.008),
      sizeAttenuation: false,
    }));
    this.group.add(this.channelMarkers);

    // --- Ion particles (pre-allocated pool) ---
    this.ions = [];
    for (let i = 0; i < this.ionPoolSize; i++) {
      this.ions.push({
        active: false,
        channelIdx: 0,
        progress: 0,
        duration: this.ionTransitTime,
        elapsed: 0,
        downward: true,
      });
    }
    const ionPos = new Float32Array(this.ionPoolSize * 3);
    const ionColors = new Float32Array(this.ionPoolSize * 3);
    const ionGeo = new THREE.BufferGeometry();
    ionGeo.setAttribute('position', new THREE.BufferAttribute(ionPos, 3));
    ionGeo.setAttribute('color', new THREE.BufferAttribute(ionColors, 3));
    this.ionPoints = new THREE.Points(ionGeo, new THREE.PointsMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0,
      size: Math.max(2, Math.min(w, h) * 0.005),
      sizeAttenuation: false,
    }));
    this.group.add(this.ionPoints);

    this.ionTimer = 0;
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    const { x, y, w, h } = this.px;

    const breathe = 0.7 + 0.3 * Math.sin(time * this.breatheSpeed);
    const upperBaseY = y + h * 0.45;
    const lowerBaseY = y + h * 0.55 + (this.gapMultiplier - 1) * h * 0.1;

    // Decay rupture gap back toward normal
    if (!this.ruptured && this.gapMultiplier > 1) {
      this.gapMultiplier = Math.max(1, this.gapMultiplier - dt * 0.5);
    }

    // --- Update leaflet vertices ---
    const upperAttr = this.upperLeaflet.geometry.getAttribute('position') as THREE.BufferAttribute;
    const lowerAttr = this.lowerLeaflet.geometry.getAttribute('position') as THREE.BufferAttribute;

    for (let i = 0; i < this.vertexCount; i++) {
      const t = i / (this.vertexCount - 1);
      const px = x + w * t;

      // Sum of sine waves for deformation
      let deform = 0;
      for (const wave of this.sineWaves) {
        deform += wave.amplitude * this.amplitudeScale * breathe *
          Math.sin(t * Math.PI * 2 * wave.frequency + wave.phase + time * 1.5);
      }

      upperAttr.setXYZ(i, px, upperBaseY + deform, 1);
      lowerAttr.setXYZ(i, px, lowerBaseY + deform, 1);
    }
    upperAttr.needsUpdate = true;
    lowerAttr.needsUpdate = true;

    // --- Update channel pores and markers ---
    const poreAttr = this.channelPores.geometry.getAttribute('position') as THREE.BufferAttribute;
    const markerAttr = this.channelMarkers.geometry.getAttribute('position') as THREE.BufferAttribute;

    for (let c = 0; c < this.channels.length; c++) {
      const ch = this.channels[c];

      // Drift channels horizontally (chaotic variant)
      if (this.channelDrift) {
        ch.t += ch.driftSpeed * dt;
        if (ch.t < 0.05) { ch.t = 0.05; ch.driftSpeed = Math.abs(ch.driftSpeed); }
        if (ch.t > 0.95) { ch.t = 0.95; ch.driftSpeed = -Math.abs(ch.driftSpeed); }
      }

      const chX = x + w * ch.t;

      // Compute deformation at channel position
      let deform = 0;
      for (const wave of this.sineWaves) {
        deform += wave.amplitude * this.amplitudeScale * breathe *
          Math.sin(ch.t * Math.PI * 2 * wave.frequency + wave.phase + time * 1.5);
      }

      const chUpperY = upperBaseY + deform;
      const chLowerY = lowerBaseY + deform;

      // Pore line: upper to lower
      poreAttr.setXYZ(c * 2, chX, chUpperY, 1);
      poreAttr.setXYZ(c * 2 + 1, chX, chLowerY, 1);

      // Marker dots: one on upper, one on lower
      markerAttr.setXYZ(c * 2, chX, chUpperY, 1.5);
      markerAttr.setXYZ(c * 2 + 1, chX, chLowerY, 1.5);
    }
    poreAttr.needsUpdate = true;
    markerAttr.needsUpdate = true;

    // --- Ion transport ---
    this.ionTimer += dt;
    const effectiveInterval = this.ionInterval / (1 + this.intensityLevel * 0.3);

    if (this.ruptured) {
      // Flood mode: spawn many ions randomly positioned between leaflets
      this.floodIons(time);
    } else {
      // Normal mode: spawn ions at intervals through channels
      if (this.ionTimer >= effectiveInterval) {
        this.ionTimer -= effectiveInterval;
        this.spawnIon();
      }
    }

    // Update ion positions
    const ionPosAttr = this.ionPoints.geometry.getAttribute('position') as THREE.BufferAttribute;
    const ionColAttr = this.ionPoints.geometry.getAttribute('color') as THREE.BufferAttribute;
    const ionColor = this.intensityLevel >= 4 ? this.palette.alert : this.palette.secondary;

    for (let i = 0; i < this.ionPoolSize; i++) {
      const ion = this.ions[i];
      if (ion.active) {
        ion.elapsed += dt;
        ion.progress = Math.min(1, ion.elapsed / ion.duration);

        if (ion.progress >= 1) {
          ion.active = false;
          ionPosAttr.setXYZ(i, 0, 0, -10);
          ionColAttr.setXYZ(i, 0, 0, 0);
          continue;
        }

        const ch = this.channels[ion.channelIdx];
        const chX = x + w * ch.t;

        // Compute deformation at channel position
        let deform = 0;
        for (const wave of this.sineWaves) {
          deform += wave.amplitude * this.amplitudeScale * breathe *
            Math.sin(ch.t * Math.PI * 2 * wave.frequency + wave.phase + time * 1.5);
        }

        const chUpperY = upperBaseY + deform;
        const chLowerY = lowerBaseY + deform;

        // Interpolate from one leaflet to the other
        let ionY: number;
        if (ion.downward) {
          ionY = chUpperY + (chLowerY - chUpperY) * ion.progress;
        } else {
          ionY = chLowerY + (chUpperY - chLowerY) * ion.progress;
        }

        ionPosAttr.setXYZ(i, chX, ionY, 2);
        ionColAttr.setXYZ(i, ionColor.r, ionColor.g, ionColor.b);
      } else {
        ionPosAttr.setXYZ(i, 0, 0, -10);
        ionColAttr.setXYZ(i, 0, 0, 0);
      }
    }
    ionPosAttr.needsUpdate = true;
    ionColAttr.needsUpdate = true;

    // --- Apply opacities ---
    const leafletColor = this.ruptured ? this.palette.alert : this.palette.primary;
    (this.upperLeaflet.material as THREE.LineBasicMaterial).color.copy(leafletColor);
    (this.lowerLeaflet.material as THREE.LineBasicMaterial).color.copy(leafletColor);

    (this.upperLeaflet.material as THREE.LineBasicMaterial).opacity = opacity * 0.9;
    (this.lowerLeaflet.material as THREE.LineBasicMaterial).opacity = opacity * 0.9;
    (this.channelPores.material as THREE.LineBasicMaterial).opacity = opacity * 0.5;
    (this.channelMarkers.material as THREE.PointsMaterial).opacity = opacity * 0.7;
    (this.ionPoints.material as THREE.PointsMaterial).opacity = opacity * 0.85;
  }

  private spawnIon(): void {
    if (this.channels.length === 0) return;
    for (const ion of this.ions) {
      if (!ion.active) {
        ion.active = true;
        ion.channelIdx = this.rng.int(0, this.channels.length - 1);
        ion.progress = 0;
        ion.elapsed = 0;
        ion.duration = this.ionTransitTime * this.rng.float(0.8, 1.2);
        ion.downward = this.rng.chance(0.5);
        return;
      }
    }
  }

  private floodIons(time: number): void {
    const { x, y, w, h } = this.px;
    const ionPosAttr = this.ionPoints.geometry.getAttribute('position') as THREE.BufferAttribute;
    const ionColAttr = this.ionPoints.geometry.getAttribute('color') as THREE.BufferAttribute;
    const alertColor = this.palette.alert;

    // In flood mode, just scatter all ions randomly between the leaflets
    const upperBaseY = y + h * 0.45;
    const lowerBaseY = y + h * 0.55 + (this.gapMultiplier - 1) * h * 0.1;

    for (let i = 0; i < this.ionPoolSize; i++) {
      const ion = this.ions[i];
      ion.active = true;
      // Jitter positions each frame for a flooding effect
      const ix = x + w * (0.05 + 0.9 * ((i * 7 + Math.sin(time * 3 + i) * 0.1) % 1));
      const iy = upperBaseY + (lowerBaseY - upperBaseY) * ((i / this.ionPoolSize) + Math.sin(time * 5 + i * 0.7) * 0.3);
      ionPosAttr.setXYZ(i, ix, iy, 2);
      ionColAttr.setXYZ(i, alertColor.r, alertColor.g, alertColor.b);
    }
    ionPosAttr.needsUpdate = true;
    ionColAttr.needsUpdate = true;
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    this.intensityLevel = level;

    if (level === 0) {
      this.amplitudeScale = 1;
      this.ruptured = false;
      this.gapMultiplier = 1;
      return;
    }

    // Wave amplitude increases with level
    this.amplitudeScale = 1 + level * 0.2;

    if (level >= 5) {
      // Membrane rupture: leaflets separate, ions flood
      this.ruptured = true;
      this.gapMultiplier = 3;
      // Clear rupture after a few seconds
      setTimeout(() => {
        this.ruptured = false;
      }, 3000);
    } else {
      this.ruptured = false;
      this.gapMultiplier = 1;
    }
  }
}
