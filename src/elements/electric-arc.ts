import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Electric arc between two electrodes with stochastic branching.
 * Main arc jitters each frame with secondary sparks and a glow effect —
 * like a Tesla coil or Jacob's ladder on a power systems display.
 */
export class ElectricArcElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'electric-arc',
    meta: { shape: 'rectangular', roles: ['decorative', 'gauge'], moods: ['tactical', 'ambient'], bandAffinity: 'high', audioSensitivity: 2.0, sizes: ['works-small', 'needs-medium'] },
  };

  private arcMesh!: THREE.Line;
  private arcMat!: THREE.LineBasicMaterial;
  private glowMesh!: THREE.Line;
  private glowMat!: THREE.LineBasicMaterial;
  private sparkMesh!: THREE.LineSegments;
  private sparkMat!: THREE.LineBasicMaterial;

  private arcPoints = 40;
  private sparkCount = 12;
  private startX = 0; private startY = 0;
  private endX = 0; private endY = 0;
  private jitterAmount = 0;
  private arcIntensity = 1;

  build(): void {
    const variant = this.rng.int(0, 3);
    const presets = [
      { points: 40, sparks: 12, jitterMul: 0.08 },
      { points: 60, sparks: 20, jitterMul: 0.12 },
      { points: 20, sparks: 6, jitterMul: 0.05 },
      { points: 50, sparks: 16, jitterMul: 0.15 },
    ];
    const p = presets[variant];
    this.glitchAmount = 6;

    const { x, y, w, h } = this.px;
    this.arcPoints = p.points;
    this.sparkCount = p.sparks;
    this.jitterAmount = Math.min(w, h) * p.jitterMul;

    // Electrodes at top and bottom center
    this.startX = x + w / 2;
    this.startY = y + h * 0.1;
    this.endX = x + w / 2;
    this.endY = y + h * 0.9;

    // Main arc
    const arcPos = new Float32Array(this.arcPoints * 3);
    const arcGeo = new THREE.BufferGeometry();
    arcGeo.setAttribute('position', new THREE.BufferAttribute(arcPos, 3));
    this.arcMat = new THREE.LineBasicMaterial({ color: this.palette.secondary, transparent: true, opacity: 0 });
    this.arcMesh = new THREE.Line(arcGeo, this.arcMat);
    this.group.add(this.arcMesh);

    // Glow (wider, dimmer)
    const glowPos = new Float32Array(this.arcPoints * 3);
    const glowGeo = new THREE.BufferGeometry();
    glowGeo.setAttribute('position', new THREE.BufferAttribute(glowPos, 3));
    this.glowMat = new THREE.LineBasicMaterial({ color: this.palette.primary, transparent: true, opacity: 0 });
    this.glowMesh = new THREE.Line(glowGeo, this.glowMat);
    this.group.add(this.glowMesh);

    // Sparks
    const sparkPos = new Float32Array(this.sparkCount * 6);
    const sparkGeo = new THREE.BufferGeometry();
    sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
    this.sparkMat = new THREE.LineBasicMaterial({ color: this.palette.secondary, transparent: true, opacity: 0 });
    this.sparkMesh = new THREE.LineSegments(sparkGeo, this.sparkMat);
    this.group.add(this.sparkMesh);
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);
    const jit = this.jitterAmount * this.arcIntensity;

    // Generate arc path with accumulated displacement
    const arcPos = this.arcMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const glowPos = this.glowMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    let offsetX = 0;

    for (let i = 0; i < this.arcPoints; i++) {
      const t = i / (this.arcPoints - 1);
      const baseX = this.startX + (this.endX - this.startX) * t;
      const baseY = this.startY + (this.endY - this.startY) * t;

      // Random walk displacement, strongest in middle
      const midFactor = Math.sin(t * Math.PI);
      offsetX += (this.rng.next() - 0.5) * jit * 2 * midFactor;
      // Bias back toward center
      offsetX *= 0.92;

      arcPos.setXYZ(i, baseX + offsetX, baseY, 0.5);
      // Glow: slightly wider displacement
      glowPos.setXYZ(i, baseX + offsetX * 1.3, baseY, 0.2);
    }
    arcPos.needsUpdate = true;
    glowPos.needsUpdate = true;

    // Sparks: small branches off the main arc
    const sparkPos = this.sparkMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let s = 0; s < this.sparkCount; s++) {
      const t = this.rng.next();
      const pi = Math.floor(t * (this.arcPoints - 1));
      const sx = arcPos.getX(pi);
      const sy = arcPos.getY(pi);
      const len = this.rng.float(5, jit * 2);
      const angle = this.rng.float(0, Math.PI * 2);
      sparkPos.setXYZ(s * 2, sx, sy, 0.3);
      sparkPos.setXYZ(s * 2 + 1, sx + Math.cos(angle) * len, sy + Math.sin(angle) * len, 0.3);
    }
    sparkPos.needsUpdate = true;

    const flicker = 0.8 + this.rng.next() * 0.2;
    this.arcMat.opacity = opacity * flicker;
    this.glowMat.opacity = opacity * 0.3 * flicker;
    this.sparkMat.opacity = opacity * 0.6 * flicker;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') this.arcIntensity = 3;
    if (action === 'alert') this.arcIntensity = 5;
    if (action === 'pulse') this.arcIntensity = 2;
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    this.arcIntensity = 1 + level * 0.5;
  }
}
