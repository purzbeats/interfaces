import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

interface Tracer {
  x: number;
  y: number;
  phase: number;
}

/**
 * Tidal flow simulation. Water level rises and falls sinusoidally.
 * Particle tracers show flow direction reversing. Shore features
 * partially submerge/emerge. Canvas + line rendering.
 */
export class TideFlowElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'tide-flow',
    meta: {
      shape: 'rectangular',
      roles: ['data-display', 'decorative'],
      moods: ['ambient'],
      bandAffinity: 'bass',
      sizes: ['works-small', 'needs-medium'],
    } satisfies ElementMeta,
  };

  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private texture!: THREE.CanvasTexture;
  private mesh!: THREE.Mesh;

  private tracers: Tracer[] = [];
  private tracerCount: number = 40;
  private tidePeriod: number = 8;
  private tideRange: number = 0.25; // fraction of height
  private shoreLine: number = 0.6; // fraction from top
  private shoreFeatures!: Float32Array; // per-column shore height variation
  private shoreColumns: number = 40;
  private flowSpeed: number = 30;
  private speedMult: number = 1;

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;

    const variant = this.rng.int(0, 3);
    const presets = [
      { tracers: 40, period: 8, range: 0.25, shore: 0.6, flow: 30, columns: 40 },
      { tracers: 60, period: 5, range: 0.30, shore: 0.55, flow: 45, columns: 50 },
      { tracers: 25, period: 12, range: 0.20, shore: 0.65, flow: 20, columns: 30 },
      { tracers: 50, period: 6, range: 0.28, shore: 0.58, flow: 35, columns: 45 },
    ];
    const p = presets[variant];
    this.tracerCount = p.tracers;
    this.tidePeriod = p.period;
    this.tideRange = p.range;
    this.shoreLine = p.shore;
    this.flowSpeed = p.flow;
    this.shoreColumns = p.columns;

    // Generate irregular shoreline
    this.shoreFeatures = new Float32Array(this.shoreColumns);
    for (let i = 0; i < this.shoreColumns; i++) {
      this.shoreFeatures[i] = this.rng.float(-0.05, 0.05);
    }

    // Initialize tracers
    this.tracers = [];
    for (let i = 0; i < this.tracerCount; i++) {
      this.tracers.push({
        x: this.rng.float(0, 1),
        y: this.rng.float(this.shoreLine - this.tideRange, this.shoreLine + this.tideRange),
        phase: this.rng.float(0, Math.PI * 2),
      });
    }

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

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    const ctx = this.ctx;
    const effDt = dt * this.speedMult;
    const effTime = time * this.speedMult;

    // Current tide level (0 = high, 1 = low in normalized coords)
    const tidePhase = Math.sin(effTime * Math.PI * 2 / this.tidePeriod);
    const waterLevel = this.shoreLine - tidePhase * this.tideRange;
    // Flow direction: positive when tide rising, negative when falling
    const flowDir = Math.cos(effTime * Math.PI * 2 / this.tidePeriod);

    // Update tracers
    for (const tracer of this.tracers) {
      // Horizontal flow
      tracer.x += flowDir * this.flowSpeed * effDt / cw;
      // Slight vertical oscillation
      tracer.y += Math.sin(effTime * 3 + tracer.phase) * 0.001;

      // Wrap horizontally
      if (tracer.x > 1.1) tracer.x = -0.1;
      if (tracer.x < -0.1) tracer.x = 1.1;

      // Keep tracers in water zone
      if (tracer.y < waterLevel - 0.02) {
        tracer.y = waterLevel + this.rng.float(0, this.tideRange * 0.5);
      }
      if (tracer.y > this.shoreLine + this.tideRange * 0.5) {
        tracer.y = waterLevel + this.rng.float(-0.02, 0.05);
      }
    }

    // Render
    ctx.clearRect(0, 0, cw, ch);

    const bgHex = '#' + this.palette.bg.getHexString();
    const priHex = '#' + this.palette.primary.getHexString();
    const secHex = '#' + this.palette.secondary.getHexString();
    const dimHex = '#' + this.palette.dim.getHexString();

    const priR = Math.floor(this.palette.primary.r * 255);
    const priG = Math.floor(this.palette.primary.g * 255);
    const priB = Math.floor(this.palette.primary.b * 255);

    // Draw sky/land region above water
    ctx.fillStyle = bgHex;
    ctx.fillRect(0, 0, cw, ch);

    // Draw shore features (sand/rock)
    ctx.fillStyle = dimHex;
    const colW = cw / this.shoreColumns;
    for (let i = 0; i < this.shoreColumns; i++) {
      const shoreY = (this.shoreLine + this.shoreFeatures[i]) * ch;
      const featureH = ch - shoreY;
      ctx.fillRect(i * colW, shoreY, colW + 1, featureH);
    }

    // Draw water
    const waterY = waterLevel * ch;
    ctx.fillStyle = `rgba(${priR},${priG},${priB},0.15)`;
    ctx.fillRect(0, waterY, cw, ch - waterY);

    // Draw water surface wave
    ctx.strokeStyle = priHex;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let px = 0; px <= cw; px += 2) {
      const wave = Math.sin(px * 0.05 + effTime * 3) * 3
                 + Math.sin(px * 0.02 + effTime * 1.5) * 2;
      const wy = waterY + wave;
      if (px === 0) ctx.moveTo(px, wy);
      else ctx.lineTo(px, wy);
    }
    ctx.stroke();

    // Draw tracers (flow particles)
    for (const tracer of this.tracers) {
      const tx = tracer.x * cw;
      const ty = tracer.y * ch;

      // Only draw if in water
      if (ty < waterY - 5) continue;

      const alpha = Math.max(0.2, Math.min(0.8,
        1 - Math.abs(tracer.y - waterLevel) / (this.tideRange * 2)));

      ctx.fillStyle = `rgba(${priR},${priG},${priB},${alpha.toFixed(2)})`;
      ctx.beginPath();
      ctx.arc(tx, ty, 2, 0, Math.PI * 2);
      ctx.fill();

      // Flow direction indicator (short line)
      const lineLen = flowDir * 4;
      ctx.strokeStyle = `rgba(${priR},${priG},${priB},${(alpha * 0.5).toFixed(2)})`;
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(tx + lineLen, ty);
      ctx.stroke();
    }

    // Draw tide markers on sides
    ctx.strokeStyle = secHex;
    ctx.lineWidth = 1;
    // High tide mark
    const highY = (this.shoreLine - this.tideRange) * ch;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(0, highY);
    ctx.lineTo(15, highY);
    ctx.stroke();
    // Low tide mark
    const lowY = (this.shoreLine + this.tideRange) * ch;
    ctx.beginPath();
    ctx.moveTo(0, lowY);
    ctx.lineTo(15, lowY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Current level indicator
    ctx.fillStyle = priHex;
    ctx.fillRect(0, waterY - 1, 8, 2);

    this.texture.needsUpdate = true;
    (this.mesh.material as THREE.MeshBasicMaterial).opacity = opacity * 0.9;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Storm surge
      this.speedMult = 4;
      setTimeout(() => { this.speedMult = 1; }, 500);
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) {
      this.speedMult = 1;
      return;
    }
    this.speedMult = 1 + level * 0.3;
  }
}
