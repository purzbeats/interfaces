import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * RC circuit visualization showing voltage/current curves during
 * charge/discharge cycles. Capacitor plates fill/empty with charge.
 * Multiple RC time constants as presets.
 */
export class CapacitorChargeElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'capacitor-charge',
    meta: {
      shape: 'rectangular',
      roles: ['data-display', 'gauge'],
      moods: ['diagnostic', 'tactical'],
      bandAffinity: 'bass',
      sizes: ['needs-medium', 'needs-large'],
    },
  };

  private voltageLine!: THREE.Line;
  private currentLine!: THREE.Line;
  private plateMesh!: THREE.Mesh;
  private chargeFill!: THREE.Mesh;
  private frameLine!: THREE.LineSegments;

  private tau: number = 1;
  private cycleTime: number = 6;
  private curvePoints: number = 80;
  private chargePhase: number = 0;
  private speedMult: number = 1;

  private plateX: number = 0;
  private plateY: number = 0;
  private plateW: number = 0;
  private plateH: number = 0;

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;
    const variant = this.rng.int(0, 3);
    const presets = [
      { tau: 0.8, cycle: 5, label: 'fast' },
      { tau: 1.5, cycle: 7, label: 'medium' },
      { tau: 2.5, cycle: 10, label: 'slow' },
      { tau: 0.4, cycle: 3, label: 'rapid' },
    ];
    const p = presets[variant];
    this.tau = p.tau;
    this.cycleTime = p.cycle;

    // Voltage curve
    const vPos = new Float32Array(this.curvePoints * 3);
    const vGeo = new THREE.BufferGeometry();
    vGeo.setAttribute('position', new THREE.BufferAttribute(vPos, 3));
    this.voltageLine = new THREE.Line(vGeo, new THREE.LineBasicMaterial({
      color: this.palette.primary, transparent: true, opacity: 0,
    }));
    this.group.add(this.voltageLine);

    // Current curve
    const cPos = new Float32Array(this.curvePoints * 3);
    const cGeo = new THREE.BufferGeometry();
    cGeo.setAttribute('position', new THREE.BufferAttribute(cPos, 3));
    this.currentLine = new THREE.Line(cGeo, new THREE.LineBasicMaterial({
      color: this.palette.secondary, transparent: true, opacity: 0,
    }));
    this.group.add(this.currentLine);

    // Capacitor plates (two rectangles)
    this.plateX = x + w * 0.75;
    this.plateY = y + h * 0.15;
    this.plateW = w * 0.18;
    this.plateH = h * 0.7;
    const plateVerts = new Float32Array([
      this.plateX, this.plateY, 0,
      this.plateX + 2, this.plateY, 0,
      this.plateX + 2, this.plateY + this.plateH, 0,
      this.plateX, this.plateY + this.plateH, 0,
      this.plateX + this.plateW, this.plateY, 0,
      this.plateX + this.plateW + 2, this.plateY, 0,
      this.plateX + this.plateW + 2, this.plateY + this.plateH, 0,
      this.plateX + this.plateW, this.plateY + this.plateH, 0,
    ]);
    const plateIdx = new Uint16Array([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
    const plateGeo = new THREE.BufferGeometry();
    plateGeo.setAttribute('position', new THREE.BufferAttribute(plateVerts, 3));
    plateGeo.setIndex(new THREE.BufferAttribute(plateIdx, 1));
    this.plateMesh = new THREE.Mesh(plateGeo, new THREE.MeshBasicMaterial({
      color: this.palette.dim, transparent: true, opacity: 0,
    }));
    this.group.add(this.plateMesh);

    // Charge fill between plates
    const fillVerts = new Float32Array(12);
    const fillIdx = new Uint16Array([0, 1, 2, 0, 2, 3]);
    const fillGeo = new THREE.BufferGeometry();
    fillGeo.setAttribute('position', new THREE.BufferAttribute(fillVerts, 3));
    fillGeo.setIndex(new THREE.BufferAttribute(fillIdx, 1));
    this.chargeFill = new THREE.Mesh(fillGeo, new THREE.MeshBasicMaterial({
      color: this.palette.primary, transparent: true, opacity: 0,
    }));
    this.group.add(this.chargeFill);

    // Frame border
    const pad = 2;
    const fv = new Float32Array([
      x + pad, y + pad, 0, x + w - pad, y + pad, 0,
      x + w - pad, y + pad, 0, x + w - pad, y + h - pad, 0,
      x + w - pad, y + h - pad, 0, x + pad, y + h - pad, 0,
      x + pad, y + h - pad, 0, x + pad, y + pad, 0,
    ]);
    const fGeo = new THREE.BufferGeometry();
    fGeo.setAttribute('position', new THREE.BufferAttribute(fv, 3));
    this.frameLine = new THREE.LineSegments(fGeo, new THREE.LineBasicMaterial({
      color: this.palette.dim, transparent: true, opacity: 0,
    }));
    this.group.add(this.frameLine);
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    const { x, y, w, h } = this.px;
    const t = time * this.speedMult;

    // Determine charge/discharge phase
    const halfCycle = this.cycleTime / 2;
    const cyclePos = t % this.cycleTime;
    const charging = cyclePos < halfCycle;
    const phaseT = charging ? cyclePos / halfCycle : (cyclePos - halfCycle) / halfCycle;

    // RC exponential: V_charge = 1 - e^(-t/tau), V_discharge = e^(-t/tau)
    const tNorm = phaseT * halfCycle;
    const chargeLevel = charging
      ? 1 - Math.exp(-tNorm / this.tau)
      : Math.exp(-tNorm / this.tau);

    // Plot voltage and current curves
    const graphX = x + w * 0.05;
    const graphW = w * 0.6;
    const graphY = y + h * 0.15;
    const graphH = h * 0.7;

    const vPos = this.voltageLine.geometry.getAttribute('position') as THREE.BufferAttribute;
    const cPos = this.currentLine.geometry.getAttribute('position') as THREE.BufferAttribute;

    for (let i = 0; i < this.curvePoints; i++) {
      const frac = i / (this.curvePoints - 1);
      const tSample = frac * halfCycle;
      const vVal = charging
        ? 1 - Math.exp(-tSample / this.tau)
        : Math.exp(-tSample / this.tau);
      const iVal = charging
        ? Math.exp(-tSample / this.tau)
        : -Math.exp(-tSample / this.tau);

      const px = graphX + frac * graphW;
      vPos.setXYZ(i, px, graphY + graphH * (1 - vVal), 1);
      cPos.setXYZ(i, px, graphY + graphH * (0.5 - iVal * 0.45), 0.8);
    }
    vPos.needsUpdate = true;
    cPos.needsUpdate = true;

    // Update charge fill between capacitor plates
    const fillH = this.plateH * chargeLevel;
    const fillTop = this.plateY + this.plateH - fillH;
    const fillLeft = this.plateX + 3;
    const fillRight = this.plateX + this.plateW - 1;
    const fPos = this.chargeFill.geometry.getAttribute('position') as THREE.BufferAttribute;
    fPos.setXYZ(0, fillLeft, fillTop, 0.5);
    fPos.setXYZ(1, fillRight, fillTop, 0.5);
    fPos.setXYZ(2, fillRight, this.plateY + this.plateH, 0.5);
    fPos.setXYZ(3, fillLeft, this.plateY + this.plateH, 0.5);
    fPos.needsUpdate = true;

    // Time cursor on graph
    this.chargePhase = chargeLevel;

    // Update opacities
    (this.voltageLine.material as THREE.LineBasicMaterial).opacity = opacity * 0.9;
    (this.currentLine.material as THREE.LineBasicMaterial).opacity = opacity * 0.6;
    (this.plateMesh.material as THREE.MeshBasicMaterial).opacity = opacity * 0.5;
    (this.chargeFill.material as THREE.MeshBasicMaterial).opacity = opacity * 0.4 * chargeLevel;
    (this.frameLine.material as THREE.LineBasicMaterial).opacity = opacity * 0.2;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      this.speedMult = 4;
      setTimeout(() => { this.speedMult = 1; }, 400);
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level >= 3) this.speedMult = 1 + level * 0.3;
    else this.speedMult = 1;
  }
}
