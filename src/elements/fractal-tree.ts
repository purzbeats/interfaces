import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * L-system fractal tree that grows branch-by-branch with gentle wind sway.
 * Resembles a dendritic analysis display or neural growth simulation —
 * luminous branching structures pulsing on a research terminal.
 */

interface BranchSegment {
  /** Parent index (-1 for root) */
  parent: number;
  /** Base angle relative to parent (before wind) */
  baseAngle: number;
  /** Branch length in pixels */
  length: number;
  /** Depth level (0 = trunk) */
  depth: number;
  /** Growth delay: branches at depth d appear at d * growthStep seconds */
  growthDelay: number;
  /** Whether this is a leaf-level branch */
  isLeaf: boolean;
}

export class FractalTreeElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'fractal-tree',
    meta: { shape: 'rectangular', roles: ['data-display', 'decorative'], moods: ['diagnostic', 'ambient'], sizes: ['needs-medium', 'needs-large'] },
  };
  private linesMesh!: THREE.LineSegments;
  private lineMat!: THREE.LineBasicMaterial;
  private groundLine!: THREE.LineSegments;
  private groundMat!: THREE.LineBasicMaterial;

  private segments: BranchSegment[] = [];
  private maxDepth: number = 0;

  /** Flat arrays: each segment i has start at i*6..i*6+2 and end at i*6+3..i*6+5 */
  private positionBuffer!: Float32Array;
  private colorBuffer!: Float32Array;

  /** Growth / cycle state */
  private growthTime: number = 0;
  private growthStep: number = 0.3;   // seconds per depth level
  private holdTime: number = 0;
  private cyclePhase: 'growing' | 'holding' | 'shedding' = 'growing';
  private holdDuration: number = 2.5;
  private speedMultiplier: number = 1;

  /** Wind */
  private windSpeed: number = 0;
  private windStrength: number = 0;

  /** Cached computed positions for each segment: [startX, startY, endX, endY] */
  private computedPositions!: Float32Array;

  /** Alert rapid-cycle timer */
  private alertTimer: number = 0;

  /** Leaf flash timer (pulse action) */
  private leafFlashTimer: number = 0;

  /** Random angle offsets stored per-segment for variation between growth cycles */
  private angleOffsets!: Float32Array;

  build(): void {
    this.glitchAmount = 5;
    const { x, y, w, h } = this.px;

    this.maxDepth = this.rng.int(8, 10);
    this.windSpeed = this.rng.float(1.2, 2.5);
    this.windStrength = this.rng.float(0.015, 0.035);
    this.holdDuration = this.rng.float(2.0, 3.0);
    this.growthStep = this.rng.float(0.25, 0.35);

    // Generate L-system tree structure
    const startX = x + w / 2;
    const startY = y;  // bottom of region
    const trunkLength = h * this.rng.float(0.18, 0.25);

    this.generateTree(startX, startY, trunkLength);

    // Allocate geometry buffers
    const segCount = this.segments.length;
    this.positionBuffer = new Float32Array(segCount * 6); // 2 vertices * 3 components
    this.colorBuffer = new Float32Array(segCount * 6);
    this.computedPositions = new Float32Array(segCount * 4); // startX, startY, endX, endY
    this.angleOffsets = new Float32Array(segCount);
    for (let i = 0; i < segCount; i++) {
      this.angleOffsets[i] = 0;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positionBuffer, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.colorBuffer, 3));
    geo.setDrawRange(0, 0);

    this.lineMat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0,
    });
    this.linesMesh = new THREE.LineSegments(geo, this.lineMat);
    this.group.add(this.linesMesh);

    // Ground line
    const groundVerts = new Float32Array([
      x + w * 0.1, y, 0,
      x + w * 0.9, y, 0,
    ]);
    const groundGeo = new THREE.BufferGeometry();
    groundGeo.setAttribute('position', new THREE.BufferAttribute(groundVerts, 3));
    this.groundMat = new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    });
    this.groundLine = new THREE.LineSegments(groundGeo, this.groundMat);
    this.group.add(this.groundLine);
  }

  private generateTree(rootX: number, rootY: number, trunkLength: number): void {
    this.segments = [];

    // Root/trunk segment: grows straight up
    this.segments.push({
      parent: -1,
      baseAngle: Math.PI / 2, // straight up
      length: trunkLength,
      depth: 0,
      growthDelay: 0,
      isLeaf: false,
    });

    // Recursive branching via queue
    const queue: number[] = [0]; // indices to branch from

    while (queue.length > 0) {
      const parentIdx = queue.shift()!;
      const parentSeg = this.segments[parentIdx];

      if (parentSeg.depth >= this.maxDepth) continue;

      const nextDepth = parentSeg.depth + 1;
      const isLeaf = nextDepth >= this.maxDepth;

      // Two branches: left and right
      const spreadAngle = this.rng.float(20, 35) * (Math.PI / 180);
      const lengthFactor = this.rng.float(0.65, 0.75);
      const childLength = parentSeg.length * lengthFactor;

      // Sometimes add a third branch (20% chance) for more organic look
      const branchCount = this.rng.chance(0.2) ? 3 : 2;

      for (let b = 0; b < branchCount; b++) {
        let angleOffset: number;
        if (branchCount === 2) {
          angleOffset = b === 0 ? -spreadAngle : spreadAngle;
        } else {
          angleOffset = (b - 1) * spreadAngle * this.rng.float(0.8, 1.2);
        }

        // Slight random variation
        angleOffset += this.rng.float(-0.05, 0.05);

        const idx = this.segments.length;
        this.segments.push({
          parent: parentIdx,
          baseAngle: angleOffset, // relative to parent direction
          length: childLength * this.rng.float(0.9, 1.1),
          depth: nextDepth,
          growthDelay: nextDepth * this.growthStep,
          isLeaf,
        });

        if (!isLeaf) {
          queue.push(idx);
        }

        // Pruning: skip some branches at higher depths for natural asymmetry
        if (nextDepth > 4 && this.rng.chance(0.15)) {
          // Don't queue this branch for further growth (already pushed but mark as leaf)
          this.segments[idx].isLeaf = true;
        }
      }
    }
  }

  /**
   * Recompute all branch positions given current wind state.
   * This walks the tree from root, applying cumulative angles.
   */
  private recomputePositions(time: number, glitchActive: boolean): void {
    const { x, y, w, h } = this.px;
    const rootX = x + w / 2;
    const rootY = y;

    // For each segment, compute absolute start and end positions
    // We need to walk the tree from root.
    // Store cumulative absolute angle and start position per segment.
    const absAngles = new Float32Array(this.segments.length);
    const startXArr = new Float32Array(this.segments.length);
    const startYArr = new Float32Array(this.segments.length);

    for (let i = 0; i < this.segments.length; i++) {
      const seg = this.segments[i];

      if (seg.parent === -1) {
        // Root: starts at bottom center
        startXArr[i] = rootX;
        startYArr[i] = rootY;
        absAngles[i] = seg.baseAngle + this.angleOffsets[i];
      } else {
        // Start where parent ends
        const pIdx = seg.parent * 4;
        startXArr[i] = this.computedPositions[pIdx + 2]; // parent endX
        startYArr[i] = this.computedPositions[pIdx + 3]; // parent endY

        // Absolute angle = parent absolute angle + our relative offset
        const parentAngle = absAngles[seg.parent];
        let relAngle = seg.baseAngle + this.angleOffsets[i];

        // Wind sway: increases with depth
        const windSway = Math.sin(time * this.windSpeed + seg.depth * 0.5 + i * 0.1)
                       * this.windStrength * (seg.depth * 0.7 + 0.3);

        // Glitch: random snap
        if (glitchActive) {
          relAngle += (Math.random() - 0.5) * 1.5;
        }

        absAngles[i] = parentAngle + relAngle + windSway;
      }

      // Compute end position
      const endX = startXArr[i] + Math.cos(absAngles[i]) * seg.length;
      const endY = startYArr[i] + Math.sin(absAngles[i]) * seg.length;

      const idx = i * 4;
      this.computedPositions[idx] = startXArr[i];
      this.computedPositions[idx + 1] = startYArr[i];
      this.computedPositions[idx + 2] = endX;
      this.computedPositions[idx + 3] = endY;
    }

    // Also apply wind to root trunk
    const rootWindSway = Math.sin(time * this.windSpeed) * this.windStrength * 0.2;
    absAngles[0] = this.segments[0].baseAngle + this.angleOffsets[0] + rootWindSway;
    if (glitchActive) {
      absAngles[0] += (Math.random() - 0.5) * 0.5;
    }
    const rootEnd = {
      x: rootX + Math.cos(absAngles[0]) * this.segments[0].length,
      y: rootY + Math.sin(absAngles[0]) * this.segments[0].length,
    };
    this.computedPositions[0] = rootX;
    this.computedPositions[1] = rootY;
    this.computedPositions[2] = rootEnd.x;
    this.computedPositions[3] = rootEnd.y;

    // Recompute children of root since root end changed
    // Actually we need a full second pass for correctness since root changed.
    // More efficient: just do the whole loop again with the corrected root.
    for (let i = 1; i < this.segments.length; i++) {
      const seg = this.segments[i];
      const pIdx = seg.parent * 4;
      startXArr[i] = this.computedPositions[pIdx + 2];
      startYArr[i] = this.computedPositions[pIdx + 3];

      const parentAngle = absAngles[seg.parent];
      let relAngle = seg.baseAngle + this.angleOffsets[i];
      const windSway = Math.sin(time * this.windSpeed + seg.depth * 0.5 + i * 0.1)
                     * this.windStrength * (seg.depth * 0.7 + 0.3);
      if (glitchActive) {
        relAngle += (Math.random() - 0.5) * 1.5;
      }
      absAngles[i] = parentAngle + relAngle + windSway;

      const endX = startXArr[i] + Math.cos(absAngles[i]) * seg.length;
      const endY = startYArr[i] + Math.sin(absAngles[i]) * seg.length;

      const idx = i * 4;
      this.computedPositions[idx] = startXArr[i];
      this.computedPositions[idx + 1] = startYArr[i];
      this.computedPositions[idx + 2] = endX;
      this.computedPositions[idx + 3] = endY;
    }
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);

    const effectiveDt = dt * this.speedMultiplier;

    // Handle alert rapid-cycle
    if (this.alertTimer > 0) {
      this.alertTimer -= dt;
      this.speedMultiplier = 3;
      if (this.alertTimer <= 0) {
        this.speedMultiplier = 1;
      }
    }

    // Leaf flash timer
    if (this.leafFlashTimer > 0) {
      this.leafFlashTimer -= dt;
    }

    // Cycle state machine
    const totalGrowthTime = (this.maxDepth + 1) * this.growthStep;

    switch (this.cyclePhase) {
      case 'growing':
        this.growthTime += effectiveDt;
        if (this.growthTime >= totalGrowthTime) {
          this.growthTime = totalGrowthTime;
          this.cyclePhase = 'holding';
          this.holdTime = 0;
        }
        break;

      case 'holding':
        this.holdTime += effectiveDt;
        if (this.holdTime >= this.holdDuration) {
          this.cyclePhase = 'shedding';
        }
        break;

      case 'shedding':
        this.growthTime -= effectiveDt * 1.5; // shed slightly faster
        if (this.growthTime <= 0) {
          this.growthTime = 0;
          this.cyclePhase = 'growing';
          // Regenerate with new random angle offsets
          this.randomizeAngles();
        }
        break;
    }

    // Recompute positions with wind
    const glitchActive = this.glitchTimer > 0;
    this.recomputePositions(time, glitchActive);

    // Determine visible segment count based on growth time
    let visibleVerts = 0;
    const posAttr = this.linesMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const colAttr = this.linesMesh.geometry.getAttribute('color') as THREE.BufferAttribute;

    const pr = this.palette.primary;
    const sr = this.palette.secondary;
    const dr = this.palette.dim;

    for (let i = 0; i < this.segments.length; i++) {
      const seg = this.segments[i];
      if (seg.growthDelay > this.growthTime) continue;

      // Growth interpolation for the current depth level
      const depthStart = seg.depth * this.growthStep;
      const depthEnd = depthStart + this.growthStep;
      const t = Math.min(1, (this.growthTime - depthStart) / (depthEnd - depthStart));

      const idx = i * 4;
      const sx = this.computedPositions[idx];
      const sy = this.computedPositions[idx + 1];
      // Interpolate end position for growth animation
      const ex = sx + (this.computedPositions[idx + 2] - sx) * t;
      const ey = sy + (this.computedPositions[idx + 3] - sy) * t;

      const vi = visibleVerts * 2;
      posAttr.setXYZ(vi, sx, sy, 0);
      posAttr.setXYZ(vi + 1, ex, ey, 0);

      // Color by depth: trunk=primary, tips=dim, leaf flash=secondary
      const depthRatio = seg.depth / this.maxDepth;
      let r: number, g: number, b: number;

      if (seg.isLeaf && this.leafFlashTimer > 0) {
        // Flash leaves with secondary color
        const flash = Math.min(1, this.leafFlashTimer * 4);
        r = dr.r + (sr.r - dr.r) * flash;
        g = dr.g + (sr.g - dr.g) * flash;
        b = dr.b + (sr.b - dr.b) * flash;
      } else {
        r = pr.r + (dr.r - pr.r) * depthRatio;
        g = pr.g + (dr.g - pr.g) * depthRatio;
        b = pr.b + (dr.b - pr.b) * depthRatio;
      }

      // Start vertex slightly brighter
      colAttr.setXYZ(vi, r, g, b);
      colAttr.setXYZ(vi + 1, r * 0.85, g * 0.85, b * 0.85);

      visibleVerts++;
    }

    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
    this.linesMesh.geometry.setDrawRange(0, visibleVerts * 2);

    this.lineMat.opacity = opacity;
    this.groundMat.opacity = opacity * 0.25;
  }

  private randomizeAngles(): void {
    for (let i = 0; i < this.segments.length; i++) {
      // Small random perturbation to base angles for variety between cycles
      this.angleOffsets[i] = (Math.random() - 0.5) * 0.3;
    }
  }

  onAction(action: string): void {
    super.onAction(action);

    if (action === 'glitch') {
      // Glitch is handled in recomputePositions via glitchTimer
    }

    if (action === 'alert') {
      // Rapid growth cycle at 3x speed
      this.alertTimer = 2.0;
      this.pulseTimer = 2.0;
    }

    if (action === 'pulse') {
      // Flash all leaf-level branches with secondary color
      this.leafFlashTimer = 0.6;
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) { this.speedMultiplier = 1; this.windStrength = 0.015; return; }
    // Graduated wind: gentle breeze to storm (absolute, not cumulative)
    this.windStrength = 0.015 + level * 0.015;
    if (level >= 3) {
      this.leafFlashTimer = 0.3;
      this.speedMultiplier = 1 + level * 0.3;
    }
    if (level >= 5) {
      this.alertTimer = 1.5;
      this.speedMultiplier = 3;
    }
  }
}
