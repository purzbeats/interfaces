import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * A triangular prism refracting a light beam into a spectrum.
 * One beam enters one side and splits into multiple colored rays on the other.
 * Variants: single prism, double prism, with spectrum bars, rotating prism.
 */
export class PrismRefractElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'prism-refract',
    meta: { shape: 'rectangular', roles: ['decorative', 'scanner'], moods: ['ambient', 'diagnostic'], bandAffinity: 'high', sizes: ['needs-medium', 'needs-large'] },
  };

  private prisms!: THREE.Line[];
  private inBeams!: THREE.Line[];
  private outBeams!: THREE.LineSegments[];
  private spectrumBars!: THREE.LineSegments | null;

  private variant: number = 0;
  private prismCount: number = 1;
  private outRayCount: number = 5;
  private rotating: boolean = false;
  private prismAngles: number[] = [];
  private prismSpeeds: number[] = [];
  private beamShiftSpeed: number = 0;
  private beamShiftPhase: number = 0;
  private alertMode: boolean = false;

  // Spectral colors for the output rays
  private readonly SPECTRUM_COLORS = [
    new THREE.Color(0.9, 0.15, 0.15),   // red
    new THREE.Color(0.95, 0.5, 0.05),   // orange
    new THREE.Color(0.9, 0.9, 0.1),     // yellow
    new THREE.Color(0.15, 0.9, 0.15),   // green
    new THREE.Color(0.1, 0.5, 1.0),     // blue
    new THREE.Color(0.5, 0.1, 0.9),     // violet
  ];

  private buildPrismGeometry(cx: number, cy: number, size: number, angle: number): Float32Array {
    // Equilateral triangle centered at (cx, cy)
    const verts = new Float32Array(4 * 3); // 3 corners + close
    for (let i = 0; i <= 3; i++) {
      const a = angle + (i / 3) * Math.PI * 2 - Math.PI / 2;
      verts[i * 3] = cx + Math.cos(a) * size;
      verts[i * 3 + 1] = cy + Math.sin(a) * size;
      verts[i * 3 + 2] = 1;
    }
    return verts;
  }

  build(): void {
    this.variant = this.rng.int(0, 3);
    this.glitchAmount = 3;
    const { x, y, w, h } = this.px;

    const presets = [
      // 0: single prism, stationary
      { count: 1, rays: 5, rotating: false, specBars: false, sizeScale: 0.28 },
      // 1: double prism, stationary
      { count: 2, rays: 4, rotating: false, specBars: false, sizeScale: 0.20 },
      // 2: single prism with spectrum bars
      { count: 1, rays: 6, rotating: false, specBars: true, sizeScale: 0.25 },
      // 3: rotating prism
      { count: 1, rays: 5, rotating: true, specBars: false, sizeScale: 0.26 },
    ];
    const p = presets[this.variant];
    this.prismCount = p.count;
    this.outRayCount = p.rays;
    this.rotating = p.rotating;
    this.beamShiftSpeed = this.rng.float(0.15, 0.4);
    this.beamShiftPhase = this.rng.float(0, Math.PI * 2);

    const prismSize = Math.min(w, h) * p.sizeScale;

    // Prism centers
    const prismCenters: Array<{ cx: number; cy: number }> = [];
    if (this.prismCount === 1) {
      prismCenters.push({ cx: x + w * 0.42, cy: y + h * 0.5 });
    } else {
      prismCenters.push({ cx: x + w * 0.32, cy: y + h * 0.38 });
      prismCenters.push({ cx: x + w * 0.55, cy: y + h * 0.62 });
    }

    this.prisms = [];
    this.inBeams = [];
    this.outBeams = [];

    for (let pi = 0; pi < this.prismCount; pi++) {
      const { cx, cy } = prismCenters[pi];
      const initAngle = this.rng.float(0, Math.PI * 2);
      this.prismAngles.push(initAngle);
      this.prismSpeeds.push(this.rotating ? this.rng.float(0.2, 0.5) * (this.rng.chance(0.5) ? 1 : -1) : 0);

      // Prism outline (triangle as LineLoop)
      const triVerts = this.buildPrismGeometry(cx, cy, prismSize, initAngle);
      const triGeo = new THREE.BufferGeometry();
      triGeo.setAttribute('position', new THREE.BufferAttribute(triVerts, 3));
      const prism = new THREE.LineLoop(triGeo, new THREE.LineBasicMaterial({
        color: this.palette.dim,
        transparent: true,
        opacity: 0,
      }));
      this.group.add(prism);
      this.prisms.push(prism);

      // Input beam (left side → prism)
      const inPos = new Float32Array(2 * 3);
      const inGeo = new THREE.BufferGeometry();
      inGeo.setAttribute('position', new THREE.BufferAttribute(inPos, 3));
      const inBeam = new THREE.Line(inGeo, new THREE.LineBasicMaterial({
        color: this.palette.primary,
        transparent: true,
        opacity: 0,
      }));
      this.group.add(inBeam);
      this.inBeams.push(inBeam);

      // Output beams (prism → right side), one per ray
      const outCount = pi === 0 ? this.outRayCount : Math.floor(this.outRayCount * 0.7);
      const outPos = new Float32Array(outCount * 2 * 3);
      const outColors = new Float32Array(outCount * 2 * 3);
      const outGeo = new THREE.BufferGeometry();
      outGeo.setAttribute('position', new THREE.BufferAttribute(outPos, 3));
      outGeo.setAttribute('color', new THREE.BufferAttribute(outColors, 3));
      const outBeam = new THREE.LineSegments(outGeo, new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0,
      }));
      this.group.add(outBeam);
      this.outBeams.push(outBeam);
    }

    // Spectrum bars (variant 2)
    this.spectrumBars = null;
    if (p.specBars) {
      const barCount = this.outRayCount;
      const barVerts = new Float32Array(barCount * 2 * 3);
      const barColors = new Float32Array(barCount * 2 * 3);
      // Pre-fill positions; will be updated in update()
      for (let i = 0; i < barCount; i++) {
        const specIdx = Math.floor(i * this.SPECTRUM_COLORS.length / barCount);
        const sc = this.SPECTRUM_COLORS[specIdx];
        barColors[i * 6 + 0] = sc.r; barColors[i * 6 + 1] = sc.g; barColors[i * 6 + 2] = sc.b;
        barColors[i * 6 + 3] = sc.r; barColors[i * 6 + 4] = sc.g; barColors[i * 6 + 5] = sc.b;
      }
      const barGeo = new THREE.BufferGeometry();
      barGeo.setAttribute('position', new THREE.BufferAttribute(barVerts, 3));
      barGeo.setAttribute('color', new THREE.BufferAttribute(barColors, 3));
      this.spectrumBars = new THREE.LineSegments(barGeo, new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0,
      }));
      this.group.add(this.spectrumBars);
    }
  }

  private getPrismVertex(cx: number, cy: number, size: number, angle: number, vertIdx: number): THREE.Vector2 {
    const a = angle + (vertIdx / 3) * Math.PI * 2 - Math.PI / 2;
    return new THREE.Vector2(cx + Math.cos(a) * size, cy + Math.sin(a) * size);
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    const { x, y, w, h } = this.px;

    this.beamShiftPhase += this.beamShiftSpeed * dt;

    const prismSize = Math.min(w, h) * (this.prismCount === 1 ? 0.28 : 0.20);
    const prismCenters = this.prismCount === 1
      ? [{ cx: x + w * 0.42, cy: y + h * 0.5 }]
      : [{ cx: x + w * 0.32, cy: y + h * 0.38 }, { cx: x + w * 0.55, cy: y + h * 0.62 }];

    for (let pi = 0; pi < this.prismCount; pi++) {
      this.prismAngles[pi] += this.prismSpeeds[pi] * dt;
      const angle = this.prismAngles[pi];
      const { cx, cy } = prismCenters[pi];

      // Update prism triangle
      const triVerts = this.buildPrismGeometry(cx, cy, prismSize, angle);
      const triPos = this.prisms[pi].geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i <= 3; i++) {
        triPos.setXYZ(i, triVerts[i * 3], triVerts[i * 3 + 1], 1);
      }
      triPos.needsUpdate = true;

      // Entry face: vertex 0 → vertex 1 (left face of prism, rotated)
      const v0 = this.getPrismVertex(cx, cy, prismSize, angle, 0);
      const v1 = this.getPrismVertex(cx, cy, prismSize, angle, 1);
      const entryMid = new THREE.Vector2((v0.x + v1.x) / 2, (v0.y + v1.y) / 2);

      // Exit face midpoint: vertex 1 → vertex 2
      const v2 = this.getPrismVertex(cx, cy, prismSize, angle, 2);
      const exitMid = new THREE.Vector2((v1.x + v2.x) / 2, (v1.y + v2.y) / 2);

      // Input beam: from left edge to entry face
      const beamShift = Math.sin(this.beamShiftPhase) * h * 0.06;
      const inStart = new THREE.Vector2(x + w * 0.03, entryMid.y + beamShift);
      const inPos = this.inBeams[pi].geometry.getAttribute('position') as THREE.BufferAttribute;
      inPos.setXYZ(0, inStart.x, inStart.y, 1.5);
      inPos.setXYZ(1, entryMid.x, entryMid.y, 1.5);
      inPos.needsUpdate = true;
      (this.inBeams[pi].material as THREE.LineBasicMaterial).opacity = opacity * 0.9;

      // Output beams: fan from exit face to right edge
      const outCount = pi === 0 ? this.outRayCount : Math.floor(this.outRayCount * 0.7);
      const outPos = this.outBeams[pi].geometry.getAttribute('position') as THREE.BufferAttribute;
      const outColors = this.outBeams[pi].geometry.getAttribute('color') as THREE.BufferAttribute;

      // Fan angle: shifted by beam phase
      const fanSpread = Math.PI * 0.35;
      const fanBase = Math.atan2(exitMid.y - cy, exitMid.x - cx);

      for (let ri = 0; ri < outCount; ri++) {
        const rf = ri / (outCount - 1);
        const rayAngle = fanBase - fanSpread / 2 + rf * fanSpread + Math.sin(this.beamShiftPhase * 0.5) * 0.08;

        const endX = exitMid.x + Math.cos(rayAngle) * w * 0.45;
        const endY = exitMid.y + Math.sin(rayAngle) * w * 0.45;

        // Clamp to element bounds
        const clampedEnd = new THREE.Vector2(
          Math.min(x + w * 0.97, Math.max(x + w * 0.03, endX)),
          Math.min(y + h * 0.97, Math.max(y + h * 0.03, endY))
        );

        outPos.setXYZ(ri * 2, exitMid.x, exitMid.y, 1.5);
        outPos.setXYZ(ri * 2 + 1, clampedEnd.x, clampedEnd.y, 1.5);

        // Pick spectral color
        const specIdx = Math.floor(rf * this.SPECTRUM_COLORS.length);
        const sc = this.alertMode ? this.palette.alert : this.SPECTRUM_COLORS[Math.min(specIdx, this.SPECTRUM_COLORS.length - 1)];
        const dim = 0.65;
        outColors.setXYZ(ri * 2, sc.r * dim, sc.g * dim, sc.b * dim);
        outColors.setXYZ(ri * 2 + 1, sc.r, sc.g, sc.b);
      }
      outPos.needsUpdate = true;
      outColors.needsUpdate = true;

      (this.outBeams[pi].material as THREE.LineBasicMaterial).opacity = opacity * 0.8;
      (this.prisms[pi].material as THREE.LineBasicMaterial).opacity = opacity * 0.6;
    }

    // Spectrum bars (static vertical bars showing the output spectrum)
    if (this.spectrumBars) {
      const barCount = this.outRayCount;
      const barPos = this.spectrumBars.geometry.getAttribute('position') as THREE.BufferAttribute;
      const barX0 = x + w * 0.72;
      const barSpacing = w * 0.04;
      const barMaxH = h * 0.35;

      for (let i = 0; i < barCount; i++) {
        const rf = i / (barCount - 1);
        const bx = barX0 + i * barSpacing;
        const barH = barMaxH * (0.5 + 0.5 * Math.sin(time * 1.2 + rf * Math.PI));
        barPos.setXYZ(i * 2, bx, y + h * 0.62, 1);
        barPos.setXYZ(i * 2 + 1, bx, y + h * 0.62 - barH, 1);
      }
      barPos.needsUpdate = true;
      (this.spectrumBars.material as THREE.LineBasicMaterial).opacity = opacity * 0.7;
    }
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Spin prisms fast
      for (let i = 0; i < this.prismSpeeds.length; i++) {
        const origSpeed = this.prismSpeeds[i];
        this.prismSpeeds[i] = (origSpeed === 0 ? 1 : origSpeed) * 8;
        setTimeout(() => { this.prismSpeeds[i] = origSpeed; }, 500);
      }
    }
    if (action === 'alert') {
      this.alertMode = true;
      this.pulseTimer = 2.0;
      setTimeout(() => { this.alertMode = false; }, 3000);
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) {
      this.alertMode = false;
      return;
    }
    if (level >= 4) {
      this.alertMode = true;
    }
    if (level >= 3) {
      // Speed up beam shift
      this.beamShiftSpeed = 0.8 + level * 0.3;
    } else {
      this.beamShiftSpeed = 0.25;
    }
  }
}
