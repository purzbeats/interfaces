import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Pollen grain dispersal from a source. Grains carried by wind with
 * Brownian motion component. Shows dispersal kernel shape. Points
 * geometry with trail lines.
 */
export class PollenScatterElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'pollen-scatter',
    meta: {
      shape: 'rectangular',
      roles: ['decorative', 'data-display'],
      moods: ['ambient'],
      bandAffinity: 'high',
      sizes: ['works-small', 'needs-medium'],
    } satisfies ElementMeta,
  };

  private points!: THREE.Points;
  private pointsMat!: THREE.PointsMaterial;
  private trailLines!: THREE.LineSegments;
  private trailMat!: THREE.LineBasicMaterial;

  private poolSize: number = 80;
  private grainX!: Float32Array;
  private grainY!: Float32Array;
  private grainPrevX!: Float32Array;
  private grainPrevY!: Float32Array;
  private grainVX!: Float32Array;
  private grainVY!: Float32Array;
  private grainLife!: Float32Array;
  private grainMaxLife!: Float32Array;
  private grainActive!: Uint8Array;
  private grainPhase!: Float32Array;

  private sourceX: number = 0;
  private sourceY: number = 0;
  private windX: number = 20;
  private windY: number = -5;
  private brownian: number = 40;
  private emitRate: number = 8; // per second
  private emitAccum: number = 0;
  private speedMult: number = 1;

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;

    const variant = this.rng.int(0, 3);
    const presets = [
      { pool: 160, windX: 20, windY: -5, brownian: 50, rate: 18 },
      { pool: 250, windX: 35, windY: -10, brownian: 70, rate: 25 },
      { pool: 120, windX: 10, windY: -3, brownian: 35, rate: 12 },
      { pool: 200, windX: 25, windY: 5, brownian: 60, rate: 20 },
    ];
    const p = presets[variant];
    this.poolSize = p.pool;
    this.windX = p.windX;
    this.windY = p.windY;
    this.brownian = p.brownian;
    this.emitRate = p.rate;

    // Source position: center of region
    this.sourceX = x + w * 0.45;
    this.sourceY = y + h * 0.5;

    // Allocate grain arrays
    this.grainX = new Float32Array(this.poolSize);
    this.grainY = new Float32Array(this.poolSize);
    this.grainPrevX = new Float32Array(this.poolSize);
    this.grainPrevY = new Float32Array(this.poolSize);
    this.grainVX = new Float32Array(this.poolSize);
    this.grainVY = new Float32Array(this.poolSize);
    this.grainLife = new Float32Array(this.poolSize);
    this.grainMaxLife = new Float32Array(this.poolSize);
    this.grainActive = new Uint8Array(this.poolSize);
    this.grainPhase = new Float32Array(this.poolSize);

    for (let i = 0; i < this.poolSize; i++) {
      this.grainPhase[i] = this.rng.float(0, Math.PI * 2);
    }

    // Points geometry
    const pointPos = new Float32Array(this.poolSize * 3);
    const pointCol = new Float32Array(this.poolSize * 3);
    for (let i = 0; i < pointPos.length; i++) pointPos[i] = 0;
    for (let i = 0; i < pointCol.length; i++) pointCol[i] = 0;

    const pointGeo = new THREE.BufferGeometry();
    pointGeo.setAttribute('position', new THREE.BufferAttribute(pointPos, 3));
    pointGeo.setAttribute('color', new THREE.BufferAttribute(pointCol, 3));
    pointGeo.setDrawRange(0, 0);

    this.pointsMat = new THREE.PointsMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0,
      size: Math.max(4, Math.min(w, h) * 0.018),
      sizeAttenuation: false,
    });
    this.points = new THREE.Points(pointGeo, this.pointsMat);
    this.group.add(this.points);

    // Trail lines (each grain has a trail segment from prev to current position)
    const trailPos = new Float32Array(this.poolSize * 2 * 3);
    for (let i = 0; i < trailPos.length; i++) trailPos[i] = 0;

    const trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPos, 3));
    trailGeo.setDrawRange(0, 0);

    this.trailMat = new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    });
    this.trailLines = new THREE.LineSegments(trailGeo, this.trailMat);
    this.group.add(this.trailLines);

    // Draw source marker
    const srcVerts = new Float32Array(12 * 3);
    // Small circle for source
    for (let i = 0; i < 12; i++) {
      const angle = (i / 12) * Math.PI * 2;
      srcVerts[i * 3] = this.sourceX + Math.cos(angle) * 6;
      srcVerts[i * 3 + 1] = this.sourceY + Math.sin(angle) * 6;
      srcVerts[i * 3 + 2] = 0;
    }
    const srcGeo = new THREE.BufferGeometry();
    srcGeo.setAttribute('position', new THREE.BufferAttribute(srcVerts, 3));
    const srcLine = new THREE.Line(srcGeo, new THREE.LineBasicMaterial({
      color: this.palette.secondary,
      transparent: true,
      opacity: 0.5,
    }));
    this.group.add(srcLine);
  }

  private emitGrain(): void {
    for (let i = 0; i < this.poolSize; i++) {
      if (this.grainActive[i]) continue;

      this.grainX[i] = this.sourceX + this.rng.float(-8, 8);
      this.grainY[i] = this.sourceY + this.rng.float(-8, 8);
      this.grainPrevX[i] = this.grainX[i];
      this.grainPrevY[i] = this.grainY[i];

      // Initial velocity: mostly wind direction with some spread
      this.grainVX[i] = this.windX * this.rng.float(0.5, 1.5);
      this.grainVY[i] = this.windY * this.rng.float(0.5, 1.5) + this.rng.float(-10, 10);

      this.grainLife[i] = this.rng.float(2.0, 5.0);
      this.grainMaxLife[i] = this.grainLife[i];
      this.grainActive[i] = 1;
      this.grainPhase[i] = this.rng.float(0, Math.PI * 2);
      return;
    }
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    const { x, y, w, h } = this.px;
    const effDt = dt * this.speedMult;

    // Emit new grains
    this.emitAccum += this.emitRate * effDt;
    while (this.emitAccum >= 1) {
      this.emitGrain();
      this.emitAccum -= 1;
    }

    // Update grains
    const posAttr = this.points.geometry.getAttribute('position') as THREE.BufferAttribute;
    const colAttr = this.points.geometry.getAttribute('color') as THREE.BufferAttribute;
    const trailAttr = this.trailLines.geometry.getAttribute('position') as THREE.BufferAttribute;

    const priR = this.palette.primary.r, priG = this.palette.primary.g, priB = this.palette.primary.b;
    const secR = this.palette.secondary.r, secG = this.palette.secondary.g, secB = this.palette.secondary.b;

    let activeCount = 0;

    for (let i = 0; i < this.poolSize; i++) {
      if (!this.grainActive[i]) continue;

      // Save previous position for trail
      this.grainPrevX[i] = this.grainX[i];
      this.grainPrevY[i] = this.grainY[i];

      // Brownian motion
      const bx = (Math.sin(time * 5 + this.grainPhase[i]) +
                  Math.sin(time * 13 + this.grainPhase[i] * 3)) * this.brownian;
      const by = (Math.cos(time * 7 + this.grainPhase[i] * 2) +
                  Math.cos(time * 11 + this.grainPhase[i] * 5)) * this.brownian;

      this.grainVX[i] += bx * effDt;
      this.grainVY[i] += by * effDt;

      // Drag to keep speed bounded
      this.grainVX[i] *= 0.98;
      this.grainVY[i] *= 0.98;

      // Wind force
      this.grainVX[i] += this.windX * 0.5 * effDt;
      this.grainVY[i] += this.windY * 0.5 * effDt;

      this.grainX[i] += this.grainVX[i] * effDt;
      this.grainY[i] += this.grainVY[i] * effDt;

      this.grainLife[i] -= effDt;

      // Out of bounds or dead
      if (this.grainLife[i] <= 0 ||
          this.grainX[i] < x - 20 || this.grainX[i] > x + w + 20 ||
          this.grainY[i] < y - 20 || this.grainY[i] > y + h + 20) {
        this.grainActive[i] = 0;
        continue;
      }

      const lifeFrac = Math.max(0, this.grainLife[i] / this.grainMaxLife[i]);

      // Write point position
      posAttr.setXYZ(activeCount, this.grainX[i], this.grainY[i], 1);

      // Color: primary fading to secondary as life decreases
      const cr = priR * lifeFrac + secR * (1 - lifeFrac);
      const cg = priG * lifeFrac + secG * (1 - lifeFrac);
      const cb = priB * lifeFrac + secB * (1 - lifeFrac);
      colAttr.setXYZ(activeCount, cr * lifeFrac, cg * lifeFrac, cb * lifeFrac);

      // Trail segment
      trailAttr.setXYZ(activeCount * 2, this.grainPrevX[i], this.grainPrevY[i], 0.5);
      trailAttr.setXYZ(activeCount * 2 + 1, this.grainX[i], this.grainY[i], 0.5);

      activeCount++;
    }

    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
    trailAttr.needsUpdate = true;
    this.points.geometry.setDrawRange(0, activeCount);
    this.trailLines.geometry.setDrawRange(0, activeCount * 2);

    this.pointsMat.opacity = opacity;
    this.trailMat.opacity = opacity * 0.5;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Wind gust: burst of grains
      for (let i = 0; i < 15; i++) this.emitGrain();
      this.speedMult = 3;
      setTimeout(() => { this.speedMult = 1; }, 400);
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) {
      this.speedMult = 1;
      return;
    }
    this.speedMult = 1 + level * 0.3;
    if (level >= 3) {
      for (let i = 0; i < level * 3; i++) this.emitGrain();
    }
  }
}
