import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Animated epitrochoid/spirograph curves with slowly varying parameters
 * producing evolving rosette patterns. The curve draws progressively,
 * and parameters drift over time to create morphing patterns.
 * Multiple concentric curves with different gear ratios.
 */
export class EpitrochoidElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'epitrochoid',
    meta: {
      shape: 'radial',
      roles: ['decorative'],
      moods: ['ambient'],
      bandAffinity: 'high',
      sizes: ['works-small', 'needs-medium'],
    } satisfies ElementMeta,
  };

  private lines: THREE.Line[] = [];
  private lineMats: THREE.LineBasicMaterial[] = [];
  private dotMesh!: THREE.Points;
  private dotMat!: THREE.PointsMaterial;
  private borderLines!: THREE.LineSegments;
  private borderMat!: THREE.LineBasicMaterial;

  private curveCount = 0;
  private maxPoints = 2000;
  private drawHeads: number[] = [];
  private cx = 0;
  private cy = 0;
  private scaleR = 0;
  // Per-curve parameters
  private curveParams: { R: number; r: number; d: number; speed: number; simT: number; driftRate: number }[] = [];
  private intensityLevel = 0;

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;
    this.cx = x + w / 2;
    this.cy = y + h / 2;
    this.scaleR = Math.min(w, h) * 0.36;

    const variant = this.rng.int(0, 3);
    const presets = [
      { curves: 2, params: [
        { R: 1, r: 0.35, d: 0.8, speed: 1.2, drift: 0.01 },
        { R: 1, r: 0.55, d: 0.4, speed: 0.8, drift: 0.015 },
      ]},
      { curves: 3, params: [
        { R: 1, r: 0.25, d: 0.6, speed: 1.5, drift: 0.008 },
        { R: 1, r: 0.42, d: 0.7, speed: 1.0, drift: 0.012 },
        { R: 1, r: 0.6,  d: 0.3, speed: 0.6, drift: 0.02 },
      ]},
      { curves: 1, params: [
        { R: 1, r: 0.42, d: 0.95, speed: 1.0, drift: 0.005 },
      ]},
      { curves: 2, params: [
        { R: 1, r: 0.6,  d: 0.5, speed: 0.8, drift: 0.018 },
        { R: 1, r: 0.33, d: 0.9, speed: 1.3, drift: 0.01 },
      ]},
    ];
    const p = presets[variant];
    this.curveCount = p.curves;

    this.curveParams = p.params.map(pp => ({
      R: pp.R,
      r: pp.r + this.rng.float(-0.02, 0.02),
      d: pp.d + this.rng.float(-0.05, 0.05),
      speed: pp.speed,
      simT: 0,
      driftRate: pp.drift,
    }));

    // Create line meshes for each curve
    for (let c = 0; c < this.curveCount; c++) {
      const positions = new Float32Array(this.maxPoints * 3);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geo.setDrawRange(0, 0);
      const t = c / Math.max(1, this.curveCount - 1);
      const color = new THREE.Color().copy(this.palette.primary).lerp(this.palette.secondary, t);
      const mat = new THREE.LineBasicMaterial({
        color, transparent: true, opacity: 0,
      });
      const line = new THREE.Line(geo, mat);
      this.group.add(line);
      this.lines.push(line);
      this.lineMats.push(mat);
      this.drawHeads.push(0);
    }

    // Drawing point indicator
    const dotPos = new Float32Array(this.curveCount * 3);
    const dotGeo = new THREE.BufferGeometry();
    dotGeo.setAttribute('position', new THREE.BufferAttribute(dotPos, 3));
    this.dotMat = new THREE.PointsMaterial({
      color: this.palette.primary, transparent: true, opacity: 0,
      size: 4, sizeAttenuation: false,
    });
    this.dotMesh = new THREE.Points(dotGeo, this.dotMat);
    this.group.add(this.dotMesh);

    // Border
    const bv = new Float32Array([
      x, y, 0, x + w, y, 0, x + w, y, 0, x + w, y + h, 0,
      x + w, y + h, 0, x, y + h, 0, x, y + h, 0, x, y, 0,
    ]);
    const bGeo = new THREE.BufferGeometry();
    bGeo.setAttribute('position', new THREE.BufferAttribute(bv, 3));
    this.borderMat = new THREE.LineBasicMaterial({
      color: this.palette.dim, transparent: true, opacity: 0,
    });
    this.borderLines = new THREE.LineSegments(bGeo, this.borderMat);
    this.group.add(this.borderLines);
  }

  private sampleCurve(c: number, t: number): { x: number; y: number } {
    const cp = this.curveParams[c];
    const R = cp.R, r = cp.r, d = cp.d;
    const ratio = (R + r) / r;
    const norm = 1 / (R + r + d);
    const xVal = ((R + r) * Math.cos(t) - d * Math.cos(ratio * t)) * norm;
    const yVal = ((R + r) * Math.sin(t) - d * Math.sin(ratio * t)) * norm;
    // Scale by curve index (inner curves smaller)
    const scale = 1 - c * 0.15;
    return { x: xVal * scale, y: yVal * scale };
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    const clampDt = Math.min(dt, 0.05);

    const dotPos = this.dotMesh.geometry.getAttribute('position') as THREE.BufferAttribute;

    for (let c = 0; c < this.curveCount; c++) {
      const cp = this.curveParams[c];
      cp.simT += clampDt * cp.speed;

      // Slowly drift parameters
      cp.d += Math.sin(time * cp.driftRate * 7) * cp.driftRate * clampDt;
      cp.d = Math.max(0.15, Math.min(1.2, cp.d));
      cp.r += Math.cos(time * cp.driftRate * 5) * cp.driftRate * 0.5 * clampDt;
      cp.r = Math.max(0.15, Math.min(0.8, cp.r));

      const pos = this.lines[c].geometry.getAttribute('position') as THREE.BufferAttribute;
      const ptsPerFrame = 10;
      let lastPt = { x: 0, y: 0 };

      for (let i = 0; i < ptsPerFrame; i++) {
        if (this.drawHeads[c] >= this.maxPoints) {
          this.drawHeads[c] = 0;
          cp.simT = 0;
        }
        const t = cp.simT + (i / ptsPerFrame) * clampDt * cp.speed;
        const pt = this.sampleCurve(c, t);
        pos.setXYZ(this.drawHeads[c], this.cx + pt.x * this.scaleR, this.cy + pt.y * this.scaleR, 0);
        lastPt = pt;
        this.drawHeads[c]++;
      }
      pos.needsUpdate = true;
      this.lines[c].geometry.setDrawRange(0, this.drawHeads[c]);
      this.lineMats[c].opacity = opacity * (0.6 + 0.2 * (1 - c / this.curveCount));

      // Update dot position
      dotPos.setXYZ(c, this.cx + lastPt.x * this.scaleR, this.cy + lastPt.y * this.scaleR, 0.1);
    }
    dotPos.needsUpdate = true;

    this.dotMat.opacity = opacity;
    this.borderMat.opacity = opacity * 0.2;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      for (let c = 0; c < this.curveCount; c++) {
        this.drawHeads[c] = 0;
        this.curveParams[c].simT = 0;
        this.curveParams[c].r = 0.2 + this.rng.float(0, 0.5);
        this.curveParams[c].d = 0.3 + this.rng.float(0, 0.8);
      }
    }
    if (action === 'pulse') {
      for (const cp of this.curveParams) {
        cp.speed *= 3;
      }
      setTimeout(() => { for (const cp of this.curveParams) cp.speed /= 3; }, 500);
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    this.intensityLevel = level;
    if (level === 0) return;
    for (const cp of this.curveParams) {
      cp.speed = 1.2 + level * 0.3;
      cp.driftRate = 0.01 + level * 0.005;
    }
  }
}
