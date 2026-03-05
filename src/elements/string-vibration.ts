import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Standing wave visualization on vibrating strings.
 * Multiple parallel strings vibrate at different harmonics with node/antinode highlighting.
 */
export class StringVibrationElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'string-vibration',
    meta: { shape: 'rectangular', roles: ['data-display', 'decorative'], moods: ['diagnostic', 'ambient'], bandAffinity: 'high', audioSensitivity: 1.5, sizes: ['works-small', 'needs-medium', 'needs-large'] },
  };

  private stringCount = 0;
  private pointsPerString = 80;
  private harmonics!: Float32Array;
  private amplitudes!: Float32Array;
  private stringMeshes: THREE.Line[] = [];
  private stringMats: THREE.LineBasicMaterial[] = [];
  private nodeMesh!: THREE.Points;

  build(): void {
    const variant = this.rng.int(0, 3);
    const presets = [
      { strings: 6, points: 80, maxHarmonic: 6 },
      { strings: 10, points: 120, maxHarmonic: 10 },
      { strings: 3, points: 60, maxHarmonic: 3 },
      { strings: 8, points: 100, maxHarmonic: 8 },
    ];
    const p = presets[variant];
    this.glitchAmount = 4;

    const { x, y, w, h } = this.px;
    this.stringCount = p.strings;
    this.pointsPerString = p.points;
    this.harmonics = new Float32Array(this.stringCount);
    this.amplitudes = new Float32Array(this.stringCount);

    const spacing = h / (this.stringCount + 1);
    const amp = spacing * 0.3;

    // Node points (where vibration = 0)
    const nodePoints: number[] = [];

    for (let s = 0; s < this.stringCount; s++) {
      this.harmonics[s] = s + 1; // 1st, 2nd, 3rd... harmonic
      this.amplitudes[s] = amp * this.rng.float(0.5, 1.0) / (s + 1);
      const baseY = y + spacing * (s + 1);

      const pts = new Float32Array(this.pointsPerString * 3);
      for (let i = 0; i < this.pointsPerString; i++) {
        const t = i / (this.pointsPerString - 1);
        pts[i * 3] = x + t * w;
        pts[i * 3 + 1] = baseY;
        pts[i * 3 + 2] = 0;
      }

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pts, 3));
      const color = s % 2 === 0 ? this.palette.primary : this.palette.secondary;
      const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0 });
      const mesh = new THREE.Line(geo, mat);
      this.stringMeshes.push(mesh);
      this.stringMats.push(mat);
      this.group.add(mesh);

      // Nodes: endpoints + interior nodes
      nodePoints.push(x, baseY, 0.5);
      nodePoints.push(x + w, baseY, 0.5);
      for (let n = 1; n < this.harmonics[s]; n++) {
        const nx = x + (n / this.harmonics[s]) * w;
        nodePoints.push(nx, baseY, 0.5);
      }
    }

    // Node dots
    const ng = new THREE.BufferGeometry();
    ng.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nodePoints), 3));
    this.nodeMesh = new THREE.Points(ng, new THREE.PointsMaterial({
      color: this.palette.dim, transparent: true, opacity: 0, size: Math.max(1, Math.min(w, h) * 0.01), sizeAttenuation: false,
    }));
    this.group.add(this.nodeMesh);
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    const { x, y, w, h } = this.px;
    const spacing = h / (this.stringCount + 1);

    for (let s = 0; s < this.stringCount; s++) {
      const baseY = y + spacing * (s + 1);
      const pos = this.stringMeshes[s].geometry.getAttribute('position') as THREE.BufferAttribute;
      const n = this.harmonics[s];
      const a = this.amplitudes[s];
      const freq = 1 + s * 0.7; // Different frequencies

      for (let i = 0; i < this.pointsPerString; i++) {
        const t = i / (this.pointsPerString - 1);
        // Standing wave = sin(n*pi*x) * cos(omega*t)
        const displacement = a * Math.sin(n * Math.PI * t) * Math.cos(freq * time * 3);
        pos.setXYZ(i, x + t * w, baseY + displacement, 0);
      }
      pos.needsUpdate = true;
      this.stringMats[s].opacity = opacity * 0.7;
    }

    (this.nodeMesh.material as THREE.PointsMaterial).opacity = opacity * 0.4;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      for (let i = 0; i < this.stringCount; i++) this.harmonics[i] = this.rng.int(1, 12);
    }
    if (action === 'pulse') {
      for (let i = 0; i < this.stringCount; i++) this.amplitudes[i] *= 2;
      setTimeout(() => {
        const { h } = this.px;
        const spacing = h / (this.stringCount + 1);
        for (let i = 0; i < this.stringCount; i++) this.amplitudes[i] = spacing * 0.3 / (i + 1);
      }, 500);
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level >= 3) {
      for (let i = 0; i < this.stringCount; i++) this.amplitudes[i] *= 1.5;
    }
  }
}
