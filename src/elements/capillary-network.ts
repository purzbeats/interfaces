import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Biotech HUD element: procedural branching vascular tree with blood cell
 * particles flowing through it. A binary tree of vessel segments grows from
 * the top of the region downward; particle "blood cells" travel along the
 * vessels, routing through branches and looping back to the root. A
 * sinusoidal heartbeat modulates flow speed.
 */

export class CapillaryNetworkElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'capillary-network',
    meta: {
      shape: 'rectangular',
      roles: ['data-display', 'decorative'],
      moods: ['diagnostic', 'ambient'],
      sizes: ['needs-medium', 'needs-large'],
      bandAffinity: 'sub',
    } satisfies ElementMeta,
  };

  /* ---- vessel tree flat arrays ---- */
  private segStartX!: Float32Array;
  private segStartY!: Float32Array;
  private segEndX!: Float32Array;
  private segEndY!: Float32Array;
  private segDepth!: Uint8Array;
  private segWidth!: Float32Array;
  /** For each segment: indices of its two children (-1 if leaf). */
  private segChildA!: Int16Array;
  private segChildB!: Int16Array;
  private segCount = 0;

  /* ---- Three.js objects ---- */
  private vesselLines!: THREE.LineSegments;
  private vesselMat!: THREE.LineBasicMaterial;
  private trunkLine!: THREE.Line;
  private trunkMat!: THREE.LineBasicMaterial;
  private cellPoints!: THREE.Points;
  private cellMat!: THREE.PointsMaterial;

  /* ---- particle parallel arrays ---- */
  private particleSegment!: Int16Array;
  private particleProgress!: Float32Array;
  private particleActive!: Uint8Array; // 0 or 1
  private particleCount = 0;

  /* ---- variant parameters ---- */
  private maxDepth = 5;
  private heartRate = 1.2;
  private baseFlowSpeed = 1.0;
  private flowSpeedMultiplier = 1.0;
  private pulseAmplitude = 0.3;
  private hemorrhage = false;
  private intensityLevel = 0;

  /** Per-segment width irregularity multiplier (varicose variant). */
  private widthJitter!: Float32Array;

  build(): void {
    const variant = this.rng.int(0, 3);
    const presets = [
      { depth: 6, particles: 180, heartRate: 1.2, flowSpeed: 1.0, pulseAmp: 0.3, varicose: false }, // Standard
      { depth: 4, particles: 150, heartRate: 1.8, flowSpeed: 1.6, pulseAmp: 0.4, varicose: false }, // Arterial
      { depth: 8, particles: 200, heartRate: 0.9, flowSpeed: 0.6, pulseAmp: 0.2, varicose: false }, // Capillary-bed
      { depth: 6, particles: 180, heartRate: 1.2, flowSpeed: 1.0, pulseAmp: 0.3, varicose: true  }, // Varicose
    ];
    const p = presets[variant];

    this.maxDepth = p.depth;
    this.heartRate = p.heartRate;
    this.baseFlowSpeed = p.flowSpeed;
    this.pulseAmplitude = p.pulseAmp;
    this.particleCount = p.particles;

    const { x, y, w, h } = this.px;
    this.glitchAmount = 4;

    /* ---- Generate vascular tree ---- */
    // Worst-case segment count for a full binary tree of depth d: 2^(d+1) - 1
    const maxSegs = (1 << (this.maxDepth + 1)) - 1;
    this.segStartX = new Float32Array(maxSegs);
    this.segStartY = new Float32Array(maxSegs);
    this.segEndX = new Float32Array(maxSegs);
    this.segEndY = new Float32Array(maxSegs);
    this.segDepth = new Uint8Array(maxSegs);
    this.segWidth = new Float32Array(maxSegs);
    this.segChildA = new Int16Array(maxSegs).fill(-1);
    this.segChildB = new Int16Array(maxSegs).fill(-1);
    this.widthJitter = new Float32Array(maxSegs);
    for (let i = 0; i < maxSegs; i++) {
      this.widthJitter[i] = p.varicose ? this.rng.float(0.5, 1.5) : 1.0;
    }

    const rootX = x + w * 0.5;
    const rootY = y + h * 0.05;
    const rootLength = h * 0.22;
    const rootWidth = w * 0.10;

    this.segCount = 0;
    this.generateBranch(rootX, rootY, Math.PI / 2, rootLength, rootWidth, 0);

    /* ---- Vessel wall LineSegments ---- */
    // Two parallel lines per segment = 4 vertices = 12 floats per segment
    const wallVerts = new Float32Array(this.segCount * 12);
    const wallColors = new Float32Array(this.segCount * 12);

    const dimR = this.palette.dim.r;
    const dimG = this.palette.dim.g;
    const dimB = this.palette.dim.b;

    for (let i = 0; i < this.segCount; i++) {
      const sx = this.segStartX[i];
      const sy = this.segStartY[i];
      const ex = this.segEndX[i];
      const ey = this.segEndY[i];
      const vw = this.segWidth[i] * this.widthJitter[i] * 0.5;

      // Perpendicular direction
      const dx = ex - sx;
      const dy = ey - sy;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;

      const off = i * 12;
      // Left wall
      wallVerts[off]     = sx + nx * vw;
      wallVerts[off + 1] = sy + ny * vw;
      wallVerts[off + 2] = 0;
      wallVerts[off + 3] = ex + nx * vw;
      wallVerts[off + 4] = ey + ny * vw;
      wallVerts[off + 5] = 0;
      // Right wall
      wallVerts[off + 6]  = sx - nx * vw;
      wallVerts[off + 7]  = sy - ny * vw;
      wallVerts[off + 8]  = 0;
      wallVerts[off + 9]  = ex - nx * vw;
      wallVerts[off + 10] = ey - ny * vw;
      wallVerts[off + 11] = 0;

      // Color: palette.dim, faded with depth
      const depthAlpha = 1 - this.segDepth[i] / (this.maxDepth + 1) * 0.6;
      for (let v = 0; v < 4; v++) {
        wallColors[off + v * 3]     = dimR * depthAlpha;
        wallColors[off + v * 3 + 1] = dimG * depthAlpha;
        wallColors[off + v * 3 + 2] = dimB * depthAlpha;
      }
    }

    const wallGeo = new THREE.BufferGeometry();
    wallGeo.setAttribute('position', new THREE.BufferAttribute(wallVerts, 3));
    wallGeo.setAttribute('color', new THREE.BufferAttribute(wallColors, 3));
    this.vesselMat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0,
    });
    this.vesselLines = new THREE.LineSegments(wallGeo, this.vesselMat);
    this.group.add(this.vesselLines);

    /* ---- Central trunk Line ---- */
    const trunkVerts = new Float32Array([
      this.segStartX[0], this.segStartY[0], 0.5,
      this.segEndX[0], this.segEndY[0], 0.5,
    ]);
    const trunkGeo = new THREE.BufferGeometry();
    trunkGeo.setAttribute('position', new THREE.BufferAttribute(trunkVerts, 3));
    this.trunkMat = new THREE.LineBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
    });
    this.trunkLine = new THREE.Line(trunkGeo, this.trunkMat);
    this.group.add(this.trunkLine);

    /* ---- Blood cell particles (Points) ---- */
    const maxParticles = 200; // pre-allocated pool ceiling
    this.particleSegment = new Int16Array(maxParticles);
    this.particleProgress = new Float32Array(maxParticles);
    this.particleActive = new Uint8Array(maxParticles);

    // Initialize particles
    for (let i = 0; i < this.particleCount; i++) {
      this.particleSegment[i] = 0; // start at root
      this.particleProgress[i] = this.rng.float(0, 1);
      this.particleActive[i] = 1;
    }

    const cellPositions = new Float32Array(maxParticles * 3);
    const cellColors = new Float32Array(maxParticles * 3);
    const cellGeo = new THREE.BufferGeometry();
    cellGeo.setAttribute('position', new THREE.BufferAttribute(cellPositions, 3));
    cellGeo.setAttribute('color', new THREE.BufferAttribute(cellColors, 3));
    cellGeo.setDrawRange(0, this.particleCount);

    this.cellMat = new THREE.PointsMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0,
      size: Math.max(3, Math.min(w, h) * 0.015),
      sizeAttenuation: false,
    });
    this.cellPoints = new THREE.Points(cellGeo, this.cellMat);
    this.group.add(this.cellPoints);
  }

  /**
   * Recursively generate a binary branching tree, storing segments in flat arrays.
   * Returns the index of the newly created segment.
   */
  private generateBranch(
    startX: number, startY: number,
    angle: number, length: number, width: number,
    depth: number,
  ): number {
    const idx = this.segCount++;
    const endX = startX + Math.cos(angle) * length;
    const endY = startY + Math.sin(angle) * length;

    this.segStartX[idx] = startX;
    this.segStartY[idx] = startY;
    this.segEndX[idx] = endX;
    this.segEndY[idx] = endY;
    this.segDepth[idx] = depth;
    this.segWidth[idx] = width;

    if (depth < this.maxDepth) {
      const spreadAngle = this.rng.float(25, 55) * (Math.PI / 180);
      const childLength = length * this.rng.float(0.65, 0.85);
      const childWidth = width * 0.6;

      const jitterA = this.rng.float(-0.05, 0.05);
      const jitterB = this.rng.float(-0.05, 0.05);

      const childA = this.generateBranch(
        endX, endY,
        angle - spreadAngle / 2 + jitterA,
        childLength, childWidth, depth + 1,
      );
      const childB = this.generateBranch(
        endX, endY,
        angle + spreadAngle / 2 + jitterB,
        childLength, childWidth, depth + 1,
      );

      this.segChildA[idx] = childA;
      this.segChildB[idx] = childB;
    }

    return idx;
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);

    /* ---- heartbeat-modulated flow speed ---- */
    const heartbeat = 1 + this.pulseAmplitude * Math.sin(time * this.heartRate * Math.PI * 2);
    const speed = this.baseFlowSpeed * this.flowSpeedMultiplier * heartbeat;

    /* ---- update particles ---- */
    const posAttr = this.cellPoints.geometry.getAttribute('position') as THREE.BufferAttribute;
    const colAttr = this.cellPoints.geometry.getAttribute('color') as THREE.BufferAttribute;

    const primR = this.palette.primary.r;
    const primG = this.palette.primary.g;
    const primB = this.palette.primary.b;
    const secR = this.palette.secondary.r;
    const secG = this.palette.secondary.g;
    const secB = this.palette.secondary.b;
    const alertR = this.palette.alert.r;
    const alertG = this.palette.alert.g;
    const alertB = this.palette.alert.b;

    for (let i = 0; i < this.particleCount; i++) {
      if (!this.particleActive[i]) continue;

      const seg = this.particleSegment[i];
      const vesselWidth = this.segWidth[seg] * this.widthJitter[seg];

      // Speed inversely proportional to vessel width (narrow = slow)
      const widthFactor = 1 / (vesselWidth * 10 + 1);
      this.particleProgress[i] += speed * widthFactor * dt;

      // Particle reached end of current vessel segment
      if (this.particleProgress[i] >= 1) {
        this.particleProgress[i] = 0;

        const childA = this.segChildA[seg];
        const childB = this.segChildB[seg];

        if (childA >= 0 && childB >= 0) {
          // Branch: randomly pick a child
          this.particleSegment[i] = this.rng.chance(0.5) ? childA : childB;
        } else if (childA >= 0) {
          this.particleSegment[i] = childA;
        } else if (childB >= 0) {
          this.particleSegment[i] = childB;
        } else {
          // Leaf: loop back to root
          this.particleSegment[i] = 0;
          this.particleProgress[i] = 0;
        }
      }

      // Compute world position by lerping between segment start/end
      const s = this.particleSegment[i];
      const t = this.particleProgress[i];
      let px = this.segStartX[s] + (this.segEndX[s] - this.segStartX[s]) * t;
      let py = this.segStartY[s] + (this.segEndY[s] - this.segStartY[s]) * t;

      // Level 5 hemorrhage: scatter particles outside vessels
      if (this.hemorrhage) {
        px += (this.rng.next() - 0.5) * 8;
        py += (this.rng.next() - 0.5) * 8;
      }

      posAttr.setXYZ(i, px, py, 1);

      // Color: primary for shallow, transition to secondary at deeper levels
      const depth = this.segDepth[s];
      const depthRatio = depth / Math.max(1, this.maxDepth);

      if (this.hemorrhage && this.rng.next() < 0.3) {
        // Some particles use alert color during hemorrhage
        colAttr.setXYZ(i, alertR, alertG, alertB);
      } else {
        const r = primR + (secR - primR) * depthRatio;
        const g = primG + (secG - primG) * depthRatio;
        const b = primB + (secB - primB) * depthRatio;
        colAttr.setXYZ(i, r, g, b);
      }
    }

    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
    this.cellPoints.geometry.setDrawRange(0, this.particleCount);

    /* ---- apply opacity ---- */
    this.vesselMat.opacity = opacity * 0.85;
    this.trunkMat.opacity = opacity;
    this.cellMat.opacity = opacity;
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    this.intensityLevel = level;

    if (level === 0) {
      this.flowSpeedMultiplier = 1.0;
      this.pulseAmplitude = 0.3;
      this.hemorrhage = false;
      return;
    }

    // Flow speed and pulse amplitude increase with level
    this.flowSpeedMultiplier = 1.0 + level * 0.3;
    this.pulseAmplitude = 0.3 + level * 0.08;

    // Level 5: hemorrhage mode
    if (level >= 5) {
      this.hemorrhage = true;
    } else {
      this.hemorrhage = false;
    }
  }
}
