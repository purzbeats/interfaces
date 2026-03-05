import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Charged particles moving in a magnetic field. Shows helical/circular
 * paths due to the Lorentz force. Multiple particles with different
 * charge/mass ratios produce different radii. Trail rendering.
 */
export class LorentzForceElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'lorentz-force',
    meta: {
      shape: 'radial',
      roles: ['data-display', 'decorative'],
      moods: ['tactical', 'diagnostic'],
      bandAffinity: 'high',
      sizes: ['needs-medium', 'needs-large'],
    },
  };

  private particles!: THREE.Points;
  private trailLines: THREE.Line[] = [];
  private fieldIndicator!: THREE.LineSegments;
  private frameLine!: THREE.LineSegments;

  private particleData: {
    x: number; y: number;
    vx: number; vy: number;
    qm: number; // charge-to-mass ratio
    trail: { x: number; y: number }[];
  }[] = [];

  private cx: number = 0;
  private cy: number = 0;
  private bField: number = 0.5;
  private trailLen: number = 120;
  private particleCount: number = 3;
  private speedMult: number = 1;
  private regionW: number = 0;
  private regionH: number = 0;

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;
    this.cx = x + w / 2;
    this.cy = y + h / 2;
    this.regionW = w;
    this.regionH = h;

    const variant = this.rng.int(0, 3);
    const presets = [
      { count: 3, bField: 0.5, speeds: [40, 60, 80], qms: [1.0, 0.5, 2.0] },
      { count: 2, bField: 0.8, speeds: [50, 70], qms: [1.0, -1.0] },
      { count: 4, bField: 0.3, speeds: [30, 45, 60, 75], qms: [0.5, 1.0, 1.5, 2.0] },
      { count: 5, bField: 0.6, speeds: [35, 50, 65, 80, 95], qms: [0.3, 0.7, 1.0, 1.5, -0.8] },
    ];
    const p = presets[variant];
    this.particleCount = p.count;
    this.bField = p.bField;

    // Initialize particles
    for (let i = 0; i < this.particleCount; i++) {
      const angle = this.rng.float(0, Math.PI * 2);
      const speed = p.speeds[i] ?? 50;
      this.particleData.push({
        x: this.cx + this.rng.float(-w * 0.2, w * 0.2),
        y: this.cy + this.rng.float(-h * 0.2, h * 0.2),
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        qm: p.qms[i] ?? 1.0,
        trail: [],
      });
    }

    // Particle points
    const pPos = new Float32Array(this.particleCount * 3);
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
    this.particles = new THREE.Points(pGeo, new THREE.PointsMaterial({
      color: this.palette.primary, transparent: true, opacity: 0,
      size: Math.max(1, Math.min(w, h) * 0.02), sizeAttenuation: false,
    }));
    this.group.add(this.particles);

    // Trail lines for each particle
    const colors = [this.palette.primary, this.palette.secondary, this.palette.dim];
    for (let i = 0; i < this.particleCount; i++) {
      const tPos = new Float32Array(this.trailLen * 3);
      const tGeo = new THREE.BufferGeometry();
      tGeo.setAttribute('position', new THREE.BufferAttribute(tPos, 3));
      const trail = new THREE.Line(tGeo, new THREE.LineBasicMaterial({
        color: colors[i % colors.length], transparent: true, opacity: 0,
      }));
      this.trailLines.push(trail);
      this.group.add(trail);
    }

    // Magnetic field indicator (cross pattern showing B field into page)
    const fSegs = 16;
    const fPos = new Float32Array(fSegs * 6);
    let fi = 0;
    const spacing = Math.min(w, h) * 0.2;
    for (let gy = 0; gy < 4; gy++) {
      for (let gx = 0; gx < 4; gx++) {
        if (fi >= fSegs) break;
        const fx = x + w * 0.2 + gx * spacing;
        const fy = y + h * 0.2 + gy * spacing;
        const s = 3;
        // X mark (field into page)
        fPos[fi * 6] = fx - s; fPos[fi * 6 + 1] = fy - s; fPos[fi * 6 + 2] = 0;
        fPos[fi * 6 + 3] = fx + s; fPos[fi * 6 + 4] = fy + s; fPos[fi * 6 + 5] = 0;
        fi++;
      }
    }
    // Fill remaining with last valid position
    const lastX = fPos[(fi - 1) * 6 + 3];
    const lastY = fPos[(fi - 1) * 6 + 4];
    while (fi < fSegs) {
      fPos[fi * 6] = lastX; fPos[fi * 6 + 1] = lastY; fPos[fi * 6 + 2] = 0;
      fPos[fi * 6 + 3] = lastX; fPos[fi * 6 + 4] = lastY; fPos[fi * 6 + 5] = 0;
      fi++;
    }
    const fGeo = new THREE.BufferGeometry();
    fGeo.setAttribute('position', new THREE.BufferAttribute(fPos, 3));
    this.fieldIndicator = new THREE.LineSegments(fGeo, new THREE.LineBasicMaterial({
      color: this.palette.dim, transparent: true, opacity: 0,
    }));
    this.group.add(this.fieldIndicator);

    // Frame
    const pad = 2;
    const frv = new Float32Array([
      x + pad, y + pad, 0, x + w - pad, y + pad, 0,
      x + w - pad, y + pad, 0, x + w - pad, y + h - pad, 0,
      x + w - pad, y + h - pad, 0, x + pad, y + h - pad, 0,
      x + pad, y + h - pad, 0, x + pad, y + pad, 0,
    ]);
    const frGeo = new THREE.BufferGeometry();
    frGeo.setAttribute('position', new THREE.BufferAttribute(frv, 3));
    this.frameLine = new THREE.LineSegments(frGeo, new THREE.LineBasicMaterial({
      color: this.palette.dim, transparent: true, opacity: 0,
    }));
    this.group.add(this.frameLine);
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    const effDt = Math.min(dt, 0.03) * this.speedMult;
    const { x, y, w, h } = this.px;

    const pPos = this.particles.geometry.getAttribute('position') as THREE.BufferAttribute;

    // Simulate Lorentz force: F = qv x B
    // In 2D with B perpendicular to plane: ax = qm*B*vy, ay = -qm*B*vx
    const steps = 4;
    const subDt = effDt / steps;

    for (let i = 0; i < this.particleCount; i++) {
      const pd = this.particleData[i];

      for (let s = 0; s < steps; s++) {
        const ax = pd.qm * this.bField * pd.vy;
        const ay = -pd.qm * this.bField * pd.vx;
        pd.vx += ax * subDt;
        pd.vy += ay * subDt;
        pd.x += pd.vx * subDt;
        pd.y += pd.vy * subDt;

        // Wrap around region boundaries
        if (pd.x < x) pd.x += w;
        if (pd.x > x + w) pd.x -= w;
        if (pd.y < y) pd.y += h;
        if (pd.y > y + h) pd.y -= h;
      }

      // Update particle position
      pPos.setXYZ(i, pd.x, pd.y, 2);

      // Update trail
      pd.trail.push({ x: pd.x, y: pd.y });
      if (pd.trail.length > this.trailLen) pd.trail.shift();

      const tPos = this.trailLines[i].geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let j = 0; j < this.trailLen; j++) {
        const pt = pd.trail[j] ?? pd.trail[pd.trail.length - 1] ?? { x: pd.x, y: pd.y };
        tPos.setXYZ(j, pt.x, pt.y, 0.5);
      }
      tPos.needsUpdate = true;

      const trailFade = Math.min(pd.trail.length / this.trailLen, 1);
      (this.trailLines[i].material as THREE.LineBasicMaterial).opacity = opacity * 0.35 * trailFade;
    }
    pPos.needsUpdate = true;

    // Opacities
    (this.particles.material as THREE.PointsMaterial).opacity = opacity;
    (this.fieldIndicator.material as THREE.LineBasicMaterial).opacity = opacity * 0.1;
    (this.frameLine.material as THREE.LineBasicMaterial).opacity = opacity * 0.15;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Reverse B field briefly
      this.bField = -this.bField;
      setTimeout(() => { this.bField = -this.bField; }, 500);
      // Perturb velocities
      for (const pd of this.particleData) {
        pd.vx += this.rng.float(-20, 20);
        pd.vy += this.rng.float(-20, 20);
      }
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level >= 4) {
      this.bField *= 1.5;
      this.speedMult = 2;
    } else if (level >= 2) {
      this.speedMult = 1.3;
    } else {
      this.speedMult = 1;
    }
  }
}
