import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Loading spinner — rotating loading indicators with trailing opacity.
 * Four variants: single arc, double arc, dots in a circle, segmented ring.
 */
export class LoadingSpinnerElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'loading-spinner',
    meta: {
      shape: 'radial',
      roles: ['gauge', 'decorative'],
      moods: ['diagnostic', 'ambient'],
      bandAffinity: 'mid',
      sizes: ['works-small', 'needs-medium'],
    },
  };

  private variant: number = 0;

  // Variant 0: single spinning arc
  private singleArc!: THREE.Line;
  private singleArcPoints: THREE.Vector3[] = [];

  // Variant 1: double arcs (inner + outer, opposing)
  private outerArc!: THREE.Line;
  private innerArc!: THREE.Line;
  private outerPoints: THREE.Vector3[] = [];
  private innerPoints: THREE.Vector3[] = [];

  // Variant 2: dots in a circle
  private dotsMesh!: THREE.Points;
  private dotCount: number = 12;
  private dotPhases: number[] = [];

  // Variant 3: segmented ring
  private segments: THREE.Line[] = [];
  private segmentCount: number = 12;
  private segPhases: number[] = [];

  // Animation state
  private spinAngle: number = 0;
  private spinSpeed: number = 2.0;
  private arcSpan: number = Math.PI * 1.4;
  private radius: number = 0;
  private innerRadius: number = 0;
  private cx: number = 0;
  private cy: number = 0;

  private alertTimer: number = 0;
  private speedBoost: number = 1;

  build(): void {
    this.variant = this.rng.int(0, 3);
    const { x, y, w, h } = this.px;

    const presets = [
      { spinSpeed: 1.8 + this.rng.float(-0.3, 0.3), arcSpan: Math.PI * (1.2 + this.rng.float(0, 0.4)), radiusFrac: 0.38 },
      { spinSpeed: 1.5 + this.rng.float(-0.3, 0.3), arcSpan: Math.PI * (1.0 + this.rng.float(0, 0.5)), radiusFrac: 0.40 },
      { spinSpeed: 2.5 + this.rng.float(-0.5, 0.5), arcSpan: 0, radiusFrac: 0.35 },
      { spinSpeed: 1.2 + this.rng.float(-0.2, 0.2), arcSpan: 0, radiusFrac: 0.38 },
    ];
    const p = presets[this.variant];

    this.cx = x + w / 2;
    this.cy = y + h / 2;
    this.radius = Math.min(w, h) * p.radiusFrac;
    this.innerRadius = this.radius * 0.6;
    this.spinSpeed = p.spinSpeed;
    this.arcSpan = p.arcSpan;
    this.spinAngle = this.rng.float(0, Math.PI * 2);

    if (this.variant === 0) {
      // Single arc: a curved line that spins
      const arcPoints = this.buildArcPoints(0, 0, this.radius, 0, this.arcSpan, 48);
      this.singleArcPoints = arcPoints;
      const geo = new THREE.BufferGeometry().setFromPoints(arcPoints);
      this.singleArc = new THREE.Line(geo, new THREE.LineBasicMaterial({
        color: this.palette.primary,
        transparent: true,
        opacity: 0,
      }));
      this.singleArc.position.set(this.cx, this.cy, 0);
      this.group.add(this.singleArc);

    } else if (this.variant === 1) {
      // Double arc: outer spins forward, inner spins backward
      const outerPts = this.buildArcPoints(0, 0, this.radius, 0, this.arcSpan, 48);
      this.outerPoints = outerPts;
      const outerGeo = new THREE.BufferGeometry().setFromPoints(outerPts);
      this.outerArc = new THREE.Line(outerGeo, new THREE.LineBasicMaterial({
        color: this.palette.primary,
        transparent: true,
        opacity: 0,
      }));
      this.outerArc.position.set(this.cx, this.cy, 0.3);
      this.group.add(this.outerArc);

      const innerSpan = Math.PI * (0.7 + this.rng.float(0, 0.4));
      const innerPts = this.buildArcPoints(0, 0, this.innerRadius, 0, innerSpan, 36);
      this.innerPoints = innerPts;
      const innerGeo = new THREE.BufferGeometry().setFromPoints(innerPts);
      this.innerArc = new THREE.Line(innerGeo, new THREE.LineBasicMaterial({
        color: this.palette.secondary,
        transparent: true,
        opacity: 0,
      }));
      this.innerArc.position.set(this.cx, this.cy, 0.5);
      this.group.add(this.innerArc);

    } else if (this.variant === 2) {
      // Dots in a circle — individual dots orbit with trailing fade
      this.dotCount = 10 + this.rng.int(0, 4);
      this.dotPhases = [];
      for (let i = 0; i < this.dotCount; i++) {
        this.dotPhases.push((i / this.dotCount) * Math.PI * 2);
      }

      const positions = new Float32Array(this.dotCount * 3);
      const colors = new Float32Array(this.dotCount * 3);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

      this.dotsMesh = new THREE.Points(geo, new THREE.PointsMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0,
        size: 3.5,
        sizeAttenuation: false,
      }));
      this.group.add(this.dotsMesh);

    } else {
      // Segmented ring: arcs arranged around a circle, each segment fades in/out in sequence
      this.segmentCount = 10 + this.rng.int(0, 4);
      const gapAngle = 0.15; // gap between segments
      const segAngle = (Math.PI * 2 - gapAngle * this.segmentCount) / this.segmentCount;

      for (let i = 0; i < this.segmentCount; i++) {
        const startA = i * (segAngle + gapAngle);
        const pts = this.buildArcPoints(0, 0, this.radius, startA, segAngle, 8);
        const geo = new THREE.BufferGeometry().setFromPoints(pts);
        const seg = new THREE.Line(geo, new THREE.LineBasicMaterial({
          color: this.palette.primary,
          transparent: true,
          opacity: 0,
        }));
        seg.position.set(this.cx, this.cy, 0);
        this.segments.push(seg);
        this.group.add(seg);
        this.segPhases.push((i / this.segmentCount) * Math.PI * 2);
      }
    }
  }

  /** Build arc points in local space (centered at 0,0) */
  private buildArcPoints(
    cx: number, cy: number, r: number, startAngle: number, span: number, steps: number
  ): THREE.Vector3[] {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= steps; i++) {
      const a = startAngle + (i / steps) * span;
      pts.push(new THREE.Vector3(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 0));
    }
    return pts;
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);

    if (this.alertTimer > 0) {
      this.alertTimer -= dt;
      this.speedBoost = 3.5;
      if (this.alertTimer <= 0) this.speedBoost = 1;
    }

    const effectiveSpeed = this.spinSpeed * this.speedBoost;
    this.spinAngle += dt * effectiveSpeed;

    if (this.variant === 0) {
      // Single arc rotates
      this.singleArc.rotation.z = this.spinAngle;

      // Trailing opacity: gradient from bright head to dim tail
      const pos = this.singleArc.geometry.getAttribute('position') as THREE.BufferAttribute;
      const count = pos.count;
      // Rebuild positions with a fading trail effect via color isn't possible on Line
      // So we animate the arc span by adjusting geometry
      (this.singleArc.material as THREE.LineBasicMaterial).opacity = opacity * 0.9;

    } else if (this.variant === 1) {
      this.outerArc.rotation.z = this.spinAngle;
      this.innerArc.rotation.z = -this.spinAngle * 1.3;

      // Pulsing brightness difference between inner/outer
      const prim = 0.75 + Math.sin(time * 3.5) * 0.2;
      const sec = 0.6 + Math.sin(time * 3.5 + Math.PI) * 0.25;
      (this.outerArc.material as THREE.LineBasicMaterial).opacity = opacity * prim;
      (this.innerArc.material as THREE.LineBasicMaterial).opacity = opacity * sec;

    } else if (this.variant === 2) {
      // Dots orbit around center — each slightly behind the previous with trail fade
      const pos = this.dotsMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
      const col = this.dotsMesh.geometry.getAttribute('color') as THREE.BufferAttribute;
      const pr = this.palette.primary.r, pg = this.palette.primary.g, pb = this.palette.primary.b;
      const dr = this.palette.dim.r, dg = this.palette.dim.g, db = this.palette.dim.b;

      for (let i = 0; i < this.dotCount; i++) {
        const a = this.spinAngle + this.dotPhases[i];
        const dx = this.cx + Math.cos(a) * this.radius;
        const dy = this.cy + Math.sin(a) * this.radius;
        pos.setXYZ(i, dx, dy, 0.5);

        // Trail: dots behind the "head" are dimmer
        const trailFrac = i / (this.dotCount - 1); // 0 = head, 1 = tail
        const blend = 1 - trailFrac * 0.85;
        col.setXYZ(i, pr * blend + dr * (1 - blend), pg * blend + dg * (1 - blend), pb * blend + db * (1 - blend));
      }
      pos.needsUpdate = true;
      col.needsUpdate = true;
      (this.dotsMesh.material as THREE.PointsMaterial).opacity = opacity * 0.9;

    } else {
      // Segmented ring: segments light up in sequence like a progress indicator
      const cyclePos = (this.spinAngle / (Math.PI * 2)) % 1;
      for (let i = 0; i < this.segmentCount; i++) {
        const segFrac = i / this.segmentCount;
        // Distance from active "pointer"
        let diff = ((cyclePos - segFrac) % 1 + 1) % 1; // 0..1, wrapped
        // Bright if near pointer, fade over trailing 0.4 of cycle
        let segOpacity: number;
        if (diff < 0.05) {
          segOpacity = 1.0; // head
        } else if (diff < 0.5) {
          segOpacity = 1.0 - (diff - 0.05) / 0.45 * 0.85; // trailing fade
        } else {
          segOpacity = 0.05; // off
        }

        const mat = this.segments[i].material as THREE.LineBasicMaterial;
        mat.opacity = opacity * segOpacity;
      }
    }
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'activate') {
      this.spinAngle = 0;
      this.speedBoost = 1;
    }
    if (action === 'alert') {
      this.alertTimer = 2.5;
      this.pulseTimer = 2.0;
      // Swap to alert color
      if (this.variant === 0) {
        (this.singleArc.material as THREE.LineBasicMaterial).color.copy(this.palette.alert);
      } else if (this.variant === 1) {
        (this.outerArc.material as THREE.LineBasicMaterial).color.copy(this.palette.alert);
      } else if (this.variant === 3) {
        for (const seg of this.segments) {
          (seg.material as THREE.LineBasicMaterial).color.copy(this.palette.alert);
        }
      }
    }
    if (action === 'pulse') {
      this.speedBoost = 2.0;
      setTimeout(() => { this.speedBoost = 1; }, 600);
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) {
      this.speedBoost = 1;
      return;
    }
    if (level >= 5) {
      this.speedBoost = 4.0;
    } else if (level >= 3) {
      this.speedBoost = 2.5;
    } else {
      this.speedBoost = 1.5;
    }
  }
}
