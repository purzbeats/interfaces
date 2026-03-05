import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Fourier epicycle drawing machine.
 * Rotating circles of decreasing radius chain together to trace
 * complex shapes — visualizing the Fourier transform as mechanical art.
 */
export class FourierDrawElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'fourier-draw',
    meta: { shape: 'rectangular', roles: ['data-display', 'decorative'], moods: ['diagnostic', 'ambient'], bandAffinity: 'mid', sizes: ['needs-medium', 'needs-large'] },
  };

  private epicycleCount = 0;
  private frequencies!: Float32Array;
  private amplitudes!: Float32Array;
  private phases!: Float32Array;

  private trailLen = 800;
  private trailX!: Float32Array;
  private trailY!: Float32Array;
  private trailHead = 0;
  private trailFilled = false;

  private circleMesh!: THREE.LineSegments;
  private armMesh!: THREE.Line;
  private trailMesh!: THREE.Line;
  private tipMesh!: THREE.Points;

  private cx = 0;
  private cy = 0;
  private scale = 1;
  private timeScale = 0.5;

  build(): void {
    const variant = this.rng.int(0, 3);
    const presets = [
      { circles: 8, trailLen: 600, timeScale: 0.5, shape: 'square' },
      { circles: 16, trailLen: 1200, timeScale: 0.3, shape: 'star' },
      { circles: 5, trailLen: 400, timeScale: 0.7, shape: 'triangle' },
      { circles: 12, trailLen: 900, timeScale: 0.4, shape: 'random' },
    ];
    const p = presets[variant];
    this.glitchAmount = 4;

    const { x, y, w, h } = this.px;
    this.cx = x + w / 2;
    this.cy = y + h / 2;
    this.scale = Math.min(w, h) * 0.25;
    this.timeScale = p.timeScale;
    this.trailLen = p.trailLen;

    this.epicycleCount = p.circles;
    this.frequencies = new Float32Array(this.epicycleCount);
    this.amplitudes = new Float32Array(this.epicycleCount);
    this.phases = new Float32Array(this.epicycleCount);

    // Generate epicycle parameters based on shape
    for (let i = 0; i < this.epicycleCount; i++) {
      const n = i + 1;
      switch (p.shape) {
        case 'square':
          // Square wave: odd harmonics, 1/n amplitude
          this.frequencies[i] = (2 * n - 1);
          this.amplitudes[i] = 1 / (2 * n - 1);
          this.phases[i] = 0;
          break;
        case 'star':
          this.frequencies[i] = n * (n % 2 === 0 ? 1 : -1) * 3;
          this.amplitudes[i] = 1 / (n * 0.8);
          this.phases[i] = this.rng.float(0, 0.3);
          break;
        case 'triangle':
          this.frequencies[i] = (2 * n - 1);
          this.amplitudes[i] = (n % 2 === 0 ? -1 : 1) / ((2 * n - 1) * (2 * n - 1));
          this.phases[i] = 0;
          break;
        default:
          this.frequencies[i] = this.rng.float(-8, 8);
          this.amplitudes[i] = this.rng.float(0.1, 1) / (n * 0.5);
          this.phases[i] = this.rng.float(0, Math.PI * 2);
      }
    }

    // Trail
    this.trailX = new Float32Array(this.trailLen);
    this.trailY = new Float32Array(this.trailLen);
    this.trailX.fill(this.cx);
    this.trailY.fill(this.cy);

    // Circle segments (each circle approximated by 32 line segments)
    const segsPerCircle = 32;
    const circleVerts = new Float32Array(this.epicycleCount * segsPerCircle * 6);
    const circGeo = new THREE.BufferGeometry();
    circGeo.setAttribute('position', new THREE.BufferAttribute(circleVerts, 3));
    this.circleMesh = new THREE.LineSegments(circGeo, new THREE.LineBasicMaterial({
      color: this.palette.dim, transparent: true, opacity: 0,
    }));
    this.group.add(this.circleMesh);

    // Arm line (epicycleCount+1 points)
    const armVerts = new Float32Array((this.epicycleCount + 1) * 3);
    const armGeo = new THREE.BufferGeometry();
    armGeo.setAttribute('position', new THREE.BufferAttribute(armVerts, 3));
    this.armMesh = new THREE.Line(armGeo, new THREE.LineBasicMaterial({
      color: this.palette.primary, transparent: true, opacity: 0,
    }));
    this.group.add(this.armMesh);

    // Trail line
    const trailVerts = new Float32Array(this.trailLen * 3);
    const trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute('position', new THREE.BufferAttribute(trailVerts, 3));
    trailGeo.setDrawRange(0, 0);
    this.trailMesh = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({
      color: this.palette.secondary, transparent: true, opacity: 0,
    }));
    this.group.add(this.trailMesh);

    // Tip dot
    const tipGeo = new THREE.BufferGeometry();
    tipGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3));
    this.tipMesh = new THREE.Points(tipGeo, new THREE.PointsMaterial({
      color: this.palette.secondary, transparent: true, opacity: 0, size: Math.max(1, Math.min(w, h) * 0.013), sizeAttenuation: false,
    }));
    this.group.add(this.tipMesh);
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    const t = time * this.timeScale;
    const segsPerCircle = 32;

    // Compute arm positions
    let armX = this.cx, armY = this.cy;
    const armPos = this.armMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    armPos.setXYZ(0, armX, armY, 0.5);

    const circPos = this.circleMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    let ci = 0;

    for (let e = 0; e < this.epicycleCount; e++) {
      const radius = Math.abs(this.amplitudes[e]) * this.scale;
      const angle = this.frequencies[e] * t * Math.PI * 2 + this.phases[e];

      // Draw circle at current arm position
      for (let s = 0; s < segsPerCircle; s++) {
        const a1 = (s / segsPerCircle) * Math.PI * 2;
        const a2 = ((s + 1) / segsPerCircle) * Math.PI * 2;
        circPos.setXYZ(ci++, armX + Math.cos(a1) * radius, armY + Math.sin(a1) * radius, 0);
        circPos.setXYZ(ci++, armX + Math.cos(a2) * radius, armY + Math.sin(a2) * radius, 0);
      }

      // Advance arm
      armX += Math.cos(angle) * radius;
      armY += Math.sin(angle) * radius;
      armPos.setXYZ(e + 1, armX, armY, 0.5);
    }
    armPos.needsUpdate = true;
    circPos.needsUpdate = true;

    // Record trail
    this.trailX[this.trailHead] = armX;
    this.trailY[this.trailHead] = armY;
    this.trailHead = (this.trailHead + 1) % this.trailLen;
    if (this.trailHead === 0) this.trailFilled = true;

    // Update trail mesh (render in order from oldest to newest)
    const trailPos = this.trailMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const count = this.trailFilled ? this.trailLen : this.trailHead;
    for (let i = 0; i < count; i++) {
      const ri = (this.trailHead - count + i + this.trailLen) % this.trailLen;
      trailPos.setXYZ(i, this.trailX[ri], this.trailY[ri], 0);
    }
    trailPos.needsUpdate = true;
    this.trailMesh.geometry.setDrawRange(0, count);

    // Tip
    const tipPos = this.tipMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    tipPos.setXYZ(0, armX, armY, 1);
    tipPos.needsUpdate = true;

    (this.circleMesh.material as THREE.LineBasicMaterial).opacity = opacity * 0.12;
    (this.armMesh.material as THREE.LineBasicMaterial).opacity = opacity * 0.4;
    (this.trailMesh.material as THREE.LineBasicMaterial).opacity = opacity * 0.8;
    (this.tipMesh.material as THREE.PointsMaterial).opacity = opacity;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      for (let i = 0; i < this.epicycleCount; i++) this.phases[i] += this.rng.float(-1, 1);
    }
    if (action === 'alert') {
      for (let i = 0; i < this.epicycleCount; i++) this.frequencies[i] *= -1;
      this.trailFilled = false;
      this.trailHead = 0;
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level >= 3) this.timeScale = 1.2;
    if (level >= 5) {
      for (let i = 0; i < this.epicycleCount; i++) this.amplitudes[i] *= 1.5;
    }
  }
}
