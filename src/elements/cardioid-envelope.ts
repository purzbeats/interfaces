import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Cardioid formed as envelope of circles. Draw N circles whose centers
 * lie on a base circle, each passing through a fixed point. The envelope
 * of these circles forms a cardioid. Animate N increasing over time.
 * Line geometry with progressive reveal.
 */
export class CardioidEnvelopeElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'cardioid-envelope',
    meta: {
      shape: 'radial',
      roles: ['decorative'],
      moods: ['ambient', 'diagnostic'],
      bandAffinity: 'mid',
      sizes: ['needs-medium', 'needs-large'],
    },
  };

  private envelopeCircles: THREE.Line[] = [];
  private envelopeMats: THREE.LineBasicMaterial[] = [];
  private cardioidLine!: THREE.Line;
  private cardioidMat!: THREE.LineBasicMaterial;
  private baseLine!: THREE.Line;
  private baseMat!: THREE.LineBasicMaterial;

  private cx = 0;
  private cy = 0;
  private baseRadius = 0;
  private maxCircles = 0;
  private circleSegs = 32;
  private revealSpeed = 0;
  private rotSpeed = 0;
  private cardioidPoints = 0;
  private cardioidPositions!: Float32Array;

  build(): void {
    this.glitchAmount = 4;
    const variant = this.rng.int(0, 3);
    const { x, y, w, h } = this.px;

    this.cx = x + w / 2;
    this.cy = y + h / 2;
    this.baseRadius = Math.min(w, h) * 0.22;

    const presets = [
      { circles: 36, reveal: 0.3,  rot: 0.08, cPoints: 200 },
      { circles: 60, reveal: 0.2,  rot: 0.05, cPoints: 300 },
      { circles: 24, reveal: 0.5,  rot: 0.12, cPoints: 150 },
      { circles: 48, reveal: 0.15, rot: 0.06, cPoints: 250 },
    ];
    const p = presets[variant];

    this.maxCircles = p.circles;
    this.revealSpeed = p.reveal;
    this.rotSpeed = p.rot;
    this.cardioidPoints = p.cPoints;

    // Create envelope circle line objects
    for (let i = 0; i < this.maxCircles; i++) {
      const positions = new Float32Array((this.circleSegs + 1) * 3);
      for (let j = 0; j <= this.circleSegs; j++) {
        positions[j * 3] = this.cx;
        positions[j * 3 + 1] = this.cy;
        positions[j * 3 + 2] = 0;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const mat = new THREE.LineBasicMaterial({
        color: this.palette.dim, transparent: true, opacity: 0,
      });
      const line = new THREE.Line(geo, mat);
      this.envelopeCircles.push(line);
      this.envelopeMats.push(mat);
      this.group.add(line);
    }

    // Base circle
    const basePositions = new Float32Array((this.circleSegs + 1) * 3);
    for (let i = 0; i <= this.circleSegs; i++) {
      const a = (i / this.circleSegs) * Math.PI * 2;
      basePositions[i * 3] = this.cx + Math.cos(a) * this.baseRadius;
      basePositions[i * 3 + 1] = this.cy + Math.sin(a) * this.baseRadius;
      basePositions[i * 3 + 2] = 0;
    }
    const baseGeo = new THREE.BufferGeometry();
    baseGeo.setAttribute('position', new THREE.BufferAttribute(basePositions, 3));
    this.baseMat = new THREE.LineBasicMaterial({
      color: this.palette.dim, transparent: true, opacity: 0,
    });
    this.baseLine = new THREE.Line(baseGeo, this.baseMat);
    this.group.add(this.baseLine);

    // Cardioid curve (the envelope itself)
    this.cardioidPositions = new Float32Array(this.cardioidPoints * 3);
    for (let i = 0; i < this.cardioidPoints; i++) {
      const t = (i / (this.cardioidPoints - 1)) * Math.PI * 2;
      // Cardioid: r = 2a(1 + cos(t))
      const r = this.baseRadius * (1 + Math.cos(t));
      this.cardioidPositions[i * 3] = this.cx + r * Math.cos(t);
      this.cardioidPositions[i * 3 + 1] = this.cy + r * Math.sin(t);
      this.cardioidPositions[i * 3 + 2] = 0;
    }
    const cardioidGeo = new THREE.BufferGeometry();
    cardioidGeo.setAttribute('position', new THREE.BufferAttribute(this.cardioidPositions, 3));
    this.cardioidMat = new THREE.LineBasicMaterial({
      color: this.palette.primary, transparent: true, opacity: 0,
    });
    this.cardioidLine = new THREE.Line(cardioidGeo, this.cardioidMat);
    this.group.add(this.cardioidLine);
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    const rotation = time * this.rotSpeed;

    // How many circles are visible (cyclic reveal)
    const cycle = (time * this.revealSpeed) % 2;
    const revealFrac = cycle <= 1 ? cycle : 2 - cycle;
    const visibleCount = Math.max(1, (revealFrac * this.maxCircles) | 0);

    // Fixed point on the base circle (the point all envelope circles pass through)
    const fixedAngle = rotation;
    const fixedX = this.cx + Math.cos(fixedAngle) * this.baseRadius;
    const fixedY = this.cy + Math.sin(fixedAngle) * this.baseRadius;

    // Update envelope circles
    for (let i = 0; i < this.maxCircles; i++) {
      const visible = i < visibleCount;
      const pos = this.envelopeCircles[i].geometry.getAttribute('position') as THREE.BufferAttribute;

      if (visible) {
        // Center of this envelope circle on the base circle
        const angle = (i / this.maxCircles) * Math.PI * 2 + rotation;
        const centerX = this.cx + Math.cos(angle) * this.baseRadius;
        const centerY = this.cy + Math.sin(angle) * this.baseRadius;

        // Radius: distance from this center to the fixed point
        const dx = fixedX - centerX;
        const dy = fixedY - centerY;
        const r = Math.sqrt(dx * dx + dy * dy);

        for (let j = 0; j <= this.circleSegs; j++) {
          const a = (j / this.circleSegs) * Math.PI * 2;
          pos.setXYZ(j, centerX + Math.cos(a) * r, centerY + Math.sin(a) * r, 0);
        }
        pos.needsUpdate = true;

        // Fade based on position in reveal
        const fadeFrac = i / visibleCount;
        this.envelopeMats[i].opacity = opacity * (0.08 + 0.15 * (1 - fadeFrac));
      } else {
        this.envelopeMats[i].opacity = 0;
      }
    }

    // Update cardioid curve with rotation
    for (let i = 0; i < this.cardioidPoints; i++) {
      const t = (i / (this.cardioidPoints - 1)) * Math.PI * 2;
      const r = this.baseRadius * (1 + Math.cos(t));
      this.cardioidPositions[i * 3] = this.cx + r * Math.cos(t + rotation);
      this.cardioidPositions[i * 3 + 1] = this.cy + r * Math.sin(t + rotation);
      this.cardioidPositions[i * 3 + 2] = 0;
    }
    (this.cardioidLine.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;

    // Cardioid becomes more visible as more circles are revealed
    this.cardioidMat.opacity = opacity * 0.7 * revealFrac;
    this.baseMat.opacity = opacity * 0.25;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Flash all circles at once
      for (let i = 0; i < this.maxCircles; i++) {
        this.envelopeMats[i].opacity = 0.6;
      }
      this.revealSpeed *= 4;
      setTimeout(() => { this.revealSpeed /= 4; }, 500);
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) {
      this.revealSpeed = 0.3;
      this.rotSpeed = 0.08;
      return;
    }
    this.revealSpeed = 0.3 + level * 0.08;
    this.rotSpeed = 0.08 + level * 0.03;
  }
}
