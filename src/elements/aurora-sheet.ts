import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Aurora borealis curtain. Vertical rays of light forming a wavy curtain.
 * Colors shift green/blue/purple. Animated undulation.
 */
export class AuroraSheetElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'aurora-sheet',
    meta: {
      shape: 'rectangular',
      roles: ['decorative'],
      moods: ['ambient'],
      bandAffinity: 'sub',
      sizes: ['needs-medium', 'needs-large'],
    },
  };

  private curtainLines: THREE.Line[] = [];
  private layerCount: number = 0;
  private pointsPerLayer: number = 0;
  private waveSpeed: number = 0;
  private waveAmp: number = 0;
  private verticalSpread: number = 0;
  private layerOffsets: number[] = [];
  private layerSpeeds: number[] = [];
  private colorPhaseSpeed: number = 0;

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;

    const variant = this.rng.int(0, 3);
    const presets = [
      { layers: 5, points: 40, speed: 0.4, amp: 0.15, vSpread: 0.3, colorSpd: 0.2 },
      { layers: 8, points: 60, speed: 0.6, amp: 0.2, vSpread: 0.4, colorSpd: 0.3 },
      { layers: 3, points: 30, speed: 0.25, amp: 0.1, vSpread: 0.2, colorSpd: 0.15 },
      { layers: 6, points: 50, speed: 0.8, amp: 0.25, vSpread: 0.35, colorSpd: 0.4 },
    ];
    const p = presets[variant];
    this.layerCount = p.layers;
    this.pointsPerLayer = p.points;
    this.waveSpeed = p.speed;
    this.waveAmp = p.amp;
    this.verticalSpread = p.vSpread;
    this.colorPhaseSpeed = p.colorSpd;

    // Aurora colors (green, blue, purple)
    const auroraColors = [
      new THREE.Color(0.1, 0.8, 0.3),
      new THREE.Color(0.1, 0.5, 0.9),
      new THREE.Color(0.5, 0.2, 0.8),
      new THREE.Color(0.2, 0.9, 0.5),
      new THREE.Color(0.3, 0.3, 0.9),
    ];

    this.layerOffsets = [];
    this.layerSpeeds = [];

    for (let l = 0; l < this.layerCount; l++) {
      this.layerOffsets.push(this.rng.float(0, Math.PI * 2));
      this.layerSpeeds.push(this.rng.float(0.8, 1.2));

      const positions = new Float32Array(this.pointsPerLayer * 3);
      const colors = new Float32Array(this.pointsPerLayer * 3);

      // Initialize positions along a horizontal band
      const baseY = y + h * (0.2 + l * this.verticalSpread / this.layerCount);
      for (let i = 0; i < this.pointsPerLayer; i++) {
        const frac = i / (this.pointsPerLayer - 1);
        positions[i * 3] = x + frac * w;
        positions[i * 3 + 1] = baseY;
        positions[i * 3 + 2] = 0;
        // Initial color
        const col = auroraColors[l % auroraColors.length];
        colors[i * 3] = col.r;
        colors[i * 3 + 1] = col.g;
        colors[i * 3 + 2] = col.b;
      }

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0,
      }));
      this.group.add(line);
      this.curtainLines.push(line);
    }
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    const { x, y, w, h } = this.px;

    for (let l = 0; l < this.layerCount; l++) {
      const line = this.curtainLines[l];
      const posAttr = line.geometry.getAttribute('position') as THREE.BufferAttribute;
      const colAttr = line.geometry.getAttribute('color') as THREE.BufferAttribute;

      const baseY = y + h * (0.2 + l * this.verticalSpread / this.layerCount);
      const phaseOffset = this.layerOffsets[l];
      const speed = this.layerSpeeds[l];

      for (let i = 0; i < this.pointsPerLayer; i++) {
        const frac = i / (this.pointsPerLayer - 1);
        const px = x + frac * w;

        // Multiple wave components for organic curtain movement
        const wave1 = Math.sin(frac * Math.PI * 3 + time * this.waveSpeed * speed + phaseOffset);
        const wave2 = Math.sin(frac * Math.PI * 7 + time * this.waveSpeed * 0.7 + phaseOffset * 2) * 0.3;
        const wave3 = Math.sin(frac * Math.PI * 1.5 + time * this.waveSpeed * 0.3) * 0.5;
        const totalWave = (wave1 + wave2 + wave3) * this.waveAmp * h;

        // Vertical rays: add high-frequency vertical displacement
        const ray = Math.sin(frac * Math.PI * 20 + time * 2 + l) * h * 0.02;

        posAttr.setXYZ(i, px, baseY + totalWave + ray, 0);

        // Color shifting: cycle through green -> blue -> purple
        const colorPhase = time * this.colorPhaseSpeed + frac * 2 + l * 0.5;
        const r = 0.1 + Math.sin(colorPhase + Math.PI * 1.3) * 0.2;
        const g = 0.4 + Math.sin(colorPhase) * 0.4;
        const b = 0.5 + Math.sin(colorPhase + Math.PI * 0.7) * 0.3;
        colAttr.setXYZ(i,
          Math.max(0, Math.min(1, r)),
          Math.max(0, Math.min(1, g)),
          Math.max(0, Math.min(1, b)),
        );
      }

      posAttr.needsUpdate = true;
      colAttr.needsUpdate = true;

      // Layers further back are more transparent
      const layerAlpha = 1 - l * 0.1;
      (line.material as THREE.LineBasicMaterial).opacity = opacity * layerAlpha * 0.7;
    }
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Sudden phase shift
      for (let l = 0; l < this.layerOffsets.length; l++) {
        this.layerOffsets[l] += this.rng.float(-3, 3);
      }
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level >= 2) {
      this.waveAmp = 0.15 + level * 0.04;
      this.waveSpeed = 0.4 + level * 0.15;
    }
  }
}
