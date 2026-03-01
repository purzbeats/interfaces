import * as THREE from 'three';
import { BaseElement } from './base-element';
import { pulse, stateOpacity, glitchOffset } from '../animation/fx';

/**
 * Subtle electrical arc between two electrodes.
 * A single jagged line regenerated a few times per second, with gentle flicker.
 */
export class VoltageArcElement extends BaseElement {
  private arcLines!: THREE.LineSegments;
  private electrodeLines!: THREE.LineSegments;
  private arcSegments: number = 0;
  private pulseTimer: number = 0;
  private glitchTimer: number = 0;
  private regenAccum: number = 0;
  private regenRate: number = 0;
  private arcSeed: number = 0;

  build(): void {
    const { x, y, w, h } = this.px;
    this.arcSegments = this.rng.int(8, 14);
    this.regenRate = this.rng.float(6, 12); // regens per second

    // Electrode end-caps
    const eVerts = new Float32Array([
      x + w * 0.08, y + h * 0.35, 0, x + w * 0.08, y + h * 0.65, 0,
      x + w * 0.92, y + h * 0.35, 0, x + w * 0.92, y + h * 0.65, 0,
    ]);
    const eGeo = new THREE.BufferGeometry();
    eGeo.setAttribute('position', new THREE.Float32BufferAttribute(eVerts, 3));
    this.electrodeLines = new THREE.LineSegments(eGeo, new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.electrodeLines);

    // Single arc path (just main line, no branches)
    const maxVerts = this.arcSegments * 2 * 3;
    const arcGeo = new THREE.BufferGeometry();
    arcGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(maxVerts), 3));
    arcGeo.setDrawRange(0, 0);
    this.arcLines = new THREE.LineSegments(arcGeo, new THREE.LineBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.arcLines);

    this.arcSeed = this.rng.float(0, 1000);
  }

  update(dt: number, time: number): void {
    let opacity = stateOpacity(this.stateMachine.state, this.stateMachine.progress);
    const { x, y, w, h } = this.px;

    if (this.pulseTimer > 0) {
      this.pulseTimer -= dt;
      opacity *= pulse(this.pulseTimer);
    }

    const gx = this.glitchTimer > 0 ? glitchOffset(this.glitchTimer, 5) : 0;
    if (this.glitchTimer > 0) this.glitchTimer -= dt;

    (this.electrodeLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.5;

    // Regenerate arc at fixed rate (not every frame)
    this.regenAccum += dt;
    if (this.regenAccum >= 1 / this.regenRate) {
      this.regenAccum = 0;
      this.arcSeed = time * 100; // new seed each regen

      const pos = this.arcLines.geometry.getAttribute('position') as THREE.BufferAttribute;
      const cy = y + h / 2;
      const startX = x + w * 0.08 + gx;
      const endX = x + w * 0.92 + gx;
      const spread = h * 0.15; // much tighter spread
      let vi = 0;

      // Single main arc — clean jagged path
      let prevX = startX;
      let prevY = cy;
      for (let i = 1; i <= this.arcSegments; i++) {
        const t = i / this.arcSegments;
        const px = startX + (endX - startX) * t;
        const envelope = Math.sin(t * Math.PI); // taper at ends
        const noise = Math.sin(t * 37 + this.arcSeed) * Math.cos(t * 19 + this.arcSeed * 0.7)
          + Math.sin(t * 71 + this.arcSeed * 1.3) * 0.4;
        const py = cy + noise * spread * envelope;

        pos.setXYZ(vi++, prevX, prevY, 1);
        pos.setXYZ(vi++, px, py, 1);
        prevX = px;
        prevY = py;
      }

      pos.needsUpdate = true;
      this.arcLines.geometry.setDrawRange(0, vi);
    }

    const arcMat = this.arcLines.material as THREE.LineBasicMaterial;
    // Gentle flicker
    const flicker = 0.75 + Math.sin(time * 17) * 0.15 + Math.sin(time * 31) * 0.1;
    arcMat.opacity = opacity * 0.7 * flicker;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'pulse') this.pulseTimer = 0.6;
    if (action === 'glitch') {
      this.glitchTimer = 0.5;
      this.regenRate = this.rng.float(20, 40); // crackle faster briefly
    }
    if (action === 'alert') {
      this.pulseTimer = 2.0;
      (this.arcLines.material as THREE.LineBasicMaterial).color.copy(this.palette.alert);
    }
  }
}
