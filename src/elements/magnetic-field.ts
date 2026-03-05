import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Magnetic field line visualization between poles.
 * Particles trace field lines from north to south poles with proper
 * dipole/quadrupole physics — like a magnetoscope laboratory display.
 */
export class MagneticFieldElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'magnetic-field-lines',
    meta: { shape: 'rectangular', roles: ['data-display', 'decorative'], moods: ['diagnostic', 'tactical'], bandAffinity: 'mid', sizes: ['needs-medium', 'needs-large'] },
  };

  private poleCount = 0;
  private poleX: number[] = [];
  private poleY: number[] = [];
  private poleStrength: number[] = []; // + = north, - = south

  private lineCount = 0;
  private lineLen = 80;
  private lineMesh!: THREE.Line;
  private lineMat!: THREE.LineBasicMaterial;
  private linePositions!: Float32Array;

  private poleMesh!: THREE.Points;
  private poleColors!: Float32Array;

  build(): void {
    const variant = this.rng.int(0, 3);
    const presets = [
      { poles: 2, lines: 24, lineLen: 80 },
      { poles: 4, lines: 40, lineLen: 60 },
      { poles: 2, lines: 16, lineLen: 100 },
      { poles: 6, lines: 48, lineLen: 50 },
    ];
    const p = presets[variant];
    this.glitchAmount = 4;

    const { x, y, w, h } = this.px;
    this.poleCount = p.poles;
    this.lineCount = p.lines;
    this.lineLen = p.lineLen;

    // Alternating north/south poles
    for (let i = 0; i < this.poleCount; i++) {
      this.poleX.push(x + this.rng.float(w * 0.2, w * 0.8));
      this.poleY.push(y + this.rng.float(h * 0.2, h * 0.8));
      this.poleStrength.push(i % 2 === 0 ? 1 : -1);
    }

    // Field line geometry
    const totalPts = this.lineCount * this.lineLen;
    this.linePositions = new Float32Array(totalPts * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.linePositions, 3));
    this.lineMat = new THREE.LineBasicMaterial({ color: this.palette.primary, transparent: true, opacity: 0 });
    this.lineMesh = new THREE.Line(geo, this.lineMat);
    this.group.add(this.lineMesh);

    // Pole markers
    const polePos = new Float32Array(this.poleCount * 3);
    this.poleColors = new Float32Array(this.poleCount * 3);
    for (let i = 0; i < this.poleCount; i++) {
      polePos[i * 3] = this.poleX[i];
      polePos[i * 3 + 1] = this.poleY[i];
      polePos[i * 3 + 2] = 1;
      const c = this.poleStrength[i] > 0 ? this.palette.secondary : this.palette.primary;
      this.poleColors[i * 3] = c.r;
      this.poleColors[i * 3 + 1] = c.g;
      this.poleColors[i * 3 + 2] = c.b;
    }
    const pg2 = new THREE.BufferGeometry();
    pg2.setAttribute('position', new THREE.BufferAttribute(polePos, 3));
    pg2.setAttribute('color', new THREE.BufferAttribute(this.poleColors, 3));
    this.poleMesh = new THREE.Points(pg2, new THREE.PointsMaterial({
      vertexColors: true, transparent: true, opacity: 0, size: 5, sizeAttenuation: false,
    }));
    this.group.add(this.poleMesh);

    this.traceAllLines();
  }

  private fieldAt(wx: number, wy: number): { bx: number; by: number } {
    let bx = 0, by = 0;
    for (let i = 0; i < this.poleCount; i++) {
      const dx = wx - this.poleX[i];
      const dy = wy - this.poleY[i];
      const d2 = dx * dx + dy * dy + 100;
      const d = Math.sqrt(d2);
      const str = this.poleStrength[i] * 5000 / (d2);
      bx += (dx / d) * str;
      by += (dy / d) * str;
    }
    return { bx, by };
  }

  private traceAllLines(): void {
    const stepSize = 3;
    const { x, y, w, h } = this.px;

    for (let l = 0; l < this.lineCount; l++) {
      // Start near a north pole
      const northPoles = [];
      for (let i = 0; i < this.poleCount; i++) {
        if (this.poleStrength[i] > 0) northPoles.push(i);
      }
      if (northPoles.length === 0) break;

      const pole = northPoles[l % northPoles.length];
      const angle = (l / this.lineCount) * Math.PI * 2;
      let lx = this.poleX[pole] + Math.cos(angle) * 10;
      let ly = this.poleY[pole] + Math.sin(angle) * 10;

      const base = l * this.lineLen * 3;

      let stopped = false;
      for (let s = 0; s < this.lineLen; s++) {
        if (stopped) {
          // Fill remaining with last valid position to avoid lines to origin
          this.linePositions[base + s * 3] = lx;
          this.linePositions[base + s * 3 + 1] = ly;
          this.linePositions[base + s * 3 + 2] = 0;
          continue;
        }

        this.linePositions[base + s * 3] = lx;
        this.linePositions[base + s * 3 + 1] = ly;
        this.linePositions[base + s * 3 + 2] = 0;

        const { bx, by } = this.fieldAt(lx, ly);
        const mag = Math.sqrt(bx * bx + by * by) + 0.001;
        lx += (bx / mag) * stepSize;
        ly += (by / mag) * stepSize;

        if (lx < x - 10 || lx > x + w + 10 || ly < y - 10 || ly > y + h + 10) stopped = true;
      }
    }

    (this.lineMesh.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);

    // Slowly drift poles
    for (let i = 0; i < this.poleCount; i++) {
      this.poleX[i] += Math.sin(time * 0.3 + i * 2) * 5 * dt;
      this.poleY[i] += Math.cos(time * 0.4 + i * 3) * 5 * dt;
    }
    // Retrace field lines
    this.traceAllLines();

    // Update pole markers
    const ppos = this.poleMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < this.poleCount; i++) ppos.setXYZ(i, this.poleX[i], this.poleY[i], 1);
    ppos.needsUpdate = true;

    this.lineMat.opacity = opacity * 0.5;
    (this.poleMesh.material as THREE.PointsMaterial).opacity = opacity;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      for (let i = 0; i < this.poleCount; i++) this.poleStrength[i] *= -1;
    }
    if (action === 'alert') {
      const { x, y, w, h } = this.px;
      this.poleX.push(x + w / 2);
      this.poleY.push(y + h / 2);
      this.poleStrength.push(2);
      this.poleCount++;
      setTimeout(() => {
        this.poleX.pop(); this.poleY.pop(); this.poleStrength.pop();
        this.poleCount--;
      }, 2000);
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
  }
}
