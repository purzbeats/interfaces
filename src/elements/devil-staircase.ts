import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Cantor/devil's staircase function. Flat on removed intervals, rises on
 * Cantor set. Animate construction level. Show the function and its
 * derivative (Cantor measure approximation). Line geometry.
 */
export class DevilStaircaseElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'devil-staircase',
    meta: {
      shape: 'rectangular',
      roles: ['data-display', 'decorative'],
      moods: ['diagnostic', 'ambient'],
      bandAffinity: 'mid',
      sizes: ['works-small', 'needs-medium', 'needs-large'],
    },
  };

  private stairLines: THREE.Line[] = [];
  private derivLine!: THREE.Line;
  private axisLines!: THREE.LineSegments;
  private maxLevel: number = 8;
  private numPoints: number = 500;
  private animSpeed: number = 0.6;
  private animTime: number = 0;
  private showDerivative: boolean = true;
  private ox: number = 0;
  private oy: number = 0;
  private plotW: number = 0;
  private plotH: number = 0;

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;

    const variant = this.rng.int(0, 3);
    const presets = [
      { maxLevel: 8, numPoints: 500, animSpeed: 0.6, showDeriv: true },
      { maxLevel: 10, numPoints: 800, animSpeed: 0.4, showDeriv: true },
      { maxLevel: 6, numPoints: 400, animSpeed: 0.9, showDeriv: false },
      { maxLevel: 12, numPoints: 1000, animSpeed: 0.3, showDeriv: false },
    ];
    const p = presets[variant];
    this.maxLevel = p.maxLevel;
    this.numPoints = p.numPoints;
    this.animSpeed = p.animSpeed;
    this.showDerivative = p.showDeriv;

    const padX = w * 0.08;
    const padY = h * 0.08;
    this.ox = x + padX;
    this.oy = y + padY;
    this.plotW = w - padX * 2;
    this.plotH = this.showDerivative ? (h - padY * 2) * 0.45 : (h - padY * 2) * 0.85;

    // Create a line for each construction level
    for (let level = 1; level <= this.maxLevel; level++) {
      const pos = new Float32Array(this.numPoints * 3);
      // Initialize to baseline
      for (let i = 0; i < this.numPoints; i++) {
        const t = i / (this.numPoints - 1);
        pos[i * 3] = this.ox + t * this.plotW;
        pos[i * 3 + 1] = this.oy + this.plotH;
        pos[i * 3 + 2] = 0;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const lt = level / this.maxLevel;
      const col = new THREE.Color().copy(this.palette.dim).lerp(this.palette.primary, lt);
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
        color: col, transparent: true, opacity: 0,
      }));
      this.group.add(line);
      this.stairLines.push(line);
    }

    // Derivative approximation line
    if (this.showDerivative) {
      const derivPos = new Float32Array(this.numPoints * 3);
      const derivBaseY = this.oy + this.plotH * 1.15;
      for (let i = 0; i < this.numPoints; i++) {
        const t = i / (this.numPoints - 1);
        derivPos[i * 3] = this.ox + t * this.plotW;
        derivPos[i * 3 + 1] = derivBaseY;
        derivPos[i * 3 + 2] = 0;
      }
      const derivGeo = new THREE.BufferGeometry();
      derivGeo.setAttribute('position', new THREE.BufferAttribute(derivPos, 3));
      this.derivLine = new THREE.Line(derivGeo, new THREE.LineBasicMaterial({
        color: this.palette.secondary, transparent: true, opacity: 0,
      }));
      this.group.add(this.derivLine);
    }

    // Axis lines
    const axisCount = this.showDerivative ? 4 : 2;
    const axisPos = new Float32Array(axisCount * 3);
    axisPos[0] = this.ox; axisPos[1] = this.oy + this.plotH; axisPos[2] = 0;
    axisPos[3] = this.ox + this.plotW; axisPos[4] = this.oy + this.plotH; axisPos[5] = 0;
    if (this.showDerivative) {
      const derivBaseY = this.oy + this.plotH * 2.15;
      axisPos[6] = this.ox; axisPos[7] = derivBaseY; axisPos[8] = 0;
      axisPos[9] = this.ox + this.plotW; axisPos[10] = derivBaseY; axisPos[11] = 0;
    }
    const axisGeo = new THREE.BufferGeometry();
    axisGeo.setAttribute('position', new THREE.BufferAttribute(axisPos, 3));
    this.axisLines = new THREE.LineSegments(axisGeo, new THREE.LineBasicMaterial({
      color: this.palette.dim, transparent: true, opacity: 0,
    }));
    this.group.add(this.axisLines);
  }

  /**
   * Evaluate the devil's staircase at level n.
   * Uses ternary expansion: for x in [0,1], express in base 3.
   * If a digit is 1, replace it and all following with 1, then read in base 2.
   */
  private devilStaircase(xVal: number, level: number): number {
    if (xVal <= 0) return 0;
    if (xVal >= 1) return 1;
    let result = 0;
    let place = 0.5;
    let x = xVal;
    for (let n = 0; n < level; n++) {
      x *= 3;
      const digit = Math.floor(x);
      if (digit >= 2) {
        // digit is 2 — contribute 1 to binary expansion
        result += place;
        x -= 2;
      } else if (digit === 1) {
        // In the middle third — staircase is flat
        result += place;
        return result;
      } else {
        // digit is 0 — contribute 0
        x -= 0;
      }
      place /= 2;
    }
    return result;
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);
    this.animTime += dt * this.animSpeed;

    const cycleLen = this.maxLevel + 3;
    const phase = this.animTime % cycleLen;

    // Update each staircase level
    for (let li = 0; li < this.maxLevel; li++) {
      const level = li + 1;
      const attr = this.stairLines[li].geometry.getAttribute('position') as THREE.BufferAttribute;

      // Compute the staircase at this level
      for (let i = 0; i < this.numPoints; i++) {
        const t = i / (this.numPoints - 1);
        const yVal = this.devilStaircase(t, level);
        attr.setXYZ(i,
          this.ox + t * this.plotW,
          this.oy + (1 - yVal) * this.plotH,
          0,
        );
      }
      attr.needsUpdate = true;

      // Animate visibility: show levels progressively
      let levelOpacity = 0;
      if (phase > li) {
        levelOpacity = Math.min(1, phase - li);
      }
      // Dim older levels
      if (phase > li + 2) {
        levelOpacity = Math.max(0.08, levelOpacity * 0.3);
      }
      // Keep the latest level brightest
      const latestLevel = Math.min(Math.floor(phase), this.maxLevel - 1);
      if (li === latestLevel) levelOpacity = 1;

      (this.stairLines[li].material as THREE.LineBasicMaterial).opacity = opacity * levelOpacity * 0.8;
    }

    // Derivative approximation (finite differences of the current highest level)
    if (this.showDerivative && this.derivLine) {
      const currentLevel = Math.min(Math.floor(phase) + 1, this.maxLevel);
      const derivAttr = this.derivLine.geometry.getAttribute('position') as THREE.BufferAttribute;
      const derivBaseY = this.oy + this.plotH * 1.15;
      const derivH = this.plotH * 0.9;
      let maxDeriv = 0;

      // First pass: compute derivatives
      const derivs: number[] = [];
      for (let i = 0; i < this.numPoints; i++) {
        const t0 = Math.max(0, (i - 1) / (this.numPoints - 1));
        const t1 = Math.min(1, (i + 1) / (this.numPoints - 1));
        const y0 = this.devilStaircase(t0, currentLevel);
        const y1 = this.devilStaircase(t1, currentLevel);
        const deriv = Math.abs(y1 - y0) / (t1 - t0);
        derivs.push(deriv);
        if (deriv > maxDeriv) maxDeriv = deriv;
      }
      const normFactor = maxDeriv > 0 ? 1 / maxDeriv : 1;

      // Second pass: plot
      for (let i = 0; i < this.numPoints; i++) {
        const t = i / (this.numPoints - 1);
        const ny = derivs[i] * normFactor;
        derivAttr.setXYZ(i,
          this.ox + t * this.plotW,
          derivBaseY + (1 - ny) * derivH,
          0,
        );
      }
      derivAttr.needsUpdate = true;

      const derivFade = Math.max(0, Math.min(1, phase - 1));
      (this.derivLine.material as THREE.LineBasicMaterial).opacity = opacity * derivFade * 0.6;
    }

    (this.axisLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.2;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      this.animTime = 0;
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) return;
    this.animSpeed = 0.6 + level * 0.25;
  }
}
