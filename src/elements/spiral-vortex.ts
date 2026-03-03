import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';

/**
 * Archimedean/logarithmic spiral arms that rotate with sine-modulated speed,
 * periodic direction reversal, and radius noise distortion.
 */
export class SpiralVortexElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'spiral-vortex',
    meta: { shape: 'radial', roles: ['decorative'], moods: ['ambient'], sizes: ['needs-medium', 'needs-large'], bandAffinity: 'sub' },
  };
  private arms: THREE.Line[] = [];
  private boundaryCircle: THREE.Line | null = null;
  private cx: number = 0;
  private cy: number = 0;
  private maxRadius: number = 0;
  private pointsPerArm: number = 0;
  private armCount: number = 0;
  private rotAngle: number = 0;
  private rotSpeed: number = 0;
  private rotDir: number = 1;
  private reverseTimer: number = 0;
  private reverseInterval: number = 0;
  private noiseAmp: number = 0;
  private noiseFreq: number = 0;
  private isLog: boolean = false;

  build(): void {
    const variant = this.rng.int(0, 4);
    const presets = [
      { arms: 1, pts: 160, speed: 0.5, reverseMin: 10, reverseMax: 20, noiseAmp: 0.08, noiseFreq: 3, log: false, boundary: true },   // Single Arm
      { arms: 2, pts: 150, speed: 0.6, reverseMin: 8, reverseMax: 16, noiseAmp: 0.06, noiseFreq: 4, log: false, boundary: true },    // Twin
      { arms: 3, pts: 120, speed: 0.4, reverseMin: 12, reverseMax: 20, noiseAmp: 0.05, noiseFreq: 5, log: true, boundary: false },   // Triple Helix
      { arms: 2, pts: 200, speed: 0.8, reverseMin: 5, reverseMax: 10, noiseAmp: 0.20, noiseFreq: 7, log: false, boundary: false },   // Chaotic
    ];
    const p = presets[variant];

    this.glitchAmount = 5;
    const { x, y, w, h } = this.px;
    this.cx = x + w / 2;
    this.cy = y + h / 2;
    this.maxRadius = Math.min(w, h) * 0.44;
    this.pointsPerArm = p.pts;
    this.armCount = p.arms;
    this.rotSpeed = p.speed;
    this.noiseAmp = p.noiseAmp;
    this.noiseFreq = p.noiseFreq;
    this.isLog = p.log;
    this.reverseInterval = this.rng.float(p.reverseMin, p.reverseMax);
    this.reverseTimer = this.reverseInterval;

    // Create spiral arm lines
    for (let a = 0; a < this.armCount; a++) {
      const positions = new Float32Array(this.pointsPerArm * 3);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const arm = new THREE.Line(geo, new THREE.LineBasicMaterial({
        color: a === 0 ? this.palette.primary : this.palette.secondary,
        transparent: true,
        opacity: 0,
      }));
      this.group.add(arm);
      this.arms.push(arm);
    }

    // Optional boundary circle
    if (p.boundary) {
      const segs = 64;
      const circlePos = new Float32Array((segs + 1) * 3);
      for (let i = 0; i <= segs; i++) {
        const a = (i / segs) * Math.PI * 2;
        circlePos[i * 3] = this.cx + Math.cos(a) * this.maxRadius;
        circlePos[i * 3 + 1] = this.cy + Math.sin(a) * this.maxRadius;
        circlePos[i * 3 + 2] = 0;
      }
      const cGeo = new THREE.BufferGeometry();
      cGeo.setAttribute('position', new THREE.BufferAttribute(circlePos, 3));
      this.boundaryCircle = new THREE.Line(cGeo, new THREE.LineBasicMaterial({
        color: this.palette.dim,
        transparent: true,
        opacity: 0,
      }));
      this.group.add(this.boundaryCircle);
    }
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);

    // Direction reversal
    this.reverseTimer -= dt;
    if (this.reverseTimer <= 0) {
      this.rotDir *= -1;
      this.reverseTimer = this.rng.float(8, 20);
    }

    // Sine-modulated rotation speed
    const speedMod = 1 + 0.3 * Math.sin(time * 0.4);
    this.rotAngle += this.rotSpeed * speedMod * this.rotDir * dt;

    for (let a = 0; a < this.armCount; a++) {
      const armOffset = (a / this.armCount) * Math.PI * 2;
      const pos = this.arms[a].geometry.getAttribute('position') as THREE.BufferAttribute;

      for (let i = 0; i < this.pointsPerArm; i++) {
        const t = i / (this.pointsPerArm - 1);

        // Spiral radius
        let r: number;
        if (this.isLog) {
          r = this.maxRadius * 0.05 * Math.exp(t * 3);
          r = Math.min(r, this.maxRadius);
        } else {
          r = t * this.maxRadius;
        }

        // Spiral angle — 3-4 full turns
        const spiralAngle = t * Math.PI * 7 + this.rotAngle + armOffset;

        // Noise distortion
        const noise = Math.sin(t * this.noiseFreq * Math.PI + time * 2) * this.noiseAmp * r
                     + Math.sin(t * this.noiseFreq * 1.7 * Math.PI + time * 1.3) * this.noiseAmp * r * 0.5;

        const finalR = r + noise;
        const px = this.cx + Math.cos(spiralAngle) * finalR;
        const py = this.cy + Math.sin(spiralAngle) * finalR;
        pos.setXYZ(i, px, py, 0);
      }
      pos.needsUpdate = true;

      (this.arms[a].material as THREE.LineBasicMaterial).opacity = opacity * 0.7;
    }

    if (this.boundaryCircle) {
      (this.boundaryCircle.material as THREE.LineBasicMaterial).opacity = opacity * 0.25;
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) return;
    this.rotSpeed += level * 0.15;
    if (level >= 3) {
      this.rotDir *= -1;
    }
    if (level >= 5) {
      // Collapse/expand burst
      this.maxRadius *= 0.3;
      setTimeout(() => { this.maxRadius /= 0.3; }, 800);
    }
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      this.rotDir *= -1;
      this.noiseAmp *= 3;
      setTimeout(() => { this.noiseAmp /= 3; }, 500);
    }
  }
}
