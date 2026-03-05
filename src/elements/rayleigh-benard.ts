import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Rayleigh-Benard convection cells with particle tracers.
 * Hot bottom, cool top — circulation rolls visualised via advected particles.
 */
export class RayleighBenardElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'rayleigh-benard',
    meta: { shape: 'rectangular', roles: ['data-display', 'decorative'], moods: ['ambient', 'diagnostic'], bandAffinity: 'sub', sizes: ['needs-medium', 'needs-large'] },
  };

  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private texture!: THREE.CanvasTexture;
  private mesh!: THREE.Mesh;

  private cellCount = 4;
  private particles: Array<{ x: number; y: number }> = [];
  private particleCount = 200;
  private flowSpeed = 1.0;

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;

    const variant = this.rng.int(0, 3);
    const presets = [
      { cells: 4, pCount: 200, speed: 1.0 },
      { cells: 6, pCount: 350, speed: 1.3 },
      { cells: 3, pCount: 150, speed: 0.7 },
      { cells: 5, pCount: 280, speed: 1.1 },
    ];
    const p = presets[variant];
    this.cellCount = p.cells;
    this.particleCount = p.pCount;
    this.flowSpeed = p.speed;

    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.max(64, Math.min(512, Math.round(w)));
    this.canvas.height = Math.max(32, Math.min(256, Math.round(h)));
    this.ctx = this.get2DContext(this.canvas);
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.magFilter = THREE.NearestFilter;

    // Initialize particles randomly
    for (let i = 0; i < this.particleCount; i++) {
      this.particles.push({
        x: this.rng.float(0, 1),
        y: this.rng.float(0, 1),
      });
    }

    const geo = new THREE.PlaneGeometry(w, h);
    const mat = new THREE.MeshBasicMaterial({ map: this.texture, transparent: true });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.set(x + w / 2, y + h / 2, 0);
    this.group.add(this.mesh);
  }

  /** Velocity field for Rayleigh-Benard convection rolls. */
  private velocity(nx: number, ny: number): [number, number] {
    // Stream function for counter-rotating convection cells:
    // psi = sin(n*pi*x) * sin(pi*y)
    // vx = dpsi/dy = sin(n*pi*x) * pi * cos(pi*y)
    // vy = -dpsi/dx = -n*pi*cos(n*pi*x) * sin(pi*y)
    const n = this.cellCount;
    const px = Math.PI;
    const sinNx = Math.sin(n * px * nx);
    const cosNx = Math.cos(n * px * nx);
    const sinY = Math.sin(px * ny);
    const cosY = Math.cos(px * ny);

    const vx = sinNx * px * cosY * this.flowSpeed;
    const vy = -n * px * cosNx * sinY * this.flowSpeed;

    return [vx, vy];
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);
    (this.mesh.material as THREE.MeshBasicMaterial).opacity = opacity;

    const cw = this.canvas.width;
    const ch = this.canvas.height;
    const ctx = this.ctx;
    const clampDt = Math.min(dt, 0.05);

    // Semi-transparent clear for trail effect
    ctx.fillStyle = 'rgba(0, 0, 0, 0.08)';
    ctx.fillRect(0, 0, cw, ch);

    // Draw temperature gradient background (subtle)
    const hotR = Math.round(this.palette.primary.r * 255);
    const hotG = Math.round(this.palette.primary.g * 255);
    const hotB = Math.round(this.palette.primary.b * 255);
    const coolR = Math.round(this.palette.secondary.r * 255);
    const coolG = Math.round(this.palette.secondary.g * 255);
    const coolB = Math.round(this.palette.secondary.b * 255);

    // Draw cell boundaries (faint vertical lines)
    ctx.strokeStyle = `rgba(${Math.round(this.palette.dim.r * 255)}, ${Math.round(this.palette.dim.g * 255)}, ${Math.round(this.palette.dim.b * 255)}, 0.1)`;
    ctx.lineWidth = 0.5;
    for (let c = 0; c <= this.cellCount; c++) {
      const bx = (c / this.cellCount) * cw;
      ctx.beginPath();
      ctx.moveTo(bx, 0);
      ctx.lineTo(bx, ch);
      ctx.stroke();
    }

    // Hot bottom / cool top indicators
    ctx.fillStyle = `rgba(${hotR}, ${hotG}, ${hotB}, 0.05)`;
    ctx.fillRect(0, ch * 0.85, cw, ch * 0.15);
    ctx.fillStyle = `rgba(${coolR}, ${coolG}, ${coolB}, 0.05)`;
    ctx.fillRect(0, 0, cw, ch * 0.15);

    // Advect and draw particles
    for (const part of this.particles) {
      // RK2 integration
      const [vx1, vy1] = this.velocity(part.x, part.y);
      const mx = part.x + vx1 * clampDt * 0.5;
      const my = part.y + vy1 * clampDt * 0.5;
      const [vx2, vy2] = this.velocity(mx, my);

      part.x += vx2 * clampDt;
      part.y += vy2 * clampDt;

      // Wrap horizontally, reflect vertically
      if (part.x < 0) part.x += 1;
      if (part.x > 1) part.x -= 1;
      if (part.y < 0) { part.y = -part.y; }
      if (part.y > 1) { part.y = 2 - part.y; }
      part.y = Math.max(0.001, Math.min(0.999, part.y));

      // Color by temperature (y position): hot at bottom, cool at top
      const temp = part.y; // 0 = top (cool), 1 = bottom (hot)
      const r = Math.round(coolR + (hotR - coolR) * temp);
      const g = Math.round(coolG + (hotG - coolG) * temp);
      const b = Math.round(coolB + (hotB - coolB) * temp);

      const speed = Math.sqrt(vx2 * vx2 + vy2 * vy2);
      const size = 1 + Math.min(2, speed * 0.3);

      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.7)`;
      ctx.fillRect(part.x * cw - size / 2, part.y * ch - size / 2, size, size);
    }

    this.texture.needsUpdate = true;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Perturb all particles
      for (const p of this.particles) {
        p.x += this.rng.float(-0.1, 0.1);
        p.y += this.rng.float(-0.1, 0.1);
        p.x = ((p.x % 1) + 1) % 1;
        p.y = Math.max(0.01, Math.min(0.99, p.y));
      }
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level >= 2) {
      this.flowSpeed = 1.0 + level * 0.3;
    }
  }
}
