import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Ticker tape — abstract scrolling horizontal "text" made from small rectangles
 * representing characters. Continuously scrolls left like a stock ticker.
 * Variants: single line, double line, variable speed with bursts, separator dots.
 */
export class TickerTapeElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'ticker-tape',
    meta: {
      shape: 'linear',
      roles: ['data-display', 'decorative'],
      moods: ['diagnostic', 'tactical'],
      bandAffinity: 'mid',
      sizes: ['works-small', 'needs-medium'],
    },
  };

  private rows: Array<{
    blocks: THREE.Mesh[];
    pattern: number[];    // width multiplier per "character"
    isAccent: boolean[];  // whether this block is a separator/highlight
    scrollOffset: number;
    speed: number;
    y: number;
    blockH: number;
    blockBaseW: number;
    gap: number;
    totalWidth: number;
  }> = [];

  private separatorDots: THREE.Mesh[] = [];
  private borderLines!: THREE.LineSegments;
  private variant: number = 0;
  private blockCount: number = 0;
  private hasSeparatorDots: boolean = false;
  private speedModTimer: number = 0;
  private speedModInterval: number = 0;
  private speedBurst: number = 1;
  private speedBurstTarget: number = 1;

  build(): void {
    this.variant = this.rng.int(0, 3);
    const { x, y, w, h } = this.px;

    const presets = [
      // Variant 0: Single line, uniform blocks, steady scroll
      { rowCount: 1, speedRange: [40, 80] as const, blockCountRange: [20, 40] as const, hasDots: false, variableSpeed: false, blockHFrac: 0.5 },
      // Variant 1: Double line, alternating block sizes
      { rowCount: 2, speedRange: [30, 60] as const, blockCountRange: [15, 30] as const, hasDots: false, variableSpeed: false, blockHFrac: 0.35 },
      // Variant 2: Single line, variable speed bursts
      { rowCount: 1, speedRange: [20, 120] as const, blockCountRange: [25, 45] as const, hasDots: false, variableSpeed: true, blockHFrac: 0.55 },
      // Variant 3: Double line with separator dots between word-groups
      { rowCount: 2, speedRange: [35, 65] as const, blockCountRange: [18, 35] as const, hasDots: true, variableSpeed: false, blockHFrac: 0.3 },
    ];

    const p = presets[this.variant];
    this.hasSeparatorDots = p.hasDots;
    this.speedModInterval = this.rng.float(1.5, 4.0);
    this.blockCount = this.rng.int(p.blockCountRange[0], p.blockCountRange[1]);

    const rowHeight = h / p.rowCount;
    const blockH = rowHeight * p.blockHFrac;
    const gap = Math.max(2, rowHeight * 0.08);
    const blockBaseW = Math.max(3, blockH * this.rng.float(0.5, 1.2));

    for (let ri = 0; ri < p.rowCount; ri++) {
      const rowY = y + rowHeight * ri + rowHeight / 2;
      const rowSpeed = this.rng.float(p.speedRange[0], p.speedRange[1]) * (ri === 1 ? 0.7 : 1);
      const isSecondRow = ri === 1;

      // Build a repeating pattern of block widths (simulates word lengths)
      const pattern: number[] = [];
      const isAccent: boolean[] = [];

      // Generate "words" (groups of blocks) separated by gaps
      let i = 0;
      while (i < this.blockCount) {
        // Word: 2-6 blocks
        const wordLen = this.rng.int(2, 6);
        for (let j = 0; j < wordLen && i < this.blockCount; j++, i++) {
          // Width varies: narrow 0.6x, normal 1x, wide 1.4x
          const wMult = j === 0 ? 1.2 : this.rng.float(0.5, 1.3);
          pattern.push(wMult);
          isAccent.push(false);
        }
        // Separator — wider gap block (accent color, thin)
        if (i < this.blockCount) {
          pattern.push(0.3);
          isAccent.push(true);
          i++;
        }
      }

      // Compute total pattern width
      let totalWidth = 0;
      for (const wm of pattern) {
        totalWidth += blockBaseW * wm + gap;
      }

      // Create block meshes — we use a pool that tiles across 2x the visible width
      const blocks: THREE.Mesh[] = [];
      const tileCount = Math.ceil((w * 2) / totalWidth) + 1;

      for (let tile = 0; tile < tileCount; tile++) {
        let cx = x + tile * totalWidth;
        for (let bi = 0; bi < pattern.length; bi++) {
          const bw = blockBaseW * pattern[bi];
          const accent = isAccent[bi];
          const bh = accent ? blockH * 0.3 : blockH * this.rng.float(0.7, 1.0);
          const geo = new THREE.PlaneGeometry(bw, bh);
          const mat = new THREE.MeshBasicMaterial({
            color: accent
              ? this.palette.dim
              : (isSecondRow ? this.palette.secondary : this.palette.primary),
            transparent: true,
            opacity: 0,
          });
          const mesh = new THREE.Mesh(geo, mat);
          mesh.position.set(cx + bw / 2, rowY, 1);
          this.group.add(mesh);
          blocks.push(mesh);
          cx += bw + gap;
        }
      }

      this.rows.push({
        blocks,
        pattern,
        isAccent,
        scrollOffset: this.rng.float(0, totalWidth),
        speed: rowSpeed,
        y: rowY,
        blockH,
        blockBaseW,
        gap,
        totalWidth,
      });
    }

    // Separator dots (variant 3)
    if (this.hasSeparatorDots) {
      const dotCount = Math.floor(w / 16);
      const dotY = y + h / 2;
      for (let di = 0; di < dotCount; di++) {
        const geo = new THREE.PlaneGeometry(3, 3);
        const mat = new THREE.MeshBasicMaterial({
          color: this.palette.dim,
          transparent: true,
          opacity: 0,
        });
        const dot = new THREE.Mesh(geo, mat);
        dot.position.set(x + (di + 0.5) * (w / dotCount), dotY, 0.5);
        this.separatorDots.push(dot);
        this.group.add(dot);
      }
    }

    // Border
    const bv = new Float32Array([
      x, y, 0, x + w, y, 0,
      x + w, y, 0, x + w, y + h, 0,
      x + w, y + h, 0, x, y + h, 0,
      x, y + h, 0, x, y, 0,
    ]);
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.BufferAttribute(bv, 3));
    this.borderLines = new THREE.LineSegments(bg, new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.borderLines);
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    const { x, w } = this.px;

    // Variable speed burst logic (variant 2)
    if (this.variant === 2) {
      this.speedModTimer += dt;
      if (this.speedModTimer >= this.speedModInterval) {
        this.speedModTimer = 0;
        this.speedModInterval = this.rng.float(1.5, 4.0);
        this.speedBurstTarget = this.rng.chance(0.3) ? this.rng.float(2.5, 5.0) : this.rng.float(0.3, 1.2);
      }
      this.speedBurst += (this.speedBurstTarget - this.speedBurst) * dt * 4;
    }

    for (const row of this.rows) {
      // Advance scroll offset
      row.scrollOffset += row.speed * this.speedBurst * dt;
      if (row.scrollOffset >= row.totalWidth) {
        row.scrollOffset -= row.totalWidth;
      }

      // Reposition all blocks based on scroll
      let blockIndex = 0;
      const tileCount = Math.ceil((w * 2) / row.totalWidth) + 1;
      for (let tile = 0; tile < tileCount; tile++) {
        let cx = x + tile * row.totalWidth - row.scrollOffset;
        for (let bi = 0; bi < row.pattern.length; bi++, blockIndex++) {
          if (blockIndex >= row.blocks.length) break;
          const bw = row.blockBaseW * row.pattern[bi];
          const block = row.blocks[blockIndex];
          const screenX = cx + bw / 2;
          block.position.x = screenX;

          // Compute opacity — fade in/out near edges
          const relX = (screenX - x) / w;
          const edgeFade = Math.min(1, Math.min(relX * 6, (1 - relX) * 6));
          const visible = screenX + bw > x && screenX - bw < x + w;
          const blockMat = block.material as THREE.MeshBasicMaterial;

          if (visible) {
            // Subtle flicker per block
            const flicker = 0.85 + 0.15 * Math.sin(time * 8 + bi * 1.37 + tile * 0.91);
            blockMat.opacity = opacity * edgeFade * flicker *
              (row.isAccent[bi] ? 0.4 : 0.7);
          } else {
            blockMat.opacity = 0;
          }

          cx += bw + row.gap;
        }
        if (blockIndex >= row.blocks.length) break;
      }
    }

    // Separator dots breathe
    for (let di = 0; di < this.separatorDots.length; di++) {
      const dot = this.separatorDots[di];
      const wave = 0.5 + 0.5 * Math.sin(time * 2 + di * 0.5);
      (dot.material as THREE.MeshBasicMaterial).opacity = opacity * 0.25 * wave;
    }

    (this.borderLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.2;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'pulse') {
      this.speedBurstTarget = 4.0;
      setTimeout(() => { this.speedBurstTarget = 1.0; }, 500);
    }
    if (action === 'glitch') {
      for (const row of this.rows) {
        row.scrollOffset = this.rng.float(0, row.totalWidth);
        row.speed *= this.rng.float(0.3, 3.0);
      }
    }
    if (action === 'alert') {
      this.speedBurstTarget = 6.0;
      for (const row of this.rows) {
        for (let bi = 0; bi < row.blocks.length; bi++) {
          if (!row.isAccent[bi % row.pattern.length]) {
            (row.blocks[bi].material as THREE.MeshBasicMaterial).color.copy(this.palette.alert);
          }
        }
      }
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) {
      this.speedBurstTarget = 1.0;
      return;
    }
    this.speedBurstTarget = 1 + level * 0.5;
  }
}
