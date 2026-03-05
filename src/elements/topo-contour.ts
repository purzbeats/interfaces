import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Animated topographic contour map with shifting elevation.
 * Iso-elevation lines flow as the underlying terrain slowly morphs,
 * creating a living topographic survey display.
 */
export class TopoContourElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'topo-contour',
    meta: { shape: 'rectangular', roles: ['data-display', 'structural'], moods: ['diagnostic', 'tactical'], bandAffinity: 'bass', sizes: ['needs-medium', 'needs-large'] },
  };

  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private texture!: THREE.CanvasTexture;
  private mesh!: THREE.Mesh;

  private cw = 0;
  private ch = 0;
  private contourLevels = 12;
  private renderAccum = 0;

  build(): void {
    const variant = this.rng.int(0, 3);
    const presets = [
      { res: 160, levels: 12 },
      { res: 240, levels: 18 },
      { res: 100, levels: 8 },
      { res: 200, levels: 15 },
    ];
    const p = presets[variant];
    this.glitchAmount = 4;

    const { x, y, w, h } = this.px;
    const aspect = w / h;
    this.cw = Math.round(p.res * Math.max(1, aspect));
    this.ch = Math.round(p.res / Math.max(1, 1 / aspect));
    this.contourLevels = p.levels;

    this.canvas = document.createElement('canvas');
    this.canvas.width = this.cw;
    this.canvas.height = this.ch;
    this.ctx = this.get2DContext(this.canvas);

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.magFilter = THREE.NearestFilter;

    const geo = new THREE.PlaneGeometry(w, h);
    this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, opacity: 0 }));
    this.mesh.position.set(x + w / 2, y + h / 2, 0);
    this.group.add(this.mesh);
  }

  private elevation(gx: number, gy: number, time: number): number {
    const nx = gx / this.cw;
    const ny = gy / this.ch;
    let h2 = 0;
    h2 += Math.sin(nx * 4 + time * 0.3) * Math.cos(ny * 3 + time * 0.2) * 0.4;
    h2 += Math.sin(nx * 8 + ny * 6 + time * 0.5) * 0.2;
    h2 += Math.sin(nx * 2 - time * 0.15) * Math.cos(ny * 5 + time * 0.25) * 0.3;
    h2 += Math.cos(nx * 12 + ny * 10 + time * 0.4) * 0.1;
    return h2 * 0.5 + 0.5; // 0..1
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);

    this.renderAccum += dt;
    if (this.renderAccum < 0.08) {
      (this.mesh.material as THREE.MeshBasicMaterial).opacity = opacity * 0.85;
      return;
    }
    this.renderAccum = 0;

    const img = this.ctx.getImageData(0, 0, this.cw, this.ch);
    const data = img.data;
    const pr = this.palette.primary.r * 255;
    const pg2 = this.palette.primary.g * 255;
    const pb = this.palette.primary.b * 255;
    const dr = this.palette.dim.r * 255;
    const dg = this.palette.dim.g * 255;
    const db = this.palette.dim.b * 255;

    for (let gy = 0; gy < this.ch; gy++) {
      for (let gx = 0; gx < this.cw; gx++) {
        const h2 = this.elevation(gx, gy, time);
        const level = h2 * this.contourLevels;
        const frac = level - Math.floor(level);

        const idx = (gy * this.cw + gx) * 4;

        // Contour line detection
        const isContour = frac < 0.08 || frac > 0.92;
        const isMajor = Math.floor(level) % 3 === 0;

        if (isContour) {
          const bright = isMajor ? 0.9 : 0.5;
          data[idx] = pr * bright;
          data[idx + 1] = pg2 * bright;
          data[idx + 2] = pb * bright;
        } else {
          const shade = h2 * 0.15;
          data[idx] = dr * shade;
          data[idx + 1] = dg * shade;
          data[idx + 2] = db * shade;
        }
        data[idx + 3] = 255;
      }
    }

    this.ctx.putImageData(img, 0, 0);
    this.texture.needsUpdate = true;
    (this.mesh.material as THREE.MeshBasicMaterial).opacity = opacity * 0.85;
  }

  onAction(action: string): void {
    super.onAction(action);
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level >= 3) this.contourLevels = 24;
  }
}
