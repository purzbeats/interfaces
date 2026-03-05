import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Chain of spring-coupled masses showing normal mode oscillations.
 * Masses rendered as points, springs as line segments.
 */
export class CoupledOscillatorElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'coupled-oscillator',
    meta: { shape: 'linear', roles: ['data-display', 'decorative'], moods: ['diagnostic', 'ambient'], bandAffinity: 'bass', sizes: ['works-small', 'needs-medium'] },
  };

  private numMasses = 0;
  private dispY!: Float32Array;      // displacement from equilibrium
  private velY!: Float32Array;       // velocity
  private springK = 0;               // spring constant
  private damping = 0;
  private massSpacing = 0;
  private startX = 0;
  private baseY = 0;
  private massPoints!: THREE.Points;
  private springLines!: THREE.LineSegments;
  private wallLines!: THREE.LineSegments;
  private amplitude = 0;
  private mode = 1;

  build(): void {
    this.glitchAmount = 4;
    const variant = this.rng.int(0, 4);
    const { x, y, w, h } = this.px;
    const presets = [
      { masses: 10, k: 200, damping: 0.998, mode: 1 },
      { masses: 16, k: 300, damping: 0.999, mode: 2 },
      { masses: 8, k: 150, damping: 0.997, mode: 3 },
      { masses: 20, k: 400, damping: 0.999, mode: 1 },
    ];
    const p = presets[variant];

    this.numMasses = p.masses;
    this.springK = p.k;
    this.damping = p.damping;
    this.mode = p.mode;
    this.amplitude = h * 0.3;
    this.baseY = y + h / 2;
    this.startX = x + w * 0.05;
    const endX = x + w * 0.95;
    this.massSpacing = (endX - this.startX) / (this.numMasses + 1);

    const n = this.numMasses;
    this.dispY = new Float32Array(n);
    this.velY = new Float32Array(n);

    // Initialize in the selected normal mode
    for (let i = 0; i < n; i++) {
      this.dispY[i] = this.amplitude * Math.sin(this.mode * Math.PI * (i + 1) / (n + 1));
      this.velY[i] = 0;
    }

    // Mass points
    const massPos = new Float32Array(n * 3);
    const massGeo = new THREE.BufferGeometry();
    massGeo.setAttribute('position', new THREE.BufferAttribute(massPos, 3));
    this.massPoints = new THREE.Points(massGeo, new THREE.PointsMaterial({
      color: this.palette.primary, transparent: true, opacity: 0,
      size: Math.max(1, Math.min(w, h) * 0.016), sizeAttenuation: false,
    }));
    this.group.add(this.massPoints);

    // Spring segments: n+1 springs (wall-to-mass, mass-to-mass, mass-to-wall)
    const springCount = n + 1;
    const springPos = new Float32Array(springCount * 6); // 2 verts per spring
    const springGeo = new THREE.BufferGeometry();
    springGeo.setAttribute('position', new THREE.BufferAttribute(springPos, 3));
    this.springLines = new THREE.LineSegments(springGeo, new THREE.LineBasicMaterial({
      color: this.palette.secondary, transparent: true, opacity: 0,
    }));
    this.group.add(this.springLines);

    // Wall markers (two short vertical lines at endpoints)
    const wallH = h * 0.15;
    const lx = this.startX;
    const rx = this.startX + (n + 1) * this.massSpacing;
    const wallVerts = new Float32Array([
      lx, this.baseY - wallH, 0, lx, this.baseY + wallH, 0,
      rx, this.baseY - wallH, 0, rx, this.baseY + wallH, 0,
    ]);
    const wallGeo = new THREE.BufferGeometry();
    wallGeo.setAttribute('position', new THREE.BufferAttribute(wallVerts, 3));
    this.wallLines = new THREE.LineSegments(wallGeo, new THREE.LineBasicMaterial({
      color: this.palette.dim, transparent: true, opacity: 0,
    }));
    this.group.add(this.wallLines);
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);
    const n = this.numMasses;
    const clampDt = Math.min(dt, 0.02);
    const steps = 4;
    const subDt = clampDt / steps;

    // Leapfrog integration
    for (let s = 0; s < steps; s++) {
      // Compute accelerations from spring forces
      for (let i = 0; i < n; i++) {
        const left = i === 0 ? 0 : this.dispY[i - 1];
        const right = i === n - 1 ? 0 : this.dispY[i + 1];
        const force = this.springK * (left + right - 2 * this.dispY[i]);
        this.velY[i] += force * subDt;
        this.velY[i] *= this.damping;
      }
      for (let i = 0; i < n; i++) {
        this.dispY[i] += this.velY[i] * subDt;
      }
    }

    // Update mass positions
    const mp = this.massPoints.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < n; i++) {
      const mx = this.startX + (i + 1) * this.massSpacing;
      mp.setXYZ(i, mx, this.baseY + this.dispY[i], 0.5);
    }
    mp.needsUpdate = true;

    // Update spring lines
    const sp = this.springLines.geometry.getAttribute('position') as THREE.BufferAttribute;
    const sarr = sp.array as Float32Array;
    const wallLx = this.startX;
    const wallRx = this.startX + (n + 1) * this.massSpacing;

    for (let i = 0; i <= n; i++) {
      const idx = i * 6;
      if (i === 0) {
        // Wall to first mass
        sarr[idx] = wallLx; sarr[idx + 1] = this.baseY; sarr[idx + 2] = 0;
        sarr[idx + 3] = this.startX + this.massSpacing;
        sarr[idx + 4] = this.baseY + this.dispY[0]; sarr[idx + 5] = 0;
      } else if (i === n) {
        // Last mass to wall
        sarr[idx] = this.startX + n * this.massSpacing;
        sarr[idx + 1] = this.baseY + this.dispY[n - 1]; sarr[idx + 2] = 0;
        sarr[idx + 3] = wallRx; sarr[idx + 4] = this.baseY; sarr[idx + 5] = 0;
      } else {
        // Mass to mass
        sarr[idx] = this.startX + i * this.massSpacing;
        sarr[idx + 1] = this.baseY + this.dispY[i - 1]; sarr[idx + 2] = 0;
        sarr[idx + 3] = this.startX + (i + 1) * this.massSpacing;
        sarr[idx + 4] = this.baseY + this.dispY[i]; sarr[idx + 5] = 0;
      }
    }
    sp.needsUpdate = true;

    (this.massPoints.material as THREE.PointsMaterial).opacity = opacity;
    (this.springLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.6;
    (this.wallLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.3;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Excite a random mass with a big impulse
      const idx = this.rng.int(0, this.numMasses);
      this.velY[idx] += this.rng.float(-this.amplitude * 8, this.amplitude * 8);
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level > 0) {
      // Inject energy proportional to level
      for (let i = 0; i < this.numMasses; i++) {
        this.velY[i] += this.rng.float(-level * 2, level * 2);
      }
    }
  }
}
