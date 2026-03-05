import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

interface LichenColony {
  cx: number;
  cy: number;
  radius: number;
  maxRadius: number;
  speed: number;
  colorIdx: number; // 0=primary, 1=secondary
  edgeNoise: Float32Array; // per-angle noise for irregular edge
}

/**
 * Lichen radial expansion. Circular organisms grow outward from seed
 * points. Growth front is irregular/fractal. Multiple lichens can merge
 * or compete for space. Canvas rendered.
 */
export class LichenFrontElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'lichen-front',
    meta: {
      shape: 'rectangular',
      roles: ['decorative'],
      moods: ['ambient'],
      bandAffinity: 'sub',
      sizes: ['works-small', 'needs-medium', 'needs-large'],
    } satisfies ElementMeta,
  };

  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private texture!: THREE.CanvasTexture;
  private mesh!: THREE.Mesh;

  private colonies: LichenColony[] = [];
  private colonyCount: number = 4;
  private edgeSegments: number = 48;
  private growthBase: number = 8;
  private speedMult: number = 1;
  private resetTimer: number = 0;
  private resetInterval: number = 15;

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;

    const variant = this.rng.int(0, 3);
    const presets = [
      { count: 4, segs: 48, growth: 8, reset: 15 },
      { count: 8, segs: 36, growth: 12, reset: 10 },
      { count: 2, segs: 64, growth: 5, reset: 20 },
      { count: 6, segs: 48, growth: 10, reset: 12 },
    ];
    const p = presets[variant];
    this.colonyCount = p.count;
    this.edgeSegments = p.segs;
    this.growthBase = p.growth;
    this.resetInterval = p.reset;

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

    this.initColonies();
  }

  private initColonies(): void {
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    this.colonies = [];
    const maxR = Math.min(cw, ch) * 0.4;

    for (let i = 0; i < this.colonyCount; i++) {
      const edgeNoise = new Float32Array(this.edgeSegments);
      for (let j = 0; j < this.edgeSegments; j++) {
        edgeNoise[j] = this.rng.float(0.6, 1.4);
      }
      this.colonies.push({
        cx: this.rng.float(cw * 0.15, cw * 0.85),
        cy: this.rng.float(ch * 0.15, ch * 0.85),
        radius: this.rng.float(3, 8),
        maxRadius: maxR * this.rng.float(0.5, 1.0),
        speed: this.growthBase * this.rng.float(0.6, 1.4),
        colorIdx: i % 2,
        edgeNoise,
      });
    }
    this.ctx.clearRect(0, 0, cw, ch);
    this.resetTimer = 0;
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    const effDt = dt * this.speedMult;

    this.resetTimer += effDt;
    if (this.resetTimer >= this.resetInterval) {
      this.initColonies();
    }

    // Grow colonies
    for (const col of this.colonies) {
      col.radius = Math.min(col.radius + col.speed * effDt, col.maxRadius);
      // Slowly evolve edge noise
      for (let j = 0; j < this.edgeSegments; j++) {
        col.edgeNoise[j] += (Math.sin(time * 0.5 + j * 1.7) * 0.02);
        col.edgeNoise[j] = Math.max(0.4, Math.min(1.6, col.edgeNoise[j]));
      }
    }

    // Render
    this.ctx.clearRect(0, 0, cw, ch);

    const priR = Math.floor(this.palette.primary.r * 255);
    const priG = Math.floor(this.palette.primary.g * 255);
    const priB = Math.floor(this.palette.primary.b * 255);
    const secR = Math.floor(this.palette.secondary.r * 255);
    const secG = Math.floor(this.palette.secondary.g * 255);
    const secB = Math.floor(this.palette.secondary.b * 255);
    const dimHex = '#' + this.palette.dim.getHexString();

    for (const col of this.colonies) {
      if (col.radius < 1) continue;

      // Fill body with semi-transparent color
      const isP = col.colorIdx === 0;
      const r = isP ? priR : secR;
      const g = isP ? priG : secG;
      const b = isP ? priB : secB;

      // Draw filled irregular shape
      this.ctx.fillStyle = `rgba(${r},${g},${b},0.3)`;
      this.ctx.beginPath();
      for (let j = 0; j <= this.edgeSegments; j++) {
        const idx = j % this.edgeSegments;
        const angle = (idx / this.edgeSegments) * Math.PI * 2;
        const noise = col.edgeNoise[idx];
        const er = col.radius * noise;
        const ex = col.cx + Math.cos(angle) * er;
        const ey = col.cy + Math.sin(angle) * er;
        if (j === 0) this.ctx.moveTo(ex, ey);
        else this.ctx.lineTo(ex, ey);
      }
      this.ctx.closePath();
      this.ctx.fill();

      // Draw growth front edge
      this.ctx.strokeStyle = `rgba(${r},${g},${b},0.8)`;
      this.ctx.lineWidth = 1.5;
      this.ctx.beginPath();
      for (let j = 0; j <= this.edgeSegments; j++) {
        const idx = j % this.edgeSegments;
        const angle = (idx / this.edgeSegments) * Math.PI * 2;
        const noise = col.edgeNoise[idx];
        const er = col.radius * noise;
        const ex = col.cx + Math.cos(angle) * er;
        const ey = col.cy + Math.sin(angle) * er;
        if (j === 0) this.ctx.moveTo(ex, ey);
        else this.ctx.lineTo(ex, ey);
      }
      this.ctx.closePath();
      this.ctx.stroke();

      // Draw center dot
      this.ctx.fillStyle = dimHex;
      this.ctx.beginPath();
      this.ctx.arc(col.cx, col.cy, 2, 0, Math.PI * 2);
      this.ctx.fill();

      // Draw internal texture lines (radial speckle)
      this.ctx.strokeStyle = `rgba(${r},${g},${b},0.15)`;
      this.ctx.lineWidth = 0.5;
      const ringCount = Math.floor(col.radius / 10);
      for (let ri = 1; ri <= ringCount; ri++) {
        const ringR = ri * 10;
        if (ringR > col.radius) break;
        this.ctx.beginPath();
        for (let j = 0; j <= this.edgeSegments; j++) {
          const idx = j % this.edgeSegments;
          const angle = (idx / this.edgeSegments) * Math.PI * 2;
          const noise = col.edgeNoise[idx];
          const er = Math.min(ringR, col.radius * noise);
          const ex = col.cx + Math.cos(angle) * er;
          const ey = col.cy + Math.sin(angle) * er;
          if (j === 0) this.ctx.moveTo(ex, ey);
          else this.ctx.lineTo(ex, ey);
        }
        this.ctx.closePath();
        this.ctx.stroke();
      }
    }

    this.texture.needsUpdate = true;
    (this.mesh.material as THREE.MeshBasicMaterial).opacity = opacity * 0.9;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Growth spurt
      for (const col of this.colonies) {
        col.radius = Math.min(col.radius + 15, col.maxRadius);
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
    if (level >= 5) {
      this.initColonies();
    }
  }
}
