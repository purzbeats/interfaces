import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

interface RingPreset {
  ringCount: number;
  growSpeed: number;
  wobble: number;
  widthVariation: number;
}

/**
 * Tree ring growth cross-section. Concentric rings with varying widths
 * (wide = good year, narrow = drought). Rings are slightly non-circular.
 * Canvas rendered with ring-by-ring growth animation.
 */
export class TreeRingsElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'tree-rings',
    meta: {
      shape: 'radial',
      roles: ['decorative'],
      moods: ['ambient'],
      sizes: ['needs-medium', 'needs-large'],
      bandAffinity: 'bass',
    } satisfies ElementMeta,
  };

  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private texture!: THREE.CanvasTexture;
  private mesh!: THREE.Mesh;
  private mat!: THREE.MeshBasicMaterial;

  // Ring data
  private ringRadii!: Float32Array;  // target radius for each ring
  private ringWidths!: Float32Array;  // width of each ring
  private ringWobblePhase!: Float32Array; // wobble offset per ring
  private ringCount = 20;
  private maxRadius = 0;
  private growSpeed = 1;
  private wobbleAmount = 0.06;
  private growthProgress = 0;  // 0..1 — how many rings are visible
  private cx = 0;
  private cy = 0;
  private intensityLevel = 0;

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;

    const variant = this.rng.int(0, 4);
    const presets: RingPreset[] = [
      { ringCount: 20, growSpeed: 0.08, wobble: 0.06, widthVariation: 0.5 },
      { ringCount: 35, growSpeed: 0.05, wobble: 0.03, widthVariation: 0.3 },
      { ringCount: 12, growSpeed: 0.12, wobble: 0.10, widthVariation: 0.7 },
      { ringCount: 25, growSpeed: 0.06, wobble: 0.08, widthVariation: 0.6 },
    ];
    const p = presets[variant];

    this.ringCount = p.ringCount;
    this.growSpeed = p.growSpeed;
    this.wobbleAmount = p.wobble;

    this.canvas = document.createElement('canvas');
    const maxRes = 300;
    const canvasScale = Math.min(1, maxRes / Math.max(w, h));
    this.canvas.width = Math.max(64, Math.floor(w * canvasScale));
    this.canvas.height = Math.max(64, Math.floor(h * canvasScale));
    this.ctx = this.get2DContext(this.canvas);
    this.texture = new THREE.CanvasTexture(this.canvas);

    this.cx = this.canvas.width / 2;
    this.cy = this.canvas.height / 2;
    this.maxRadius = Math.min(this.cx, this.cy) * 0.9;

    // Generate ring data
    this.ringRadii = new Float32Array(this.ringCount);
    this.ringWidths = new Float32Array(this.ringCount);
    this.ringWobblePhase = new Float32Array(this.ringCount);

    let accRadius = 0;
    for (let i = 0; i < this.ringCount; i++) {
      const baseWidth = this.maxRadius / this.ringCount;
      const width = baseWidth * (1.0 + this.rng.float(-p.widthVariation, p.widthVariation));
      accRadius += Math.max(width, baseWidth * 0.2);
      this.ringRadii[i] = accRadius;
      this.ringWidths[i] = Math.max(width, baseWidth * 0.2);
      this.ringWobblePhase[i] = this.rng.float(0, Math.PI * 2);
    }

    // Normalize radii to fit within maxRadius
    const scale = this.maxRadius / accRadius;
    for (let i = 0; i < this.ringCount; i++) {
      this.ringRadii[i] *= scale;
      this.ringWidths[i] *= scale;
    }

    const planeGeo = new THREE.PlaneGeometry(w, h);
    this.mat = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      opacity: 0,
    });
    this.mesh = new THREE.Mesh(planeGeo, this.mat);
    this.mesh.position.set(x + w / 2, y + h / 2, 0);
    this.group.add(this.mesh);
  }

  private drawRings(time: number): void {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    const visibleRings = Math.floor(this.growthProgress * this.ringCount);
    const partialFrac = (this.growthProgress * this.ringCount) - visibleRings;

    const pri = this.palette.primary;
    const sec = this.palette.secondary;
    const dim = this.palette.dim;
    const bg = this.palette.bg;

    // Draw pith (center)
    ctx.fillStyle = `rgb(${Math.floor(dim.r * 255)},${Math.floor(dim.g * 255)},${Math.floor(dim.b * 255)})`;
    ctx.beginPath();
    ctx.arc(this.cx, this.cy, Math.max(2, this.maxRadius * 0.03), 0, Math.PI * 2);
    ctx.fill();

    for (let i = 0; i < Math.min(visibleRings + 1, this.ringCount); i++) {
      const radius = this.ringRadii[i];
      const alpha = i < visibleRings ? 1.0 : partialFrac;

      // Alternate between primary-like and secondary-like tones
      const ringColor = i % 2 === 0 ? pri : sec;
      const r = Math.floor(ringColor.r * 200 + bg.r * 55);
      const g = Math.floor(ringColor.g * 200 + bg.g * 55);
      const b = Math.floor(ringColor.b * 200 + bg.b * 55);

      ctx.strokeStyle = `rgba(${Math.min(r, 255)},${Math.min(g, 255)},${Math.min(b, 255)},${alpha * 0.8})`;
      ctx.lineWidth = Math.max(1, this.ringWidths[i] * 0.6);

      // Draw slightly non-circular ring using wobble
      const segments = 64;
      ctx.beginPath();
      for (let s = 0; s <= segments; s++) {
        const angle = (s / segments) * Math.PI * 2;
        const wobble = 1 + this.wobbleAmount * Math.sin(
          angle * 3 + this.ringWobblePhase[i] + time * 0.2,
        );
        const rx = this.cx + Math.cos(angle) * radius * wobble;
        const ry = this.cy + Math.sin(angle) * radius * wobble;
        if (s === 0) ctx.moveTo(rx, ry);
        else ctx.lineTo(rx, ry);
      }
      ctx.stroke();
    }
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);

    // Grow rings over time, loop when fully grown
    const speed = this.growSpeed * (1 + this.intensityLevel * 0.3);
    this.growthProgress += dt * speed;
    if (this.growthProgress > 1.2) {
      this.growthProgress = 0;
      // Regenerate ring widths for variety
      for (let i = 0; i < this.ringCount; i++) {
        this.ringWobblePhase[i] = this.rng.float(0, Math.PI * 2);
      }
    }

    this.drawRings(time);
    this.texture.needsUpdate = true;
    this.mat.opacity = opacity;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      this.growthProgress = Math.max(0, this.growthProgress - 0.1);
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    this.intensityLevel = level;
  }
}
