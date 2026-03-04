import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

interface PetriVariant {
  colonyCount: number;
  fillTime: number;
  dotCount: number;
  dotSize: number;
  irregularSpeeds: boolean;
  useAlertColonies: boolean;
}

interface Colony {
  cx: number;
  cy: number;
  growthRadius: number;
  growthSpeed: number;
  colorIndex: number; // 0 = primary, 1 = secondary, 2 = alert (contaminated)
}

/**
 * Biotech HUD element — petri dish with growing bacterial colonies.
 * Colonies expand outward from seed points; when coverage exceeds threshold,
 * a sterilization flash resets all colonies to new positions.
 */
export class PetriDishElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'petri-dish',
    meta: {
      shape: 'radial',
      roles: ['data-display', 'scanner'],
      moods: ['diagnostic'],
      sizes: ['needs-medium', 'needs-large'],
      bandAffinity: 'high',
    } satisfies ElementMeta,
  };

  // Three.js objects
  private dishBorder!: THREE.Line;
  private dishBorderMat!: THREE.LineBasicMaterial;
  private agarGrid!: THREE.LineSegments;
  private agarGridMat!: THREE.LineBasicMaterial;
  private colonyPoints!: THREE.Points;
  private colonyPointsMat!: THREE.PointsMaterial;

  // Dish geometry
  private dishCX = 0;
  private dishCY = 0;
  private dishRadius = 0;

  // Variant config
  private dotCount = 300;
  private dotSize = 2;

  // Colony data
  private colonies: Colony[] = [];
  private maxColonyRadius = 0;

  // Per-dot parallel arrays
  private dotColonyIndex!: Uint16Array;   // which colony this dot belongs to
  private dotDistFromCenter!: Float32Array; // distance from its colony center
  private dotVisible!: Uint8Array;         // whether this dot is currently visible

  // Sterilization flash
  private flashTimer = 0;
  private flashDuration = 0.3;
  private isFlashing = false;

  // Intensity state
  private intensityLevel = 0;
  private growthMultiplier = 1;

  // Coverage threshold for sterilization
  private coverageThreshold = 0.8;

  build(): void {
    const variant = this.rng.int(0, 3);
    const presets: PetriVariant[] = [
      { colonyCount: 4,  fillTime: 12, dotCount: 300, dotSize: 2,   irregularSpeeds: false, useAlertColonies: false }, // Standard
      { colonyCount: 8,  fillTime: 8,  dotCount: 500, dotSize: 2,   irregularSpeeds: false, useAlertColonies: false }, // Dense
      { colonyCount: 2,  fillTime: 20, dotCount: 200, dotSize: 3.5, irregularSpeeds: false, useAlertColonies: false }, // Sparse
      { colonyCount: 5,  fillTime: 12, dotCount: 400, dotSize: 2,   irregularSpeeds: true,  useAlertColonies: true  }, // Contaminated
    ];
    const p = presets[variant];

    // Vary colony count slightly
    const colonyCount = p.colonyCount + this.rng.int(-1, 1);
    this.dotCount = p.dotCount;
    this.dotSize = p.dotSize;

    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;
    this.dishCX = x + w / 2;
    this.dishCY = y + h / 2;
    this.dishRadius = Math.min(w, h) * 0.45;
    this.maxColonyRadius = this.dishRadius;

    // Base growth speed: radius to fill dish in fillTime
    const baseGrowthSpeed = this.dishRadius / p.fillTime;

    // ── Dish border (circular outline) ──
    const borderSegments = 64;
    const borderVerts = new Float32Array((borderSegments + 1) * 3);
    for (let i = 0; i <= borderSegments; i++) {
      const angle = (i / borderSegments) * Math.PI * 2;
      borderVerts[i * 3] = this.dishCX + Math.cos(angle) * this.dishRadius;
      borderVerts[i * 3 + 1] = this.dishCY + Math.sin(angle) * this.dishRadius;
      borderVerts[i * 3 + 2] = 0;
    }
    const borderGeo = new THREE.BufferGeometry();
    borderGeo.setAttribute('position', new THREE.BufferAttribute(borderVerts, 3));
    this.dishBorderMat = new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    });
    this.dishBorder = new THREE.Line(borderGeo, this.dishBorderMat);
    this.group.add(this.dishBorder);

    // ── Agar grid (horizontal + vertical lines clipped to circle) ──
    const gridVerts: number[] = [];
    const gridLines = 6 + this.rng.int(-1, 2); // 5-8 lines each direction
    const gridStep = (this.dishRadius * 2) / (gridLines + 1);

    // Horizontal lines
    for (let i = 1; i <= gridLines; i++) {
      const gy = this.dishCY - this.dishRadius + i * gridStep;
      const dy = gy - this.dishCY;
      const halfChord = Math.sqrt(Math.max(0, this.dishRadius * this.dishRadius - dy * dy));
      if (halfChord > 0) {
        gridVerts.push(
          this.dishCX - halfChord, gy, 0,
          this.dishCX + halfChord, gy, 0,
        );
      }
    }

    // Vertical lines
    for (let i = 1; i <= gridLines; i++) {
      const gx = this.dishCX - this.dishRadius + i * gridStep;
      const dx = gx - this.dishCX;
      const halfChord = Math.sqrt(Math.max(0, this.dishRadius * this.dishRadius - dx * dx));
      if (halfChord > 0) {
        gridVerts.push(
          gx, this.dishCY - halfChord, 0,
          gx, this.dishCY + halfChord, 0,
        );
      }
    }

    const gridGeo = new THREE.BufferGeometry();
    gridGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(gridVerts), 3));
    this.agarGridMat = new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    });
    this.agarGrid = new THREE.LineSegments(gridGeo, this.agarGridMat);
    this.group.add(this.agarGrid);

    // ── Initialize colonies ──
    this.seedColonies(Math.max(1, colonyCount), baseGrowthSpeed, p.irregularSpeeds, p.useAlertColonies);

    // ── Colony dots (pre-allocated Points pool) ──
    this.dotColonyIndex = new Uint16Array(this.dotCount);
    this.dotDistFromCenter = new Float32Array(this.dotCount);
    this.dotVisible = new Uint8Array(this.dotCount);

    const dotPos = new Float32Array(this.dotCount * 3);
    const dotCol = new Float32Array(this.dotCount * 3);

    // Distribute dots across colonies evenly
    const dotsPerColony = Math.floor(this.dotCount / this.colonies.length);
    let dotIdx = 0;

    for (let c = 0; c < this.colonies.length; c++) {
      const colony = this.colonies[c];
      const count = (c === this.colonies.length - 1) ? (this.dotCount - dotIdx) : dotsPerColony;

      for (let d = 0; d < count && dotIdx < this.dotCount; d++) {
        // Place dot at random position within max colony radius from colony center
        const angle = this.rng.float(0, Math.PI * 2);
        const dist = this.rng.float(0, this.maxColonyRadius * 0.9);

        const px = colony.cx + Math.cos(angle) * dist;
        const py = colony.cy + Math.sin(angle) * dist;

        // Check if point is inside the dish
        const dishDist = Math.sqrt((px - this.dishCX) ** 2 + (py - this.dishCY) ** 2);
        if (dishDist > this.dishRadius * 0.95) {
          // Clamp to dish boundary
          const clampAngle = Math.atan2(py - this.dishCY, px - this.dishCX);
          const clampR = this.dishRadius * 0.9 * this.rng.float(0.7, 1.0);
          dotPos[dotIdx * 3] = this.dishCX + Math.cos(clampAngle) * clampR;
          dotPos[dotIdx * 3 + 1] = this.dishCY + Math.sin(clampAngle) * clampR;
        } else {
          dotPos[dotIdx * 3] = px;
          dotPos[dotIdx * 3 + 1] = py;
        }
        dotPos[dotIdx * 3 + 2] = 1;

        // Store which colony and distance from colony center
        this.dotColonyIndex[dotIdx] = c;
        const finalX = dotPos[dotIdx * 3];
        const finalY = dotPos[dotIdx * 3 + 1];
        this.dotDistFromCenter[dotIdx] = Math.sqrt(
          (finalX - colony.cx) ** 2 + (finalY - colony.cy) ** 2,
        );

        // Set initial vertex color based on colony colorIndex
        this.setDotColor(dotCol, dotIdx, colony.colorIndex, 1);

        dotIdx++;
      }
    }

    // Sort dots by distance from their colony center so drawRange works correctly
    // (closer dots become visible first as colony grows)
    this.sortDotsByDistance(dotPos, dotCol);

    const dotGeo = new THREE.BufferGeometry();
    dotGeo.setAttribute('position', new THREE.BufferAttribute(dotPos, 3));
    dotGeo.setAttribute('color', new THREE.BufferAttribute(dotCol, 3));
    dotGeo.setDrawRange(0, 0);

    this.colonyPointsMat = new THREE.PointsMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0,
      size: Math.max(2, this.dotSize),
      sizeAttenuation: false,
    });
    this.colonyPoints = new THREE.Points(dotGeo, this.colonyPointsMat);
    this.group.add(this.colonyPoints);
  }

  /** Set vertex color for a dot based on colony color index */
  private setDotColor(colorArr: Float32Array, idx: number, colorIndex: number, brightness: number): void {
    let color: THREE.Color;
    if (colorIndex === 2) {
      color = this.palette.alert;
    } else if (colorIndex === 1) {
      color = this.palette.secondary;
    } else {
      color = this.palette.primary;
    }
    colorArr[idx * 3] = color.r * brightness;
    colorArr[idx * 3 + 1] = color.g * brightness;
    colorArr[idx * 3 + 2] = color.b * brightness;
  }

  /** Sort all dot arrays by distance from colony center (ascending) */
  private sortDotsByDistance(posArr: Float32Array, colArr: Float32Array): void {
    // Build index array, sort by distance, then rearrange all parallel arrays
    const indices = Array.from({ length: this.dotCount }, (_, i) => i);
    indices.sort((a, b) => this.dotDistFromCenter[a] - this.dotDistFromCenter[b]);

    const tmpPos = new Float32Array(posArr);
    const tmpCol = new Float32Array(colArr);
    const tmpColony = new Uint16Array(this.dotColonyIndex);
    const tmpDist = new Float32Array(this.dotDistFromCenter);

    for (let i = 0; i < this.dotCount; i++) {
      const src = indices[i];
      posArr[i * 3] = tmpPos[src * 3];
      posArr[i * 3 + 1] = tmpPos[src * 3 + 1];
      posArr[i * 3 + 2] = tmpPos[src * 3 + 2];
      colArr[i * 3] = tmpCol[src * 3];
      colArr[i * 3 + 1] = tmpCol[src * 3 + 1];
      colArr[i * 3 + 2] = tmpCol[src * 3 + 2];
      this.dotColonyIndex[i] = tmpColony[src];
      this.dotDistFromCenter[i] = tmpDist[src];
    }
  }

  /** Seed new colonies at random positions within dish */
  private seedColonies(count: number, baseSpeed: number, irregularSpeeds: boolean, useAlert: boolean): void {
    this.colonies = [];
    for (let i = 0; i < count; i++) {
      // Random position inside dish (not too close to edge)
      const angle = this.rng.float(0, Math.PI * 2);
      const dist = this.rng.float(0, this.dishRadius * 0.7);
      const cx = this.dishCX + Math.cos(angle) * dist;
      const cy = this.dishCY + Math.sin(angle) * dist;

      let speed = baseSpeed;
      if (irregularSpeeds) {
        speed *= this.rng.float(0.5, 2.0);
      }

      let colorIndex: number;
      if (useAlert && this.rng.float(0, 1) < 0.3) {
        colorIndex = 2; // alert/mutant
      } else {
        colorIndex = i % 2; // alternate primary/secondary
      }

      this.colonies.push({
        cx,
        cy,
        growthRadius: this.rng.float(2, 8), // small initial seed
        growthSpeed: speed,
        colorIndex,
      });
    }
  }

  /** Redistribute dots to new colony positions after sterilization */
  private redistributeDots(): void {
    const posAttr = this.colonyPoints.geometry.getAttribute('position') as THREE.BufferAttribute;
    const colAttr = this.colonyPoints.geometry.getAttribute('color') as THREE.BufferAttribute;
    const posArr = posAttr.array as Float32Array;
    const colArr = colAttr.array as Float32Array;

    const dotsPerColony = Math.floor(this.dotCount / this.colonies.length);
    let dotIdx = 0;

    for (let c = 0; c < this.colonies.length; c++) {
      const colony = this.colonies[c];
      const count = (c === this.colonies.length - 1) ? (this.dotCount - dotIdx) : dotsPerColony;

      for (let d = 0; d < count && dotIdx < this.dotCount; d++) {
        const angle = this.rng.float(0, Math.PI * 2);
        const dist = this.rng.float(0, this.maxColonyRadius * 0.9);

        let px = colony.cx + Math.cos(angle) * dist;
        let py = colony.cy + Math.sin(angle) * dist;

        // Clamp to dish
        const dishDist = Math.sqrt((px - this.dishCX) ** 2 + (py - this.dishCY) ** 2);
        if (dishDist > this.dishRadius * 0.95) {
          const clampAngle = Math.atan2(py - this.dishCY, px - this.dishCX);
          const clampR = this.dishRadius * 0.9 * this.rng.float(0.7, 1.0);
          px = this.dishCX + Math.cos(clampAngle) * clampR;
          py = this.dishCY + Math.sin(clampAngle) * clampR;
        }

        posArr[dotIdx * 3] = px;
        posArr[dotIdx * 3 + 1] = py;
        posArr[dotIdx * 3 + 2] = 1;

        this.dotColonyIndex[dotIdx] = c;
        this.dotDistFromCenter[dotIdx] = Math.sqrt(
          (px - colony.cx) ** 2 + (py - colony.cy) ** 2,
        );

        this.setDotColor(colArr, dotIdx, colony.colorIndex, 1);
        dotIdx++;
      }
    }

    // Re-sort by distance for drawRange
    this.sortDotsByDistance(posArr, colArr);

    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
    this.colonyPoints.geometry.setDrawRange(0, 0);
  }

  /** Trigger sterilization: flash + reset colonies */
  private triggerSterilization(): void {
    this.isFlashing = true;
    this.flashTimer = this.flashDuration;

    // Flash all dots to alert color
    const colAttr = this.colonyPoints.geometry.getAttribute('color') as THREE.BufferAttribute;
    const colArr = colAttr.array as Float32Array;
    const alert = this.palette.alert;
    for (let i = 0; i < this.dotCount; i++) {
      colArr[i * 3] = alert.r;
      colArr[i * 3 + 1] = alert.g;
      colArr[i * 3 + 2] = alert.b;
    }
    colAttr.needsUpdate = true;

    // Show all dots during flash
    this.colonyPoints.geometry.setDrawRange(0, this.dotCount);
  }

  /** Finish sterilization: reseed colonies at new positions */
  private finishSterilization(): void {
    this.isFlashing = false;

    const colonyCount = this.colonies.length;
    const avgSpeed = this.colonies.reduce((sum, c) => sum + c.growthSpeed, 0) / colonyCount;
    const hasAlert = this.colonies.some((c) => c.colorIndex === 2);
    const hasIrregular = this.colonies.some((c, i, arr) =>
      i > 0 && Math.abs(c.growthSpeed - arr[0].growthSpeed) > avgSpeed * 0.2,
    );

    // Determine growth speed based on intensity
    const speed = this.intensityLevel >= 5 ? avgSpeed * 3 : avgSpeed * this.growthMultiplier;

    this.seedColonies(colonyCount, speed, hasIrregular, hasAlert);
    this.redistributeDots();
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);

    // ── Handle sterilization flash ──
    if (this.isFlashing) {
      this.flashTimer -= dt;
      if (this.flashTimer <= 0) {
        this.finishSterilization();
      } else {
        // During flash: bright pulse on all dots
        const flashBrightness = this.flashTimer / this.flashDuration;
        this.colonyPointsMat.opacity = opacity * (0.5 + flashBrightness * 0.5);
        this.dishBorderMat.opacity = opacity * (0.5 + flashBrightness * 0.5);
        this.agarGridMat.opacity = opacity * 0.15;
        return;
      }
    }

    // ── Grow colonies ──
    const effectiveMultiplier = this.growthMultiplier;
    let totalCoverageArea = 0;
    const dishArea = Math.PI * this.dishRadius * this.dishRadius;

    for (const colony of this.colonies) {
      colony.growthRadius += colony.growthSpeed * effectiveMultiplier * dt;
      // Clamp to max radius
      if (colony.growthRadius > this.maxColonyRadius) {
        colony.growthRadius = this.maxColonyRadius;
      }
      totalCoverageArea += Math.PI * colony.growthRadius * colony.growthRadius;
    }

    // Check coverage (approximate, overlaps count double but that's fine for threshold)
    const coverageRatio = Math.min(1, totalCoverageArea / dishArea);
    if (coverageRatio >= this.coverageThreshold) {
      this.triggerSterilization();
      // Apply flash opacity and return early
      this.colonyPointsMat.opacity = opacity;
      this.dishBorderMat.opacity = opacity;
      this.agarGridMat.opacity = opacity * 0.15;
      return;
    }

    // ── Update dot visibility based on colony growth radii ──
    let visibleCount = 0;
    for (let i = 0; i < this.dotCount; i++) {
      const colonyIdx = this.dotColonyIndex[i];
      const colony = this.colonies[colonyIdx];
      if (this.dotDistFromCenter[i] <= colony.growthRadius) {
        visibleCount++;
      } else {
        // Since dots are sorted by distance, once we find one outside,
        // we could break per-colony, but mixed colonies make this tricky.
        // Just count all visible ones.
      }
    }
    this.colonyPoints.geometry.setDrawRange(0, visibleCount);

    // ── Apply opacity to all materials ──
    this.dishBorderMat.opacity = opacity;
    this.agarGridMat.opacity = opacity * 0.15;
    this.colonyPointsMat.opacity = opacity;
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    this.intensityLevel = level;

    if (level === 0) {
      this.growthMultiplier = 1;
      return;
    }

    // Growth rate increases with level
    this.growthMultiplier = 1 + level * 0.4;

    if (level >= 5) {
      // Sterilization flash + explosive regrowth
      this.triggerSterilization();
    }
  }
}
