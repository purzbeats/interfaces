import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

type MitosisPhase = 'interphase' | 'prophase' | 'metaphase' | 'anaphase' | 'cytokinesis';

interface CellVariant {
  cycleDuration: number;
  membraneVerts: number;
  chromosomeCount: number;
  fiberCount: number;
  asymmetric: boolean;
  wobbleAmount: number;
}

const PHASE_RANGES: { phase: MitosisPhase; start: number; end: number }[] = [
  { phase: 'interphase', start: 0.0, end: 0.4 },
  { phase: 'prophase', start: 0.4, end: 0.55 },
  { phase: 'metaphase', start: 0.55, end: 0.65 },
  { phase: 'anaphase', start: 0.65, end: 0.8 },
  { phase: 'cytokinesis', start: 0.8, end: 1.0 },
];

/**
 * Biotech HUD element: a cell undergoing mitosis.
 * Renders a deformable membrane, spindle fibers, chromosome particles,
 * and centrosome dots cycling through interphase, prophase, metaphase,
 * anaphase, and cytokinesis.
 */
export class CellDivisionElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'cell-division',
    meta: {
      shape: 'radial',
      roles: ['data-display', 'decorative'],
      moods: ['diagnostic', 'ambient'],
      sizes: ['needs-medium', 'needs-large'],
      bandAffinity: 'bass',
    } satisfies ElementMeta,
  };

  private membrane!: THREE.Line;
  private spindleFibers!: THREE.LineSegments;
  private chromosomes!: THREE.Points;
  private centrosomes!: THREE.Points;

  private variant!: CellVariant;
  private cycleTime: number = 0;
  private intensityLevel: number = 0;
  private speedMultiplier: number = 1;

  // Per-vertex wobble phase offsets for the membrane
  private membranePhases!: Float32Array;

  // Per-chromosome random offsets for drift and scatter
  private chromoOffsetX!: Float32Array;
  private chromoOffsetY!: Float32Array;
  private chromoDriftX!: Float32Array;
  private chromoDriftY!: Float32Array;

  // Secondary cycle for intensity level 5 (overlapping division)
  private secondaryCycleTime: number = -1;

  build(): void {
    const variantIdx = this.rng.int(0, 3);
    const presets: CellVariant[] = [
      { cycleDuration: 8, membraneVerts: 60, chromosomeCount: 30, fiberCount: 12, asymmetric: false, wobbleAmount: 3 },
      { cycleDuration: 4, membraneVerts: 40, chromosomeCount: 20, fiberCount: 8, asymmetric: false, wobbleAmount: 2 },
      { cycleDuration: 14, membraneVerts: 80, chromosomeCount: 40, fiberCount: 16, asymmetric: false, wobbleAmount: 4 },
      { cycleDuration: 8, membraneVerts: 60, chromosomeCount: 30, fiberCount: 12, asymmetric: true, wobbleAmount: 4 },
    ];
    this.variant = presets[variantIdx];

    this.glitchAmount = 4;
    const { w, h } = this.px;

    // --- Membrane (closed polyline) ---
    // +1 vertex to close the loop
    const memVerts = this.variant.membraneVerts + 1;
    const memPos = new Float32Array(memVerts * 3);
    const memGeo = new THREE.BufferGeometry();
    memGeo.setAttribute('position', new THREE.BufferAttribute(memPos, 3));
    this.membrane = new THREE.Line(memGeo, new THREE.LineBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
      linewidth: 1,
    }));
    this.group.add(this.membrane);

    // Pre-generate wobble phase offsets per vertex
    this.membranePhases = new Float32Array(this.variant.membraneVerts);
    for (let i = 0; i < this.variant.membraneVerts; i++) {
      this.membranePhases[i] = this.rng.float(0, Math.PI * 2);
    }

    // --- Spindle fibers (LineSegments: pairs of vertices from each pole to equator) ---
    const totalFibers = this.variant.fiberCount * 2; // fibers from each pole
    const fiberPos = new Float32Array(totalFibers * 2 * 3);
    const fiberGeo = new THREE.BufferGeometry();
    fiberGeo.setAttribute('position', new THREE.BufferAttribute(fiberPos, 3));
    this.spindleFibers = new THREE.LineSegments(fiberGeo, new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
      linewidth: 1,
    }));
    this.group.add(this.spindleFibers);

    // --- Chromosomes/chromatin dots (Points with vertex colors) ---
    const chromoCount = this.variant.chromosomeCount;
    const chromoPos = new Float32Array(chromoCount * 3);
    const chromoColors = new Float32Array(chromoCount * 3);
    const chromoGeo = new THREE.BufferGeometry();
    chromoGeo.setAttribute('position', new THREE.BufferAttribute(chromoPos, 3));
    chromoGeo.setAttribute('color', new THREE.BufferAttribute(chromoColors, 3));
    this.chromosomes = new THREE.Points(chromoGeo, new THREE.PointsMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0,
      size: Math.max(2, Math.min(w, h) * 0.012),
      sizeAttenuation: false,
    }));
    this.group.add(this.chromosomes);

    // Per-chromosome random offsets for organic scatter and drift
    this.chromoOffsetX = new Float32Array(chromoCount);
    this.chromoOffsetY = new Float32Array(chromoCount);
    this.chromoDriftX = new Float32Array(chromoCount);
    this.chromoDriftY = new Float32Array(chromoCount);
    for (let i = 0; i < chromoCount; i++) {
      this.chromoOffsetX[i] = this.rng.float(-1, 1);
      this.chromoOffsetY[i] = this.rng.float(-1, 1);
      this.chromoDriftX[i] = this.rng.float(-0.5, 0.5);
      this.chromoDriftY[i] = this.rng.float(-0.5, 0.5);
    }

    // --- Centrosome dots (2 bright dots at the poles) ---
    const centroPos = new Float32Array(2 * 3);
    const centroGeo = new THREE.BufferGeometry();
    centroGeo.setAttribute('position', new THREE.BufferAttribute(centroPos, 3));
    this.centrosomes = new THREE.Points(centroGeo, new THREE.PointsMaterial({
      color: this.palette.secondary,
      transparent: true,
      opacity: 0,
      size: Math.max(4, Math.min(w, h) * 0.018),
      sizeAttenuation: false,
    }));
    this.group.add(this.centrosomes);
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    const { x, y, w, h } = this.px;

    const cx = x + w * 0.5;
    const cy = y + h * 0.5;
    const rx = w * 0.35;
    const ry = h * 0.35;

    // Advance cycle
    this.cycleTime += dt * this.speedMultiplier;
    const cycleDur = this.variant.cycleDuration;
    if (this.cycleTime >= cycleDur) {
      this.cycleTime -= cycleDur;
    }

    // Advance secondary cycle if active (intensity 5)
    if (this.secondaryCycleTime >= 0) {
      this.secondaryCycleTime += dt * this.speedMultiplier;
      if (this.secondaryCycleTime >= cycleDur) {
        this.secondaryCycleTime = -1; // secondary cycle ends
      }
    }

    const ratio = this.cycleTime / cycleDur;
    const { phase, phaseProgress } = this.getPhase(ratio);

    // Membrane growth during interphase
    const growFactor = phase === 'interphase' ? 1.0 + phaseProgress * 0.08 : 1.08;

    this.updateMembrane(time, cx, cy, rx * growFactor, ry * growFactor, phase, phaseProgress, opacity);
    this.updateSpindleFibers(cx, cy, rx * growFactor, ry * growFactor, phase, phaseProgress, opacity);
    this.updateChromosomes(time, cx, cy, rx * growFactor, ry * growFactor, phase, phaseProgress, opacity);
    this.updateCentrosomes(cx, cy, rx * growFactor, phase, opacity);
  }

  private getPhase(ratio: number): { phase: MitosisPhase; phaseProgress: number } {
    for (const pr of PHASE_RANGES) {
      if (ratio >= pr.start && ratio < pr.end) {
        return {
          phase: pr.phase,
          phaseProgress: (ratio - pr.start) / (pr.end - pr.start),
        };
      }
    }
    return { phase: 'interphase', phaseProgress: 0 };
  }

  private updateMembrane(
    time: number, cx: number, cy: number,
    rx: number, ry: number,
    phase: MitosisPhase, phaseProgress: number,
    opacity: number,
  ): void {
    const attr = this.membrane.geometry.getAttribute('position') as THREE.BufferAttribute;
    const n = this.variant.membraneVerts;
    const wobbleSpeed = 2.5;
    const wobbleAmt = this.variant.wobbleAmount;

    // Compute pinch amount during cytokinesis
    let pinchAmount = 0;
    if (phase === 'cytokinesis') {
      pinchAmount = phaseProgress * 0.85;
    } else if (phase === 'anaphase') {
      pinchAmount = phaseProgress * 0.15;
    }

    for (let i = 0; i <= n; i++) {
      const idx = i % n;
      const angle = (idx / n) * Math.PI * 2;

      // Base ellipse
      let vx = cx + rx * Math.cos(angle);
      let vy = cy + ry * Math.sin(angle);

      // Organic wobble noise
      const wobble = Math.sin(time * wobbleSpeed + this.membranePhases[idx]) * wobbleAmt;
      vx += wobble * Math.cos(angle);
      vy += wobble * Math.sin(angle);

      // Cytokinesis pinch: constrict at equator (where cos(angle) ~ 0, i.e. top/bottom)
      // Actually the equator is at x = cx, so we pinch based on sin(angle)
      // Vertices near the left/right poles (cos(angle) ~ +-1) stay, vertices near equator pinch in
      if (pinchAmount > 0) {
        // How close this vertex is to the equator (top or bottom of ellipse)
        const equatorCloseness = Math.abs(Math.sin(angle));
        const squeeze = equatorCloseness * pinchAmount;

        // Push the vertex toward the vertical center axis
        const dirX = Math.cos(angle);
        vx -= dirX * rx * squeeze;

        // Asymmetric variant: one side pinches more
        if (this.variant.asymmetric && Math.sin(angle) > 0) {
          vx -= dirX * rx * squeeze * 0.3;
        }
      }

      // During cytokinesis late stage, drift daughter cells apart
      if (phase === 'cytokinesis' && phaseProgress > 0.6) {
        const driftAmount = (phaseProgress - 0.6) / 0.4;
        if (Math.cos(angle) > 0) {
          vx += rx * 0.15 * driftAmount;
        } else {
          vx -= rx * 0.15 * driftAmount;
        }
      }

      attr.setXYZ(i, vx, vy, 1);
    }
    attr.needsUpdate = true;

    (this.membrane.material as THREE.LineBasicMaterial).opacity = opacity * 0.9;
  }

  private updateSpindleFibers(
    cx: number, cy: number,
    rx: number, ry: number,
    phase: MitosisPhase, phaseProgress: number,
    opacity: number,
  ): void {
    const attr = this.spindleFibers.geometry.getAttribute('position') as THREE.BufferAttribute;
    const fiberCount = this.variant.fiberCount;

    // Spindle fibers only visible during prophase through anaphase
    const showSpindle = phase === 'prophase' || phase === 'metaphase' || phase === 'anaphase';
    let fiberOpacity = 0;
    if (phase === 'prophase') {
      fiberOpacity = phaseProgress; // fade in
    } else if (phase === 'metaphase') {
      fiberOpacity = 1;
    } else if (phase === 'anaphase') {
      fiberOpacity = 1 - phaseProgress * 0.5; // fade out partially
    }

    // Pole positions (left and right of cell)
    const poleLeftX = cx - rx * 0.85;
    const poleRightX = cx + rx * 0.85;

    if (showSpindle) {
      for (let i = 0; i < fiberCount; i++) {
        // Spread fibers vertically around the equator
        const spread = (i / (fiberCount - 1) - 0.5) * ry * 1.2;
        const targetY = cy + spread;

        // Each fiber is a pair: start vertex, end vertex
        // Left pole fibers: indices [0..fiberCount-1] * 2
        const lStart = i * 2;
        attr.setXYZ(lStart, poleLeftX, cy, 0.8);
        attr.setXYZ(lStart + 1, cx, targetY, 0.8);

        // Right pole fibers: indices [fiberCount..fiberCount*2-1] * 2
        const rStart = (fiberCount + i) * 2;
        attr.setXYZ(rStart, poleRightX, cy, 0.8);
        attr.setXYZ(rStart + 1, cx, targetY, 0.8);
      }
    } else {
      // Hide fibers offscreen
      const totalVerts = fiberCount * 2 * 2;
      for (let i = 0; i < totalVerts; i++) {
        attr.setXYZ(i, 0, 0, -10);
      }
    }
    attr.needsUpdate = true;

    (this.spindleFibers.material as THREE.LineBasicMaterial).opacity = opacity * fiberOpacity * 0.6;
  }

  private updateChromosomes(
    time: number, cx: number, cy: number,
    rx: number, ry: number,
    phase: MitosisPhase, phaseProgress: number,
    opacity: number,
  ): void {
    const posAttr = this.chromosomes.geometry.getAttribute('position') as THREE.BufferAttribute;
    const colAttr = this.chromosomes.geometry.getAttribute('color') as THREE.BufferAttribute;
    const count = this.variant.chromosomeCount;

    // Choose chromosome color
    const baseColor = this.palette.secondary;
    const alertColor = this.palette.alert;
    const useAlertSome = this.intensityLevel >= 3;
    const useAlertAll = this.intensityLevel >= 5;

    for (let i = 0; i < count; i++) {
      let px: number;
      let py: number;

      const offX = this.chromoOffsetX[i];
      const offY = this.chromoOffsetY[i];
      const driftX = this.chromoDriftX[i];
      const driftY = this.chromoDriftY[i];

      switch (phase) {
        case 'interphase': {
          // Loosely scattered within cell, gentle drift
          const scatter = 0.6;
          px = cx + offX * rx * scatter + Math.sin(time * 0.5 + driftX * 10) * rx * 0.05;
          py = cy + offY * ry * scatter + Math.cos(time * 0.4 + driftY * 10) * ry * 0.05;
          break;
        }
        case 'prophase': {
          // Condense toward bright points near center
          const condense = phaseProgress;
          const scatterRemain = 0.6 * (1 - condense) + 0.15 * condense;
          px = cx + offX * rx * scatterRemain;
          py = cy + offY * ry * scatterRemain;
          break;
        }
        case 'metaphase': {
          // Align at equator (vertical center line at x = cx)
          const align = phaseProgress;
          const scatterX = 0.15 * (1 - align) + 0.02 * align;
          const spreadY = 0.5;
          px = cx + offX * rx * scatterX;
          py = cy + offY * ry * spreadY;
          break;
        }
        case 'anaphase': {
          // Pull toward opposite poles
          const half = i < count / 2;
          const poleX = half ? cx - rx * 0.6 : cx + rx * 0.6;
          const pullProgress = phaseProgress;
          // Start from equator position, move toward pole
          const startX = cx + offX * rx * 0.02;
          px = startX + (poleX - startX) * pullProgress;
          py = cy + offY * ry * 0.35 * (1 - pullProgress * 0.3);
          break;
        }
        case 'cytokinesis': {
          // Two groups at poles, drifting apart
          const half = i < count / 2;
          const drift = phaseProgress * 0.2;
          const poleX = half ? cx - rx * (0.6 + drift) : cx + rx * (0.6 + drift);
          px = poleX + offX * rx * 0.15;
          py = cy + offY * ry * 0.3;

          // Late cytokinesis: one group fades (handled via opacity below)
          break;
        }
        default:
          px = cx;
          py = cy;
      }

      posAttr.setXYZ(i, px, py, 1.5);

      // Color: secondary normally; intensity 3+ flashes alert on some; intensity 5 flashes all
      if (useAlertAll && Math.sin(time * 12 + i * 1.3) > 0.3) {
        colAttr.setXYZ(i, alertColor.r, alertColor.g, alertColor.b);
      } else if (useAlertSome && i % 3 === 0) {
        colAttr.setXYZ(i, alertColor.r, alertColor.g, alertColor.b);
      } else {
        colAttr.setXYZ(i, baseColor.r, baseColor.g, baseColor.b);
      }
    }
    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;

    // Chromosome brightness depends on phase
    let chromoOpacity = 0.7;
    if (phase === 'prophase') chromoOpacity = 0.7 + phaseProgress * 0.3;
    else if (phase === 'metaphase' || phase === 'anaphase') chromoOpacity = 1.0;
    else if (phase === 'cytokinesis') chromoOpacity = 1.0 - phaseProgress * 0.3;

    (this.chromosomes.material as THREE.PointsMaterial).opacity = opacity * chromoOpacity;
  }

  private updateCentrosomes(
    cx: number, cy: number, rx: number,
    phase: MitosisPhase,
    opacity: number,
  ): void {
    const attr = this.centrosomes.geometry.getAttribute('position') as THREE.BufferAttribute;

    // Centrosomes visible from prophase through cytokinesis
    const showCentro = phase !== 'interphase';

    if (showCentro) {
      const poleLeftX = cx - rx * 0.85;
      const poleRightX = cx + rx * 0.85;
      attr.setXYZ(0, poleLeftX, cy, 2);
      attr.setXYZ(1, poleRightX, cy, 2);
    } else {
      attr.setXYZ(0, 0, 0, -10);
      attr.setXYZ(1, 0, 0, -10);
    }
    attr.needsUpdate = true;

    (this.centrosomes.material as THREE.PointsMaterial).opacity = showCentro ? opacity * 0.9 : 0;
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    this.intensityLevel = level;

    if (level === 0) {
      this.speedMultiplier = 1;
      this.secondaryCycleTime = -1;
      return;
    }

    // Speed increase with intensity
    this.speedMultiplier = 1 + level * 0.25;

    // Level 5: spawn overlapping secondary division offset by 50%
    if (level >= 5 && this.secondaryCycleTime < 0) {
      this.secondaryCycleTime = this.variant.cycleDuration * 0.5;
    }
  }
}
