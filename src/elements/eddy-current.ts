import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Eddy currents induced in a conductive plate by a moving magnetic field source.
 * The source moves in a pattern, inducing circular current loops.
 * Current density is visualized as colored arrows on a canvas.
 */
export class EddyCurrentElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'eddy-current',
    meta: { shape: 'rectangular', roles: ['data-display', 'scanner'], moods: ['diagnostic', 'tactical'], bandAffinity: 'sub', sizes: ['needs-medium', 'needs-large'] },
  };

  private gridW = 0;
  private gridH = 0;
  private jx!: Float32Array; // current density x-component
  private jy!: Float32Array; // current density y-component

  private magnetX = 0;
  private magnetY = 0;
  private magnetVx = 0;
  private magnetVy = 0;
  private magnetStrength = 1;
  private decayRate = 0;

  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private texture!: THREE.CanvasTexture;
  private mesh!: THREE.Mesh;
  private magnetPoint!: THREE.Points;
  private borderLines!: THREE.LineSegments;
  private renderAccum = 0;

  build(): void {
    this.glitchAmount = 4;
    const variant = this.rng.int(0, 3);
    const presets = [
      { grid: 30, strength: 1.0, decay: 2.0, speed: 0.4 },
      { grid: 45, strength: 1.5, decay: 3.0, speed: 0.6 },
      { grid: 20, strength: 0.8, decay: 1.5, speed: 0.3 },
      { grid: 35, strength: 1.2, decay: 2.5, speed: 0.5 },
    ];
    const p = presets[variant];

    const { x, y, w, h } = this.px;
    const aspect = w / h;
    this.gridW = Math.round(p.grid * Math.max(1, aspect));
    this.gridH = Math.round(p.grid / Math.max(1, 1 / aspect));
    this.magnetStrength = p.strength;
    this.decayRate = p.decay;

    const cells = this.gridW * this.gridH;
    this.jx = new Float32Array(cells);
    this.jy = new Float32Array(cells);

    // Initial magnet position and velocity
    this.magnetX = 0.5;
    this.magnetY = 0.5;
    const angle = this.rng.float(0, Math.PI * 2);
    this.magnetVx = Math.cos(angle) * p.speed;
    this.magnetVy = Math.sin(angle) * p.speed;

    // Canvas
    const res = Math.min(400, Math.max(w, h));
    const scale = res / Math.max(w, h);
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.ceil(w * scale);
    this.canvas.height = Math.ceil(h * scale);
    this.ctx = this.get2DContext(this.canvas);

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.LinearFilter;
    const geo = new THREE.PlaneGeometry(w, h);
    this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      map: this.texture, transparent: true, opacity: 0,
    }));
    this.mesh.position.set(x + w / 2, y + h / 2, 0);
    this.group.add(this.mesh);

    // Magnet position marker
    const magGeo = new THREE.BufferGeometry();
    magGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3));
    this.magnetPoint = new THREE.Points(magGeo, new THREE.PointsMaterial({
      color: this.palette.primary, transparent: true, opacity: 0,
      size: 8, sizeAttenuation: false,
    }));
    this.group.add(this.magnetPoint);

    // Border
    const bv = [x, y, 0, x + w, y, 0, x + w, y, 0, x + w, y + h, 0,
      x + w, y + h, 0, x, y + h, 0, x, y + h, 0, x, y, 0];
    const borderGeo = new THREE.BufferGeometry();
    borderGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(bv), 3));
    this.borderLines = new THREE.LineSegments(borderGeo, new THREE.LineBasicMaterial({
      color: this.palette.dim, transparent: true, opacity: 0,
    }));
    this.group.add(this.borderLines);
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);
    const { x, y, w, h } = this.px;
    const cdt = Math.min(dt, 0.033);

    // Move magnet (bounce off edges)
    const prevMx = this.magnetX;
    const prevMy = this.magnetY;
    this.magnetX += this.magnetVx * cdt;
    this.magnetY += this.magnetVy * cdt;
    if (this.magnetX < 0.05 || this.magnetX > 0.95) this.magnetVx *= -1;
    if (this.magnetY < 0.05 || this.magnetY > 0.95) this.magnetVy *= -1;
    this.magnetX = Math.max(0.05, Math.min(0.95, this.magnetX));
    this.magnetY = Math.max(0.05, Math.min(0.95, this.magnetY));

    // Magnet velocity in grid coords
    const dmx = (this.magnetX - prevMx) / cdt;
    const dmy = (this.magnetY - prevMy) / cdt;

    // Induce eddy currents: curl of induced E field from changing B
    // Simplified: current loops around the magnet position, proportional to magnet velocity
    for (let gy = 0; gy < this.gridH; gy++) {
      for (let gx = 0; gx < this.gridW; gx++) {
        const idx = gy * this.gridW + gx;
        const cellX = (gx + 0.5) / this.gridW;
        const cellY = (gy + 0.5) / this.gridH;
        const dx = cellX - this.magnetX;
        const dy = cellY - this.magnetY;
        const r2 = dx * dx + dy * dy;
        const r = Math.sqrt(r2) + 0.01;

        // Induced current is tangential: J = strength * cross(v_magnet, r_hat) / r
        // For a moving dipole, eddy currents form loops around the motion path
        const magSpeed = Math.sqrt(dmx * dmx + dmy * dmy);
        if (r < 0.4 && magSpeed > 0.01) {
          // Cross product of magnet velocity with radial direction gives tangential current
          const cross = (dmx * dy - dmy * dx) / r;
          const falloff = Math.exp(-r * 8) * this.magnetStrength;
          this.jx[idx] += (-dy / r) * cross * falloff * cdt * 10;
          this.jy[idx] += (dx / r) * cross * falloff * cdt * 10;
        }

        // Decay existing currents
        this.jx[idx] *= Math.exp(-this.decayRate * cdt);
        this.jy[idx] *= Math.exp(-this.decayRate * cdt);
      }
    }

    // Update magnet marker
    const magPos = this.magnetPoint.geometry.getAttribute('position') as THREE.BufferAttribute;
    magPos.setXYZ(0, x + this.magnetX * w, y + this.magnetY * h, 1);
    magPos.needsUpdate = true;

    // Render to canvas
    this.renderAccum += dt;
    if (this.renderAccum >= 0.05) {
      this.renderAccum = 0;
      const cw = this.canvas.width, ch = this.canvas.height;
      this.ctx.fillStyle = '#000';
      this.ctx.fillRect(0, 0, cw, ch);

      const pr = Math.round(this.palette.primary.r * 255);
      const pg = Math.round(this.palette.primary.g * 255);
      const pb = Math.round(this.palette.primary.b * 255);
      const sr = Math.round(this.palette.secondary.r * 255);
      const sg = Math.round(this.palette.secondary.g * 255);
      const sb = Math.round(this.palette.secondary.b * 255);

      const cellW = cw / this.gridW;
      const cellH = ch / this.gridH;

      for (let gy = 0; gy < this.gridH; gy++) {
        for (let gx = 0; gx < this.gridW; gx++) {
          const idx = gy * this.gridW + gx;
          const jxv = this.jx[idx];
          const jyv = this.jy[idx];
          const mag = Math.sqrt(jxv * jxv + jyv * jyv);

          if (mag > 0.01) {
            const cx2 = (gx + 0.5) * cellW;
            const cy2 = (gy + 0.5) * cellH;
            const len = Math.min(cellW * 0.8, mag * cellW * 3);
            const nx = jxv / mag, ny = jyv / mag;

            const alpha = Math.min(1, mag * 3);
            const t = Math.min(1, mag * 2);
            const cr = Math.round(pr * (1 - t) + sr * t);
            const cg = Math.round(pg * (1 - t) + sg * t);
            const cb = Math.round(pb * (1 - t) + sb * t);

            this.ctx.strokeStyle = `rgba(${cr},${cg},${cb},${alpha.toFixed(2)})`;
            this.ctx.lineWidth = 1;
            this.ctx.beginPath();
            this.ctx.moveTo(cx2 - nx * len * 0.5, cy2 - ny * len * 0.5);
            this.ctx.lineTo(cx2 + nx * len * 0.5, cy2 + ny * len * 0.5);
            this.ctx.stroke();

            // Arrow head
            const headLen = len * 0.3;
            const tipX = cx2 + nx * len * 0.5;
            const tipY = cy2 + ny * len * 0.5;
            this.ctx.beginPath();
            this.ctx.moveTo(tipX, tipY);
            this.ctx.lineTo(tipX - nx * headLen + ny * headLen * 0.4,
              tipY - ny * headLen - nx * headLen * 0.4);
            this.ctx.moveTo(tipX, tipY);
            this.ctx.lineTo(tipX - nx * headLen - ny * headLen * 0.4,
              tipY - ny * headLen + nx * headLen * 0.4);
            this.ctx.stroke();
          }
        }
      }

      this.texture.needsUpdate = true;
    }

    (this.mesh.material as THREE.MeshBasicMaterial).opacity = opacity * 0.9;
    (this.magnetPoint.material as THREE.PointsMaterial).opacity = opacity;
    (this.borderLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.25;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Reverse magnet direction and boost
      this.magnetVx *= -2;
      this.magnetVy *= -2;
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) { this.magnetStrength = 1; return; }
    this.magnetStrength = 1 + level * 0.3;
    const boost = 1 + level * 0.15;
    this.magnetVx *= boost;
    this.magnetVy *= boost;
  }
}
