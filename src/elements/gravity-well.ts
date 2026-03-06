import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * N-body gravitational simulation with luminous particle trails.
 * Massive bodies orbit and fling lighter particles into sweeping arcs,
 * producing hypnotic orbital mechanics on a dark tactical display.
 */
export class GravityWellElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'gravity-well',
    meta: { shape: 'rectangular', roles: ['data-display', 'decorative'], moods: ['ambient', 'diagnostic'], bandAffinity: 'mid', sizes: ['needs-medium', 'needs-large'] },
  };

  private massCount = 0;
  private massX!: Float32Array;
  private massY!: Float32Array;
  private massVx!: Float32Array;
  private massVy!: Float32Array;
  private massMass!: Float32Array;

  private particleCount = 0;
  private pX!: Float32Array;
  private pY!: Float32Array;
  private pVx!: Float32Array;
  private pVy!: Float32Array;

  private trailLen = 8;
  private trailX!: Float32Array;
  private trailY!: Float32Array;
  private trailHead = 0;
  private trailAccum = 0;

  private massMesh!: THREE.Points;
  private particleMesh!: THREE.Points;
  private trailMesh!: THREE.Points;
  private gridLines!: THREE.LineSegments;

  private cx = 0;
  private cy = 0;
  private G = 5000;
  private soften = 10;

  build(): void {
    const variant = this.rng.int(0, 3);
    const presets = [
      { masses: 3, particles: 120, G: 5000, trailLen: 8, massSize: 5, particleSize: 1.5 },
      { masses: 5, particles: 200, G: 8000, trailLen: 12, massSize: 4, particleSize: 1.2 },
      { masses: 2, particles: 60, G: 3000, trailLen: 5, massSize: 7, particleSize: 2.0 },
      { masses: 4, particles: 160, G: 12000, trailLen: 10, massSize: 4.5, particleSize: 1.3 },
    ];
    const p = presets[variant];
    this.glitchAmount = 5;

    const { x, y, w, h } = this.px;
    this.cx = x + w / 2;
    this.cy = y + h / 2;
    this.G = p.G;
    this.soften = Math.min(w, h) * 0.04;

    // Massive bodies in stable-ish orbits
    this.massCount = p.masses;
    this.massX = new Float32Array(this.massCount);
    this.massY = new Float32Array(this.massCount);
    this.massVx = new Float32Array(this.massCount);
    this.massVy = new Float32Array(this.massCount);
    this.massMass = new Float32Array(this.massCount);

    const orbitR = Math.min(w, h) * 0.25;
    for (let i = 0; i < this.massCount; i++) {
      const angle = (i / this.massCount) * Math.PI * 2 + this.rng.float(-0.3, 0.3);
      const r = orbitR * this.rng.float(0.6, 1.0);
      this.massX[i] = this.cx + Math.cos(angle) * r;
      this.massY[i] = this.cy + Math.sin(angle) * r;
      // Tangential velocity for rough orbit
      const speed = Math.sqrt(this.G / (r + this.soften)) * this.rng.float(0.4, 0.7);
      this.massVx[i] = -Math.sin(angle) * speed;
      this.massVy[i] = Math.cos(angle) * speed;
      this.massMass[i] = this.rng.float(0.5, 2.0);
    }

    // Light particles scattered around
    this.particleCount = p.particles;
    const maxP = this.particleCount + 40;
    this.pX = new Float32Array(maxP);
    this.pY = new Float32Array(maxP);
    this.pVx = new Float32Array(maxP);
    this.pVy = new Float32Array(maxP);
    for (let i = 0; i < maxP; i++) {
      this.pX[i] = x + this.rng.float(w * 0.05, w * 0.95);
      this.pY[i] = y + this.rng.float(h * 0.05, h * 0.95);
      const a = this.rng.float(0, Math.PI * 2);
      const s = this.rng.float(10, 40);
      this.pVx[i] = Math.cos(a) * s;
      this.pVy[i] = Math.sin(a) * s;
    }

    // Trails
    this.trailLen = p.trailLen;
    const totalTrail = maxP * this.trailLen;
    this.trailX = new Float32Array(totalTrail);
    this.trailY = new Float32Array(totalTrail);
    for (let i = 0; i < maxP; i++) {
      for (let t = 0; t < this.trailLen; t++) {
        this.trailX[i * this.trailLen + t] = this.pX[i];
        this.trailY[i * this.trailLen + t] = this.pY[i];
      }
    }

    // Background gravity grid
    const gridSpacing = Math.max(20, Math.min(w, h) * 0.07);
    const gv: number[] = [];
    for (let gx = x + gridSpacing; gx < x + w; gx += gridSpacing) gv.push(gx, y, 0, gx, y + h, 0);
    for (let gy = y + gridSpacing; gy < y + h; gy += gridSpacing) gv.push(x, gy, 0, x + w, gy, 0);
    if (gv.length > 0) {
      const gg = new THREE.BufferGeometry();
      gg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(gv), 3));
      this.gridLines = new THREE.LineSegments(gg, new THREE.LineBasicMaterial({ color: this.palette.dim, transparent: true, opacity: 0 }));
      this.group.add(this.gridLines);
    }

    // Trail points
    const trailPos = new Float32Array(totalTrail * 3);
    const trailColors = new Float32Array(totalTrail * 3);
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(trailPos, 3));
    tg.setAttribute('color', new THREE.BufferAttribute(trailColors, 3));
    tg.setDrawRange(0, this.particleCount * this.trailLen);
    this.trailMesh = new THREE.Points(tg, new THREE.PointsMaterial({ vertexColors: true, transparent: true, opacity: 0, size: 1.0, sizeAttenuation: false }));
    this.group.add(this.trailMesh);

    // Particle points
    const pp = new Float32Array(maxP * 3);
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(pp, 3));
    pg.setDrawRange(0, this.particleCount);
    this.particleMesh = new THREE.Points(pg, new THREE.PointsMaterial({ color: this.palette.primary, transparent: true, opacity: 0, size: p.particleSize, sizeAttenuation: false }));
    this.group.add(this.particleMesh);

    // Mass points
    const mp = new Float32Array(this.massCount * 3);
    const mg = new THREE.BufferGeometry();
    mg.setAttribute('position', new THREE.BufferAttribute(mp, 3));
    this.massMesh = new THREE.Points(mg, new THREE.PointsMaterial({ color: this.palette.secondary, transparent: true, opacity: 0, size: p.massSize, sizeAttenuation: false }));
    this.group.add(this.massMesh);
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);
    const { x, y, w, h } = this.px;
    const cdt = Math.min(dt, 0.033);

    // Update massive bodies (mutual gravity + central pull)
    for (let i = 0; i < this.massCount; i++) {
      let fx = 0, fy = 0;
      // Pull toward center
      const dcx = this.cx - this.massX[i];
      const dcy = this.cy - this.massY[i];
      const dc = Math.sqrt(dcx * dcx + dcy * dcy) + this.soften;
      fx += (dcx / dc) * this.G * 0.3 / dc;
      fy += (dcy / dc) * this.G * 0.3 / dc;
      // Mutual repulsion to prevent collapse
      for (let j = 0; j < this.massCount; j++) {
        if (i === j) continue;
        const ddx = this.massX[j] - this.massX[i];
        const ddy = this.massY[j] - this.massY[i];
        const dd = Math.sqrt(ddx * ddx + ddy * ddy) + this.soften;
        if (dd < this.soften * 3) {
          fx -= (ddx / dd) * this.G * 0.5 / (dd * dd) * this.massMass[j];
          fy -= (ddy / dd) * this.G * 0.5 / (dd * dd) * this.massMass[j];
        }
      }
      this.massVx[i] += fx * cdt;
      this.massVy[i] += fy * cdt;
      this.massX[i] += this.massVx[i] * cdt;
      this.massY[i] += this.massVy[i] * cdt;
      // Soft boundary
      const bPad = Math.min(w, h) * 0.04;
      if (this.massX[i] < x + bPad) this.massVx[i] += 50 * cdt;
      if (this.massX[i] > x + w - bPad) this.massVx[i] -= 50 * cdt;
      if (this.massY[i] < y + bPad) this.massVy[i] += 50 * cdt;
      if (this.massY[i] > y + h - bPad) this.massVy[i] -= 50 * cdt;
    }

    // Update particles (attracted to masses)
    for (let i = 0; i < this.particleCount; i++) {
      let fx = 0, fy = 0;
      for (let m = 0; m < this.massCount; m++) {
        const ddx = this.massX[m] - this.pX[i];
        const ddy = this.massY[m] - this.pY[i];
        const dd = Math.sqrt(ddx * ddx + ddy * ddy) + this.soften;
        const f = this.G * this.massMass[m] / (dd * dd);
        fx += (ddx / dd) * f;
        fy += (ddy / dd) * f;
      }
      this.pVx[i] += fx * cdt;
      this.pVy[i] += fy * cdt;
      // Damping
      const spd = Math.sqrt(this.pVx[i] * this.pVx[i] + this.pVy[i] * this.pVy[i]);
      const maxSpd = Math.min(w, h) * 2;
      if (spd > maxSpd) { this.pVx[i] *= maxSpd / spd; this.pVy[i] *= maxSpd / spd; }
      this.pX[i] += this.pVx[i] * cdt;
      this.pY[i] += this.pVy[i] * cdt;
      // Respawn OOB
      const oobPad = Math.min(w, h) * 0.08;
      if (this.pX[i] < x - oobPad || this.pX[i] > x + w + oobPad || this.pY[i] < y - oobPad || this.pY[i] > y + h + oobPad) {
        this.pX[i] = x + this.rng.next() * w;
        this.pY[i] = y + this.rng.next() * h;
        this.pVx[i] = (this.rng.next() - 0.5) * 20;
        this.pVy[i] = (this.rng.next() - 0.5) * 20;
        for (let t = 0; t < this.trailLen; t++) {
          this.trailX[i * this.trailLen + t] = this.pX[i];
          this.trailY[i * this.trailLen + t] = this.pY[i];
        }
      }
    }

    // Trails
    this.trailAccum += dt;
    if (this.trailAccum >= 0.04) {
      this.trailAccum = 0;
      this.trailHead = (this.trailHead + 1) % this.trailLen;
      for (let i = 0; i < this.particleCount; i++) {
        const idx = i * this.trailLen + this.trailHead;
        this.trailX[idx] = this.pX[i];
        this.trailY[idx] = this.pY[i];
      }
    }

    // GPU: masses
    const mpos = this.massMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < this.massCount; i++) mpos.setXYZ(i, this.massX[i], this.massY[i], 1);
    mpos.needsUpdate = true;

    // GPU: particles
    const ppos = this.particleMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < this.particleCount; i++) ppos.setXYZ(i, this.pX[i], this.pY[i], 0.5);
    ppos.needsUpdate = true;

    // GPU: trails
    const tpos = this.trailMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const tcol = this.trailMesh.geometry.getAttribute('color') as THREE.BufferAttribute;
    const dr = this.palette.dim.r, dg = this.palette.dim.g, db = this.palette.dim.b;
    const pr = this.palette.primary.r, pg2 = this.palette.primary.g, pb = this.palette.primary.b;
    for (let i = 0; i < this.particleCount; i++) {
      for (let t = 0; t < this.trailLen; t++) {
        const idx = i * this.trailLen + t;
        tpos.setXYZ(idx, this.trailX[idx], this.trailY[idx], 0.2);
        let age = (this.trailHead - t + this.trailLen) % this.trailLen;
        const f = (1 - age / (this.trailLen - 1)) * 0.7;
        tcol.setXYZ(idx, pr * f + dr * (1 - f), pg2 * f + dg * (1 - f), pb * f + db * (1 - f));
      }
    }
    tpos.needsUpdate = true;
    tcol.needsUpdate = true;

    (this.massMesh.material as THREE.PointsMaterial).opacity = opacity;
    (this.particleMesh.material as THREE.PointsMaterial).opacity = opacity * 0.85;
    (this.trailMesh.material as THREE.PointsMaterial).opacity = opacity * 0.4;
    if (this.gridLines) (this.gridLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.06;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      for (let i = 0; i < this.massCount; i++) {
        this.massVx[i] += (this.rng.next() - 0.5) * 200;
        this.massVy[i] += (this.rng.next() - 0.5) * 200;
      }
    }
    if (action === 'alert') {
      // Supernova: all particles flung outward
      for (let i = 0; i < this.particleCount; i++) {
        const dx = this.pX[i] - this.cx;
        const dy = this.pY[i] - this.cy;
        const d = Math.sqrt(dx * dx + dy * dy) + 1;
        this.pVx[i] = (dx / d) * 300;
        this.pVy[i] = (dy / d) * 300;
      }
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level >= 3) this.G *= 1.3;
    if (level >= 5) {
      for (let i = 0; i < this.massCount; i++) {
        this.massVx[i] *= 1.8;
        this.massVy[i] *= 1.8;
      }
    }
  }
}
