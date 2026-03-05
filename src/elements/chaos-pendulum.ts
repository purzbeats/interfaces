import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Magnetic pendulum over N magnets. Color-coded basins of attraction
 * create fractal basin boundaries. Computes progressively, then a
 * live pendulum bobs around over the basin map.
 */
export class ChaosPendulumElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'chaos-pendulum',
    meta: { shape: 'rectangular', roles: ['data-display', 'decorative'], moods: ['diagnostic', 'ambient'], bandAffinity: 'bass', sizes: ['needs-medium', 'needs-large'] },
  };

  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private texture!: THREE.CanvasTexture;
  private mesh!: THREE.Mesh;
  private borderLines!: THREE.LineSegments;
  private pendulumDot!: THREE.Points;
  private trailLine!: THREE.Line;
  private trailMat!: THREE.LineBasicMaterial;
  private trailPositions!: Float32Array;
  private maxTrail: number = 800;
  private trailHead: number = 0;

  private canvasW: number = 0;
  private canvasH: number = 0;
  private nMagnets: number = 3;
  private magnetX: number[] = [];
  private magnetY: number[] = [];
  private friction: number = 0.1;
  private springK: number = 0.3;
  private magnetStrength: number = 1;
  private computeRow: number = 0;
  private computed: boolean = false;
  private basinData!: Uint8Array;
  private intensity: number = 0;

  // Live pendulum state
  private pendX: number = 0;
  private pendY: number = 0;
  private pendVx: number = 0;
  private pendVy: number = 0;
  private resetTimer: number = 0;

  build(): void {
    const variant = this.rng.int(0, 4);
    const presets = [
      { nMagnets: 3, friction: 0.1, spring: 0.3, strength: 1, trail: 800 },
      { nMagnets: 4, friction: 0.08, spring: 0.25, strength: 1.2, trail: 1000 },
      { nMagnets: 3, friction: 0.15, spring: 0.4, strength: 0.8, trail: 600 },
      { nMagnets: 5, friction: 0.12, spring: 0.35, strength: 1.5, trail: 1200 },
    ];
    const p = presets[variant];
    this.nMagnets = p.nMagnets;
    this.friction = p.friction;
    this.springK = p.spring;
    this.magnetStrength = p.strength;
    this.maxTrail = p.trail;

    const { x, y, w, h } = this.px;

    // Place magnets equally around origin
    this.magnetX = [];
    this.magnetY = [];
    for (let i = 0; i < this.nMagnets; i++) {
      const angle = (i / this.nMagnets) * Math.PI * 2;
      this.magnetX.push(Math.cos(angle));
      this.magnetY.push(Math.sin(angle));
    }

    // Canvas for basin fractal (lower res for performance)
    this.canvasW = Math.min(Math.floor(w * 0.35), 100);
    this.canvasH = Math.min(Math.floor(h * 0.35), 100);
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvasW;
    this.canvas.height = this.canvasH;
    this.ctx = this.get2DContext(this.canvas);
    this.basinData = new Uint8Array(this.canvasW * this.canvasH);

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.magFilter = THREE.NearestFilter;

    const geo = new THREE.PlaneGeometry(w, h);
    const mat = new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, opacity: 0 });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.set(x + w / 2, y + h / 2, 0);
    this.group.add(this.mesh);

    // Trail for live pendulum
    this.trailPositions = new Float32Array(this.maxTrail * 3);
    const trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute('position', new THREE.BufferAttribute(this.trailPositions, 3));
    trailGeo.setDrawRange(0, 0);
    this.trailMat = new THREE.LineBasicMaterial({
      color: this.palette.secondary, transparent: true, opacity: 0,
    });
    this.trailLine = new THREE.Line(trailGeo, this.trailMat);
    this.group.add(this.trailLine);

    // Live pendulum dot
    const dotPos = new Float32Array(3);
    const dotGeo = new THREE.BufferGeometry();
    dotGeo.setAttribute('position', new THREE.BufferAttribute(dotPos, 3));
    this.pendulumDot = new THREE.Points(dotGeo, new THREE.PointsMaterial({
      color: this.palette.primary, transparent: true, opacity: 0,
      size: Math.max(1, Math.min(w, h) * 0.016), sizeAttenuation: false,
    }));
    this.group.add(this.pendulumDot);

    // Initialize live pendulum
    this.resetPendulum();

    // Border
    const bv = new Float32Array([
      x, y, 0, x + w, y, 0, x + w, y, 0, x + w, y + h, 0,
      x + w, y + h, 0, x, y + h, 0, x, y + h, 0, x, y, 0,
    ]);
    const borderGeo = new THREE.BufferGeometry();
    borderGeo.setAttribute('position', new THREE.BufferAttribute(bv, 3));
    this.borderLines = new THREE.LineSegments(borderGeo, new THREE.LineBasicMaterial({
      color: this.palette.dim, transparent: true, opacity: 0,
    }));
    this.group.add(this.borderLines);

    this.computeRow = 0;
    this.computed = false;
  }

  private resetPendulum(): void {
    this.pendX = this.rng.float(-2, 2);
    this.pendY = this.rng.float(-2, 2);
    this.pendVx = this.rng.float(-0.5, 0.5);
    this.pendVy = this.rng.float(-0.5, 0.5);
    this.trailHead = 0;
    this.resetTimer = 0;
  }

  /** Simulate pendulum from initial position, return index of closest magnet */
  private simulatePendulum(x0: number, y0: number): number {
    let px = x0, py = y0, vx = 0, vy = 0;
    const dt = 0.02;
    const maxSteps = 400;

    for (let step = 0; step < maxSteps; step++) {
      let fx = -this.springK * px;
      let fy = -this.springK * py;
      for (let m = 0; m < this.nMagnets; m++) {
        const dx = this.magnetX[m] - px;
        const dy = this.magnetY[m] - py;
        const dist2 = dx * dx + dy * dy + 0.01;
        const dist3 = dist2 * Math.sqrt(dist2);
        fx += this.magnetStrength * dx / dist3;
        fy += this.magnetStrength * dy / dist3;
      }
      fx -= this.friction * vx;
      fy -= this.friction * vy;
      vx += fx * dt;
      vy += fy * dt;
      px += vx * dt;
      py += vy * dt;
      if (vx * vx + vy * vy < 0.0005) break;
    }
    let closest = 0, minDist = Infinity;
    for (let m = 0; m < this.nMagnets; m++) {
      const dx = this.magnetX[m] - px;
      const dy = this.magnetY[m] - py;
      const d = dx * dx + dy * dy;
      if (d < minDist) { minDist = d; closest = m; }
    }
    return closest;
  }

  private computeBatch(rows: number): void {
    const range = 2.5;
    for (let b = 0; b < rows && this.computeRow < this.canvasH; b++) {
      const row = this.computeRow;
      for (let col = 0; col < this.canvasW; col++) {
        const x0 = -range + (col / this.canvasW) * 2 * range;
        const y0 = -range + (row / this.canvasH) * 2 * range;
        this.basinData[row * this.canvasW + col] = this.simulatePendulum(x0, y0);
      }
      this.computeRow++;
    }
  }

  private renderBasin(): void {
    const imgData = this.ctx.createImageData(this.canvasW, this.canvasH);
    const data = imgData.data;
    const pr = this.palette.primary;
    const sr = this.palette.secondary;
    const dm = this.palette.dim;

    const cols: { r: number; g: number; b: number }[] = [];
    for (let m = 0; m < this.nMagnets; m++) {
      const t = m / Math.max(1, this.nMagnets - 1);
      cols.push({ r: pr.r * (1 - t) + sr.r * t, g: pr.g * (1 - t) + sr.g * t, b: pr.b * (1 - t) + sr.b * t });
    }

    const rendered = Math.min(this.computeRow * this.canvasW, this.canvasW * this.canvasH);
    for (let i = 0; i < rendered; i++) {
      const c = cols[this.basinData[i]] || { r: dm.r, g: dm.g, b: dm.b };
      const idx = i * 4;
      data[idx] = Math.floor(c.r * 255);
      data[idx + 1] = Math.floor(c.g * 255);
      data[idx + 2] = Math.floor(c.b * 255);
      data[idx + 3] = 255;
    }
    // Fill uncomputed rows with background
    for (let i = rendered; i < this.canvasW * this.canvasH; i++) {
      const idx = i * 4;
      data[idx] = Math.floor(dm.r * 50);
      data[idx + 1] = Math.floor(dm.g * 50);
      data[idx + 2] = Math.floor(dm.b * 50);
      data[idx + 3] = 255;
    }

    this.ctx.putImageData(imgData, 0, 0);
    this.texture.needsUpdate = true;
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);
    const { x, y, w, h } = this.px;
    const range = 2.5;

    // Progressive basin computation
    if (!this.computed) {
      this.computeBatch(2);
      if (this.computeRow >= this.canvasH) this.computed = true;
      this.renderBasin();
    }

    // Animate live pendulum
    const simDt = 0.01;
    const stepsPerFrame = 8;
    for (let s = 0; s < stepsPerFrame; s++) {
      let fx = -this.springK * this.pendX;
      let fy = -this.springK * this.pendY;
      for (let m = 0; m < this.nMagnets; m++) {
        const dx = this.magnetX[m] - this.pendX;
        const dy = this.magnetY[m] - this.pendY;
        const dist2 = dx * dx + dy * dy + 0.01;
        const dist3 = dist2 * Math.sqrt(dist2);
        fx += this.magnetStrength * dx / dist3;
        fy += this.magnetStrength * dy / dist3;
      }
      fx -= this.friction * this.pendVx;
      fy -= this.friction * this.pendVy;
      this.pendVx += fx * simDt;
      this.pendVy += fy * simDt;
      this.pendX += this.pendVx * simDt;
      this.pendY += this.pendVy * simDt;
    }

    // Map to screen and record trail
    const screenX = x + ((this.pendX + range) / (2 * range)) * w;
    const screenY = y + ((this.pendY + range) / (2 * range)) * h;

    if (this.trailHead < this.maxTrail) {
      const idx = this.trailHead * 3;
      this.trailPositions[idx] = screenX;
      this.trailPositions[idx + 1] = screenY;
      this.trailPositions[idx + 2] = 0.2;
      this.trailHead++;
    } else {
      this.trailPositions.copyWithin(0, 3, this.maxTrail * 3);
      const idx = (this.maxTrail - 1) * 3;
      this.trailPositions[idx] = screenX;
      this.trailPositions[idx + 1] = screenY;
      this.trailPositions[idx + 2] = 0.2;
    }

    // Reset pendulum if it converges
    this.resetTimer += dt;
    const speed2 = this.pendVx * this.pendVx + this.pendVy * this.pendVy;
    if (speed2 < 0.005 && this.resetTimer > 2) {
      this.resetPendulum();
    }

    // Update trail geometry
    const trailGeo = this.trailLine.geometry;
    trailGeo.setDrawRange(0, Math.min(this.trailHead, this.maxTrail));
    (trailGeo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;

    // Update pendulum dot
    const dotPos = this.pendulumDot.geometry.getAttribute('position') as THREE.BufferAttribute;
    dotPos.setXYZ(0, screenX, screenY, 0.5);
    dotPos.needsUpdate = true;

    (this.mesh.material as THREE.MeshBasicMaterial).opacity = opacity * 0.75;
    this.trailMat.opacity = opacity * 0.6;
    (this.pendulumDot.material as THREE.PointsMaterial).opacity = opacity;
    (this.borderLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.2;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Perturb magnet positions and recompute
      for (let m = 0; m < this.nMagnets; m++) {
        this.magnetX[m] += this.rng.float(-0.15, 0.15);
        this.magnetY[m] += this.rng.float(-0.15, 0.15);
      }
      this.computeRow = 0;
      this.computed = false;
    }
    if (action === 'alert') {
      this.resetPendulum();
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    this.intensity = level;
    if (level >= 3) this.friction *= 0.85;
  }
}
