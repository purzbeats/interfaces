import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

interface FlameParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  isEmber: boolean;
}

/**
 * Rising flame/heat column using particles that drift upward and fade.
 * Warm-colored particles with turbulence simulate a column of fire or embers.
 */
export class FlameColumnElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'flame-column',
    meta: {
      shape: 'rectangular',
      roles: ['decorative'],
      moods: ['ambient', 'tactical'],
      sizes: ['works-small', 'needs-medium'],
      bandAffinity: 'bass',
    },
  };

  private pointsMesh!: THREE.Points;
  private embersMesh!: THREE.Points;
  private borderLines!: THREE.LineSegments;

  private particles: FlameParticle[] = [];
  private poolSize: number = 0;
  private emberPoolSize: number = 0;

  // Variant config
  private columnCenterX: number = 0;
  private columnWidth: number = 0;
  private baseY: number = 0;
  private topY: number = 0;
  private spawnRate: number = 0;
  private emberRate: number = 0;
  private riseSpeed: number = 0;
  private turbulence: number = 0;
  private intense: boolean = false;

  // Variant index retained for intensity scaling
  private variantIndex: number = 0;

  build(): void {
    const variant = this.rng.int(0, 3);
    this.variantIndex = variant;
    const { x, y, w, h } = this.px;

    const presets = [
      // 0: narrow flame
      { poolSize: 80, emberPool: 20, widthFrac: 0.18, rate: 25, emberRate: 3, riseMin: 60, riseMax: 130, turb: 20, pointSz: 3 },
      // 1: wide fire
      { poolSize: 160, emberPool: 40, widthFrac: 0.55, rate: 50, emberRate: 8, riseMin: 50, riseMax: 100, turb: 35, pointSz: 4 },
      // 2: embers only
      { poolSize: 20, emberPool: 80, widthFrac: 0.4, rate: 5, emberRate: 20, riseMin: 30, riseMax: 90, turb: 50, pointSz: 2 },
      // 3: intense blaze
      { poolSize: 200, emberPool: 60, widthFrac: 0.7, rate: 80, emberRate: 15, riseMin: 80, riseMax: 200, turb: 45, pointSz: 5 },
    ];
    const p = presets[variant];

    this.poolSize = p.poolSize;
    this.emberPoolSize = p.emberPool;
    this.columnCenterX = x + w * 0.5;
    this.columnWidth = w * p.widthFrac;
    this.baseY = y + h;
    this.topY = y;
    this.spawnRate = p.rate;
    this.emberRate = p.emberRate;
    this.riseSpeed = this.rng.float(p.riseMin, p.riseMax);
    this.turbulence = p.turb;

    // Initialize particle pools
    const totalPool = this.poolSize + this.emberPoolSize;
    for (let i = 0; i < totalPool; i++) {
      this.particles.push({
        x: 0, y: 0,
        vx: 0, vy: 0,
        life: 0, maxLife: 1,
        size: 3,
        isEmber: i >= this.poolSize,
      });
    }

    // Main flame particles
    const flamePositions = new Float32Array(this.poolSize * 3);
    const flameColors = new Float32Array(this.poolSize * 3);
    const flameSizes = new Float32Array(this.poolSize);
    const flameGeo = new THREE.BufferGeometry();
    flameGeo.setAttribute('position', new THREE.BufferAttribute(flamePositions, 3));
    flameGeo.setAttribute('color', new THREE.BufferAttribute(flameColors, 3));
    flameGeo.setAttribute('size', new THREE.BufferAttribute(flameSizes, 1));

    this.pointsMesh = new THREE.Points(flameGeo, new THREE.PointsMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0,
      size: p.pointSz,
      sizeAttenuation: false,
    }));
    this.group.add(this.pointsMesh);

    // Ember particles (smaller, slower)
    const emberPositions = new Float32Array(this.emberPoolSize * 3);
    const emberColors = new Float32Array(this.emberPoolSize * 3);
    const emberGeo = new THREE.BufferGeometry();
    emberGeo.setAttribute('position', new THREE.BufferAttribute(emberPositions, 3));
    emberGeo.setAttribute('color', new THREE.BufferAttribute(emberColors, 3));

    this.embersMesh = new THREE.Points(emberGeo, new THREE.PointsMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0,
      size: Math.max(1.5, p.pointSz - 1),
      sizeAttenuation: false,
    }));
    this.group.add(this.embersMesh);

    // Border
    const bv = new Float32Array([
      x, y, 0, x + w, y, 0,
      x + w, y, 0, x + w, y + h, 0,
      x + w, y + h, 0, x, y + h, 0,
      x, y + h, 0, x, y, 0,
    ]);
    const borderGeo = new THREE.BufferGeometry();
    borderGeo.setAttribute('position', new THREE.BufferAttribute(bv, 3));
    this.borderLines = new THREE.LineSegments(borderGeo, new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.borderLines);

    // Pre-spawn particles so there's visible content on the first frame (e.g. gallery view)
    this.preSpawn();
  }

  /** Fill the particle pools with pre-aged particles so the flame is visible immediately. */
  private preSpawn(): void {
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      const isEmber = p.isEmber;
      const spread = this.columnWidth * 0.5;
      p.x = this.columnCenterX + this.rng.float(-spread, spread);
      p.maxLife = isEmber ? this.rng.float(1.5, 3.5) : this.rng.float(0.4, 1.2);
      // Distribute age randomly so particles fill the column
      const ageFrac = this.rng.float(0, 1);
      p.life = p.maxLife * (1 - ageFrac);
      // Place at a height corresponding to their age
      p.y = this.baseY + (this.topY - this.baseY) * ageFrac;
      p.vy = -(this.riseSpeed + this.rng.float(-this.riseSpeed * 0.3, this.riseSpeed * 0.3));
      p.vx = this.rng.float(-this.turbulence, this.turbulence);
      p.size = isEmber ? this.rng.float(1, 2.5) : this.rng.float(2, 5);
      // Narrow x based on height
      const heightFrac = Math.max(0, (p.y - this.topY) / (this.baseY - this.topY));
      const halfW = this.columnWidth * 0.5 * heightFrac + 2;
      p.x = this.columnCenterX + this.rng.float(-halfW, halfW);
    }
  }

  private spawnFlameParticle(isEmber: boolean): void {
    const startIdx = isEmber ? this.poolSize : 0;
    const endIdx = isEmber ? this.particles.length : this.poolSize;

    for (let i = startIdx; i < endIdx; i++) {
      const p = this.particles[i];
      if (p.life <= 0) {
        // Spawn near the base of the column, with horizontal spread based on height
        const spread = this.columnWidth * 0.5;
        p.x = this.columnCenterX + this.rng.float(-spread, spread);
        p.y = this.baseY;
        p.vy = -(this.riseSpeed + this.rng.float(-this.riseSpeed * 0.3, this.riseSpeed * 0.3));
        p.vx = this.rng.float(-this.turbulence, this.turbulence);
        p.maxLife = isEmber
          ? this.rng.float(1.5, 3.5)
          : this.rng.float(0.4, 1.2);
        p.life = p.maxLife;
        p.size = isEmber ? this.rng.float(1, 2.5) : this.rng.float(2, 5);
        return;
      }
    }
  }

  /** Map a normalized age (0=young,1=old) to a warm color: white→yellow→orange→red→dark. */
  private flameColor(age: number, isEmber: boolean): [number, number, number] {
    // age: 0 = just spawned (near base), 1 = about to die (near top)
    if (isEmber) {
      // embers go orange → red → dark
      const t = Math.max(0, Math.min(1, age));
      return [
        this.palette.alert.r * (1 - t * 0.8),
        this.palette.alert.g * (1 - t),
        this.palette.alert.b * (1 - t),
      ];
    }

    const primary = this.palette.primary;
    const alert = this.palette.alert;
    const dim = this.palette.dim;

    // Young (age ~0): bright primary/white-ish
    // Mid (age ~0.4): alert orange/red
    // Old (age ~1): dim fade out
    if (age < 0.4) {
      const t = age / 0.4;
      return [
        primary.r + (alert.r - primary.r) * t,
        primary.g + (alert.g - primary.g) * t,
        primary.b + (alert.b - primary.b) * t,
      ];
    } else {
      const t = (age - 0.4) / 0.6;
      return [
        alert.r + (dim.r - alert.r) * t,
        alert.g + (dim.g - alert.g) * t,
        alert.b + (dim.b - alert.b) * t,
      ];
    }
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    const { x, y, w, h } = this.px;

    const rate = this.intense ? this.spawnRate * 2.5 : this.spawnRate;
    const eRate = this.intense ? this.emberRate * 2 : this.emberRate;

    // Spawn flame particles
    const toSpawnFlame = Math.floor(rate * dt) + (this.rng.chance((rate * dt) % 1) ? 1 : 0);
    for (let i = 0; i < toSpawnFlame; i++) this.spawnFlameParticle(false);

    const toSpawnEmber = Math.floor(eRate * dt) + (this.rng.chance((eRate * dt) % 1) ? 1 : 0);
    for (let i = 0; i < toSpawnEmber; i++) this.spawnFlameParticle(true);

    // Update particles
    const flamePos = this.pointsMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const flameCol = this.pointsMesh.geometry.getAttribute('color') as THREE.BufferAttribute;
    const emberPos = this.embersMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const emberCol = this.embersMesh.geometry.getAttribute('color') as THREE.BufferAttribute;

    let fi = 0;
    let ei = 0;

    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];

      if (p.life <= 0) {
        // Hide dead particles
        if (!p.isEmber && fi < this.poolSize) {
          flamePos.setXYZ(fi, -99999, -99999, 0);
          flameCol.setXYZ(fi, 0, 0, 0);
          fi++;
        } else if (p.isEmber && ei < this.emberPoolSize) {
          emberPos.setXYZ(ei, -99999, -99999, 0);
          emberCol.setXYZ(ei, 0, 0, 0);
          ei++;
        }
        continue;
      }

      // Physics
      p.life -= dt;

      // Turbulent horizontal drift: sine wave with time offset
      const turbX = Math.sin(time * 3.7 + p.y * 0.05 + i * 0.41) * this.turbulence * 0.4;
      // Flames narrow and accelerate as they rise (lower y = higher up since y-axis is screen down)
      const heightFrac = Math.max(0, (p.y - this.topY) / (this.baseY - this.topY)); // 1 at base, 0 at top
      const narrowing = heightFrac;

      p.x += (p.vx + turbX) * dt;
      p.y += p.vy * (1 + (1 - heightFrac) * 0.5) * dt;

      // Keep x within column (narrow at top)
      const halfW = this.columnWidth * 0.5 * narrowing + 2;
      if (p.x < this.columnCenterX - halfW) p.x = this.columnCenterX - halfW;
      if (p.x > this.columnCenterX + halfW) p.x = this.columnCenterX + halfW;

      // Kill if risen above top
      if (p.y < this.topY - 10) { p.life = 0; continue; }

      const age = 1 - Math.max(0, p.life / p.maxLife);
      const [r, g, b] = this.flameColor(age, p.isEmber);

      if (!p.isEmber && fi < this.poolSize) {
        flamePos.setXYZ(fi, p.x, p.y, 0.5);
        flameCol.setXYZ(fi, r, g, b);
        fi++;
      } else if (p.isEmber && ei < this.emberPoolSize) {
        emberPos.setXYZ(ei, p.x, p.y, 1);
        emberCol.setXYZ(ei, r, g, b);
        ei++;
      }
    }

    flamePos.needsUpdate = true;
    flameCol.needsUpdate = true;
    emberPos.needsUpdate = true;
    emberCol.needsUpdate = true;

    (this.pointsMesh.material as THREE.PointsMaterial).opacity = opacity * 0.85;
    (this.embersMesh.material as THREE.PointsMaterial).opacity = opacity * 0.75;
    (this.borderLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.15;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Sudden burst of embers
      for (let i = 0; i < 20; i++) this.spawnFlameParticle(true);
    }
    if (action === 'alert') {
      this.intense = true;
      this.pulseTimer = 2.0;
      setTimeout(() => { this.intense = false; }, 3000);
    }
    if (action === 'pulse') {
      for (let i = 0; i < 10; i++) this.spawnFlameParticle(false);
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) {
      this.intense = false;
      return;
    }
    // Burst proportional to level
    const burstCount = level * 5;
    for (let i = 0; i < burstCount; i++) {
      this.spawnFlameParticle(false);
      if (i % 2 === 0) this.spawnFlameParticle(true);
    }
    if (level >= 4) {
      this.intense = true;
    }
    if (level >= 5) {
      setTimeout(() => { this.intense = false; }, 2000);
    }
  }
}
