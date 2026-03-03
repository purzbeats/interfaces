import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Rotating double helix (DNA strand) with base pair connections.
 * Looks like a genetic sequencing display on a biotech terminal.
 * Two sinusoidal backbone strands connected by colored base pair rungs,
 * with depth-based brightness, scrolling, and a measurement scale.
 */
export class DnaHelixElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'dna-helix',
    meta: { shape: 'rectangular', roles: ['data-display', 'decorative'], moods: ['diagnostic', 'ambient'], bandAffinity: 'mid', sizes: ['needs-medium', 'needs-large'] },
  };
  private strand1!: THREE.Line;
  private strand2!: THREE.Line;
  private basePairs!: THREE.LineSegments;
  private basePairColors!: Float32Array;
  private scaleTicks!: THREE.LineSegments;
  private scaleLabels!: THREE.Points;
  private bobPoints!: THREE.Points;

  private numPoints: number = 0;
  private numPairs: number = 0;
  private phase: number = 0;
  private scrollOffset: number = 0;
  private helixRadius: number = 0;
  private rotationSpeed: number = 0;
  private scrollSpeed: number = 0;
  private pairTypes: number[] = []; // 0=AT, 1=CG
  private unwindAmount: number = 0;
  private alertSpinBoost: number = 0;
  private alertFlashPhase: number = 0;

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;

    this.numPoints = Math.max(40, Math.min(60, Math.floor(h * 0.15)));
    this.numPairs = this.numPoints;
    this.helixRadius = w * 0.25;
    this.rotationSpeed = this.rng.float(1.2, 2.5);
    this.scrollSpeed = this.rng.float(15, 35);

    // Assign random base pair types
    for (let i = 0; i < this.numPairs; i++) {
      this.pairTypes.push(this.rng.chance(0.5) ? 0 : 1);
    }

    // --- Backbone strand 1 ---
    const s1Pos = new Float32Array(this.numPoints * 3);
    const s1Geo = new THREE.BufferGeometry();
    s1Geo.setAttribute('position', new THREE.BufferAttribute(s1Pos, 3));
    this.strand1 = new THREE.Line(s1Geo, new THREE.LineBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
      linewidth: 1,
    }));
    this.group.add(this.strand1);

    // --- Backbone strand 2 ---
    const s2Pos = new Float32Array(this.numPoints * 3);
    const s2Geo = new THREE.BufferGeometry();
    s2Geo.setAttribute('position', new THREE.BufferAttribute(s2Pos, 3));
    this.strand2 = new THREE.Line(s2Geo, new THREE.LineBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
      linewidth: 1,
    }));
    this.group.add(this.strand2);

    // --- Base pair connections (LineSegments: pairs of vertices) ---
    const bpPos = new Float32Array(this.numPairs * 2 * 3);
    this.basePairColors = new Float32Array(this.numPairs * 2 * 3);
    const bpGeo = new THREE.BufferGeometry();
    bpGeo.setAttribute('position', new THREE.BufferAttribute(bpPos, 3));
    bpGeo.setAttribute('color', new THREE.BufferAttribute(this.basePairColors, 3));
    this.basePairs = new THREE.LineSegments(bpGeo, new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.basePairs);

    // --- Phosphate "node" dots at each backbone vertex ---
    const bobPos = new Float32Array(this.numPoints * 2 * 3);
    const bobColors = new Float32Array(this.numPoints * 2 * 3);
    const bobGeo = new THREE.BufferGeometry();
    bobGeo.setAttribute('position', new THREE.BufferAttribute(bobPos, 3));
    bobGeo.setAttribute('color', new THREE.BufferAttribute(bobColors, 3));
    this.bobPoints = new THREE.Points(bobGeo, new THREE.PointsMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0,
      size: Math.max(2, Math.min(w, h) * 0.008),
      sizeAttenuation: false,
    }));
    this.group.add(this.bobPoints);

    // --- Measurement scale (left side ruler) ---
    const scaleX = x + w * 0.08;
    const tickCount = Math.floor(h / 20);
    const tickVerts = new Float32Array(tickCount * 2 * 3);
    for (let i = 0; i < tickCount; i++) {
      const ty = y + (h * i) / tickCount;
      const isMajor = i % 5 === 0;
      const tickLen = isMajor ? w * 0.06 : w * 0.03;
      tickVerts[i * 6 + 0] = scaleX;
      tickVerts[i * 6 + 1] = ty;
      tickVerts[i * 6 + 2] = 0.5;
      tickVerts[i * 6 + 3] = scaleX + tickLen;
      tickVerts[i * 6 + 4] = ty;
      tickVerts[i * 6 + 5] = 0.5;
    }
    const scaleGeo = new THREE.BufferGeometry();
    scaleGeo.setAttribute('position', new THREE.BufferAttribute(tickVerts, 3));
    this.scaleTicks = new THREE.LineSegments(scaleGeo, new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.scaleTicks);

    // Dots at major tick marks for nucleotide position labels
    const majorCount = Math.floor(tickCount / 5) + 1;
    const labelPos = new Float32Array(majorCount * 3);
    for (let i = 0; i < majorCount; i++) {
      const ty = y + (h * i * 5) / tickCount;
      labelPos[i * 3] = scaleX - w * 0.02;
      labelPos[i * 3 + 1] = ty;
      labelPos[i * 3 + 2] = 0.5;
    }
    const labelGeo = new THREE.BufferGeometry();
    labelGeo.setAttribute('position', new THREE.BufferAttribute(labelPos, 3));
    this.scaleLabels = new THREE.Points(labelGeo, new THREE.PointsMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
      size: 3,
      sizeAttenuation: false,
    }));
    this.group.add(this.scaleLabels);
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    const { x, y, w, h } = this.px;

    // Decay alert/glitch modifiers
    if (this.unwindAmount > 0) this.unwindAmount = Math.max(0, this.unwindAmount - dt * 2);
    if (this.alertSpinBoost > 0) this.alertSpinBoost = Math.max(0, this.alertSpinBoost - dt * 0.5);

    const effectiveSpeed = this.rotationSpeed + this.alertSpinBoost * 6;
    this.phase += effectiveSpeed * dt;
    this.scrollOffset += this.scrollSpeed * dt;
    this.alertFlashPhase += dt * 12;

    const cx = x + w * 0.52; // center of helix, offset for scale
    const radius = this.helixRadius * (1 + this.unwindAmount * 0.8);

    const s1Pos = this.strand1.geometry.getAttribute('position') as THREE.BufferAttribute;
    const s2Pos = this.strand2.geometry.getAttribute('position') as THREE.BufferAttribute;
    const bpPos = this.basePairs.geometry.getAttribute('position') as THREE.BufferAttribute;
    const bpCol = this.basePairs.geometry.getAttribute('color') as THREE.BufferAttribute;
    const bobPos = this.bobPoints.geometry.getAttribute('position') as THREE.BufferAttribute;
    const bobCol = this.bobPoints.geometry.getAttribute('color') as THREE.BufferAttribute;

    const twistPeriod = 2.5; // how many full twists fit in the region

    for (let i = 0; i < this.numPoints; i++) {
      const t = i / (this.numPoints - 1);
      const py = y + h * t;

      // The helix angle at this vertical position, incorporating scroll and rotation
      const scrollT = (t + this.scrollOffset / h) % 1.0;
      const angle = this.phase + scrollT * Math.PI * 2 * twistPeriod;

      // Strand positions (sin/cos for apparent 3D rotation)
      const sinA = Math.sin(angle);
      const cosA = Math.cos(angle);

      const s1x = cx + sinA * radius;
      const s2x = cx - sinA * radius; // offset by pi

      // Depth-based z for layering (front strand on top)
      const s1z = 1.0 + cosA * 0.4;
      const s2z = 1.0 - cosA * 0.4;

      s1Pos.setXYZ(i, s1x, py, s1z);
      s2Pos.setXYZ(i, s2x, py, s2z);

      // Depth brightness: front bright, back dim
      const s1Brightness = 0.4 + 0.6 * Math.max(0, cosA);
      const s2Brightness = 0.4 + 0.6 * Math.max(0, -cosA);

      // Bob (node) dots along backbones
      const bi1 = i * 2;
      const bi2 = i * 2 + 1;
      bobPos.setXYZ(bi1, s1x, py, s1z + 0.1);
      bobPos.setXYZ(bi2, s2x, py, s2z + 0.1);

      const p = this.palette.primary;
      const d = this.palette.dim;
      bobCol.setXYZ(bi1,
        d.r + (p.r - d.r) * s1Brightness,
        d.g + (p.g - d.g) * s1Brightness,
        d.b + (p.b - d.b) * s1Brightness);
      bobCol.setXYZ(bi2,
        d.r + (p.r - d.r) * s2Brightness,
        d.g + (p.g - d.g) * s2Brightness,
        d.b + (p.b - d.b) * s2Brightness);

      // Base pairs
      if (i < this.numPairs) {
        bpPos.setXYZ(i * 2, s1x, py, Math.min(s1z, s2z));
        bpPos.setXYZ(i * 2 + 1, s2x, py, Math.min(s1z, s2z));

        // Color: AT pairs = primary, CG pairs = secondary
        const pairType = this.pairTypes[i % this.pairTypes.length];
        const baseColor = pairType === 0 ? this.palette.primary : this.palette.secondary;

        // Depth dimming for base pairs (use average depth)
        const pairBrightness = 0.3 + 0.7 * (0.5 + 0.5 * Math.abs(cosA));

        // Alert flash: sequential flash down the helix
        let flashMul = 1.0;
        if (this.alertSpinBoost > 0) {
          const flashWave = Math.sin(this.alertFlashPhase - i * 0.4);
          flashMul = 0.5 + 0.5 * Math.max(0, flashWave);
        }

        const cr = baseColor.r * pairBrightness * flashMul;
        const cg = baseColor.g * pairBrightness * flashMul;
        const cb = baseColor.b * pairBrightness * flashMul;
        bpCol.setXYZ(i * 2, cr, cg, cb);
        bpCol.setXYZ(i * 2 + 1, cr, cg, cb);
      }
    }

    s1Pos.needsUpdate = true;
    s2Pos.needsUpdate = true;
    bpPos.needsUpdate = true;
    bpCol.needsUpdate = true;
    bobPos.needsUpdate = true;
    bobCol.needsUpdate = true;

    // Strand brightness via material color modulation (front/back average)
    (this.strand1.material as THREE.LineBasicMaterial).opacity = opacity * 0.9;
    (this.strand2.material as THREE.LineBasicMaterial).opacity = opacity * 0.9;
    (this.basePairs.material as THREE.LineBasicMaterial).opacity = opacity * 0.7;
    (this.bobPoints.material as THREE.PointsMaterial).opacity = opacity * 0.85;
    (this.scaleTicks.material as THREE.LineBasicMaterial).opacity = opacity * 0.25;
    (this.scaleLabels.material as THREE.PointsMaterial).opacity = opacity * 0.3;
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) return;
    if (level >= 5) {
      this.unwindAmount = 1.0;
      this.alertSpinBoost = 3.0;
    } else if (level >= 3) {
      this.unwindAmount = 0.3;
    }
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Helix unwinds — strands separate
      this.unwindAmount = 1.0;
    }
    if (action === 'alert') {
      // Fast spin + sequential base pair flash
      this.alertSpinBoost = 2.0;
      this.alertFlashPhase = 0;
      this.pulseTimer = 2.0;
    }
    if (action === 'pulse') {
      // Handled by applyEffects — brightens all
    }
  }
}
