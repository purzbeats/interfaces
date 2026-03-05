import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

interface MothPreset {
  mothCount: number;
  spiralRate: number;
  escapeChance: number;
  trailLength: number;
}

interface Moth {
  angle: number;
  radius: number;
  angularSpeed: number;
  radialSpeed: number;
  escaped: boolean;
  escapeDir: number;
  trailX: Float32Array;
  trailY: Float32Array;
  trailHead: number;
}

/**
 * Moths orbiting a flame using logarithmic spiral approach dynamics.
 * Multiple moths spiral inward, some escape, some converge.
 * Flame as a bright point. Points + trail lines.
 */
export class MothFlameElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'moth-flame',
    meta: {
      shape: 'radial',
      roles: ['decorative'],
      moods: ['ambient'],
      sizes: ['works-small', 'needs-medium'],
      bandAffinity: 'high',
    } satisfies ElementMeta,
  };

  private flamePoint!: THREE.Points;
  private flameMat!: THREE.PointsMaterial;
  private mothPoints!: THREE.Points;
  private mothMat!: THREE.PointsMaterial;
  private trailLines!: THREE.LineSegments;
  private trailMat!: THREE.LineBasicMaterial;

  private cx = 0;
  private cy = 0;
  private maxRadius = 0;
  private moths: Moth[] = [];
  private mothCount = 5;
  private spiralRate = 8;
  private escapeChance = 0.3;
  private trailLength = 30;
  private intensityLevel = 0;

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;
    this.cx = x + w / 2;
    this.cy = y + h / 2;
    this.maxRadius = Math.min(w, h) * 0.4;

    const variant = this.rng.int(0, 4);
    const presets: MothPreset[] = [
      { mothCount: 5,  spiralRate: 8,  escapeChance: 0.3, trailLength: 30 },
      { mothCount: 8,  spiralRate: 5,  escapeChance: 0.2, trailLength: 20 },
      { mothCount: 3,  spiralRate: 12, escapeChance: 0.5, trailLength: 40 },
      { mothCount: 6,  spiralRate: 6,  escapeChance: 0.15, trailLength: 35 },
    ];
    const p = presets[variant];
    this.mothCount = p.mothCount;
    this.spiralRate = p.spiralRate;
    this.escapeChance = p.escapeChance;
    this.trailLength = p.trailLength;

    // Initialize moths
    for (let i = 0; i < this.mothCount; i++) {
      this.moths.push(this.createMoth());
    }

    // ── Flame point ──
    const flamePos = new Float32Array([this.cx, this.cy, 1]);
    const flameGeo = new THREE.BufferGeometry();
    flameGeo.setAttribute('position', new THREE.BufferAttribute(flamePos, 3));
    this.flameMat = new THREE.PointsMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
      size: Math.max(6, this.maxRadius * 0.05),
      sizeAttenuation: false,
    });
    this.flamePoint = new THREE.Points(flameGeo, this.flameMat);
    this.group.add(this.flamePoint);

    // ── Moth points ──
    const mothPos = new Float32Array(this.mothCount * 3);
    for (let i = 0; i < this.mothCount * 3; i++) mothPos[i] = 0;
    const mothGeo = new THREE.BufferGeometry();
    mothGeo.setAttribute('position', new THREE.BufferAttribute(mothPos, 3));
    this.mothMat = new THREE.PointsMaterial({
      color: this.palette.secondary,
      transparent: true,
      opacity: 0,
      size: Math.max(3, this.maxRadius * 0.025),
      sizeAttenuation: false,
    });
    this.mothPoints = new THREE.Points(mothGeo, this.mothMat);
    this.group.add(this.mothPoints);

    // ── Trail lines ──
    const totalTrailSegs = this.mothCount * (this.trailLength - 1);
    const trailPos = new Float32Array(totalTrailSegs * 2 * 3);
    for (let i = 0; i < trailPos.length; i++) trailPos[i] = 0;
    const trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPos, 3));
    this.trailMat = new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    });
    this.trailLines = new THREE.LineSegments(trailGeo, this.trailMat);
    this.group.add(this.trailLines);
  }

  private createMoth(): Moth {
    const trail = this.trailLength;
    const trailX = new Float32Array(trail);
    const trailY = new Float32Array(trail);
    const angle = this.rng.float(0, Math.PI * 2);
    const radius = this.rng.float(this.maxRadius * 0.5, this.maxRadius);
    const mx = this.cx + Math.cos(angle) * radius;
    const my = this.cy + Math.sin(angle) * radius;
    for (let t = 0; t < trail; t++) {
      trailX[t] = mx;
      trailY[t] = my;
    }
    return {
      angle,
      radius,
      angularSpeed: this.rng.float(1.5, 3.0),
      radialSpeed: -this.spiralRate * this.rng.float(0.5, 1.5),
      escaped: false,
      escapeDir: this.rng.chance(0.5) ? 1 : -1,
      trailX,
      trailY,
      trailHead: 0,
    };
  }

  private resetMoth(moth: Moth): void {
    moth.angle = this.rng.float(0, Math.PI * 2);
    moth.radius = this.rng.float(this.maxRadius * 0.6, this.maxRadius);
    moth.angularSpeed = this.rng.float(1.5, 3.0);
    moth.radialSpeed = -this.spiralRate * this.rng.float(0.5, 1.5);
    moth.escaped = false;
    moth.escapeDir = this.rng.chance(0.5) ? 1 : -1;
    const mx = this.cx + Math.cos(moth.angle) * moth.radius;
    const my = this.cy + Math.sin(moth.angle) * moth.radius;
    for (let t = 0; t < this.trailLength; t++) {
      moth.trailX[t] = mx;
      moth.trailY[t] = my;
    }
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    const speedMul = 1 + this.intensityLevel * 0.3;

    // Animate flame flicker
    const flamePos = this.flamePoint.geometry.getAttribute('position') as THREE.BufferAttribute;
    const flicker = Math.sin(time * 15) * this.maxRadius * 0.01;
    flamePos.setXYZ(0, this.cx + flicker, this.cy + Math.sin(time * 20) * this.maxRadius * 0.008, 1);
    flamePos.needsUpdate = true;

    const mothPos = this.mothPoints.geometry.getAttribute('position') as THREE.BufferAttribute;
    const trailPos = this.trailLines.geometry.getAttribute('position') as THREE.BufferAttribute;

    for (let m = 0; m < this.mothCount; m++) {
      const moth = this.moths[m];

      if (moth.escaped) {
        // Fly outward
        moth.radius += Math.abs(moth.radialSpeed) * dt * speedMul * 2;
        moth.angle += moth.angularSpeed * dt * speedMul * 0.5 * moth.escapeDir;
        if (moth.radius > this.maxRadius * 1.2) {
          this.resetMoth(moth);
        }
      } else {
        // Spiral inward (logarithmic spiral approach)
        moth.angle += moth.angularSpeed * dt * speedMul;
        moth.radius += moth.radialSpeed * dt * speedMul;

        // Check for escape or convergence
        if (moth.radius < this.maxRadius * 0.05) {
          if (this.rng.chance(this.escapeChance)) {
            moth.escaped = true;
            moth.radialSpeed = Math.abs(moth.radialSpeed) * 1.5;
          } else {
            // Reset — moth converged to flame
            this.resetMoth(moth);
          }
        }
      }

      const mx = this.cx + Math.cos(moth.angle) * moth.radius;
      const my = this.cy + Math.sin(moth.angle) * moth.radius;

      // Record trail
      moth.trailHead = (moth.trailHead + 1) % this.trailLength;
      moth.trailX[moth.trailHead] = mx;
      moth.trailY[moth.trailHead] = my;

      mothPos.setXYZ(m, mx, my, 1);

      // Update trail line segments
      const trailOffset = m * (this.trailLength - 1);
      for (let t = 0; t < this.trailLength - 1; t++) {
        const idx0 = (moth.trailHead - t + this.trailLength) % this.trailLength;
        const idx1 = (moth.trailHead - t - 1 + this.trailLength) % this.trailLength;
        const vi = (trailOffset + t) * 2;
        trailPos.setXYZ(vi, moth.trailX[idx0], moth.trailY[idx0], 0.5);
        trailPos.setXYZ(vi + 1, moth.trailX[idx1], moth.trailY[idx1], 0.5);
      }
    }

    mothPos.needsUpdate = true;
    trailPos.needsUpdate = true;

    this.flameMat.opacity = opacity;
    this.mothMat.opacity = opacity * 0.9;
    this.trailMat.opacity = opacity * 0.3;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // All moths scatter outward
      for (const moth of this.moths) {
        moth.escaped = true;
        moth.radialSpeed = this.spiralRate * 2;
      }
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    this.intensityLevel = level;
    if (level >= 4) {
      // Increase spiral speed dramatically
      for (const moth of this.moths) {
        moth.angularSpeed *= 1.5;
      }
    }
  }
}
