import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Astroid (hypocycloid with 4 cusps). Shows a small circle rolling inside
 * a larger fixed circle, tracing the astroid curve. Parametric form:
 * x = a*cos^3(t), y = a*sin^3(t). Animate rolling with visible geometry.
 * Line geometry with rolling circle, spoke, and traced curve.
 */
export class AstroidCurveElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'astroid-curve',
    meta: {
      shape: 'radial',
      roles: ['decorative', 'gauge'],
      moods: ['ambient', 'tactical'],
      bandAffinity: 'bass',
      sizes: ['needs-medium', 'needs-large'],
    },
  };

  private fixedCircleLine!: THREE.Line;
  private fixedCircleMat!: THREE.LineBasicMaterial;
  private rollingCircleLine!: THREE.Line;
  private rollingCircleMat!: THREE.LineBasicMaterial;
  private astroidLine!: THREE.Line;
  private astroidMat!: THREE.LineBasicMaterial;
  private spokeLine!: THREE.LineSegments;
  private spokeMat!: THREE.LineBasicMaterial;
  private trailLine!: THREE.Line;
  private trailMat!: THREE.LineBasicMaterial;

  private rollingPositions!: Float32Array;
  private trailPositions!: Float32Array;
  private spokePositions!: Float32Array;

  private cx = 0;
  private cy = 0;
  private fixedRadius = 0;
  private rollingRadius = 0;
  private circleSegs = 48;
  private astroidPoints = 0;
  private trailPoints = 0;
  private rollSpeed = 0;
  private cusps = 0;

  build(): void {
    this.glitchAmount = 4;
    const variant = this.rng.int(0, 3);
    const { x, y, w, h } = this.px;

    this.cx = x + w / 2;
    this.cy = y + h / 2;

    // Presets: different numbers of cusps (astroid=4, deltoid=3, 5-cusp, 6-cusp)
    const presets = [
      { cusps: 4, speed: 0.4,  aPoints: 200, tPoints: 500 },
      { cusps: 3, speed: 0.35, aPoints: 180, tPoints: 400 },
      { cusps: 5, speed: 0.3,  aPoints: 250, tPoints: 600 },
      { cusps: 6, speed: 0.25, aPoints: 300, tPoints: 700 },
    ];
    const p = presets[variant];

    this.cusps = p.cusps;
    this.rollSpeed = p.speed;
    this.astroidPoints = p.aPoints;
    this.trailPoints = p.tPoints;
    this.fixedRadius = Math.min(w, h) * 0.38;
    this.rollingRadius = this.fixedRadius / this.cusps;

    // Fixed outer circle
    const fixedPositions = new Float32Array((this.circleSegs + 1) * 3);
    for (let i = 0; i <= this.circleSegs; i++) {
      const a = (i / this.circleSegs) * Math.PI * 2;
      fixedPositions[i * 3] = this.cx + Math.cos(a) * this.fixedRadius;
      fixedPositions[i * 3 + 1] = this.cy + Math.sin(a) * this.fixedRadius;
      fixedPositions[i * 3 + 2] = 0;
    }
    const fixedGeo = new THREE.BufferGeometry();
    fixedGeo.setAttribute('position', new THREE.BufferAttribute(fixedPositions, 3));
    this.fixedCircleMat = new THREE.LineBasicMaterial({
      color: this.palette.dim, transparent: true, opacity: 0,
    });
    this.fixedCircleLine = new THREE.Line(fixedGeo, this.fixedCircleMat);
    this.group.add(this.fixedCircleLine);

    // Rolling inner circle
    this.rollingPositions = new Float32Array((this.circleSegs + 1) * 3);
    for (let i = 0; i <= this.circleSegs; i++) {
      this.rollingPositions[i * 3] = this.cx;
      this.rollingPositions[i * 3 + 1] = this.cy;
      this.rollingPositions[i * 3 + 2] = 0;
    }
    const rollingGeo = new THREE.BufferGeometry();
    rollingGeo.setAttribute('position', new THREE.BufferAttribute(this.rollingPositions, 3));
    this.rollingCircleMat = new THREE.LineBasicMaterial({
      color: this.palette.secondary, transparent: true, opacity: 0,
    });
    this.rollingCircleLine = new THREE.Line(rollingGeo, this.rollingCircleMat);
    this.group.add(this.rollingCircleLine);

    // Static astroid / hypocycloid shape (full curve for reference)
    const astroidPositions = new Float32Array(this.astroidPoints * 3);
    for (let i = 0; i < this.astroidPoints; i++) {
      const t = (i / (this.astroidPoints - 1)) * Math.PI * 2;
      const [hx, hy] = this.hypocycloid(t);
      astroidPositions[i * 3] = hx;
      astroidPositions[i * 3 + 1] = hy;
      astroidPositions[i * 3 + 2] = 0;
    }
    const astroidGeo = new THREE.BufferGeometry();
    astroidGeo.setAttribute('position', new THREE.BufferAttribute(astroidPositions, 3));
    this.astroidMat = new THREE.LineBasicMaterial({
      color: this.palette.primary, transparent: true, opacity: 0,
    });
    this.astroidLine = new THREE.Line(astroidGeo, this.astroidMat);
    this.group.add(this.astroidLine);

    // Animated trace trail (progressively drawn)
    this.trailPositions = new Float32Array(this.trailPoints * 3);
    for (let i = 0; i < this.trailPoints * 3; i += 3) {
      this.trailPositions[i] = this.cx;
      this.trailPositions[i + 1] = this.cy;
      this.trailPositions[i + 2] = 0;
    }
    const trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute('position', new THREE.BufferAttribute(this.trailPositions, 3));
    trailGeo.setDrawRange(0, 0);
    this.trailMat = new THREE.LineBasicMaterial({
      color: this.palette.primary, transparent: true, opacity: 0,
    });
    this.trailLine = new THREE.Line(trailGeo, this.trailMat);
    this.group.add(this.trailLine);

    // Spoke lines: center of rolling circle to trace point, and to contact point
    this.spokePositions = new Float32Array(12);
    for (let i = 0; i < 12; i++) this.spokePositions[i] = this.cx;
    const spokeGeo = new THREE.BufferGeometry();
    spokeGeo.setAttribute('position', new THREE.BufferAttribute(this.spokePositions, 3));
    this.spokeMat = new THREE.LineBasicMaterial({
      color: this.palette.secondary, transparent: true, opacity: 0,
    });
    this.spokeLine = new THREE.LineSegments(spokeGeo, this.spokeMat);
    this.group.add(this.spokeLine);
  }

  /** Hypocycloid point: small circle of radius r rolling inside R */
  private hypocycloid(t: number): [number, number] {
    const R = this.fixedRadius;
    const r = this.rollingRadius;
    const diff = R - r;
    const ratio = diff / r;
    const hx = diff * Math.cos(t) + r * Math.cos(ratio * t);
    const hy = diff * Math.sin(t) - r * Math.sin(ratio * t);
    return [this.cx + hx, this.cy + hy];
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    const R = this.fixedRadius;
    const r = this.rollingRadius;
    const diff = R - r;

    // Rolling angle
    const t = time * this.rollSpeed * Math.PI * 2;

    // Center of rolling circle
    const rcx = this.cx + diff * Math.cos(t);
    const rcy = this.cy + diff * Math.sin(t);

    // Update rolling circle
    for (let i = 0; i <= this.circleSegs; i++) {
      const a = (i / this.circleSegs) * Math.PI * 2;
      this.rollingPositions[i * 3] = rcx + Math.cos(a) * r;
      this.rollingPositions[i * 3 + 1] = rcy + Math.sin(a) * r;
      this.rollingPositions[i * 3 + 2] = 0;
    }
    (this.rollingCircleLine.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    this.rollingCircleMat.opacity = opacity * 0.4;

    // Trace point on the rolling circle
    const [tpx, tpy] = this.hypocycloid(t);

    // Update trail: progressive drawing cycling over full rotation
    const fullCycle = Math.PI * 2;
    const currentAngle = t % fullCycle;
    const drawCount = Math.max(2, ((currentAngle / fullCycle) * this.trailPoints) | 0);

    for (let i = 0; i < drawCount; i++) {
      const ti = (i / (this.trailPoints - 1)) * fullCycle;
      const angle = ti;
      const [hx, hy] = this.hypocycloid(angle);
      this.trailPositions[i * 3] = hx;
      this.trailPositions[i * 3 + 1] = hy;
      this.trailPositions[i * 3 + 2] = 0;
    }
    this.trailLine.geometry.setDrawRange(0, drawCount);
    (this.trailLine.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    this.trailMat.opacity = opacity * 0.6;

    // Update spokes
    // Line 1: rolling center to trace point
    this.spokePositions[0] = rcx;
    this.spokePositions[1] = rcy;
    this.spokePositions[2] = 0;
    this.spokePositions[3] = tpx;
    this.spokePositions[4] = tpy;
    this.spokePositions[5] = 0;
    // Line 2: rolling center to contact point on fixed circle
    const contactAngle = t;
    this.spokePositions[6] = rcx;
    this.spokePositions[7] = rcy;
    this.spokePositions[8] = 0;
    this.spokePositions[9] = this.cx + Math.cos(contactAngle) * R;
    this.spokePositions[10] = this.cy + Math.sin(contactAngle) * R;
    this.spokePositions[11] = 0;
    (this.spokeLine.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    this.spokeMat.opacity = opacity * 0.3;

    // Static full astroid is always visible but dim
    this.astroidMat.opacity = opacity * 0.15;
    this.fixedCircleMat.opacity = opacity * 0.2;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Temporarily change cusp count
      const saved = this.cusps;
      const savedR = this.rollingRadius;
      this.cusps = this.rng.int(3, 8);
      this.rollingRadius = this.fixedRadius / this.cusps;
      setTimeout(() => {
        this.cusps = saved;
        this.rollingRadius = savedR;
      }, 600);
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) {
      this.rollSpeed = 0.4;
      return;
    }
    this.rollSpeed = 0.4 + level * 0.12;
  }
}
