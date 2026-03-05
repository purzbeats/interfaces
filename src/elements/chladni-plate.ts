import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Chladni vibration patterns on a rectangular plate.
 * Sand accumulates at nodal lines. Different resonant modes (n,m) as presets.
 * Pattern: cos(n*pi*x/L)*cos(m*pi*y/H) - cos(m*pi*x/L)*cos(n*pi*y/H)
 */
export class ChladniPlateElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'chladni-plate',
    meta: { shape: 'rectangular', roles: ['data-display', 'decorative'], moods: ['ambient', 'diagnostic'], bandAffinity: 'high', sizes: ['needs-medium', 'needs-large'] },
  };

  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private texture!: THREE.CanvasTexture;
  private mesh!: THREE.Mesh;
  private cw = 0;
  private ch = 0;

  // Sand particles
  private sandCount = 0;
  private sx!: Float32Array;
  private sy!: Float32Array;
  private modeN = 0;
  private modeM = 0;
  private vibAmp = 0;
  private settled = false;
  private settleTimer = 0;
  private transitionTimer = 0;
  private targetN = 0;
  private targetM = 0;

  build(): void {
    this.glitchAmount = 4;
    const variant = this.rng.int(0, 4);
    const { x, y, w, h } = this.px;
    const presets = [
      { n: 3, m: 2, sand: 3000, amp: 0.4 },
      { n: 5, m: 3, sand: 4000, amp: 0.35 },
      { n: 2, m: 1, sand: 2000, amp: 0.5 },
      { n: 4, m: 5, sand: 5000, amp: 0.3 },
    ];
    const p = presets[variant];

    this.modeN = p.n;
    this.modeM = p.m;
    this.targetN = p.n;
    this.targetM = p.m;
    this.sandCount = p.sand;
    this.vibAmp = p.amp;

    const maxRes = 256;
    const aspect = w / h;
    this.cw = Math.min(maxRes, Math.ceil(w));
    this.ch = Math.max(1, Math.ceil(this.cw / aspect));
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.cw;
    this.canvas.height = this.ch;
    this.ctx = this.get2DContext(this.canvas);

    // Initialize sand randomly
    this.sx = new Float32Array(this.sandCount);
    this.sy = new Float32Array(this.sandCount);
    for (let i = 0; i < this.sandCount; i++) {
      this.sx[i] = this.rng.float(0, 1);
      this.sy[i] = this.rng.float(0, 1);
    }

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.NearestFilter;
    const geo = new THREE.PlaneGeometry(w, h);
    this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      map: this.texture, transparent: true, opacity: 0,
    }));
    this.mesh.position.set(x + w / 2, y + h / 2, 0);
    this.group.add(this.mesh);
  }

  /** Chladni function value at normalized (x,y) in [0,1] */
  private chladni(xn: number, yn: number, n: number, m: number): number {
    return Math.cos(n * Math.PI * xn) * Math.cos(m * Math.PI * yn)
         - Math.cos(m * Math.PI * xn) * Math.cos(n * Math.PI * yn);
  }

  /** Gradient of the Chladni function (drives sand toward nodal lines) */
  private chladniGrad(xn: number, yn: number, n: number, m: number): [number, number] {
    const npi = n * Math.PI;
    const mpi = m * Math.PI;
    const dfdx = -npi * Math.sin(npi * xn) * Math.cos(mpi * yn)
               + mpi * Math.sin(mpi * xn) * Math.cos(npi * yn);
    const dfdy = -mpi * Math.cos(npi * xn) * Math.sin(mpi * yn)
               + npi * Math.cos(mpi * xn) * Math.sin(npi * yn);
    return [dfdx, dfdy];
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);
    const clampDt = Math.min(dt, 0.033);

    // Handle mode transition
    if (this.transitionTimer > 0) {
      this.transitionTimer -= clampDt;
      if (this.transitionTimer <= 0) {
        this.modeN = this.targetN;
        this.modeM = this.targetM;
        // Scatter sand for new pattern
        for (let i = 0; i < this.sandCount; i++) {
          this.sx[i] = this.rng.float(0, 1);
          this.sy[i] = this.rng.float(0, 1);
        }
        this.settled = false;
      }
    }

    // Move sand toward nodal lines (where chladni function ~ 0)
    // Sand feels a force proportional to the function value, directed
    // along the gradient toward zero crossings.
    const n = this.modeN;
    const m = this.modeM;
    const step = this.vibAmp * clampDt;

    for (let i = 0; i < this.sandCount; i++) {
      const val = this.chladni(this.sx[i], this.sy[i], n, m);
      const [gx, gy] = this.chladniGrad(this.sx[i], this.sy[i], n, m);
      const gmag = Math.sqrt(gx * gx + gy * gy) + 0.001;

      // Move in direction that reduces |val|: sign(val) * gradient direction
      const sign = val > 0 ? 1 : -1;
      this.sx[i] -= sign * (gx / gmag) * step * Math.abs(val);
      this.sy[i] -= sign * (gy / gmag) * step * Math.abs(val);

      // Small random jitter to prevent perfect stacking
      this.sx[i] += this.rng.float(-0.001, 0.001);
      this.sy[i] += this.rng.float(-0.001, 0.001);

      // Clamp to plate
      if (this.sx[i] < 0) this.sx[i] = 0;
      if (this.sx[i] > 1) this.sx[i] = 1;
      if (this.sy[i] < 0) this.sy[i] = 0;
      if (this.sy[i] > 1) this.sy[i] = 1;
    }

    // Render
    this.ctx.fillStyle = '#000';
    this.ctx.fillRect(0, 0, this.cw, this.ch);

    const pr = ((this.palette.primary.r * 255) | 0);
    const pg = ((this.palette.primary.g * 255) | 0);
    const pb = ((this.palette.primary.b * 255) | 0);
    this.ctx.fillStyle = `rgba(${pr},${pg},${pb},0.4)`;

    for (let i = 0; i < this.sandCount; i++) {
      const px = this.sx[i] * this.cw;
      const py = this.sy[i] * this.ch;
      this.ctx.fillRect(px - 0.3, py - 0.3, 0.8, 0.8);
    }

    // Draw plate border
    const dr = ((this.palette.dim.r * 255) | 0);
    const dg = ((this.palette.dim.g * 255) | 0);
    const db = ((this.palette.dim.b * 255) | 0);
    this.ctx.strokeStyle = `rgb(${dr},${dg},${db})`;
    this.ctx.lineWidth = 1;
    this.ctx.strokeRect(0, 0, this.cw, this.ch);

    this.texture.needsUpdate = true;
    (this.mesh.material as THREE.MeshBasicMaterial).opacity = opacity;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Switch to a random mode
      this.targetN = this.rng.int(1, 7);
      this.targetM = this.rng.int(1, 7);
      if (this.targetN === this.targetM) this.targetM++;
      this.transitionTimer = 0.3;
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    this.vibAmp = 0.3 + level * 0.06;
  }
}
