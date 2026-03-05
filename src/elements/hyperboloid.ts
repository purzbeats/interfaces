import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Rotating ruled hyperboloid surface rendered as straight lines that form
 * a curved surface. Lines sweep around creating an hourglass shape.
 */
export class HyperboloidElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'hyperboloid',
    meta: {
      shape: 'radial',
      roles: ['decorative'],
      moods: ['ambient', 'tactical'],
      sizes: ['needs-medium', 'needs-large'],
    } satisfies ElementMeta,
  };

  private rulings!: THREE.LineSegments;
  private rulingPositions!: Float32Array;
  private rulingMat!: THREE.LineBasicMaterial;
  private ringLines!: THREE.Line[];
  private ringMats!: THREE.LineBasicMaterial[];
  private borderLines!: THREE.LineSegments;
  private borderMat!: THREE.LineBasicMaterial;

  private cx: number = 0;
  private cy: number = 0;
  private radiusTop: number = 0;
  private radiusBot: number = 0;
  private halfHeight: number = 0;
  private lineCount: number = 0;
  private rotSpeed: number = 0;
  private tiltAngle: number = 0;
  private skewSpeed: number = 0;
  private ringCount: number = 0;
  private intensityLevel: number = 0;

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;
    this.cx = x + w / 2;
    this.cy = y + h / 2;
    const minDim = Math.min(w, h);
    this.radiusTop = minDim * 0.35;
    this.radiusBot = minDim * 0.35;
    this.halfHeight = h * 0.4;

    const variant = this.rng.int(0, 3);
    const presets = [
      { lines: 24, rot: 0.3, tilt: 0.4, skew: 0.2, rings: 5 },
      { lines: 48, rot: 0.15, tilt: 0.6, skew: 0.1, rings: 8 },
      { lines: 16, rot: 0.5, tilt: 0.3, skew: 0.35, rings: 3 },
      { lines: 36, rot: -0.2, tilt: 0.5, skew: 0.25, rings: 6 },
    ];
    const p = presets[variant];
    this.lineCount = p.lines;
    this.rotSpeed = p.rot;
    this.tiltAngle = p.tilt;
    this.skewSpeed = p.skew;
    this.ringCount = p.rings;

    // Ruling lines
    this.rulingPositions = new Float32Array(this.lineCount * 2 * 3);
    const rulGeo = new THREE.BufferGeometry();
    rulGeo.setAttribute('position', new THREE.BufferAttribute(this.rulingPositions, 3));
    this.rulingMat = new THREE.LineBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
    });
    this.rulings = new THREE.LineSegments(rulGeo, this.rulingMat);
    this.group.add(this.rulings);

    // Horizontal ring lines
    this.ringLines = [];
    this.ringMats = [];
    const ringSegs = 64;
    for (let r = 0; r < this.ringCount; r++) {
      const positions = new Float32Array((ringSegs + 1) * 3);
      const rGeo = new THREE.BufferGeometry();
      rGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const mat = new THREE.LineBasicMaterial({
        color: r === 0 || r === this.ringCount - 1 ? this.palette.secondary : this.palette.dim,
        transparent: true,
        opacity: 0,
      });
      const line = new THREE.Line(rGeo, mat);
      this.group.add(line);
      this.ringLines.push(line);
      this.ringMats.push(mat);
    }

    // Border
    const bv = new Float32Array([
      x, y, 0, x + w, y, 0, x + w, y, 0, x + w, y + h, 0,
      x + w, y + h, 0, x, y + h, 0, x, y + h, 0, x, y, 0,
    ]);
    const bGeo = new THREE.BufferGeometry();
    bGeo.setAttribute('position', new THREE.BufferAttribute(bv, 3));
    this.borderMat = new THREE.LineBasicMaterial({
      color: this.palette.dim, transparent: true, opacity: 0,
    });
    this.borderLines = new THREE.LineSegments(bGeo, this.borderMat);
    this.group.add(this.borderLines);
  }

  private projectPoint(theta: number, v: number, rotation: number): { x: number; y: number } {
    // Hyperboloid of one sheet parametric:
    // x = a * cosh(v) * cos(theta), z = a * cosh(v) * sin(theta), y = c * sinh(v)
    // But we use ruled surface form: line from top circle to bottom with twist
    const topX = this.radiusTop * Math.cos(theta + rotation);
    const topZ = this.radiusTop * Math.sin(theta + rotation);
    const botX = this.radiusBot * Math.cos(theta - rotation + Math.PI * 0.3);
    const botZ = this.radiusBot * Math.sin(theta - rotation + Math.PI * 0.3);

    const px = topX * (1 - v) + botX * v;
    const py = -this.halfHeight * (1 - v) + this.halfHeight * v;
    const pz = topZ * (1 - v) + botZ * v;

    // Apply tilt rotation around X axis
    const cosT = Math.cos(this.tiltAngle);
    const sinT = Math.sin(this.tiltAngle);
    const ry = py * cosT - pz * sinT;
    const rz = py * sinT + pz * cosT;

    // Simple perspective
    const persp = 1.0 / (1.0 + rz * 0.001);
    return { x: this.cx + px * persp, y: this.cy + ry * persp };
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    const rotation = time * this.rotSpeed;
    const skew = Math.sin(time * this.skewSpeed) * 0.3;

    // Update ruling lines
    let vi = 0;
    for (let i = 0; i < this.lineCount; i++) {
      const theta = (i / this.lineCount) * Math.PI * 2;
      const top = this.projectPoint(theta + skew, 0, rotation);
      const bot = this.projectPoint(theta, 1, rotation);
      this.rulingPositions[vi++] = top.x;
      this.rulingPositions[vi++] = top.y;
      this.rulingPositions[vi++] = 0;
      this.rulingPositions[vi++] = bot.x;
      this.rulingPositions[vi++] = bot.y;
      this.rulingPositions[vi++] = 0;
    }
    const rPos = this.rulings.geometry.getAttribute('position') as THREE.BufferAttribute;
    rPos.needsUpdate = true;

    // Update ring lines
    const ringSegs = 64;
    for (let r = 0; r < this.ringCount; r++) {
      const v = r / (this.ringCount - 1);
      const pos = this.ringLines[r].geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let s = 0; s <= ringSegs; s++) {
        const theta = (s / ringSegs) * Math.PI * 2;
        const thetaTop = theta + skew * (1 - v);
        const pt = this.projectPoint(thetaTop, v, rotation);
        pos.setXYZ(s, pt.x, pt.y, 0.05);
      }
      pos.needsUpdate = true;
      this.ringMats[r].opacity = opacity * (r === 0 || r === this.ringCount - 1 ? 0.6 : 0.2);
    }

    this.rulingMat.opacity = opacity * 0.6;
    this.borderMat.opacity = opacity * 0.2;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      this.rotSpeed *= -1;
    }
    if (action === 'pulse') {
      this.tiltAngle += 0.5;
      setTimeout(() => { this.tiltAngle -= 0.5; }, 500);
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    this.intensityLevel = level;
    if (level === 0) return;
    this.rotSpeed = Math.sign(this.rotSpeed || 1) * (0.3 + level * 0.1);
  }
}
