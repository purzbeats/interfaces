import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Procedurally generated alien/runic glyphs constructed from line segments.
 * Each glyph is a random arrangement of strokes within a cell grid.
 * Glyphs periodically regenerate with a flicker transition.
 */
export class RuneGlyphElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'rune-glyph',
    meta: { shape: 'rectangular', roles: ['decorative', 'data-display'], moods: ['tactical', 'ambient'], bandAffinity: 'high', sizes: ['works-small', 'needs-medium'] },
  };

  private glyphLines: THREE.LineSegments[] = [];
  private glyphMaterials: THREE.LineBasicMaterial[] = [];
  private borderLines!: THREE.LineSegments;
  private cols: number = 0;
  private rows: number = 0;
  private cellW: number = 0;
  private cellH: number = 0;
  private regenTimer: number = 0;
  private regenInterval: number = 0;
  private flickerTimer: number = 0;
  private flickerDuration: number = 0.3;
  private isFlickering: boolean = false;
  private glyphOpacities: number[] = [];
  private variant: number = 0;
  private scrollOffset: number = 0;
  private scrollSpeed: number = 0;
  /** For scrolling variant: extra row of glyphs off-screen */
  private scrollRows: number = 0;

  build(): void {
    this.variant = this.rng.int(0, 3);
    const presets = [
      { cols: 2, rows: 2, strokesMin: 4, strokesMax: 8, regenMin: 1.5, regenMax: 4.0, scroll: false },
      { cols: 3, rows: 3, strokesMin: 3, strokesMax: 7, regenMin: 0.8, regenMax: 2.5, scroll: false },
      { cols: 1, rows: 1, strokesMin: 8, strokesMax: 14, regenMin: 2.0, regenMax: 5.0, scroll: false },
      { cols: 3, rows: 3, strokesMin: 3, strokesMax: 6, regenMin: 0.4, regenMax: 1.0, scroll: true },
    ];
    const p = presets[this.variant];

    this.glitchAmount = 3;
    this.cols = p.cols;
    this.rows = p.rows;
    this.regenInterval = this.rng.float(p.regenMin, p.regenMax);
    this.scrollSpeed = p.scroll ? this.rng.float(20, 40) : 0;
    this.scrollRows = p.scroll ? this.rows + 1 : this.rows;

    const { x, y, w, h } = this.px;
    this.cellW = w / this.cols;
    this.cellH = h / this.rows;

    const totalGlyphs = this.cols * this.scrollRows;

    for (let gi = 0; gi < totalGlyphs; gi++) {
      const col = gi % this.cols;
      const row = Math.floor(gi / this.cols);
      const gx = x + col * this.cellW;
      const gy = y + row * this.cellH;

      const strokeCount = this.rng.int(p.strokesMin, p.strokesMax);
      const verts = this.buildGlyphStrokes(gx, gy, this.cellW, this.cellH, strokeCount);

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));

      const color = this.rng.chance(0.3) ? this.palette.secondary : this.palette.primary;
      const mat = new THREE.LineBasicMaterial({
        color: new THREE.Color().copy(color),
        transparent: true,
        opacity: 0,
      });

      const lines = new THREE.LineSegments(geo, mat);
      this.glyphLines.push(lines);
      this.glyphMaterials.push(mat);
      this.glyphOpacities.push(this.rng.float(0.5, 1.0));
      this.group.add(lines);
    }

    // Cell dividers
    const divVerts: number[] = [];
    for (let c = 1; c < this.cols; c++) {
      const dx = x + c * this.cellW;
      divVerts.push(dx, y, 0, dx, y + h, 0);
    }
    for (let r = 1; r < this.rows; r++) {
      const dy = y + r * this.cellH;
      divVerts.push(x, dy, 0, x + w, dy, 0);
    }

    if (divVerts.length > 0) {
      const divGeo = new THREE.BufferGeometry();
      divGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(divVerts), 3));
      const divLines = new THREE.LineSegments(divGeo, new THREE.LineBasicMaterial({
        color: this.palette.dim,
        transparent: true,
        opacity: 0,
      }));
      this.group.add(divLines);
      this.glyphLines.push(divLines);
      this.glyphMaterials.push(divLines.material as THREE.LineBasicMaterial);
      this.glyphOpacities.push(0.15);
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

  private buildGlyphStrokes(
    gx: number, gy: number, cw: number, ch: number, strokeCount: number
  ): Float32Array {
    const margin = 0.12;
    const mx = cw * margin;
    const my = ch * margin;
    const iw = cw - mx * 2;
    const ih = ch - my * 2;

    // Anchor points on a small grid within the cell (3x4 grid for organic rune feel)
    const gridCols = 3;
    const gridRows = 4;
    const anchors: Array<[number, number]> = [];
    for (let r = 0; r <= gridRows; r++) {
      for (let c = 0; c <= gridCols; c++) {
        anchors.push([
          gx + mx + (c / gridCols) * iw,
          gy + my + (r / gridRows) * ih,
        ]);
      }
    }

    const verts: number[] = [];
    const usedPairs = new Set<string>();

    for (let s = 0; s < strokeCount; s++) {
      // Pick two distinct anchors that haven't been connected yet
      let attempts = 0;
      while (attempts < 20) {
        const ai = this.rng.int(0, anchors.length - 1);
        const bi = this.rng.int(0, anchors.length - 1);
        if (ai === bi) { attempts++; continue; }
        const key = `${Math.min(ai, bi)}-${Math.max(ai, bi)}`;
        if (usedPairs.has(key)) { attempts++; continue; }
        usedPairs.add(key);
        const [ax, ay] = anchors[ai];
        const [bx, by] = anchors[bi];
        verts.push(ax, ay, 0, bx, by, 0);
        break;
      }
    }

    if (verts.length === 0) {
      // Fallback: simple cross
      verts.push(
        gx + mx, gy + my + ih / 2, 0, gx + mx + iw, gy + my + ih / 2, 0,
        gx + mx + iw / 2, gy + my, 0, gx + mx + iw / 2, gy + my + ih, 0
      );
    }

    return new Float32Array(verts);
  }

  private regenerateGlyph(glyphIndex: number): void {
    const col = glyphIndex % this.cols;
    const row = Math.floor(glyphIndex / this.cols);
    const { x, y } = this.px;
    const gx = x + col * this.cellW;
    // For scrolling, adjust row position relative to scroll
    const gy = y + row * this.cellH;

    const strokeCount = this.rng.int(4, 10);
    const verts = this.buildGlyphStrokes(gx, gy, this.cellW, this.cellH, strokeCount);

    const lines = this.glyphLines[glyphIndex];
    if (!lines) return;
    lines.geometry.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    lines.geometry.attributes.position.needsUpdate = true;

    const useSecondary = this.rng.chance(0.3);
    const color = useSecondary ? this.palette.secondary : this.palette.primary;
    (lines.material as THREE.LineBasicMaterial).color.copy(color);
    this.glyphOpacities[glyphIndex] = this.rng.float(0.5, 1.0);
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    const { y, h } = this.px;

    // Scroll animation
    if (this.scrollSpeed > 0) {
      this.scrollOffset += this.scrollSpeed * dt;
      if (this.scrollOffset >= this.cellH) {
        this.scrollOffset -= this.cellH;
        // Shift all glyph rows down: regenerate top row
        for (let c = 0; c < this.cols; c++) {
          this.regenerateGlyph(c); // top row gets new content
        }
      }
      // Shift glyph line y positions
      const totalGlyphs = this.cols * this.scrollRows;
      for (let gi = 0; gi < totalGlyphs; gi++) {
        const row = Math.floor(gi / this.cols);
        const scrolledY = y + row * this.cellH - this.scrollOffset;
        const clampedY = Math.max(y, Math.min(y + h, scrolledY));
        this.glyphLines[gi].position.y = clampedY - (y + row * this.cellH);
      }
      // Clip via scissor-like fade at edges — handled by opacity fade
    }

    // Periodic regeneration
    this.regenTimer += dt;
    if (this.regenTimer >= this.regenInterval) {
      this.regenTimer = 0;
      this.isFlickering = true;
      this.flickerTimer = 0;
    }

    if (this.isFlickering) {
      this.flickerTimer += dt;
      const fp = this.flickerTimer / this.flickerDuration;
      if (fp >= 1.0) {
        this.isFlickering = false;
        // Regenerate all glyphs
        const totalGlyphs = this.cols * this.rows;
        for (let gi = 0; gi < totalGlyphs; gi++) {
          this.regenerateGlyph(gi);
        }
      }
    }

    // Animate individual glyph brightness
    for (let gi = 0; gi < this.glyphLines.length; gi++) {
      const mat = this.glyphMaterials[gi];
      if (!mat) continue;

      let glyphOpacity = this.glyphOpacities[gi] ?? 0.8;

      if (this.isFlickering) {
        const fp = this.flickerTimer / this.flickerDuration;
        // Strobe effect during regen
        const strobe = Math.sin(fp * Math.PI * 12) > 0 ? 1 : 0;
        glyphOpacity *= strobe;
      } else {
        // Slow breathing per glyph
        const phase = time * 0.8 + gi * 0.4;
        glyphOpacity *= 0.75 + 0.25 * Math.sin(phase);
      }

      mat.opacity = opacity * glyphOpacity;
    }

    (this.borderLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.35;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Immediately scramble all glyphs
      const totalGlyphs = this.cols * this.rows;
      for (let gi = 0; gi < totalGlyphs; gi++) {
        this.regenerateGlyph(gi);
      }
      this.isFlickering = true;
      this.flickerTimer = 0;
    }
    if (action === 'pulse') {
      // Snap all glyphs to secondary color briefly
      for (const mat of this.glyphMaterials) {
        mat.color.copy(this.palette.secondary);
      }
      setTimeout(() => {
        for (let gi = 0; gi < this.glyphMaterials.length; gi++) {
          const useSecondary = this.rng.chance(0.3);
          this.glyphMaterials[gi]?.color.copy(useSecondary ? this.palette.secondary : this.palette.primary);
        }
      }, 400);
    }
    if (action === 'alert') {
      for (const mat of this.glyphMaterials) {
        mat.color.copy(this.palette.alert);
      }
      this.regenInterval = 0.2;
      setTimeout(() => {
        this.regenInterval = this.rng.float(1.0, 3.0);
        for (let gi = 0; gi < this.glyphMaterials.length; gi++) {
          const useSecondary = this.rng.chance(0.3);
          this.glyphMaterials[gi]?.color.copy(useSecondary ? this.palette.secondary : this.palette.primary);
        }
      }, 3000);
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) {
      this.regenInterval = this.rng.float(1.5, 4.0);
      return;
    }
    // Higher intensity = faster regen
    this.regenInterval = Math.max(0.15, this.regenInterval * (1 - level * 0.15));
    if (level >= 4) {
      this.isFlickering = true;
      this.flickerTimer = 0;
    }
  }
}
