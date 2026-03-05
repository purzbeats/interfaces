import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

interface DFPreset {
  shapeCount: number;
  contourCount: number;
  contourSpacing: number;
  operation: 'union' | 'intersection' | 'subtraction';
}

interface SDFShape {
  type: 'circle' | 'box';
  cx: number;
  cy: number;
  radius: number;
  halfW: number;
  halfH: number;
  vx: number;
  vy: number;
}

/**
 * Signed distance field visualization. Multiple shape primitives (circles, boxes)
 * with CSG operations. Distance contours shown as colored bands.
 * Canvas rendered.
 */
export class DistanceFieldElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'distance-field',
    meta: {
      shape: 'rectangular',
      roles: ['data-display', 'decorative'],
      moods: ['diagnostic', 'ambient'],
      sizes: ['needs-medium', 'needs-large'],
      bandAffinity: 'mid',
    } satisfies ElementMeta,
  };

  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private texture!: THREE.CanvasTexture;
  private mesh!: THREE.Mesh;
  private mat!: THREE.MeshBasicMaterial;

  private shapes: SDFShape[] = [];
  private contourCount = 12;
  private contourSpacing = 10;
  private operation: 'union' | 'intersection' | 'subtraction' = 'union';
  private cw = 0;
  private ch = 0;
  private intensityLevel = 0;
  private renderAccum = 0;

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;

    const variant = this.rng.int(0, 3);
    const presets: DFPreset[] = [
      { shapeCount: 4, contourCount: 12, contourSpacing: 10, operation: 'union' },
      { shapeCount: 6, contourCount: 18, contourSpacing: 6,  operation: 'intersection' },
      { shapeCount: 3, contourCount: 8,  contourSpacing: 15, operation: 'subtraction' },
      { shapeCount: 5, contourCount: 14, contourSpacing: 8,  operation: 'union' },
    ];
    const p = presets[variant];
    this.contourCount = p.contourCount;
    this.contourSpacing = p.contourSpacing;
    this.operation = p.operation;

    const maxRes = 160;
    const resScale = Math.min(1, maxRes / Math.max(w, h));
    this.cw = Math.max(32, Math.floor(w * resScale));
    this.ch = Math.max(32, Math.floor(h * resScale));
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.cw;
    this.canvas.height = this.ch;
    this.ctx = this.get2DContext(this.canvas);
    this.texture = new THREE.CanvasTexture(this.canvas);

    const minDim = Math.min(this.cw, this.ch);
    for (let i = 0; i < p.shapeCount; i++) {
      const isCircle = this.rng.float(0, 1) < 0.5;
      const shape: SDFShape = {
        type: isCircle ? 'circle' : 'box',
        cx: this.rng.float(this.cw * 0.2, this.cw * 0.8),
        cy: this.rng.float(this.ch * 0.2, this.ch * 0.8),
        radius: this.rng.float(minDim * 0.1, minDim * 0.25),
        halfW: this.rng.float(minDim * 0.08, minDim * 0.2),
        halfH: this.rng.float(minDim * 0.06, minDim * 0.18),
        vx: this.rng.float(-15, 15),
        vy: this.rng.float(-15, 15),
      };
      this.shapes.push(shape);
    }

    const planeGeo = new THREE.PlaneGeometry(w, h);
    this.mat = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      opacity: 0,
    });
    this.mesh = new THREE.Mesh(planeGeo, this.mat);
    this.mesh.position.set(x + w / 2, y + h / 2, 0);
    this.group.add(this.mesh);
  }

  private sdfCircle(px: number, py: number, shape: SDFShape): number {
    const dx = px - shape.cx;
    const dy = py - shape.cy;
    return Math.sqrt(dx * dx + dy * dy) - shape.radius;
  }

  private sdfBox(px: number, py: number, shape: SDFShape): number {
    const dx = Math.abs(px - shape.cx) - shape.halfW;
    const dy = Math.abs(py - shape.cy) - shape.halfH;
    const outsideDist = Math.sqrt(Math.max(0, dx) ** 2 + Math.max(0, dy) ** 2);
    const insideDist = Math.min(0, Math.max(dx, dy));
    return outsideDist + insideDist;
  }

  private sdfShape(px: number, py: number, shape: SDFShape): number {
    return shape.type === 'circle'
      ? this.sdfCircle(px, py, shape)
      : this.sdfBox(px, py, shape);
  }

  private combineSDF(px: number, py: number): number {
    if (this.shapes.length === 0) return 1000;
    let result = this.sdfShape(px, py, this.shapes[0]);

    for (let i = 1; i < this.shapes.length; i++) {
      const d = this.sdfShape(px, py, this.shapes[i]);
      switch (this.operation) {
        case 'union':
          result = Math.min(result, d);
          break;
        case 'intersection':
          result = Math.max(result, d);
          break;
        case 'subtraction':
          result = Math.max(result, -d);
          break;
      }
    }
    return result;
  }

  private drawField(): void {
    const ctx = this.ctx;
    const imgData = ctx.createImageData(this.cw, this.ch);
    const data = imgData.data;

    const bg = this.palette.bg;
    const pri = this.palette.primary;
    const sec = this.palette.secondary;
    const dim = this.palette.dim;

    for (let py = 0; py < this.ch; py++) {
      for (let px = 0; px < this.cw; px++) {
        const d = this.combineSDF(px, py);
        const pidx = (py * this.cw + px) * 4;

        // Determine contour band
        const bandVal = Math.abs(d) / this.contourSpacing;
        const band = Math.floor(bandVal);
        const frac = bandVal - band;

        // Inside vs outside coloring
        if (d < 0) {
          // Inside shape: primary tinted
          const depth = Math.min(1, Math.abs(d) / 40);
          data[pidx] = Math.floor((pri.r * 0.6 + sec.r * 0.4 * depth) * 255);
          data[pidx + 1] = Math.floor((pri.g * 0.6 + sec.g * 0.4 * depth) * 255);
          data[pidx + 2] = Math.floor((pri.b * 0.6 + sec.b * 0.4 * depth) * 255);
          data[pidx + 3] = Math.floor((0.4 + depth * 0.4) * 255);
        } else {
          // Outside: colored bands
          const bandAlpha = band < this.contourCount ? (1 - band / this.contourCount) * 0.5 : 0;
          const t = (band % 2 === 0) ? 0.3 : 0.15;
          data[pidx] = Math.floor((bg.r + dim.r * t) * 255);
          data[pidx + 1] = Math.floor((bg.g + dim.g * t) * 255);
          data[pidx + 2] = Math.floor((bg.b + dim.b * t) * 255);
          data[pidx + 3] = Math.floor(bandAlpha * 255);
        }

        // Contour lines at band boundaries
        if (frac < 0.08 || frac > 0.92) {
          const lineAlpha = band < this.contourCount ? (1 - band / this.contourCount) : 0;
          data[pidx] = Math.floor(sec.r * 255);
          data[pidx + 1] = Math.floor(sec.g * 255);
          data[pidx + 2] = Math.floor(sec.b * 255);
          data[pidx + 3] = Math.floor(lineAlpha * 200);
        }

        // Zero contour (surface boundary) — brightest line
        if (Math.abs(d) < 1.5) {
          data[pidx] = Math.floor(pri.r * 255);
          data[pidx + 1] = Math.floor(pri.g * 255);
          data[pidx + 2] = Math.floor(pri.b * 255);
          data[pidx + 3] = 255;
        }
      }
    }

    ctx.putImageData(imgData, 0, 0);
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);
    const speedMul = 1 + this.intensityLevel * 0.3;

    // Animate shapes
    for (const s of this.shapes) {
      s.cx += s.vx * dt * speedMul;
      s.cy += s.vy * dt * speedMul;

      // Bounce
      if (s.cx < 0 || s.cx >= this.cw) { s.vx = -s.vx; s.cx = Math.max(0, Math.min(this.cw - 1, s.cx)); }
      if (s.cy < 0 || s.cy >= this.ch) { s.vy = -s.vy; s.cy = Math.max(0, Math.min(this.ch - 1, s.cy)); }
    }

    this.mat.opacity = opacity;

    this.renderAccum += dt;
    if (this.renderAccum < 0.083) return;
    this.renderAccum = 0;

    this.drawField();
    this.texture.needsUpdate = true;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Randomize shape velocities
      for (const s of this.shapes) {
        s.vx = this.rng.float(-40, 40);
        s.vy = this.rng.float(-40, 40);
      }
      // Cycle operation
      const ops: Array<'union' | 'intersection' | 'subtraction'> = ['union', 'intersection', 'subtraction'];
      this.operation = ops[this.rng.int(0, 2)];
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    this.intensityLevel = level;
  }
}
