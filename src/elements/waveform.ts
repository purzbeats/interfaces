import * as THREE from 'three';
import { BaseElement } from './base-element';

export class WaveformElement extends BaseElement {
  private line!: THREE.Line;
  private numPoints: number = 0;
  private frequency: number = 0;
  private amplitude: number = 0;
  private phase: number = 0;
  private noiseFreq: number = 0;
  private waveType: number = 0;

  build(): void {
    this.glitchAmount = 5;
    this.numPoints = this.rng.int(64, 200);
    this.frequency = this.rng.float(2, 8);
    this.amplitude = this.rng.float(0.3, 0.45);
    this.phase = this.rng.float(0, Math.PI * 2);
    this.noiseFreq = this.rng.float(5, 20);
    this.waveType = this.rng.int(0, 3);

    const positions = new Float32Array(this.numPoints * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.line = new THREE.Line(geo, new THREE.LineBasicMaterial({
      color: this.palette.secondary,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.line);

    // Border
    const { x, y, w, h } = this.px;
    const bv = new Float32Array([
      x, y, 0, x + w, y, 0,
      x + w, y, 0, x + w, y + h, 0,
      x + w, y + h, 0, x, y + h, 0,
      x, y + h, 0, x, y, 0,
    ]);
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.BufferAttribute(bv, 3));
    this.group.add(new THREE.LineSegments(bg, new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    })));
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    const { x, y, w, h } = this.px;
    const gx = this.group.position.x;

    const positions = this.line.geometry.getAttribute('position') as THREE.BufferAttribute;
    const cy = y + h / 2;
    const amp = h * this.amplitude;

    for (let i = 0; i < this.numPoints; i++) {
      const t = i / (this.numPoints - 1);
      const px = x + w * t + gx;

      let value: number;
      switch (this.waveType) {
        case 0:
          value = Math.sin(t * this.frequency * Math.PI * 2 + time * 3 + this.phase);
          break;
        case 1:
          value = ((t * this.frequency + time * 0.5) % 1) * 2 - 1;
          value += Math.sin(t * this.noiseFreq + time * 5) * 0.3;
          break;
        default:
          value = Math.sin(t * this.frequency * Math.PI * 2 + time * 2 + this.phase)
            + Math.sin(t * this.frequency * 1.5 * Math.PI * 2 + time * 3) * 0.5
            + Math.sin(t * this.noiseFreq + time * 7) * 0.15;
          value /= 1.65;
      }

      // Glitch: inject spikes
      if (this.glitchTimer > 0 && Math.sin(i * 3.7 + this.glitchTimer * 50) > 0.8) {
        value += (Math.sin(i * 17.3) > 0 ? 1 : -1) * 0.5 * this.glitchTimer;
      }

      positions.setXYZ(i, px, cy + value * amp, 1);
    }
    positions.needsUpdate = true;
    (this.line.material as THREE.LineBasicMaterial).opacity = opacity;

    this.group.children.forEach((child) => {
      if (child instanceof THREE.LineSegments) {
        (child.material as THREE.LineBasicMaterial).opacity = opacity * 0.3;
      }
    });
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      this.frequency = this.rng.float(2, 12);
    }
    if (action === 'alert') {
      (this.line.material as THREE.LineBasicMaterial).color.copy(this.palette.alert);
    }
  }
}
