import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Parallax star field with per-star twinkling, occasional shooting stars,
 * and subtle nebula glow regions. Three depth layers drift outward from center.
 */
export class StarFieldElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'star-field',
    meta: { shape: 'rectangular', roles: ['decorative'], moods: ['ambient'], bandAffinity: 'high', audioSensitivity: 1.5, sizes: ['needs-medium', 'needs-large'] },
  };
  private layers: THREE.Points[] = [];
  private layerData: Array<{
    positions: Float32Array;
    velocities: Array<{ vx: number; vy: number }>;
    twinklePhases: number[];
    twinkleSpeeds: number[];
    baseAlphas: number[];
  }> = [];
  private shootingStars: THREE.LineSegments | null = null;
  private shoots: Array<{ x: number; y: number; vx: number; vy: number; life: number }> = [];
  private shootTimer: number = 0;
  private nebulaGlow!: THREE.Mesh;
  private nebulaX: number = 0;
  private nebulaY: number = 0;

  build(): void {
    const variant = this.rng.int(0, 3);
    const presets = [
      { farCount: 110, midCount: 55, nearCount: 22, farSpd: 0.12, midSpd: 0.35, nearSpd: 0.7, twinkleMin: 1.5, twinkleMax: 5, nebulaSizeMul: 0.4, farSize: 1.5, midSize: 2.5, nearSize: 3.5 },  // Standard
      { farCount: 200, midCount: 100, nearCount: 50, farSpd: 0.25, midSpd: 0.6, nearSpd: 1.2, twinkleMin: 3, twinkleMax: 10, nebulaSizeMul: 0.6, farSize: 1.5, midSize: 3.0, nearSize: 4.5 },   // Dense/Intense
      { farCount: 40, midCount: 15, nearCount: 5, farSpd: 0.05, midSpd: 0.15, nearSpd: 0.3, twinkleMin: 0.5, twinkleMax: 2, nebulaSizeMul: 0.25, farSize: 1.0, midSize: 2.0, nearSize: 3.0 },   // Minimal/Sparse
      { farCount: 60, midCount: 80, nearCount: 40, farSpd: 0.4, midSpd: 0.1, nearSpd: 0.5, twinkleMin: 4, twinkleMax: 12, nebulaSizeMul: 0.7, farSize: 2.5, midSize: 1.5, nearSize: 5.0 },      // Exotic/Alt
    ];
    const p = presets[variant];

    this.glitchAmount = 5;
    const { x, y, w, h } = this.px;
    const cx = x + w / 2;
    const cy = y + h / 2;

    // Nebula glow — soft blob
    this.nebulaX = cx + this.rng.float(-w * 0.2, w * 0.2);
    this.nebulaY = cy + this.rng.float(-h * 0.2, h * 0.2);
    const nebulaSize = Math.min(w, h) * (p.nebulaSizeMul + this.rng.float(-0.05, 0.05));
    const nebulaGeo = new THREE.PlaneGeometry(nebulaSize, nebulaSize);
    this.nebulaGlow = new THREE.Mesh(nebulaGeo, new THREE.MeshBasicMaterial({
      color: this.palette.secondary,
      transparent: true,
      opacity: 0,
    }));
    this.nebulaGlow.position.set(this.nebulaX, this.nebulaY, 0);
    this.group.add(this.nebulaGlow);

    const layerConfigs = [
      { count: p.farCount + this.rng.int(-5, 5), speed: p.farSpd, size: p.farSize },   // far
      { count: p.midCount + this.rng.int(-3, 3), speed: p.midSpd, size: p.midSize },   // mid
      { count: p.nearCount + this.rng.int(-2, 2), speed: p.nearSpd, size: p.nearSize }, // near
    ];

    for (let l = 0; l < layerConfigs.length; l++) {
      const cfg = layerConfigs[l];
      const positions = new Float32Array(cfg.count * 3);
      const velocities: Array<{ vx: number; vy: number }> = [];
      const twinklePhases: number[] = [];
      const twinkleSpeeds: number[] = [];
      const baseAlphas: number[] = [];

      for (let i = 0; i < cfg.count; i++) {
        positions[i * 3] = x + this.rng.float(0, w);
        positions[i * 3 + 1] = y + this.rng.float(0, h);
        positions[i * 3 + 2] = l;

        const dx = positions[i * 3] - cx;
        const dy = positions[i * 3 + 1] - cy;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        velocities.push({
          vx: (dx / dist) * cfg.speed * this.rng.float(0.5, 1.5),
          vy: (dy / dist) * cfg.speed * this.rng.float(0.5, 1.5),
        });
        twinklePhases.push(this.rng.float(0, Math.PI * 2));
        twinkleSpeeds.push(this.rng.float(p.twinkleMin, p.twinkleMax));
        baseAlphas.push(this.rng.float(0.4, 1.0));
      }

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      // Per-star alpha via color attribute
      const colors = new Float32Array(cfg.count * 3);
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

      const points = new THREE.Points(geo, new THREE.PointsMaterial({
        color: l === 2 ? this.palette.primary : (l === 1 ? this.palette.secondary : this.palette.dim),
        size: cfg.size,
        transparent: true,
        opacity: 0,
        sizeAttenuation: false,
      }));
      this.layers.push(points);
      this.layerData.push({ positions, velocities, twinklePhases, twinkleSpeeds, baseAlphas });
      this.group.add(points);
    }

    // Shooting stars line segments (pool of 4)
    const shootVerts = new Float32Array(4 * 2 * 3);
    const shootGeo = new THREE.BufferGeometry();
    shootGeo.setAttribute('position', new THREE.BufferAttribute(shootVerts, 3));
    shootGeo.setDrawRange(0, 0);
    this.shootingStars = new THREE.LineSegments(shootGeo, new THREE.LineBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.shootingStars);
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    const { x, y, w, h } = this.px;
    const cx = x + w / 2;
    const cy = y + h / 2;

    // Nebula pulse
    (this.nebulaGlow.material as THREE.MeshBasicMaterial).opacity =
      opacity * (0.025 + Math.sin(time * 0.5) * 0.01);

    for (let l = 0; l < this.layers.length; l++) {
      const data = this.layerData[l];
      const pos = this.layers[l].geometry.getAttribute('position') as THREE.BufferAttribute;
      const count = data.velocities.length;
      const speeds = [0.12, 0.35, 0.7];

      for (let i = 0; i < count; i++) {
        let px = data.positions[i * 3] + data.velocities[i].vx * dt;
        let py = data.positions[i * 3 + 1] + data.velocities[i].vy * dt;

        // Wrap back to center region when out of bounds
        if (px < x || px > x + w || py < y || py > y + h) {
          px = cx + this.rng.float(-w * 0.1, w * 0.1);
          py = cy + this.rng.float(-h * 0.1, h * 0.1);
          const dx = px - cx;
          const dy = py - cy;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          data.velocities[i].vx = (dx / dist) * speeds[l] * this.rng.float(0.5, 1.5);
          data.velocities[i].vy = (dy / dist) * speeds[l] * this.rng.float(0.5, 1.5);
        }

        data.positions[i * 3] = px;
        data.positions[i * 3 + 1] = py;
        pos.setXY(i, px, py);
      }
      pos.needsUpdate = true;

      // Per-star twinkle
      let layerAlpha = 0;
      for (let i = 0; i < count; i++) {
        const tw = data.baseAlphas[i] * (0.5 + 0.5 * Math.sin(time * data.twinkleSpeeds[i] + data.twinklePhases[i]));
        layerAlpha += tw;
      }
      layerAlpha /= count;
      (this.layers[l].material as THREE.PointsMaterial).opacity = opacity * Math.max(0.3, layerAlpha);
    }

    // Shooting stars
    this.shootTimer += dt;
    if (this.shootTimer > this.rng.float(2, 6)) {
      this.shootTimer = 0;
      if (this.shoots.length < 4) {
        const angle = this.rng.float(0.3, 1.2); // mostly diagonal
        const speed = this.rng.float(200, 500);
        this.shoots.push({
          x: x + this.rng.float(0, w * 0.7),
          y: y + h - this.rng.float(0, h * 0.3),
          vx: Math.cos(angle) * speed,
          vy: -Math.sin(angle) * speed,
          life: this.rng.float(0.2, 0.5),
        });
      }
    }

    const shootPos = this.shootingStars!.geometry.getAttribute('position') as THREE.BufferAttribute;
    let shootVi = 0;
    for (let i = this.shoots.length - 1; i >= 0; i--) {
      const s = this.shoots[i];
      s.life -= dt;
      if (s.life <= 0) { this.shoots.splice(i, 1); continue; }
      const tailLen = 0.05;
      shootPos.setXYZ(shootVi++, s.x, s.y, 3);
      shootPos.setXYZ(shootVi++, s.x - s.vx * tailLen, s.y - s.vy * tailLen, 3);
      s.x += s.vx * dt;
      s.y += s.vy * dt;
    }
    shootPos.needsUpdate = true;
    this.shootingStars!.geometry.setDrawRange(0, shootVi);
    (this.shootingStars!.material as THREE.LineBasicMaterial).opacity = opacity * 0.8;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      for (const data of this.layerData) {
        for (const v of data.velocities) {
          v.vx *= this.rng.float(2, 5);
          v.vy *= this.rng.float(2, 5);
        }
      }
    }
    if (action === 'alert') {
      this.pulseTimer = 2.0;
      // Trigger burst of shooting stars
      for (let i = 0; i < 3; i++) {
        this.shoots.push({
          x: this.px.x + this.rng.float(0, this.px.w),
          y: this.px.y + this.px.h,
          vx: this.rng.float(100, 300),
          vy: this.rng.float(-400, -200),
          life: 0.4,
        });
      }
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) return;
    // Scale twinkle speed with level
    for (const data of this.layerData) {
      for (let i = 0; i < data.twinkleSpeeds.length; i++) {
        data.twinkleSpeeds[i] = this.rng.float(1.5, 5) * (1 + level * 0.4);
      }
    }
    // Shooting star probability scales with level
    if (level >= 2 && this.shoots.length < 4) {
      const count = Math.min(level - 1, 4 - this.shoots.length);
      for (let i = 0; i < count; i++) {
        this.shoots.push({
          x: this.px.x + this.rng.float(0, this.px.w * 0.7),
          y: this.px.y + this.px.h - this.rng.float(0, this.px.h * 0.3),
          vx: this.rng.float(150, 400),
          vy: this.rng.float(-500, -200),
          life: this.rng.float(0.3, 0.6),
        });
      }
    }
    if (level >= 5) {
      // Hyperspace — burst of shooting stars
      for (let i = 0; i < 4; i++) {
        this.shoots.push({
          x: this.px.x + this.rng.float(0, this.px.w),
          y: this.px.y + this.px.h,
          vx: this.rng.float(200, 500),
          vy: this.rng.float(-600, -300),
          life: 0.5,
        });
      }
    }
  }
}
