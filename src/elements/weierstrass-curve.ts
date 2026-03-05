import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Weierstrass function — everywhere continuous, nowhere differentiable.
 * Sum of a^n * cos(b^n * pi * x). Zoom in to show self-similar roughness
 * at all scales. Line geometry.
 */
export class WeierstrassCurveElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'weierstrass-curve',
    meta: {
      shape: 'rectangular',
      roles: ['data-display', 'decorative'],
      moods: ['diagnostic', 'ambient'],
      bandAffinity: 'high',
      sizes: ['works-small', 'needs-medium', 'needs-large'],
    },
  };

  private curveLine!: THREE.Line;
  private zoomLine!: THREE.Line;
  private axisLines!: THREE.LineSegments;
  private numPoints: number = 400;
  private paramA: number = 0.5;
  private paramB: number = 7;
  private terms: number = 12;
  private zoomSpeed: number = 0.15;
  private zoomCenter: number = 0;
  private ox: number = 0;
  private oy: number = 0;
  private plotW: number = 0;
  private plotH: number = 0;

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;

    const variant = this.rng.int(0, 3);
    const presets = [
      { a: 0.5, b: 7, terms: 12, numPoints: 400, zoomSpeed: 0.15 },
      { a: 0.6, b: 5, terms: 15, numPoints: 500, zoomSpeed: 0.12 },
      { a: 0.4, b: 9, terms: 10, numPoints: 350, zoomSpeed: 0.20 },
      { a: 0.7, b: 3, terms: 20, numPoints: 600, zoomSpeed: 0.10 },
    ];
    const p = presets[variant];
    this.paramA = p.a;
    this.paramB = p.b;
    this.terms = p.terms;
    this.numPoints = p.numPoints;
    this.zoomSpeed = p.zoomSpeed;
    this.zoomCenter = this.rng.float(-1, 1);

    const padX = w * 0.06;
    const padY = h * 0.08;
    this.ox = x + padX;
    this.oy = y + padY;
    this.plotW = w - padX * 2;
    this.plotH = (h - padY * 2) * 0.45;

    // Main curve (top half)
    const mainPos = new Float32Array(this.numPoints * 3);
    for (let i = 0; i < this.numPoints; i++) {
      mainPos[i * 3] = this.ox;
      mainPos[i * 3 + 1] = this.oy + this.plotH / 2;
      mainPos[i * 3 + 2] = 0;
    }
    const mainGeo = new THREE.BufferGeometry();
    mainGeo.setAttribute('position', new THREE.BufferAttribute(mainPos, 3));
    this.curveLine = new THREE.Line(mainGeo, new THREE.LineBasicMaterial({
      color: this.palette.primary, transparent: true, opacity: 0,
    }));
    this.group.add(this.curveLine);

    // Zoomed curve (bottom half)
    const zoomPos = new Float32Array(this.numPoints * 3);
    for (let i = 0; i < this.numPoints; i++) {
      zoomPos[i * 3] = this.ox;
      zoomPos[i * 3 + 1] = this.oy + this.plotH * 1.5;
      zoomPos[i * 3 + 2] = 0;
    }
    const zoomGeo = new THREE.BufferGeometry();
    zoomGeo.setAttribute('position', new THREE.BufferAttribute(zoomPos, 3));
    this.zoomLine = new THREE.Line(zoomGeo, new THREE.LineBasicMaterial({
      color: this.palette.secondary, transparent: true, opacity: 0,
    }));
    this.group.add(this.zoomLine);

    // Axis lines (two horizontal separators)
    const axisPos = new Float32Array(12);
    axisPos[0] = this.ox; axisPos[1] = this.oy + this.plotH; axisPos[2] = 0;
    axisPos[3] = this.ox + this.plotW; axisPos[4] = this.oy + this.plotH; axisPos[5] = 0;
    axisPos[6] = this.ox; axisPos[7] = this.oy + this.plotH * 2; axisPos[8] = 0;
    axisPos[9] = this.ox + this.plotW; axisPos[10] = this.oy + this.plotH * 2; axisPos[11] = 0;
    const axisGeo = new THREE.BufferGeometry();
    axisGeo.setAttribute('position', new THREE.BufferAttribute(axisPos, 3));
    this.axisLines = new THREE.LineSegments(axisGeo, new THREE.LineBasicMaterial({
      color: this.palette.dim, transparent: true, opacity: 0,
    }));
    this.group.add(this.axisLines);
  }

  /** Evaluate Weierstrass function at point x */
  private weierstrass(xVal: number): number {
    let sum = 0;
    for (let n = 0; n < this.terms; n++) {
      const an = Math.pow(this.paramA, n);
      const bn = Math.pow(this.paramB, n);
      sum += an * Math.cos(bn * Math.PI * xVal);
    }
    return sum;
  }

  /** Compute min/max of function over a range for normalization */
  private sampleRange(xMin: number, xMax: number): [number, number] {
    let yMin = Infinity, yMax = -Infinity;
    const steps = 100;
    for (let i = 0; i <= steps; i++) {
      const xVal = xMin + (xMax - xMin) * (i / steps);
      const yVal = this.weierstrass(xVal);
      if (yVal < yMin) yMin = yVal;
      if (yVal > yMax) yMax = yVal;
    }
    return [yMin, yMax];
  }

  private plotCurve(
    attr: THREE.BufferAttribute,
    xMin: number, xMax: number,
    baseY: number, height: number,
  ): void {
    const [yMin, yMax] = this.sampleRange(xMin, xMax);
    const yRange = yMax - yMin || 1;
    for (let i = 0; i < this.numPoints; i++) {
      const t = i / (this.numPoints - 1);
      const xVal = xMin + (xMax - xMin) * t;
      const yVal = this.weierstrass(xVal);
      const ny = (yVal - yMin) / yRange;
      attr.setXYZ(i,
        this.ox + t * this.plotW,
        baseY + (1 - ny) * height,
        0,
      );
    }
    attr.needsUpdate = true;
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);

    // Main curve: full view [-2, 2]
    const mainAttr = this.curveLine.geometry.getAttribute('position') as THREE.BufferAttribute;
    this.plotCurve(mainAttr, -2, 2, this.oy, this.plotH * 0.9);

    // Zoomed curve: oscillating zoom level centered on zoomCenter
    const zoomLevel = 2 + 8 * (0.5 + 0.5 * Math.sin(time * this.zoomSpeed));
    const halfSpan = 2 / zoomLevel;
    const zoomAttr = this.zoomLine.geometry.getAttribute('position') as THREE.BufferAttribute;
    this.plotCurve(zoomAttr,
      this.zoomCenter - halfSpan,
      this.zoomCenter + halfSpan,
      this.oy + this.plotH * 1.05,
      this.plotH * 0.9,
    );

    (this.curveLine.material as THREE.LineBasicMaterial).opacity = opacity * 0.8;
    (this.zoomLine.material as THREE.LineBasicMaterial).opacity = opacity * 0.7;
    (this.axisLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.2;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      this.zoomCenter = this.rng.float(-1.5, 1.5);
      this.paramA = Math.min(0.9, this.paramA + this.rng.float(-0.1, 0.1));
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) return;
    this.zoomSpeed = 0.15 + level * 0.08;
    if (level >= 4) {
      this.terms = Math.min(25, this.terms + 2);
    }
  }
}
