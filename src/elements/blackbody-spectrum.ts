import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Planck radiation curves at different temperatures overlaid.
 * Wien's law peak shifts with temperature. Animates a temperature sweep.
 * Rendered with THREE.Line geometry.
 */
export class BlackbodySpectrumElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'blackbody-spectrum',
    meta: { shape: 'rectangular', roles: ['data-display', 'gauge'], moods: ['diagnostic', 'tactical'], bandAffinity: 'high', sizes: ['needs-medium', 'needs-large'] },
  };

  private curveCount = 0;
  private temperatures!: Float32Array;
  private sweepSpeed = 0;
  private sweepTemp = 0;
  private resolution = 80;
  private curves: THREE.Line[] = [];
  private sweepCurve!: THREE.Line;
  private axisLines!: THREE.LineSegments;
  private borderLines!: THREE.LineSegments;
  private wienMarker!: THREE.Points;

  // Planck constants (scaled for display)
  private readonly hc_kB = 14388; // hc/k_B in micron*K

  build(): void {
    this.glitchAmount = 4;
    const variant = this.rng.int(0, 3);
    const presets = [
      { curves: 4, temps: [3000, 4000, 5000, 6000], sweep: 500, res: 80 },
      { curves: 6, temps: [2500, 3500, 4500, 5500, 6500, 7500], sweep: 300, res: 100 },
      { curves: 3, temps: [3000, 5000, 8000], sweep: 800, res: 60 },
      { curves: 5, temps: [2000, 3000, 5000, 7000, 10000], sweep: 600, res: 90 },
    ];
    const p = presets[variant];

    const { x, y, w, h } = this.px;
    this.curveCount = p.curves;
    this.temperatures = new Float32Array(p.temps);
    this.sweepSpeed = p.sweep;
    this.sweepTemp = p.temps[0];
    this.resolution = p.res;

    // Static temperature curves
    for (let c = 0; c < this.curveCount; c++) {
      const positions = new Float32Array(this.resolution * 3);
      this.fillCurve(positions, p.temps[c], x, y, w, h);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
        color: this.palette.dim, transparent: true, opacity: 0,
      }));
      this.group.add(line);
      this.curves.push(line);
    }

    // Animated sweep curve
    const sweepPositions = new Float32Array(this.resolution * 3);
    const sweepGeo = new THREE.BufferGeometry();
    sweepGeo.setAttribute('position', new THREE.BufferAttribute(sweepPositions, 3));
    this.sweepCurve = new THREE.Line(sweepGeo, new THREE.LineBasicMaterial({
      color: this.palette.primary, transparent: true, opacity: 0,
    }));
    this.group.add(this.sweepCurve);

    // Wien peak marker
    const markerGeo = new THREE.BufferGeometry();
    markerGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3));
    this.wienMarker = new THREE.Points(markerGeo, new THREE.PointsMaterial({
      color: this.palette.secondary, transparent: true, opacity: 0,
      size: Math.max(1, Math.min(w, h) * 0.02), sizeAttenuation: false,
    }));
    this.group.add(this.wienMarker);

    // Axes
    const axisVerts = [
      // X axis
      x + w * 0.05, y + h * 0.9, 0, x + w * 0.95, y + h * 0.9, 0,
      // Y axis
      x + w * 0.05, y + h * 0.9, 0, x + w * 0.05, y + h * 0.05, 0,
    ];
    const axisGeo = new THREE.BufferGeometry();
    axisGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(axisVerts), 3));
    this.axisLines = new THREE.LineSegments(axisGeo, new THREE.LineBasicMaterial({
      color: this.palette.dim, transparent: true, opacity: 0,
    }));
    this.group.add(this.axisLines);

    // Border
    const bv = [x, y, 0, x + w, y, 0, x + w, y, 0, x + w, y + h, 0,
      x + w, y + h, 0, x, y + h, 0, x, y + h, 0, x, y, 0];
    const borderGeo = new THREE.BufferGeometry();
    borderGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(bv), 3));
    this.borderLines = new THREE.LineSegments(borderGeo, new THREE.LineBasicMaterial({
      color: this.palette.dim, transparent: true, opacity: 0,
    }));
    this.group.add(this.borderLines);
  }

  private planck(lambda: number, T: number): number {
    // Planck function B(lambda, T) proportional to 1/(lambda^5 * (exp(hc/lambda*k*T) - 1))
    // lambda in microns, T in Kelvin
    const exponent = this.hc_kB / (lambda * T);
    if (exponent > 50) return 0; // avoid overflow
    return 1 / (Math.pow(lambda, 5) * (Math.exp(exponent) - 1));
  }

  private fillCurve(positions: Float32Array, T: number, px: number, py: number, pw: number, ph: number): void {
    const lambdaMin = 0.1; // microns
    const lambdaMax = 5.0;
    const plotX0 = px + pw * 0.05;
    const plotW = pw * 0.9;
    const plotY0 = py + ph * 0.9;
    const plotH = ph * 0.8;

    // Find peak for normalization
    let maxVal = 0;
    for (let i = 0; i < this.resolution; i++) {
      const lambda = lambdaMin + (i / (this.resolution - 1)) * (lambdaMax - lambdaMin);
      const val = this.planck(lambda, T);
      if (val > maxVal) maxVal = val;
    }
    const norm = maxVal > 0 ? 1 / maxVal : 1;

    for (let i = 0; i < this.resolution; i++) {
      const t = i / (this.resolution - 1);
      const lambda = lambdaMin + t * (lambdaMax - lambdaMin);
      const val = this.planck(lambda, T) * norm;
      positions[i * 3] = plotX0 + t * plotW;
      positions[i * 3 + 1] = plotY0 - val * plotH;
      positions[i * 3 + 2] = 0;
    }
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    const { x, y, w, h } = this.px;

    // Sweep temperature oscillates between min and max
    const minT = this.temperatures[0];
    const maxT = this.temperatures[this.curveCount - 1];
    this.sweepTemp = minT + (maxT - minT) * (0.5 + 0.5 * Math.sin(time * 0.5));

    // Update sweep curve
    const sweepPos = this.sweepCurve.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = sweepPos.array as Float32Array;
    this.fillCurve(arr, this.sweepTemp, x, y, w, h);
    sweepPos.needsUpdate = true;

    // Update Wien peak marker: lambda_max = 2898 / T
    const wienLambda = 2898 / this.sweepTemp;
    const lambdaMin = 0.1, lambdaMax = 5.0;
    const plotX0 = x + w * 0.05;
    const plotW = w * 0.9;
    const plotY0 = y + h * 0.9;
    const plotH = h * 0.8;
    const wienT = (wienLambda - lambdaMin) / (lambdaMax - lambdaMin);
    const wienX = plotX0 + Math.max(0, Math.min(1, wienT)) * plotW;
    const wienVal = this.planck(wienLambda, this.sweepTemp);
    // Normalize relative to this temperature's peak
    let peakVal = 0;
    for (let i = 0; i < 50; i++) {
      const l = lambdaMin + (i / 49) * (lambdaMax - lambdaMin);
      const v = this.planck(l, this.sweepTemp);
      if (v > peakVal) peakVal = v;
    }
    const normY = peakVal > 0 ? wienVal / peakVal : 0;
    const markerPos = this.wienMarker.geometry.getAttribute('position') as THREE.BufferAttribute;
    markerPos.setXYZ(0, wienX, plotY0 - normY * plotH, 0.5);
    markerPos.needsUpdate = true;

    // Apply opacities
    for (const curve of this.curves) {
      (curve.material as THREE.LineBasicMaterial).opacity = opacity * 0.25;
    }
    (this.sweepCurve.material as THREE.LineBasicMaterial).opacity = opacity * 0.9;
    (this.wienMarker.material as THREE.PointsMaterial).opacity = opacity;
    (this.axisLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.3;
    (this.borderLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.25;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Jump sweep temp to a random value
      const minT = this.temperatures[0];
      const maxT = this.temperatures[this.curveCount - 1];
      this.sweepTemp = this.rng.float(minT, maxT);
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) return;
    // Increase sweep speed and temperature range
    this.sweepSpeed = 500 + level * 200;
  }
}
