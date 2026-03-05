import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Hohmann transfer orbit visualization. Shows inner orbit, transfer
 * ellipse, and outer orbit with spacecraft moving along the path.
 * Delta-v markers at burn points.
 */
export class OrbitalTransferElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'orbital-transfer',
    meta: {
      shape: 'radial',
      roles: ['data-display', 'decorative'],
      moods: ['tactical', 'ambient'],
      bandAffinity: 'mid',
      sizes: ['needs-medium', 'needs-large'],
    },
  };

  private innerOrbit!: THREE.Line;
  private outerOrbit!: THREE.Line;
  private transferOrbit!: THREE.Line;
  private spacecraft!: THREE.Points;
  private burnMarkers!: THREE.Points;
  private frameLine!: THREE.LineSegments;

  private cx: number = 0;
  private cy: number = 0;
  private innerR: number = 0;
  private outerR: number = 0;
  private orbitSegments: number = 96;
  private orbitSpeed: number = 1;
  private transferActive: boolean = false;
  private transferPhase: number = 0;
  private speedMult: number = 1;

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;
    this.cx = x + w / 2;
    this.cy = y + h / 2;
    const scale = Math.min(w, h) * 0.45;

    const variant = this.rng.int(0, 3);
    const presets = [
      { innerFrac: 0.35, outerFrac: 0.85, speed: 0.6 },
      { innerFrac: 0.25, outerFrac: 0.7, speed: 0.8 },
      { innerFrac: 0.4, outerFrac: 0.95, speed: 0.4 },
      { innerFrac: 0.3, outerFrac: 0.6, speed: 1.0 },
    ];
    const p = presets[variant];
    this.innerR = scale * p.innerFrac;
    this.outerR = scale * p.outerFrac;
    this.orbitSpeed = p.speed;

    // Inner circular orbit
    const iPos = new Float32Array((this.orbitSegments + 1) * 3);
    const iGeo = new THREE.BufferGeometry();
    iGeo.setAttribute('position', new THREE.BufferAttribute(iPos, 3));
    this.innerOrbit = new THREE.Line(iGeo, new THREE.LineBasicMaterial({
      color: this.palette.dim, transparent: true, opacity: 0,
    }));
    this.group.add(this.innerOrbit);

    // Outer circular orbit
    const oPos = new Float32Array((this.orbitSegments + 1) * 3);
    const oGeo = new THREE.BufferGeometry();
    oGeo.setAttribute('position', new THREE.BufferAttribute(oPos, 3));
    this.outerOrbit = new THREE.Line(oGeo, new THREE.LineBasicMaterial({
      color: this.palette.dim, transparent: true, opacity: 0,
    }));
    this.group.add(this.outerOrbit);

    // Fill orbits (static circles)
    for (let i = 0; i <= this.orbitSegments; i++) {
      const a = (i / this.orbitSegments) * Math.PI * 2;
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      (iGeo.getAttribute('position') as THREE.BufferAttribute)
        .setXYZ(i, this.cx + cos * this.innerR, this.cy + sin * this.innerR, 0);
      (oGeo.getAttribute('position') as THREE.BufferAttribute)
        .setXYZ(i, this.cx + cos * this.outerR, this.cy + sin * this.outerR, 0);
    }
    (iGeo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (oGeo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;

    // Transfer ellipse (half ellipse from inner to outer)
    const tSegs = 64;
    const tPos = new Float32Array((tSegs + 1) * 3);
    const tGeo = new THREE.BufferGeometry();
    tGeo.setAttribute('position', new THREE.BufferAttribute(tPos, 3));
    this.transferOrbit = new THREE.Line(tGeo, new THREE.LineBasicMaterial({
      color: this.palette.secondary, transparent: true, opacity: 0,
    }));
    this.group.add(this.transferOrbit);

    // Compute Hohmann transfer ellipse
    const semiMajor = (this.innerR + this.outerR) / 2;
    const ecc = (this.outerR - this.innerR) / (this.outerR + this.innerR);
    const tAttr = tGeo.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i <= tSegs; i++) {
      const theta = Math.PI * (i / tSegs); // half orbit: 0 to PI
      const r = semiMajor * (1 - ecc * ecc) / (1 + ecc * Math.cos(theta));
      tAttr.setXYZ(i, this.cx + r * Math.cos(theta), this.cy + r * Math.sin(theta), 0.5);
    }
    tAttr.needsUpdate = true;

    // Spacecraft point
    const scPos = new Float32Array(3);
    const scGeo = new THREE.BufferGeometry();
    scGeo.setAttribute('position', new THREE.BufferAttribute(scPos, 3));
    this.spacecraft = new THREE.Points(scGeo, new THREE.PointsMaterial({
      color: this.palette.primary, transparent: true, opacity: 0,
      size: 6, sizeAttenuation: false,
    }));
    this.group.add(this.spacecraft);

    // Burn markers at departure and arrival points
    const bmPos = new Float32Array(6);
    bmPos[0] = this.cx + this.innerR; bmPos[1] = this.cy; bmPos[2] = 1;
    bmPos[3] = this.cx - this.outerR; bmPos[4] = this.cy; bmPos[5] = 1;
    const bmGeo = new THREE.BufferGeometry();
    bmGeo.setAttribute('position', new THREE.BufferAttribute(bmPos, 3));
    this.burnMarkers = new THREE.Points(bmGeo, new THREE.PointsMaterial({
      color: this.palette.secondary, transparent: true, opacity: 0,
      size: 8, sizeAttenuation: false,
    }));
    this.group.add(this.burnMarkers);

    // Frame
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
    const t = time * this.orbitSpeed * this.speedMult;

    // Spacecraft cycles: inner orbit -> transfer -> outer orbit -> transfer back
    const fullCycle = 4 * Math.PI; // two full half-orbits + two transfers
    const phase = t % fullCycle;

    const semiMajor = (this.innerR + this.outerR) / 2;
    const ecc = (this.outerR - this.innerR) / (this.outerR + this.innerR);

    let scX: number, scY: number;

    if (phase < Math.PI) {
      // On inner orbit
      const a = phase;
      scX = this.cx + Math.cos(a) * this.innerR;
      scY = this.cy + Math.sin(a) * this.innerR;
      this.transferActive = false;
    } else if (phase < 2 * Math.PI) {
      // Transfer from inner to outer (Hohmann half-ellipse)
      const theta = phase - Math.PI;
      const r = semiMajor * (1 - ecc * ecc) / (1 + ecc * Math.cos(theta));
      scX = this.cx + r * Math.cos(theta);
      scY = this.cy + r * Math.sin(theta);
      this.transferActive = true;
    } else if (phase < 3 * Math.PI) {
      // On outer orbit
      const a = phase - 2 * Math.PI + Math.PI;
      scX = this.cx + Math.cos(a) * this.outerR;
      scY = this.cy + Math.sin(a) * this.outerR;
      this.transferActive = false;
    } else {
      // Transfer from outer back to inner
      const theta = phase - 3 * Math.PI;
      const r = semiMajor * (1 - ecc * ecc) / (1 - ecc * Math.cos(theta));
      scX = this.cx + r * Math.cos(theta + Math.PI);
      scY = this.cy + r * Math.sin(theta + Math.PI);
      this.transferActive = true;
    }

    const scPos = this.spacecraft.geometry.getAttribute('position') as THREE.BufferAttribute;
    scPos.setXYZ(0, scX, scY, 2);
    scPos.needsUpdate = true;

    // Opacities
    (this.innerOrbit.material as THREE.LineBasicMaterial).opacity = opacity * 0.4;
    (this.outerOrbit.material as THREE.LineBasicMaterial).opacity = opacity * 0.4;
    (this.transferOrbit.material as THREE.LineBasicMaterial).opacity = opacity * (this.transferActive ? 0.8 : 0.25);
    (this.spacecraft.material as THREE.PointsMaterial).opacity = opacity;
    (this.burnMarkers.material as THREE.PointsMaterial).opacity = opacity * 0.6;
    (this.frameLine.material as THREE.LineBasicMaterial).opacity = opacity * 0.15;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      this.speedMult = 5;
      setTimeout(() => { this.speedMult = 1; }, 500);
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level >= 3) this.speedMult = 1 + level * 0.4;
    else this.speedMult = 1;
  }
}
