import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Electrostatic equipotential lines from point charges. Smooth contour
 * rendering of the scalar potential field using marching squares on a
 * canvas texture. Charges slowly drift.
 */
export class ElectricPotentialElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'electric-potential',
    meta: {
      shape: 'rectangular',
      roles: ['data-display', 'decorative'],
      moods: ['diagnostic', 'ambient'],
      bandAffinity: 'mid',
      sizes: ['needs-medium', 'needs-large'],
    } satisfies ElementMeta,
  };

  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private texture!: THREE.CanvasTexture;
  private mesh!: THREE.Mesh;
  private meshMat!: THREE.MeshBasicMaterial;
  private chargeDots!: THREE.Points;
  private chargeMat!: THREE.PointsMaterial;
  private borderLines!: THREE.LineSegments;
  private borderMat!: THREE.LineBasicMaterial;

  private chargeCount: number = 0;
  private chargeX!: Float32Array;
  private chargeY!: Float32Array;
  private chargeQ!: Float32Array; // +1 or -1
  private chargeVX!: Float32Array;
  private chargeVY!: Float32Array;
  private canvasW: number = 0;
  private canvasH: number = 0;
  private contourLevels: number = 0;
  private intensityLevel: number = 0;

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;
    const variant = this.rng.int(0, 3);
    const presets = [
      { charges: 4, cw: 120, ch: 90, contours: 12 },
      { charges: 6, cw: 150, ch: 112, contours: 16 },
      { charges: 3, cw: 100, ch: 75, contours: 10 },
      { charges: 8, cw: 130, ch: 97, contours: 20 },
    ];
    const p = presets[variant];
    this.chargeCount = p.charges;
    this.canvasW = p.cw;
    this.canvasH = p.ch;
    this.contourLevels = p.contours;

    // Initialize charges
    this.chargeX = new Float32Array(this.chargeCount);
    this.chargeY = new Float32Array(this.chargeCount);
    this.chargeQ = new Float32Array(this.chargeCount);
    this.chargeVX = new Float32Array(this.chargeCount);
    this.chargeVY = new Float32Array(this.chargeCount);

    for (let i = 0; i < this.chargeCount; i++) {
      this.chargeX[i] = this.rng.float(0.15, 0.85);
      this.chargeY[i] = this.rng.float(0.15, 0.85);
      this.chargeQ[i] = i % 2 === 0 ? 1 : -1;
      this.chargeVX[i] = this.rng.float(-0.05, 0.05);
      this.chargeVY[i] = this.rng.float(-0.05, 0.05);
    }

    // Canvas
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvasW;
    this.canvas.height = this.canvasH;
    this.ctx = this.get2DContext(this.canvas);
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.LinearFilter;

    const geo = new THREE.PlaneGeometry(w, h);
    this.meshMat = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(geo, this.meshMat);
    this.mesh.position.set(x + w / 2, y + h / 2, 0);
    this.group.add(this.mesh);

    // Charge point indicators
    const cpPositions = new Float32Array(this.chargeCount * 3);
    const cpGeo = new THREE.BufferGeometry();
    cpGeo.setAttribute('position', new THREE.BufferAttribute(cpPositions, 3));
    this.chargeMat = new THREE.PointsMaterial({
      color: this.palette.secondary,
      transparent: true,
      opacity: 0,
      size: 5,
      sizeAttenuation: false,
    });
    this.chargeDots = new THREE.Points(cpGeo, this.chargeMat);
    this.group.add(this.chargeDots);

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

  private potential(px: number, py: number): number {
    let v = 0;
    for (let i = 0; i < this.chargeCount; i++) {
      const dx = px - this.chargeX[i];
      const dy = py - this.chargeY[i];
      const r = Math.sqrt(dx * dx + dy * dy) + 0.01;
      v += this.chargeQ[i] / r;
    }
    return v;
  }

  private moveCharges(dt: number): void {
    for (let i = 0; i < this.chargeCount; i++) {
      this.chargeX[i] += this.chargeVX[i] * dt;
      this.chargeY[i] += this.chargeVY[i] * dt;

      // Bounce off edges
      if (this.chargeX[i] < 0.1 || this.chargeX[i] > 0.9) {
        this.chargeVX[i] *= -1;
        this.chargeX[i] = Math.max(0.1, Math.min(0.9, this.chargeX[i]));
      }
      if (this.chargeY[i] < 0.1 || this.chargeY[i] > 0.9) {
        this.chargeVY[i] *= -1;
        this.chargeY[i] = Math.max(0.1, Math.min(0.9, this.chargeY[i]));
      }

      // Charges repel/attract each other weakly
      for (let j = i + 1; j < this.chargeCount; j++) {
        const dx = this.chargeX[j] - this.chargeX[i];
        const dy = this.chargeY[j] - this.chargeY[i];
        const dist = Math.sqrt(dx * dx + dy * dy) + 0.01;
        const force = this.chargeQ[i] * this.chargeQ[j] * 0.001 / (dist * dist);
        this.chargeVX[i] -= (dx / dist) * force;
        this.chargeVY[i] -= (dy / dist) * force;
        this.chargeVX[j] += (dx / dist) * force;
        this.chargeVY[j] += (dy / dist) * force;
      }

      // Damping
      this.chargeVX[i] *= 0.999;
      this.chargeVY[i] *= 0.999;
    }
  }

  private renderField(): void {
    const cw = this.canvasW;
    const ch = this.canvasH;
    const imgData = this.ctx.createImageData(cw, ch);
    const data = imgData.data;

    const pr = this.palette.primary.r;
    const pg = this.palette.primary.g;
    const pb = this.palette.primary.b;
    const sr = this.palette.secondary.r;
    const sg = this.palette.secondary.g;
    const sb = this.palette.secondary.b;
    const bgr = this.palette.bg.r * 0.3;
    const bgg = this.palette.bg.g * 0.3;
    const bgb = this.palette.bg.b * 0.3;

    for (let py = 0; py < ch; py++) {
      for (let px = 0; px < cw; px++) {
        const nx = px / cw;
        const ny = py / ch;
        const v = this.potential(nx, ny);

        // Contour line detection
        const vScaled = v * 3;
        const contourDist = Math.abs(vScaled - Math.round(vScaled));
        const isContour = contourDist < 0.08;

        const off = (py * cw + px) * 4;
        if (isContour) {
          // Draw contour line: positive = primary, negative = secondary
          if (v > 0) {
            data[off]     = Math.round(pr * 255);
            data[off + 1] = Math.round(pg * 255);
            data[off + 2] = Math.round(pb * 255);
          } else {
            data[off]     = Math.round(sr * 255);
            data[off + 1] = Math.round(sg * 255);
            data[off + 2] = Math.round(sb * 255);
          }
          const lineIntensity = 1 - contourDist / 0.08;
          data[off + 3] = Math.round(lineIntensity * 200);
        } else {
          // Background with subtle field strength
          const strength = Math.min(1, Math.abs(v) * 0.1);
          data[off]     = Math.round(bgr * strength * 255);
          data[off + 1] = Math.round(bgg * strength * 255);
          data[off + 2] = Math.round(bgb * strength * 255);
          data[off + 3] = Math.round(strength * 60);
        }
      }
    }

    this.ctx.putImageData(imgData, 0, 0);
    this.texture.needsUpdate = true;
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);
    const { x, y, w, h } = this.px;

    this.moveCharges(dt);
    this.renderField();

    // Update charge dot positions
    const cPos = this.chargeDots.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < this.chargeCount; i++) {
      cPos.setXYZ(i,
        x + this.chargeX[i] * w,
        y + this.chargeY[i] * h,
        0.1,
      );
    }
    cPos.needsUpdate = true;

    this.meshMat.opacity = opacity;
    this.chargeMat.opacity = opacity;
    this.borderMat.opacity = opacity * 0.2;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Randomize charges
      for (let i = 0; i < this.chargeCount; i++) {
        this.chargeQ[i] *= -1;
      }
    }
    if (action === 'pulse') {
      for (let i = 0; i < this.chargeCount; i++) {
        this.chargeVX[i] += this.rng.float(-0.2, 0.2);
        this.chargeVY[i] += this.rng.float(-0.2, 0.2);
      }
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    this.intensityLevel = level;
    if (level === 0) return;
    for (let i = 0; i < this.chargeCount; i++) {
      const boost = 1 + level * 0.2;
      this.chargeVX[i] *= boost;
      this.chargeVY[i] *= boost;
    }
  }
}
