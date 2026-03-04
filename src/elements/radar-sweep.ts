import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';
import { glitchOffset } from '../animation/fx';
import { hexagonPoints } from '../layout/hex-grid';

export class RadarSweepElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'radar-sweep',
    meta: { shape: 'radial', roles: ['scanner'], moods: ['tactical'], bandAffinity: 'bass', sizes: ['needs-medium', 'needs-large'] },
  };
  private sweepLine!: THREE.Line;
  private ringLines!: THREE.LineSegments;
  private blips: THREE.Points | null = null;
  private angle: number = 0;
  private speed: number = 0;
  private blipData: Array<{ angle: number; radius: number; brightness: number }> = [];
  private alertMode: boolean = false;
  private isHex: boolean = false;

  build(): void {
    const variant = this.rng.int(0, 3);
    const presets = [
      { ringCount: 5, blipCount: 12, speed: 2.5, segments: 64, decayJitter: 0 },      // Standard
      { ringCount: 9, blipCount: 28, speed: 5.0, segments: 128, decayJitter: 0.02 },   // Dense/Intense
      { ringCount: 3, blipCount: 5, speed: 1.2, segments: 32, decayJitter: -0.01 },    // Minimal/Sparse
      { ringCount: 7, blipCount: 18, speed: 8.0, segments: 48, decayJitter: 0.01 },    // Exotic/Alt
    ];
    const p = presets[variant];

    this.glitchAmount = 5;
    const { x, y, w, h } = this.px;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const radius = Math.min(w, h) / 2 * 0.9;
    this.speed = p.speed + this.rng.float(-0.3, 0.3);
    this.isHex = !!this.region.hexCell;

    // Concentric rings + crosshairs
    const ringVerts: number[] = [];
    const ringCount = p.ringCount + this.rng.int(-1, 1);
    const segments = p.segments;

    if (this.isHex) {
      for (let r = 1; r <= ringCount; r++) {
        const rr = (radius / ringCount) * r;
        const pts = hexagonPoints(cx, cy, rr, Math.max(1, Math.floor(segments / 6)));
        for (let i = 0; i < pts.length; i++) {
          const next = pts[(i + 1) % pts.length];
          ringVerts.push(pts[i].x, pts[i].y, 0, next.x, next.y, 0);
        }
      }
      // 6 radial lines to hex vertices
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i;
        ringVerts.push(cx, cy, 0, cx + Math.cos(a) * radius, cy + Math.sin(a) * radius, 0);
      }
    } else {
      for (let r = 1; r <= ringCount; r++) {
        const rr = (radius / ringCount) * r;
        for (let i = 0; i < segments; i++) {
          const a1 = (i / segments) * Math.PI * 2;
          const a2 = ((i + 1) / segments) * Math.PI * 2;
          ringVerts.push(
            cx + Math.cos(a1) * rr, cy + Math.sin(a1) * rr, 0,
            cx + Math.cos(a2) * rr, cy + Math.sin(a2) * rr, 0,
          );
        }
      }
      ringVerts.push(cx - radius, cy, 0, cx + radius, cy, 0);
      ringVerts.push(cx, cy - radius, 0, cx, cy + radius, 0);
    }

    const ringGeo = new THREE.BufferGeometry();
    ringGeo.setAttribute('position', new THREE.Float32BufferAttribute(ringVerts, 3));
    this.ringLines = new THREE.LineSegments(ringGeo, new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.ringLines);

    // Sweep line
    const sweepGeo = new THREE.BufferGeometry();
    sweepGeo.setAttribute('position', new THREE.Float32BufferAttribute([
      cx, cy, 1, cx + radius, cy, 1,
    ], 3));
    this.sweepLine = new THREE.Line(sweepGeo, new THREE.LineBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.sweepLine);

    // Blips
    const blipCount = p.blipCount + this.rng.int(-2, 2);
    for (let i = 0; i < blipCount; i++) {
      this.blipData.push({
        angle: this.rng.float(0, Math.PI * 2),
        radius: this.rng.float(0.2, 0.9) * radius,
        brightness: 0,
      });
    }
    const blipPos = new Float32Array(blipCount * 3);
    for (let i = 0; i < blipCount; i++) {
      const b = this.blipData[i];
      blipPos[i * 3] = cx + Math.cos(b.angle) * b.radius;
      blipPos[i * 3 + 1] = cy + Math.sin(b.angle) * b.radius;
      blipPos[i * 3 + 2] = 2;
    }
    const blipGeo = new THREE.BufferGeometry();
    blipGeo.setAttribute('position', new THREE.BufferAttribute(blipPos, 3));
    this.blips = new THREE.Points(blipGeo, new THREE.PointsMaterial({
      color: this.palette.primary,
      size: Math.max(4, Math.min(w, h) * 0.008),
      transparent: true,
      opacity: 0,
      sizeAttenuation: false,
    }));
    this.group.add(this.blips);
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    const { x, y, w, h } = this.px;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const radius = Math.min(w, h) / 2 * 0.9;

    this.angle += dt * this.speed;

    // Update sweep line endpoint
    const positions = this.sweepLine.geometry.getAttribute('position') as THREE.BufferAttribute;
    positions.setXY(0, cx, cy);
    if (this.isHex) {
      // Intersect ray from center at sweep angle with hex boundary
      const cosA = Math.cos(this.angle), sinA = Math.sin(this.angle);
      // For flat-top hex, find the edge the ray crosses and compute intersection
      let endR = radius;
      for (let i = 0; i < 6; i++) {
        const a1 = (Math.PI / 3) * i;
        const a2 = (Math.PI / 3) * ((i + 1) % 6);
        // Edge from vertex i to vertex i+1
        const ex1 = Math.cos(a1), ey1 = Math.sin(a1);
        const ex2 = Math.cos(a2), ey2 = Math.sin(a2);
        // Ray: P = t*(cosA, sinA), Edge: Q = ex1 + s*(ex2-ex1, ey2-ey1)
        const dx = ex2 - ex1, dy = ey2 - ey1;
        const denom = cosA * dy - sinA * dx;
        if (Math.abs(denom) < 1e-10) continue;
        const s = (cosA * ey1 - sinA * ex1) / denom;
        if (s < 0 || s > 1) continue;
        const t = (ex1 * dy - ey1 * dx) / denom;
        if (t > 0) endR = Math.min(endR, t * radius);
      }
      positions.setXY(1, cx + cosA * endR, cy + sinA * endR);
    } else {
      positions.setXY(1, cx + Math.cos(this.angle) * radius, cy + Math.sin(this.angle) * radius);
    }
    positions.needsUpdate = true;

    const sweepColor = this.alertMode ? this.palette.alert : this.palette.primary;
    (this.sweepLine.material as THREE.LineBasicMaterial).color.copy(sweepColor);
    (this.sweepLine.material as THREE.LineBasicMaterial).opacity = opacity;
    (this.ringLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.4;

    // Update blip brightness based on sweep proximity
    if (this.blips) {
      const blipPositions = this.blips.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < this.blipData.length; i++) {
        const b = this.blipData[i];
        let angleDiff = ((this.angle - b.angle) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
        if (angleDiff < 0.3) {
          b.brightness = 1;
        } else {
          b.brightness *= 0.97;
        }
        // Jitter blips during glitch
        const jx = this.glitchTimer > 0 ? glitchOffset(this.glitchTimer + i, 3) : 0;
        blipPositions.setX(i, cx + Math.cos(b.angle) * b.radius + jx);
      }
      blipPositions.needsUpdate = true;
      (this.blips.material as THREE.PointsMaterial).opacity = opacity * 0.8;
      (this.blips.material as THREE.PointsMaterial).color.copy(sweepColor);
    }
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      this.speed = this.rng.float(4, 12); // spin fast briefly
    }
    if (action === 'alert') {
      this.alertMode = true;
      this.pulseTimer = 2.0;
      this.speed *= 2;
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) { this.alertMode = false; return; }
    // Scale sweep speed with intensity
    this.speed = this.rng.float(1.5, 3.5) * (1 + level * 0.3);
    // Spawn extra blips at higher levels
    if (level >= 2) {
      const extra = Math.min(3, level - 1);
      const radius = Math.min(this.px.w, this.px.h) / 2 * 0.9;
      for (let i = 0; i < extra; i++) {
        if (this.blipData.length < 30) {
          this.blipData.push({
            angle: this.rng.float(0, Math.PI * 2),
            radius: this.rng.float(0.2, 0.9) * radius,
            brightness: 1,
          });
        }
      }
    }
    // Alert color at level 3+
    if (level >= 3) { this.alertMode = true; }
    if (level >= 5) { this.alertMode = true; }
  }
}
