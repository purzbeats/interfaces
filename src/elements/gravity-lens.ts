import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Gravitational lensing effect. Background star grid gets distorted by a
 * moving massive object creating Einstein ring effects. Canvas-based
 * with animated lens position.
 */
export class GravityLensElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'gravity-lens',
    meta: {
      shape: 'rectangular',
      roles: ['decorative', 'data-display'],
      moods: ['ambient', 'tactical'],
      bandAffinity: 'sub',
      sizes: ['needs-medium', 'needs-large'],
    },
  };

  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private texture!: THREE.CanvasTexture;
  private mesh!: THREE.Mesh;
  private material!: THREE.MeshBasicMaterial;

  private cw: number = 0;
  private ch: number = 0;

  // Star positions (background)
  private stars: { x: number; y: number; brightness: number; size: number }[] = [];

  // Lens parameters
  private lensX: number = 0;
  private lensY: number = 0;
  private lensMass: number = 40;
  private lensSpeedX: number = 0.3;
  private lensSpeedY: number = 0.2;
  private lensPathRadius: number = 0.3;
  private einsteinRadius: number = 30;
  private intensityLevel: number = 0;
  private starCount: number = 200;

  build(): void {
    const variant = this.rng.int(0, 3);
    const presets = [
      { mass: 40, stars: 200, pathR: 0.3, spdX: 0.3, spdY: 0.2, einstein: 30 },   // Gentle orbit
      { mass: 60, stars: 300, pathR: 0.15, spdX: 0.1, spdY: 0.15, einstein: 40 },  // Heavy slow
      { mass: 25, stars: 150, pathR: 0.4, spdX: 0.5, spdY: 0.35, einstein: 20 },   // Light fast
      { mass: 80, stars: 400, pathR: 0.2, spdX: 0.2, spdY: 0.1, einstein: 50 },    // Ultra-heavy
    ];
    const p = presets[variant];

    this.lensMass = p.mass;
    this.starCount = p.stars;
    this.lensPathRadius = p.pathR;
    this.lensSpeedX = p.spdX;
    this.lensSpeedY = p.spdY;
    this.einsteinRadius = p.einstein;
    this.glitchAmount = 4;

    const { x, y, w, h } = this.px;
    this.cw = Math.max(64, Math.floor(w * 0.6));
    this.ch = Math.max(64, Math.floor(h * 0.6));

    // Generate background stars in normalized coords [0,1]
    this.stars = [];
    for (let i = 0; i < this.starCount; i++) {
      this.stars.push({
        x: this.rng.float(0, 1),
        y: this.rng.float(0, 1),
        brightness: this.rng.float(0.3, 1.0),
        size: this.rng.float(0.5, 2.0),
      });
    }

    this.canvas = document.createElement('canvas');
    this.canvas.width = this.cw;
    this.canvas.height = this.ch;
    this.ctx = this.get2DContext(this.canvas);

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.magFilter = THREE.NearestFilter;

    this.material = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      opacity: 0,
    });

    const geo = new THREE.PlaneGeometry(w, h);
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.position.set(x + w / 2, y + h / 2, 0);
    this.group.add(this.mesh);
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    this.material.opacity = opacity;

    // Move lens in a Lissajous pattern
    this.lensX = 0.5 + this.lensPathRadius * Math.sin(time * this.lensSpeedX);
    this.lensY = 0.5 + this.lensPathRadius * Math.cos(time * this.lensSpeedY * 1.3);

    const ctx = this.ctx;
    const cw = this.cw;
    const ch = this.ch;

    // Clear background
    const bg = this.palette.bg;
    ctx.fillStyle = `rgb(${Math.floor(bg.r * 255)},${Math.floor(bg.g * 255)},${Math.floor(bg.b * 255)})`;
    ctx.fillRect(0, 0, cw, ch);

    const pr = this.palette.primary;
    const sr = this.palette.secondary;
    const dm = this.palette.dim;
    const eR = this.einsteinRadius * (1 + this.intensityLevel * 0.1);
    const mass = this.lensMass * (1 + this.intensityLevel * 0.1);

    // Draw each star with gravitational lensing distortion
    for (const star of this.stars) {
      // Vector from lens to star (in pixel space)
      const dx = star.x - this.lensX;
      const dy = star.y - this.lensY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      let apparentX: number;
      let apparentY: number;
      let magnification: number;

      if (dist < 0.001) {
        // Star directly behind lens: Einstein ring
        apparentX = this.lensX;
        apparentY = this.lensY;
        magnification = 5;
      } else {
        // Gravitational deflection
        const eRNorm = eR / Math.max(cw, ch);
        const deflection = (eRNorm * eRNorm) / dist;

        // Two images: one inside, one outside Einstein ring
        apparentX = star.x + (dx / dist) * deflection;
        apparentY = star.y + (dy / dist) * deflection;

        // Magnification increases near Einstein ring
        const u = dist / eRNorm;
        magnification = u < 0.1 ? 5 : (u * u + 2) / (u * Math.sqrt(u * u + 4));
      }

      const screenX = apparentX * cw;
      const screenY = apparentY * ch;
      const bright = Math.min(1, star.brightness * magnification);
      const size = star.size * Math.min(3, magnification);

      // Color: brighter stars shift toward secondary
      const t = bright;
      const r = Math.floor((dm.r + (pr.r - dm.r) * t) * 255);
      const g = Math.floor((dm.g + (pr.g - dm.g) * t) * 255);
      const b = Math.floor((dm.b + (pr.b - dm.b) * t) * 255);

      ctx.fillStyle = `rgba(${r},${g},${b},${bright})`;
      ctx.beginPath();
      ctx.arc(screenX, screenY, size, 0, Math.PI * 2);
      ctx.fill();

      // Draw secondary (inner) image for stars near the lens
      if (dist > 0.001 && dist < eR * 3 / Math.max(cw, ch)) {
        const innerX = this.lensX * cw - (dx / dist) * eR * 0.3;
        const innerY = this.lensY * ch - (dy / dist) * eR * 0.3;
        ctx.fillStyle = `rgba(${Math.floor(sr.r * 255)},${Math.floor(sr.g * 255)},${Math.floor(sr.b * 255)},${bright * 0.3})`;
        ctx.beginPath();
        ctx.arc(innerX, innerY, size * 0.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Draw Einstein ring indicator
    const lx = this.lensX * cw;
    const ly = this.lensY * ch;
    ctx.strokeStyle = `rgba(${Math.floor(sr.r * 255)},${Math.floor(sr.g * 255)},${Math.floor(sr.b * 255)},0.15)`;
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.arc(lx, ly, eR, 0, Math.PI * 2);
    ctx.stroke();

    // Lens center dot
    ctx.fillStyle = `rgba(${Math.floor(sr.r * 255)},${Math.floor(sr.g * 255)},${Math.floor(sr.b * 255)},0.4)`;
    ctx.beginPath();
    ctx.arc(lx, ly, Math.max(1, Math.min(cw, ch) * 0.008), 0, Math.PI * 2);
    ctx.fill();

    this.texture.needsUpdate = true;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      this.lensMass *= 2;
      this.einsteinRadius *= 1.5;
      setTimeout(() => {
        this.lensMass /= 2;
        this.einsteinRadius /= 1.5;
      }, 600);
    }
    if (action === 'pulse') {
      // Add extra stars near lens
      for (let i = 0; i < 20; i++) {
        this.stars.push({
          x: this.lensX + this.rng.float(-0.1, 0.1),
          y: this.lensY + this.rng.float(-0.1, 0.1),
          brightness: this.rng.float(0.5, 1.0),
          size: this.rng.float(1, 2.5),
        });
      }
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    this.intensityLevel = level;
  }
}
