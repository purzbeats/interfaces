import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
}

/**
 * Particle sparks shooting from an emitter point.
 * Sparks have velocity, gravity, and fade over their lifetime.
 */
export class SparkEmitterElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'spark-emitter',
    meta: { shape: 'rectangular', roles: ['decorative'], moods: ['ambient', 'diagnostic'], sizes: ['needs-medium', 'needs-large'] },
  };
  private pointsMesh!: THREE.Points;
  private emitterMarker!: THREE.LineSegments;
  private borderLines!: THREE.LineSegments;
  private sparks: Spark[] = [];
  private poolSize: number = 0;
  private emitterX: number = 0;
  private emitterY: number = 0;
  private spawnRate: number = 0;
  private gravity: number = 0;
  private alertMode: boolean = false;

  build(): void {
    this.glitchAmount = 5;
    const { x, y, w, h } = this.px;

    this.poolSize = this.rng.int(100, 200);
    this.spawnRate = this.rng.float(8, 20); // sparks per second
    this.gravity = this.rng.float(-20, -60); // downward pull
    this.emitterX = x + this.rng.float(w * 0.3, w * 0.7);
    this.emitterY = y + this.rng.float(h * 0.3, h * 0.7);

    // Initialize spark pool (all dead)
    for (let i = 0; i < this.poolSize; i++) {
      this.sparks.push({ x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 1 });
    }

    // Points mesh
    const positions = new Float32Array(this.poolSize * 3);
    const colors = new Float32Array(this.poolSize * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.pointsMesh = new THREE.Points(geo, new THREE.PointsMaterial({
      vertexColors: true,
      size: Math.max(2, Math.min(w, h) * 0.004),
      transparent: true,
      opacity: 0,
      sizeAttenuation: false,
    }));
    this.group.add(this.pointsMesh);

    // Emitter marker (small cross)
    const cs = Math.min(w, h) * 0.03;
    const markerVerts = new Float32Array([
      this.emitterX - cs, this.emitterY, 1, this.emitterX + cs, this.emitterY, 1,
      this.emitterX, this.emitterY - cs, 1, this.emitterX, this.emitterY + cs, 1,
    ]);
    const markerGeo = new THREE.BufferGeometry();
    markerGeo.setAttribute('position', new THREE.BufferAttribute(markerVerts, 3));
    this.emitterMarker = new THREE.LineSegments(markerGeo, new THREE.LineBasicMaterial({
      color: this.palette.secondary,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.emitterMarker);

    // Border
    const bv = new Float32Array([
      x, y, 0, x + w, y, 0,
      x + w, y, 0, x + w, y + h, 0,
      x + w, y + h, 0, x, y + h, 0,
      x, y + h, 0, x, y, 0,
    ]);
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.BufferAttribute(bv, 3));
    this.borderLines = new THREE.LineSegments(bg, new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.borderLines);
  }

  private spawnSpark(): void {
    for (const s of this.sparks) {
      if (s.life <= 0) {
        const speed = this.rng.float(40, 150);
        const angle = this.rng.float(0, Math.PI * 2);
        s.x = this.emitterX;
        s.y = this.emitterY;
        s.vx = Math.cos(angle) * speed;
        s.vy = Math.sin(angle) * speed;
        s.maxLife = this.rng.float(0.5, 2.0);
        s.life = s.maxLife;
        return;
      }
    }
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);

    // Spawn new sparks
    const rate = this.alertMode ? this.spawnRate * 3 : this.spawnRate;
    const toSpawn = Math.floor(rate * dt + (this.rng.chance(rate * dt % 1) ? 1 : 0));
    for (let i = 0; i < toSpawn; i++) {
      this.spawnSpark();
    }

    const positions = this.pointsMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const colors = this.pointsMesh.geometry.getAttribute('color') as THREE.BufferAttribute;
    const primary = this.alertMode ? this.palette.alert : this.palette.primary;
    const dim = this.palette.dim;

    const { x, y, w, h } = this.px;

    for (let i = 0; i < this.poolSize; i++) {
      const s = this.sparks[i];
      if (s.life > 0) {
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        s.vy += this.gravity * dt;
        s.life -= dt;

        if (s.x < x || s.x > x + w || s.y < y || s.y > y + h) {
          s.life = 0;
        }

        const t = Math.max(0, s.life / s.maxLife);
        positions.setXYZ(i, s.x, s.y, 1);
        colors.setXYZ(i,
          dim.r + (primary.r - dim.r) * t,
          dim.g + (primary.g - dim.g) * t,
          dim.b + (primary.b - dim.b) * t,
        );
      } else {
        positions.setXYZ(i, 0, 0, -10); // hide offscreen
        colors.setXYZ(i, 0, 0, 0);
      }
    }
    positions.needsUpdate = true;
    colors.needsUpdate = true;

    (this.pointsMesh.material as THREE.PointsMaterial).opacity = opacity;
    (this.emitterMarker.material as THREE.LineBasicMaterial).opacity = opacity * 0.6;
    (this.borderLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.2;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Burst of sparks
      for (let i = 0; i < 30; i++) this.spawnSpark();
    }
    if (action === 'alert') {
      this.alertMode = true;
      this.pulseTimer = 2.0;
      setTimeout(() => { this.alertMode = false; }, 3000);
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) { this.alertMode = false; return; }
    if (level >= 3) {
      for (let i = 0; i < level * 10; i++) this.spawnSpark();
    }
    if (level >= 5) { this.alertMode = true; }
  }
}
