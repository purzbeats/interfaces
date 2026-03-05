import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

interface Drop {
  x: number;
  y: number;
  vy: number;
  active: boolean;
  size: number;
}

/**
 * Stalactite formation by dripping. Drops fall from ceiling stalactites,
 * accumulate at bottom (stalagmite) and hang from top (stalactite).
 * Canvas rendered with mineral deposit growth animation.
 */
export class StalactiteDripElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'stalactite-drip',
    meta: {
      shape: 'rectangular',
      roles: ['decorative'],
      moods: ['ambient'],
      bandAffinity: 'sub',
      sizes: ['works-small', 'needs-medium'],
    } satisfies ElementMeta,
  };

  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private texture!: THREE.CanvasTexture;
  private mesh!: THREE.Mesh;

  private drops: Drop[] = [];
  private maxDrops: number = 20;
  private dripTimer: number = 0;
  private dripInterval: number = 1.0;
  private gravity: number = 120;

  // Stalactite/stalagmite heights per column
  private columns: number = 0;
  private stalactiteH!: Float32Array;
  private stalagmiteH!: Float32Array;
  private dripPoints!: Float32Array; // x positions for drip sources
  private growthRate: number = 0.15;
  private speedMult: number = 1;

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;

    const variant = this.rng.int(0, 3);
    const presets = [
      { columns: 8, interval: 1.2, gravity: 100, growth: 0.12, maxDrops: 15 },
      { columns: 12, interval: 0.6, gravity: 150, growth: 0.08, maxDrops: 25 },
      { columns: 5, interval: 2.0, gravity: 80, growth: 0.25, maxDrops: 10 },
      { columns: 10, interval: 0.8, gravity: 130, growth: 0.15, maxDrops: 20 },
    ];
    const p = presets[variant];
    this.columns = p.columns;
    this.dripInterval = p.interval;
    this.gravity = p.gravity;
    this.growthRate = p.growth;
    this.maxDrops = p.maxDrops;

    this.stalactiteH = new Float32Array(this.columns);
    this.stalagmiteH = new Float32Array(this.columns);
    this.dripPoints = new Float32Array(this.columns);

    const colW = w / (this.columns + 1);
    for (let i = 0; i < this.columns; i++) {
      this.dripPoints[i] = colW * (i + 1);
      this.stalactiteH[i] = this.rng.float(5, 20);
      this.stalagmiteH[i] = this.rng.float(2, 8);
    }

    this.drops = [];
    this.dripTimer = this.rng.float(0, this.dripInterval);

    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.max(64, Math.floor(w));
    this.canvas.height = Math.max(64, Math.floor(h));
    this.ctx = this.get2DContext(this.canvas);

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;

    const geo = new THREE.PlaneGeometry(w, h);
    const mat = new THREE.MeshBasicMaterial({
      map: this.texture, transparent: true, opacity: 0,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.set(x + w / 2, y + h / 2, 0);
    this.group.add(this.mesh);
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    const effDt = dt * this.speedMult;

    // Spawn new drops
    this.dripTimer -= effDt;
    if (this.dripTimer <= 0) {
      this.dripTimer = this.dripInterval;
      const col = this.rng.int(0, this.columns - 1);
      const activeCount = this.drops.filter(d => d.active).length;
      if (activeCount < this.maxDrops) {
        this.drops.push({
          x: this.dripPoints[col],
          y: this.stalactiteH[col] + 2,
          vy: 0,
          active: true,
          size: this.rng.float(2, 4),
        });
      }
    }

    // Update drops
    for (const drop of this.drops) {
      if (!drop.active) continue;
      drop.vy += this.gravity * effDt;
      drop.y += drop.vy * effDt;

      // Check if drop hit a stalagmite or floor
      const col = this.findNearestColumn(drop.x);
      const floorY = ch - this.stalagmiteH[col];
      if (drop.y >= floorY) {
        drop.active = false;
        // Grow stalagmite and stalactite
        this.stalagmiteH[col] += this.growthRate * this.speedMult;
        this.stalactiteH[col] += this.growthRate * 0.5 * this.speedMult;
      }
    }

    // Remove inactive drops
    this.drops = this.drops.filter(d => d.active);

    // Reset formations if they get too tall
    const maxH = ch * 0.35;
    for (let i = 0; i < this.columns; i++) {
      if (this.stalactiteH[i] + this.stalagmiteH[i] >= ch * 0.7) {
        this.stalactiteH[i] = this.rng.float(5, 20);
        this.stalagmiteH[i] = this.rng.float(2, 8);
      }
    }

    // Render
    this.ctx.clearRect(0, 0, cw, ch);

    const bgHex = '#' + this.palette.bg.getHexString();
    const priHex = '#' + this.palette.primary.getHexString();
    const secHex = '#' + this.palette.secondary.getHexString();
    const dimHex = '#' + this.palette.dim.getHexString();

    // Draw ceiling
    this.ctx.fillStyle = dimHex;
    this.ctx.fillRect(0, 0, cw, 3);

    // Draw floor
    this.ctx.fillRect(0, ch - 3, cw, 3);

    const colW = cw / (this.columns + 1);

    // Draw stalactites (hanging from top)
    for (let i = 0; i < this.columns; i++) {
      const cx = this.dripPoints[i];
      const h = this.stalactiteH[i];
      const baseW = colW * 0.4;

      this.ctx.fillStyle = priHex;
      this.ctx.beginPath();
      this.ctx.moveTo(cx - baseW, 0);
      this.ctx.lineTo(cx + baseW, 0);
      this.ctx.lineTo(cx + baseW * 0.3, h * 0.7);
      this.ctx.lineTo(cx, h);
      this.ctx.lineTo(cx - baseW * 0.3, h * 0.7);
      this.ctx.closePath();
      this.ctx.fill();
    }

    // Draw stalagmites (growing from bottom)
    for (let i = 0; i < this.columns; i++) {
      const cx = this.dripPoints[i];
      const h = this.stalagmiteH[i];
      const baseW = colW * 0.35;

      this.ctx.fillStyle = secHex;
      this.ctx.beginPath();
      this.ctx.moveTo(cx - baseW, ch);
      this.ctx.lineTo(cx + baseW, ch);
      this.ctx.lineTo(cx + baseW * 0.25, ch - h * 0.7);
      this.ctx.lineTo(cx, ch - h);
      this.ctx.lineTo(cx - baseW * 0.25, ch - h * 0.7);
      this.ctx.closePath();
      this.ctx.fill();
    }

    // Draw drops
    this.ctx.fillStyle = priHex;
    for (const drop of this.drops) {
      if (!drop.active) continue;
      this.ctx.beginPath();
      this.ctx.arc(drop.x, drop.y, drop.size, 0, Math.PI * 2);
      this.ctx.fill();

      // Streak behind fast drops
      if (drop.vy > 30) {
        this.ctx.strokeStyle = dimHex;
        this.ctx.lineWidth = 1;
        this.ctx.beginPath();
        this.ctx.moveTo(drop.x, drop.y - drop.size);
        this.ctx.lineTo(drop.x, drop.y - drop.size - Math.min(drop.vy * 0.1, 15));
        this.ctx.stroke();
      }
    }

    this.texture.needsUpdate = true;
    (this.mesh.material as THREE.MeshBasicMaterial).opacity = opacity * 0.9;
  }

  private findNearestColumn(x: number): number {
    let best = 0;
    let bestDist = Math.abs(x - this.dripPoints[0]);
    for (let i = 1; i < this.columns; i++) {
      const d = Math.abs(x - this.dripPoints[i]);
      if (d < bestDist) { bestDist = d; best = i; }
    }
    return best;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Burst of drops
      for (let i = 0; i < 5; i++) {
        const col = this.rng.int(0, this.columns - 1);
        this.drops.push({
          x: this.dripPoints[col] + this.rng.float(-5, 5),
          y: this.stalactiteH[col],
          vy: this.rng.float(20, 60),
          active: true,
          size: this.rng.float(2, 5),
        });
      }
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) {
      this.speedMult = 1;
      return;
    }
    this.speedMult = 1 + level * 0.4;
    if (level >= 3) {
      this.dripInterval = Math.max(0.1, 1.0 / (level * 0.5));
    }
  }
}
