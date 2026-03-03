import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

interface IsoBlock {
  col: number;
  row: number;
  height: number;      // current visual height in pixels
  targetHeight: number; // height we're animating toward
  baseHeight: number;   // rest height
  animSpeed: number;    // units/sec for height animation
  phase: number;        // phase offset for wave animations
  faceTop: THREE.Mesh;
  faceLeft: THREE.Mesh;
  faceRight: THREE.Mesh;
}

/**
 * Isometric/pseudo-3D block stacks arranged in a grid.
 * Parallelogram shapes simulate the top and two visible faces of cubes.
 * Blocks animate their height up/down with various pattern variants.
 */
export class IsoBlocksElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'iso-blocks',
    meta: {
      shape: 'rectangular',
      roles: ['data-display', 'decorative'],
      moods: ['tactical', 'diagnostic', 'ambient'],
      sizes: ['needs-medium', 'needs-large'],
      bandAffinity: 'mid',
    },
  };

  private blocks: IsoBlock[] = [];
  private borderLines!: THREE.LineSegments;

  private gridCols: number = 0;
  private gridRows: number = 0;
  private cellSize: number = 0;
  private blockW: number = 0;
  private blockH: number = 0; // face height (before projection)
  private isoOriginX: number = 0;
  private isoOriginY: number = 0;
  private variantIndex: number = 0;
  private waveTime: number = 0;
  private waveSpeed: number = 0;
  private maxBlockHeight: number = 0;

  private alertMode: boolean = false;

  build(): void {
    const variant = this.rng.int(0, 3);
    this.variantIndex = variant;
    const { x, y, w, h } = this.px;

    const presets = [
      // 0: staircase — blocks increment left to right
      { cols: 8, rows: 4, cellFrac: 0.09, waveSpd: 0, heightMul: 1.0 },
      // 1: pyramid — tallest in center, shorter outward
      { cols: 7, rows: 5, cellFrac: 0.10, waveSpd: 0, heightMul: 1.0 },
      // 2: random heights — each block independently randomized
      { cols: 9, rows: 4, cellFrac: 0.09, waveSpd: 0.8, heightMul: 0.9 },
      // 3: wave motion — sinusoidal traveling wave
      { cols: 10, rows: 4, cellFrac: 0.08, waveSpd: 2.5, heightMul: 0.8 },
    ];
    const p = presets[variant];

    this.gridCols = p.cols;
    this.gridRows = p.rows;
    this.waveSpeed = p.waveSpd;

    // In isometric projection: each cell maps to a diamond on screen.
    // cellSize = width of one cell's isometric footprint.
    this.cellSize = Math.min(w / (this.gridCols + this.gridRows * 0.5), h * 0.35) * p.cellFrac * 12;
    this.blockW = this.cellSize;
    this.blockH = this.cellSize * 0.5; // face height
    this.maxBlockHeight = this.cellSize * p.heightMul * 1.8;

    // Isometric grid origin: center the grid
    const gridPixW = (this.gridCols + this.gridRows) * this.cellSize * 0.5;
    const gridPixH = (this.gridCols + this.gridRows) * this.blockH * 0.5 + this.maxBlockHeight;
    this.isoOriginX = x + (w - gridPixW) * 0.5 + gridPixW * 0.5;
    this.isoOriginY = y + h - (h - gridPixH) * 0.3 - this.blockH;

    // Build blocks
    for (let row = 0; row < this.gridRows; row++) {
      for (let col = 0; col < this.gridCols; col++) {
        const baseH = this.computeBaseHeight(col, row, variant) * this.maxBlockHeight;

        const block: IsoBlock = {
          col,
          row,
          height: baseH,
          targetHeight: baseH,
          baseHeight: baseH,
          animSpeed: this.rng.float(40, 90),
          phase: (col + row * 0.7) * 0.8 + this.rng.float(0, Math.PI * 2),
          faceTop: null as unknown as THREE.Mesh,
          faceLeft: null as unknown as THREE.Mesh,
          faceRight: null as unknown as THREE.Mesh,
        };

        // Create the three faces as PlaneGeometry-based meshes with custom shapes
        const { faceTop, faceLeft, faceRight } = this.createBlockFaces(block);
        block.faceTop = faceTop;
        block.faceLeft = faceLeft;
        block.faceRight = faceRight;

        this.group.add(faceTop, faceLeft, faceRight);
        this.blocks.push(block);
      }
    }

    // Border
    const bv = new Float32Array([
      x, y, 0, x + w, y, 0,
      x + w, y, 0, x + w, y + h, 0,
      x + w, y + h, 0, x, y + h, 0,
      x, y + h, 0, x, y, 0,
    ]);
    const borderGeo = new THREE.BufferGeometry();
    borderGeo.setAttribute('position', new THREE.BufferAttribute(bv, 3));
    this.borderLines = new THREE.LineSegments(borderGeo, new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.borderLines);
  }

  /** Returns a 0..1 normalized height for the given block position based on variant. */
  private computeBaseHeight(col: number, row: number, variant: number): number {
    const colFrac = col / Math.max(1, this.gridCols - 1);
    const rowFrac = row / Math.max(1, this.gridRows - 1);
    switch (variant) {
      case 0: // staircase: step up along col axis
        return 0.15 + colFrac * 0.8 + this.rng.float(0, 0.08);
      case 1: { // pyramid: distance from center
        const dc = Math.abs(colFrac - 0.5) * 2; // 0 at center, 1 at edge
        const dr = Math.abs(rowFrac - 0.5) * 2;
        return Math.max(0.1, 1.0 - (dc + dr) * 0.55 + this.rng.float(-0.05, 0.05));
      }
      case 2: // random heights
        return 0.1 + this.rng.float(0, 0.9);
      case 3: // wave — initial heights based on col offset
        return 0.3 + Math.sin(colFrac * Math.PI * 1.5) * 0.4 + 0.3;
      default:
        return 0.5;
    }
  }

  /**
   * Convert grid (col, row) to isometric screen position (top of the block base).
   * ISO projection: x' = (col - row) * halfCellW, y' = (col + row) * halfCellH
   */
  private isoProject(col: number, row: number): { sx: number; sy: number } {
    const halfW = this.cellSize * 0.5;
    const halfH = this.blockH * 0.5;
    return {
      sx: this.isoOriginX + (col - row) * halfW,
      sy: this.isoOriginY - (col + row) * halfH,
    };
  }

  /** Build parallelogram meshes for top face, left face, right face of a block. */
  private createBlockFaces(block: IsoBlock): {
    faceTop: THREE.Mesh;
    faceLeft: THREE.Mesh;
    faceRight: THREE.Mesh;
  } {
    const cW = this.cellSize * 0.5; // half width step
    const cH = this.blockH * 0.5;  // half height step (iso)

    // Top face: rhombus shape
    // Vertices: center-top, right, center-bottom, left
    const topGeo = new THREE.BufferGeometry();
    const topVerts = new Float32Array(4 * 3); // 4 corners
    topGeo.setAttribute('position', new THREE.BufferAttribute(topVerts, 3));
    topGeo.setIndex([0, 1, 2, 0, 2, 3]);
    const topMat = new THREE.MeshBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
    });
    const faceTop = new THREE.Mesh(topGeo, topMat);
    this.group.add(faceTop);

    // Left face: parallelogram (col side)
    const leftGeo = new THREE.BufferGeometry();
    const leftVerts = new Float32Array(4 * 3);
    leftGeo.setAttribute('position', new THREE.BufferAttribute(leftVerts, 3));
    leftGeo.setIndex([0, 1, 2, 0, 2, 3]);
    const leftMat = new THREE.MeshBasicMaterial({
      color: this.palette.secondary,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
    });
    const faceLeft = new THREE.Mesh(leftGeo, leftMat);
    this.group.add(faceLeft);

    // Right face: parallelogram (row side)
    const rightGeo = new THREE.BufferGeometry();
    const rightVerts = new Float32Array(4 * 3);
    rightGeo.setAttribute('position', new THREE.BufferAttribute(rightVerts, 3));
    rightGeo.setIndex([0, 1, 2, 0, 2, 3]);
    const rightMat = new THREE.MeshBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
    });
    const faceRight = new THREE.Mesh(rightGeo, rightMat);
    this.group.add(faceRight);

    return { faceTop, faceLeft, faceRight };
  }

  /** Update vertex positions for all three faces of a block given its current height. */
  private updateBlockGeometry(block: IsoBlock): void {
    const { sx, sy } = this.isoProject(block.col, block.row);
    const cW = this.cellSize * 0.5;
    const cH = this.blockH * 0.5;
    const bh = block.height;

    // Top face rhombus (at sy - bh above base):
    // top = (sx, sy - bh), right = (sx + cW, sy - bh + cH)
    // bottom = (sx, sy - bh + cH * 2), left = (sx - cW, sy - bh + cH)
    const topPos = block.faceTop.geometry.getAttribute('position') as THREE.BufferAttribute;
    topPos.setXYZ(0, sx, sy - bh, 0.3);              // top
    topPos.setXYZ(1, sx + cW, sy - bh + cH, 0.3);    // right
    topPos.setXYZ(2, sx, sy - bh + cH * 2, 0.3);     // bottom
    topPos.setXYZ(3, sx - cW, sy - bh + cH, 0.3);    // left
    topPos.needsUpdate = true;
    block.faceTop.geometry.computeBoundingSphere();

    // Left face: from top-left to bottom-left
    // top-left: (sx - cW, sy - bh + cH)
    // top-right: (sx, sy - bh + cH * 2)  (the bottom of top face)
    // bottom-right: (sx, sy + cH * 2)    (base level)
    // bottom-left: (sx - cW, sy + cH)
    const leftPos = block.faceLeft.geometry.getAttribute('position') as THREE.BufferAttribute;
    leftPos.setXYZ(0, sx - cW, sy - bh + cH, 0.2);
    leftPos.setXYZ(1, sx, sy - bh + cH * 2, 0.2);
    leftPos.setXYZ(2, sx, sy + cH * 2, 0.2);
    leftPos.setXYZ(3, sx - cW, sy + cH, 0.2);
    leftPos.needsUpdate = true;
    block.faceLeft.geometry.computeBoundingSphere();

    // Right face: from top-right to bottom-right
    // top-left: (sx, sy - bh + cH * 2)
    // top-right: (sx + cW, sy - bh + cH)
    // bottom-right: (sx + cW, sy + cH)
    // bottom-left: (sx, sy + cH * 2)
    const rightPos = block.faceRight.geometry.getAttribute('position') as THREE.BufferAttribute;
    rightPos.setXYZ(0, sx, sy - bh + cH * 2, 0.1);
    rightPos.setXYZ(1, sx + cW, sy - bh + cH, 0.1);
    rightPos.setXYZ(2, sx + cW, sy + cH, 0.1);
    rightPos.setXYZ(3, sx, sy + cH * 2, 0.1);
    rightPos.needsUpdate = true;
    block.faceRight.geometry.computeBoundingSphere();
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    this.waveTime += dt;

    for (const block of this.blocks) {
      // Update target height based on variant animation
      switch (this.variantIndex) {
        case 0: { // staircase: subtle breathing per column
          const t = Math.sin(time * 0.8 + block.col * 0.4) * 0.08 + 1.0;
          block.targetHeight = block.baseHeight * t;
          break;
        }
        case 1: { // pyramid: ripple from center
          const centerCol = (this.gridCols - 1) * 0.5;
          const centerRow = (this.gridRows - 1) * 0.5;
          const dist = Math.sqrt((block.col - centerCol) ** 2 + (block.row - centerRow) ** 2);
          const wave = Math.sin(dist * 0.9 - time * 1.8) * 0.15 + 1.0;
          block.targetHeight = block.baseHeight * wave;
          break;
        }
        case 2: { // random heights: each block oscillates independently
          const wave = Math.sin(time * (0.5 + block.phase * 0.1) + block.phase) * 0.3 + 1.0;
          block.targetHeight = block.baseHeight * wave;
          break;
        }
        case 3: { // wave motion: sinusoidal traveling wave
          const phase = block.col * 0.7 + block.row * 0.4;
          const wave = Math.sin(phase - this.waveTime * this.waveSpeed) * 0.5 + 0.5;
          block.targetHeight = (0.1 + wave * 0.9) * this.maxBlockHeight;
          break;
        }
      }

      if (this.alertMode) {
        block.targetHeight = block.baseHeight * (1.4 + Math.sin(time * 8 + block.phase) * 0.3);
      }

      // Smooth height toward target
      const diff = block.targetHeight - block.height;
      const step = block.animSpeed * dt;
      if (Math.abs(diff) < step) {
        block.height = block.targetHeight;
      } else {
        block.height += Math.sign(diff) * step;
      }

      // Update geometry
      this.updateBlockGeometry(block);

      // Brightness based on height fraction
      const heightFrac = Math.max(0, Math.min(1, block.height / this.maxBlockHeight));
      const bright = 0.3 + heightFrac * 0.7;

      // Top face: primary color
      const topMat = block.faceTop.material as THREE.MeshBasicMaterial;
      if (this.alertMode) {
        topMat.color.lerpColors(this.palette.primary, this.palette.alert, heightFrac);
      } else {
        topMat.color.lerpColors(this.palette.dim, this.palette.primary, heightFrac);
      }
      topMat.opacity = opacity * (0.6 + heightFrac * 0.4);

      // Left face: secondary color, slightly dimmer
      const leftMat = block.faceLeft.material as THREE.MeshBasicMaterial;
      leftMat.color.lerpColors(this.palette.bg, this.palette.secondary, heightFrac * 0.8);
      leftMat.opacity = opacity * (0.5 + heightFrac * 0.35);

      // Right face: dim color, darkest
      const rightMat = block.faceRight.material as THREE.MeshBasicMaterial;
      rightMat.color.lerpColors(this.palette.bg, this.palette.dim, heightFrac * 0.6);
      rightMat.opacity = opacity * (0.4 + heightFrac * 0.3);
    }

    (this.borderLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.15;
  }

  onAction(action: string): void {
    super.onAction(action);

    if (action === 'glitch') {
      // Randomize all block heights suddenly
      for (const block of this.blocks) {
        block.height = this.rng.float(0.05, 1.0) * this.maxBlockHeight;
        block.animSpeed = this.rng.float(80, 200); // fast reset
        setTimeout(() => { block.animSpeed = this.rng.float(40, 90); }, 600);
      }
    }

    if (action === 'alert') {
      this.alertMode = true;
      this.pulseTimer = 2.0;
      setTimeout(() => { this.alertMode = false; }, 3000);
    }

    if (action === 'pulse') {
      // Ripple outward from center
      for (const block of this.blocks) {
        const centerCol = (this.gridCols - 1) * 0.5;
        const centerRow = (this.gridRows - 1) * 0.5;
        const dist = Math.sqrt((block.col - centerCol) ** 2 + (block.row - centerRow) ** 2);
        setTimeout(() => {
          block.targetHeight = this.maxBlockHeight * 0.9;
        }, dist * 60);
      }
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) {
      this.alertMode = false;
      return;
    }

    // Raise all blocks proportional to level
    const heightBoost = level / 5;
    for (const block of this.blocks) {
      block.targetHeight = block.baseHeight * (1 + heightBoost * 0.6);
    }

    if (level >= 4) {
      this.alertMode = true;
    }
    if (level >= 5) {
      // Slam all to max height then let them settle
      for (const block of this.blocks) {
        block.targetHeight = this.maxBlockHeight;
        block.animSpeed = 200;
      }
      setTimeout(() => {
        this.alertMode = false;
        for (const block of this.blocks) {
          block.animSpeed = this.rng.float(40, 90);
        }
      }, 1500);
    }
  }
}
