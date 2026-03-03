import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

interface CharBlock {
  baseX: number;
  baseY: number;
  offsetX: number;
  offsetY: number;
  colorIndex: number; // 0=dim, 1=primary, 2=secondary, 3=alert
  flickerTimer: number;
  flickerRate: number;  // flickers per second
  decayTimer: number;   // time until next corruption event
  decayRate: number;    // how frequently this block decays
  visible: boolean;
}

/**
 * Rows of small rectangular "character" blocks that periodically corrupt —
 * flickering, shifting, or changing color like glitched terminal text.
 */
export class DecayTextElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'decay-text',
    meta: {
      shape: 'rectangular',
      roles: ['data-display', 'decorative'],
      moods: ['diagnostic', 'tactical'],
      sizes: ['works-small', 'needs-medium'],
    },
  };

  private blockMesh!: THREE.Points;
  private borderLines!: THREE.LineSegments;

  private blocks: CharBlock[] = [];
  private cols: number = 0;
  private rows: number = 0;

  private variantIndex: number = 0;

  // Wave-of-decay front position (for wave variant)
  private wavePos: number = 0;
  private waveDir: number = 1;
  private waveSpeed: number = 0;

  // Global corruption multiplier (from intensity)
  private corruptionBoost: number = 1;

  build(): void {
    const variant = this.rng.int(0, 3);
    this.variantIndex = variant;
    const { x, y, w, h } = this.px;

    const presets = [
      // 0: slow decay — sparse, leisurely corruption
      { cellW: 7, cellH: 10, baseDecayMin: 1.5, baseDecayMax: 5.0, flickMin: 0.5, flickMax: 2.0, offsetRange: 1.5 },
      // 1: rapid corruption — fast and dense
      { cellW: 6, cellH: 9, baseDecayMin: 0.1, baseDecayMax: 0.8, flickMin: 3.0, flickMax: 12.0, offsetRange: 3.0 },
      // 2: wave of decay — corruption sweeps left→right repeatedly
      { cellW: 7, cellH: 10, baseDecayMin: 2.0, baseDecayMax: 6.0, flickMin: 1.0, flickMax: 4.0, offsetRange: 2.0 },
      // 3: random scatter — unpredictable bursts scattered across rows
      { cellW: 8, cellH: 11, baseDecayMin: 0.3, baseDecayMax: 8.0, flickMin: 0.5, flickMax: 6.0, offsetRange: 2.5 },
    ];
    const p = presets[variant];

    this.cols = Math.max(3, Math.floor(w / p.cellW));
    this.rows = Math.max(2, Math.floor(h / p.cellH));

    const cellW = w / this.cols;
    const cellH = h / this.rows;
    const blockCount = this.cols * this.rows;

    this.wavePos = 0;
    this.waveDir = 1;
    this.waveSpeed = w * 0.15; // pixels per second

    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        const bx = x + col * cellW + cellW * 0.5;
        const by = y + row * cellH + cellH * 0.5;

        this.blocks.push({
          baseX: bx,
          baseY: by,
          offsetX: 0,
          offsetY: 0,
          colorIndex: 0,
          flickerTimer: 0,
          flickerRate: this.rng.float(p.flickMin, p.flickMax),
          decayTimer: this.rng.float(p.baseDecayMin, p.baseDecayMax),
          decayRate: this.rng.float(p.baseDecayMin, p.baseDecayMax),
          visible: true,
        });
      }
    }

    // Points mesh for blocks
    const positions = new Float32Array(blockCount * 3);
    const colors = new Float32Array(blockCount * 3);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    this.blockMesh = new THREE.Points(geo, new THREE.PointsMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0,
      size: Math.max(3, Math.min(cellW, cellH) * 0.65),
      sizeAttenuation: false,
    }));
    this.group.add(this.blockMesh);

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

  private getBlockColor(ci: number): THREE.Color {
    switch (ci) {
      case 0: return this.palette.dim;
      case 1: return this.palette.primary;
      case 2: return this.palette.secondary;
      case 3: return this.palette.alert;
      default: return this.palette.dim;
    }
  }

  private corruptBlock(block: CharBlock, isWave: boolean): void {
    // Randomly change color
    const roll = this.rng.float(0, 1);
    if (roll < 0.4) {
      block.colorIndex = 1; // primary
    } else if (roll < 0.65) {
      block.colorIndex = 0; // dim
    } else if (roll < 0.85) {
      block.colorIndex = 2; // secondary
    } else {
      block.colorIndex = 3; // alert glitch
    }

    // Positional shift
    const range = isWave ? 4.0 : 2.0;
    block.offsetX = this.rng.float(-range, range);
    block.offsetY = this.rng.float(-range * 0.5, range * 0.5);

    // Toggle visibility occasionally
    block.visible = this.rng.chance(0.85);

    // Random flicker burst
    block.flickerTimer = this.rng.float(0.1, 0.5);
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    const { x, w } = this.px;

    // Wave mode: advance wave front
    if (this.variantIndex === 2) {
      this.wavePos += this.waveDir * this.waveSpeed * dt;
      if (this.wavePos > w) { this.wavePos = w; this.waveDir = -1; }
      if (this.wavePos < 0) { this.wavePos = 0; this.waveDir = 1; }
    }

    const pos = this.blockMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const col = this.blockMesh.geometry.getAttribute('color') as THREE.BufferAttribute;

    for (let i = 0; i < this.blocks.length; i++) {
      const block = this.blocks[i];

      // Check wave proximity for wave variant
      const isNearWave = this.variantIndex === 2 &&
        Math.abs((block.baseX - x) - this.wavePos) < this.px.w * 0.06;

      // Update decay timer
      const effectiveRate = block.decayRate / this.corruptionBoost;
      block.decayTimer -= dt;
      if (block.decayTimer <= 0) {
        block.decayTimer = effectiveRate + this.rng.float(-effectiveRate * 0.3, effectiveRate * 0.3);
        this.corruptBlock(block, isNearWave);
      }

      // Near wave — extra corruption
      if (isNearWave && this.rng.chance(dt * 15)) {
        this.corruptBlock(block, true);
      }

      // Flicker timer: block blinks rapidly for a short time
      let visible = block.visible;
      if (block.flickerTimer > 0) {
        block.flickerTimer -= dt;
        visible = block.visible && (Math.sin(time * block.flickerRate * Math.PI * 2) > 0);
      }

      // Slowly drift offsets back to zero
      block.offsetX *= (1 - dt * 2.5);
      block.offsetY *= (1 - dt * 2.5);

      if (!visible) {
        pos.setXYZ(i, -99999, -99999, 0);
        col.setXYZ(i, 0, 0, 0);
      } else {
        pos.setXYZ(i, block.baseX + block.offsetX, block.baseY + block.offsetY, 0);
        const c = this.getBlockColor(block.colorIndex);
        col.setXYZ(i, c.r, c.g, c.b);
      }
    }

    pos.needsUpdate = true;
    col.needsUpdate = true;

    (this.blockMesh.material as THREE.PointsMaterial).opacity = opacity;
    (this.borderLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.2;
  }

  onAction(action: string): void {
    super.onAction(action);

    if (action === 'glitch') {
      // Mass corruption burst — corrupt every block immediately
      for (const block of this.blocks) {
        this.corruptBlock(block, false);
        block.flickerTimer = this.rng.float(0.3, 1.0);
        block.offsetX = this.rng.float(-5, 5);
      }
    }

    if (action === 'alert') {
      // Rapid corruption for a moment
      this.corruptionBoost = 8;
      this.pulseTimer = 2.0;
      setTimeout(() => { this.corruptionBoost = 1; }, 3000);
    }

    if (action === 'pulse') {
      // Short burst of corruption on random blocks
      const count = Math.floor(this.blocks.length * 0.2);
      for (let i = 0; i < count; i++) {
        const idx = this.rng.int(0, this.blocks.length - 1);
        this.corruptBlock(this.blocks[idx], false);
      }
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) {
      this.corruptionBoost = 1;
      return;
    }
    this.corruptionBoost = 1 + level * 0.8;

    // Immediate corruption burst proportional to level
    const frac = level * 0.1;
    for (const block of this.blocks) {
      if (this.rng.chance(frac)) {
        this.corruptBlock(block, false);
      }
    }

    if (level >= 5) {
      // Mass glitch
      for (const block of this.blocks) {
        this.corruptBlock(block, true);
        block.flickerTimer = this.rng.float(0.2, 0.8);
      }
    }
  }
}
