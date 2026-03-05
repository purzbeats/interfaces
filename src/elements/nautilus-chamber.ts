import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

interface NautilusPreset {
  maxChambers: number;
  growInterval: number;
  spiralTightness: number;
  growthFactor: number;
}

/**
 * Nautilus shell with chambers. Logarithmic spiral with septa (chamber dividers).
 * Each chamber slightly larger. Growth animation adding chambers. Line geometry.
 */
export class NautilusChamberElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'nautilus-chamber',
    meta: {
      shape: 'radial',
      roles: ['decorative'],
      moods: ['ambient'],
      sizes: ['needs-medium', 'needs-large'],
      bandAffinity: 'bass',
    } satisfies ElementMeta,
  };

  private spiralLine!: THREE.Line;
  private spiralMat!: THREE.LineBasicMaterial;
  private septa!: THREE.LineSegments;
  private septaMat!: THREE.LineBasicMaterial;

  private cx = 0;
  private cy = 0;
  private maxRadius = 0;
  private maxChambers = 20;
  private currentChambers = 0;
  private growTimer = 0;
  private growInterval = 1.0;
  private spiralTightness = 0.18;
  private growthFactor = 1.1;
  private spiralPointsPerChamber = 20;
  private totalSpiralPoints = 0;
  private intensityLevel = 0;

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;
    this.cx = x + w / 2;
    this.cy = y + h / 2;
    this.maxRadius = Math.min(w, h) * 0.44;

    const variant = this.rng.int(0, 4);
    const presets: NautilusPreset[] = [
      { maxChambers: 20, growInterval: 1.0, spiralTightness: 0.18, growthFactor: 1.10 },
      { maxChambers: 30, growInterval: 0.6, spiralTightness: 0.12, growthFactor: 1.08 },
      { maxChambers: 14, growInterval: 1.5, spiralTightness: 0.25, growthFactor: 1.15 },
      { maxChambers: 24, growInterval: 0.8, spiralTightness: 0.15, growthFactor: 1.12 },
    ];
    const p = presets[variant];
    this.maxChambers = p.maxChambers;
    this.growInterval = p.growInterval;
    this.spiralTightness = p.spiralTightness;
    this.growthFactor = p.growthFactor;

    this.totalSpiralPoints = this.maxChambers * this.spiralPointsPerChamber;

    // ── Spiral outline ──
    const spiralPos = new Float32Array((this.totalSpiralPoints + 1) * 3);
    // Fill all positions with center initially
    for (let i = 0; i <= this.totalSpiralPoints; i++) {
      spiralPos[i * 3] = this.cx;
      spiralPos[i * 3 + 1] = this.cy;
      spiralPos[i * 3 + 2] = 0;
    }
    const spiralGeo = new THREE.BufferGeometry();
    spiralGeo.setAttribute('position', new THREE.BufferAttribute(spiralPos, 3));
    spiralGeo.setDrawRange(0, 0);
    this.spiralMat = new THREE.LineBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
    });
    this.spiralLine = new THREE.Line(spiralGeo, this.spiralMat);
    this.group.add(this.spiralLine);

    // ── Septa (chamber dividers) ──
    const septaPos = new Float32Array(this.maxChambers * 2 * 3);
    for (let i = 0; i < this.maxChambers * 2; i++) {
      septaPos[i * 3] = this.cx;
      septaPos[i * 3 + 1] = this.cy;
      septaPos[i * 3 + 2] = 0;
    }
    const septaGeo = new THREE.BufferGeometry();
    septaGeo.setAttribute('position', new THREE.BufferAttribute(septaPos, 3));
    septaGeo.setDrawRange(0, 0);
    this.septaMat = new THREE.LineBasicMaterial({
      color: this.palette.secondary,
      transparent: true,
      opacity: 0,
    });
    this.septa = new THREE.LineSegments(septaGeo, this.septaMat);
    this.group.add(this.septa);

    this.growTimer = this.rng.float(0, this.growInterval * 0.5);
  }

  private spiralRadius(theta: number): number {
    // Logarithmic spiral: r = a * e^(b*theta)
    const a = this.maxRadius * 0.02;
    return a * Math.exp(this.spiralTightness * theta);
  }

  private updateGeometry(): void {
    if (this.currentChambers <= 0) return;

    const spiralPos = this.spiralLine.geometry.getAttribute('position') as THREE.BufferAttribute;
    const septaPos = this.septa.geometry.getAttribute('position') as THREE.BufferAttribute;

    const pointsToShow = this.currentChambers * this.spiralPointsPerChamber;
    const maxTheta = this.currentChambers * (Math.PI * 2 / 6); // each chamber ~60 degrees

    // Compute spiral points
    for (let i = 0; i <= pointsToShow && i <= this.totalSpiralPoints; i++) {
      const t = i / pointsToShow;
      const theta = t * maxTheta;
      const r = Math.min(this.spiralRadius(theta), this.maxRadius);
      spiralPos.setXYZ(i,
        this.cx + Math.cos(theta) * r,
        this.cy + Math.sin(theta) * r,
        0,
      );
    }
    spiralPos.needsUpdate = true;
    this.spiralLine.geometry.setDrawRange(0, pointsToShow + 1);

    // Compute septa — lines from center toward outer edge at each chamber boundary
    for (let c = 0; c < this.currentChambers && c < this.maxChambers; c++) {
      const theta = (c + 1) * (Math.PI * 2 / 6);
      const rInner = this.spiralRadius(theta) * 0.3;
      const rOuter = this.spiralRadius(theta);
      const clampedOuter = Math.min(rOuter, this.maxRadius);

      septaPos.setXYZ(c * 2,
        this.cx + Math.cos(theta) * rInner,
        this.cy + Math.sin(theta) * rInner,
        0,
      );
      septaPos.setXYZ(c * 2 + 1,
        this.cx + Math.cos(theta) * clampedOuter,
        this.cy + Math.sin(theta) * clampedOuter,
        0,
      );
    }
    septaPos.needsUpdate = true;
    this.septa.geometry.setDrawRange(0, this.currentChambers * 2);
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);

    // Grow chambers over time
    const interval = this.growInterval / (1 + this.intensityLevel * 0.3);
    this.growTimer += dt;
    if (this.growTimer >= interval && this.currentChambers < this.maxChambers) {
      this.growTimer = 0;
      this.currentChambers++;
      this.updateGeometry();
    }

    // Reset when fully grown
    if (this.currentChambers >= this.maxChambers) {
      this.growTimer += dt;
      if (this.growTimer > 2.0) {
        this.currentChambers = 0;
        this.growTimer = 0;
        this.spiralLine.geometry.setDrawRange(0, 0);
        this.septa.geometry.setDrawRange(0, 0);
      }
    }

    this.spiralMat.opacity = opacity;
    this.septaMat.opacity = opacity * 0.6;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Instantly grow several chambers
      const burst = Math.min(this.maxChambers - this.currentChambers, 5);
      this.currentChambers += burst;
      this.updateGeometry();
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    this.intensityLevel = level;
    if (level >= 4) {
      // Rapid growth burst
      const burst = Math.min(this.maxChambers - this.currentChambers, level);
      this.currentChambers += burst;
      this.updateGeometry();
    }
  }
}
