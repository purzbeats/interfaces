import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

interface Seed {
  x: number;
  y: number;
  radius: number;
  maxRadius: number;
  branches: number;
  baseAngle: number;
  speed: number;
}

/**
 * Frost crystallization patterns spreading on a surface. Ice crystal
 * fronts expand from seed points with dendritic branching.
 * Canvas rendered with growth animation.
 */
export class FrostCrystalElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'frost-crystal',
    meta: {
      shape: 'rectangular',
      roles: ['decorative'],
      moods: ['ambient'],
      bandAffinity: 'high',
      sizes: ['works-small', 'needs-medium', 'needs-large'],
    } satisfies ElementMeta,
  };

  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private texture!: THREE.CanvasTexture;
  private mesh!: THREE.Mesh;

  private seeds: Seed[] = [];
  private seedCount: number = 3;
  private branchDepth: number = 3;
  private growthSpeed: number = 30;
  private speedMult: number = 1;
  private resetTimer: number = 0;
  private resetInterval: number = 12;
  private lineWidth: number = 1.5;

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;

    const variant = this.rng.int(0, 3);
    const presets = [
      { seeds: 3, depth: 3, speed: 25, reset: 12, lineW: 1.5 },
      { seeds: 6, depth: 2, speed: 40, reset: 8, lineW: 1.0 },
      { seeds: 1, depth: 4, speed: 15, reset: 18, lineW: 2.0 },
      { seeds: 4, depth: 3, speed: 35, reset: 10, lineW: 1.2 },
    ];
    const p = presets[variant];
    this.seedCount = p.seeds;
    this.branchDepth = p.depth;
    this.growthSpeed = p.speed;
    this.resetInterval = p.reset;
    this.lineWidth = p.lineW;

    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.max(64, Math.floor(w));
    this.canvas.height = Math.max(64, Math.floor(h));
    this.ctx = this.get2DContext(this.canvas);

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.magFilter = THREE.NearestFilter;

    const geo = new THREE.PlaneGeometry(w, h);
    const mat = new THREE.MeshBasicMaterial({
      map: this.texture, transparent: true, opacity: 0,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.set(x + w / 2, y + h / 2, 0);
    this.group.add(this.mesh);

    this.initSeeds();
    this.resetTimer = 0;
  }

  private initSeeds(): void {
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    this.seeds = [];
    for (let i = 0; i < this.seedCount; i++) {
      this.seeds.push({
        x: this.rng.float(cw * 0.1, cw * 0.9),
        y: this.rng.float(ch * 0.1, ch * 0.9),
        radius: 0,
        maxRadius: Math.min(cw, ch) * this.rng.float(0.3, 0.6),
        branches: this.rng.int(5, 8),
        baseAngle: this.rng.float(0, Math.PI * 2),
        speed: this.growthSpeed * this.rng.float(0.7, 1.3),
      });
    }
    // Clear canvas for new growth
    this.ctx.clearRect(0, 0, cw, ch);
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);
    const effDt = dt * this.speedMult;

    this.resetTimer += effDt;
    if (this.resetTimer >= this.resetInterval) {
      this.resetTimer = 0;
      this.initSeeds();
    }

    // Grow seeds
    let anyGrowing = false;
    for (const seed of this.seeds) {
      const prevRadius = seed.radius;
      seed.radius = Math.min(seed.radius + seed.speed * effDt, seed.maxRadius);
      if (seed.radius > prevRadius) {
        anyGrowing = true;
        this.drawCrystalGrowth(seed, prevRadius, seed.radius);
      }
    }

    if (anyGrowing) {
      this.texture.needsUpdate = true;
    }

    (this.mesh.material as THREE.MeshBasicMaterial).opacity = opacity * 0.9;
  }

  private drawCrystalGrowth(seed: Seed, fromR: number, toR: number): void {
    const ctx = this.ctx;
    const priHex = '#' + this.palette.primary.getHexString();
    const secHex = '#' + this.palette.secondary.getHexString();
    const dimHex = '#' + this.palette.dim.getHexString();

    // Draw dendritic branches at this growth radius
    for (let b = 0; b < seed.branches; b++) {
      const angle = seed.baseAngle + (b / seed.branches) * Math.PI * 2;
      this.drawBranch(ctx, seed.x, seed.y, angle, fromR, toR, 0, priHex, secHex, dimHex);
    }
  }

  private drawBranch(
    ctx: CanvasRenderingContext2D,
    ox: number, oy: number,
    angle: number,
    fromR: number, toR: number,
    depth: number,
    priHex: string, secHex: string, dimHex: string,
  ): void {
    if (depth > this.branchDepth) return;

    const scale = 1 / (depth + 1);
    const effFrom = fromR * scale;
    const effTo = toR * scale;

    // Main branch line segment
    const x1 = ox + Math.cos(angle) * effFrom;
    const y1 = oy + Math.sin(angle) * effFrom;
    const x2 = ox + Math.cos(angle) * effTo;
    const y2 = oy + Math.sin(angle) * effTo;

    ctx.strokeStyle = depth === 0 ? priHex : depth === 1 ? secHex : dimHex;
    ctx.lineWidth = Math.max(0.5, this.lineWidth - depth * 0.4);
    ctx.globalAlpha = 1 - depth * 0.2;

    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();

    // Sub-branches sprout at intervals along the main branch
    if (depth < this.branchDepth) {
      const subInterval = 8 + depth * 4;
      const dist = effTo - effFrom;
      if (dist > subInterval) {
        const steps = Math.floor(dist / subInterval);
        for (let s = 0; s < steps; s++) {
          const r = effFrom + (s + 1) * subInterval;
          const bx = ox + Math.cos(angle) * r;
          const by = oy + Math.sin(angle) * r;
          // Branch at +/- 60 degrees
          const subAngle1 = angle + Math.PI / 3;
          const subAngle2 = angle - Math.PI / 3;
          const subLen = (effTo - r) * 0.5 * scale;
          if (subLen > 2) {
            ctx.strokeStyle = depth === 0 ? secHex : dimHex;
            ctx.lineWidth = Math.max(0.5, this.lineWidth - (depth + 1) * 0.4);
            ctx.beginPath();
            ctx.moveTo(bx, by);
            ctx.lineTo(bx + Math.cos(subAngle1) * subLen, by + Math.sin(subAngle1) * subLen);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(bx, by);
            ctx.lineTo(bx + Math.cos(subAngle2) * subLen, by + Math.sin(subAngle2) * subLen);
            ctx.stroke();
          }
        }
      }
    }

    ctx.globalAlpha = 1;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Flash freeze: rapid growth burst
      this.speedMult = 5;
      setTimeout(() => { this.speedMult = 1; }, 400);
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) {
      this.speedMult = 1;
      return;
    }
    this.speedMult = 1 + level * 0.5;
    if (level >= 5) {
      this.resetTimer = 0;
      this.initSeeds();
    }
  }
}
