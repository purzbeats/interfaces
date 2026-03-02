import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Circular display with sine wave distortion around the perimeter.
 * The radius varies by a sine function, creating a morphing blob shape.
 */
export class WaveRadarElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'wave-radar',
    meta: { shape: 'radial', roles: ['scanner', 'data-display'], moods: ['tactical', 'diagnostic'], sizes: ['needs-medium'] },
  };
  private blobLine!: THREE.Line;
  private borderLine!: THREE.Line;
  private crosshairs!: THREE.LineSegments;
  private segments: number = 80;
  private waveCount: number = 0;
  private waveAmplitude: number = 0;
  private rotationSpeed: number = 0;
  private morphSpeed: number = 0;

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const maxR = Math.min(w, h) / 2 * 0.9;

    this.waveCount = this.rng.int(3, 7);
    this.waveAmplitude = this.rng.float(0.1, 0.3);
    this.rotationSpeed = this.rng.float(0.3, 0.8);
    this.morphSpeed = this.rng.float(0.5, 1.5);

    // Morphing blob line
    const blobPositions = new Float32Array((this.segments + 1) * 3);
    const blobGeo = new THREE.BufferGeometry();
    blobGeo.setAttribute('position', new THREE.BufferAttribute(blobPositions, 3));
    this.blobLine = new THREE.Line(blobGeo, new THREE.LineBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.blobLine);

    // Border circle (static reference)
    const borderPositions = new Float32Array((this.segments + 1) * 3);
    for (let i = 0; i <= this.segments; i++) {
      const a = (i / this.segments) * Math.PI * 2;
      borderPositions[i * 3] = cx + Math.cos(a) * maxR;
      borderPositions[i * 3 + 1] = cy + Math.sin(a) * maxR;
      borderPositions[i * 3 + 2] = 0;
    }
    const borderGeo = new THREE.BufferGeometry();
    borderGeo.setAttribute('position', new THREE.BufferAttribute(borderPositions, 3));
    this.borderLine = new THREE.Line(borderGeo, new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.borderLine);

    // Crosshair lines
    const crossVerts = new Float32Array([
      cx - maxR * 0.9, cy, 0, cx + maxR * 0.9, cy, 0,
      cx, cy - maxR * 0.9, 0, cx, cy + maxR * 0.9, 0,
    ]);
    const crossGeo = new THREE.BufferGeometry();
    crossGeo.setAttribute('position', new THREE.Float32BufferAttribute(crossVerts, 3));
    this.crosshairs = new THREE.LineSegments(crossGeo, new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.crosshairs);

    // Center dot
    const dotGeo = new THREE.CircleGeometry(Math.max(2, maxR * 0.025), 12);
    const dot = new THREE.Mesh(dotGeo, new THREE.MeshBasicMaterial({
      color: this.palette.secondary,
      transparent: true,
      opacity: 0,
    }));
    dot.position.set(cx, cy, 2);
    this.group.add(dot);
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    const { x, y, w, h } = this.px;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const maxR = Math.min(w, h) / 2 * 0.9;
    const gx = this.group.position.x;

    const baseR = maxR * 0.6;
    const rotation = time * this.rotationSpeed;
    const morphT = time * this.morphSpeed;

    // Update blob line
    const positions = this.blobLine.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i <= this.segments; i++) {
      const a = (i / this.segments) * Math.PI * 2;
      // Sine distortion: multiple wave components
      const distortion = Math.sin(a * this.waveCount + rotation) * this.waveAmplitude
        + Math.sin(a * (this.waveCount + 2) - morphT) * this.waveAmplitude * 0.5
        + Math.sin(a * 2 + morphT * 0.7) * this.waveAmplitude * 0.3;
      const r = baseR * (1 + distortion);
      positions.setXYZ(i, cx + Math.cos(a) * r + gx, cy + Math.sin(a) * r, 1);
    }
    positions.needsUpdate = true;

    // Update border circle positions (for glitch offset)
    const borderPos = this.borderLine.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i <= this.segments; i++) {
      const a = (i / this.segments) * Math.PI * 2;
      borderPos.setX(i, cx + Math.cos(a) * maxR + gx);
    }
    borderPos.needsUpdate = true;

    // Update crosshairs
    const crossPos = this.crosshairs.geometry.getAttribute('position') as THREE.BufferAttribute;
    crossPos.setX(0, cx - maxR * 0.9 + gx);
    crossPos.setX(1, cx + maxR * 0.9 + gx);
    crossPos.setX(2, cx + gx);
    crossPos.setX(3, cx + gx);
    crossPos.needsUpdate = true;

    (this.blobLine.material as THREE.LineBasicMaterial).opacity = opacity * 0.9;
    (this.borderLine.material as THREE.LineBasicMaterial).opacity = opacity * 0.25;
    (this.crosshairs.material as THREE.LineBasicMaterial).opacity = opacity * 0.2;

    // Center dot
    const dot = this.group.children[3] as THREE.Mesh;
    dot.position.x = cx + gx;
    (dot.material as THREE.MeshBasicMaterial).opacity = opacity * 0.6;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      this.waveAmplitude *= 3;
      this.morphSpeed *= 5;
      setTimeout(() => {
        this.waveAmplitude /= 3;
        this.morphSpeed /= 5;
      }, 500);
    }
    if (action === 'alert') {
      this.pulseTimer = 2.0;
    }
  }
}
