import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Hydraulic erosion terrain simulation.
 * Water droplets carve channels through procedural heightmap terrain,
 * displayed as a topographic scan with contour lines and flow paths.
 */
export class ErosionSimElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'erosion-sim',
    meta: { shape: 'rectangular', roles: ['data-display', 'decorative'], moods: ['diagnostic', 'ambient'], bandAffinity: 'bass', sizes: ['needs-medium', 'needs-large'] },
  };

  private gridW = 0;
  private gridH = 0;
  private heightMap!: Float32Array;
  private waterMap!: Float32Array;

  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private texture!: THREE.CanvasTexture;
  private mesh!: THREE.Mesh;

  private dropletsPerFrame = 20;
  private renderAccum = 0;
  private erosionRate = 0.05;
  private depositionRate = 0.03;

  build(): void {
    const variant = this.rng.int(0, 3);
    const presets = [
      { res: 128, droplets: 20, erosion: 0.05, deposition: 0.03 },
      { res: 200, droplets: 40, erosion: 0.08, deposition: 0.02 },
      { res: 80, droplets: 10, erosion: 0.03, deposition: 0.04 },
      { res: 160, droplets: 60, erosion: 0.10, deposition: 0.01 },
    ];
    const p = presets[variant];
    this.glitchAmount = 4;

    const { x, y, w, h } = this.px;
    const aspect = w / h;
    this.gridW = Math.round(p.res * Math.max(1, aspect));
    this.gridH = Math.round(p.res / Math.max(1, 1 / aspect));
    this.dropletsPerFrame = p.droplets;
    this.erosionRate = p.erosion;
    this.depositionRate = p.deposition;

    this.heightMap = new Float32Array(this.gridW * this.gridH);
    this.waterMap = new Float32Array(this.gridW * this.gridH);

    // Generate terrain with multiple octaves of sine noise
    for (let gy = 0; gy < this.gridH; gy++) {
      for (let gx = 0; gx < this.gridW; gx++) {
        let h2 = 0;
        h2 += Math.sin(gx * 0.03 + this.rng.float(0, 10)) * Math.cos(gy * 0.04 + this.rng.float(0, 10)) * 0.5;
        h2 += Math.sin(gx * 0.08 + gy * 0.05) * 0.25;
        h2 += Math.sin(gx * 0.15 + gy * 0.12 + this.rng.float(0, 5)) * 0.15;
        h2 += this.rng.float(-0.05, 0.05);
        // Ridge near center
        const cx2 = gx / this.gridW - 0.5;
        const cy2 = gy / this.gridH - 0.5;
        h2 += Math.max(0, 0.3 - Math.sqrt(cx2 * cx2 + cy2 * cy2));
        this.heightMap[gy * this.gridW + gx] = h2 * 0.5 + 0.5;
      }
    }

    this.canvas = document.createElement('canvas');
    this.canvas.width = this.gridW;
    this.canvas.height = this.gridH;
    this.ctx = this.get2DContext(this.canvas);

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.magFilter = THREE.NearestFilter;

    const geo = new THREE.PlaneGeometry(w, h);
    this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, opacity: 0 }));
    this.mesh.position.set(x + w / 2, y + h / 2, 0);
    this.group.add(this.mesh);
  }

  private simulateDroplet(): void {
    let dx = this.rng.float(1, this.gridW - 2);
    let dy = this.rng.float(1, this.gridH - 2);
    let sediment = 0;
    let speed = 1;
    const inertia = 0.1;

    for (let step = 0; step < 50; step++) {
      const ix = Math.floor(dx);
      const iy = Math.floor(dy);
      if (ix < 1 || ix >= this.gridW - 1 || iy < 1 || iy >= this.gridH - 1) break;

      // Gradient
      const idx = iy * this.gridW + ix;
      const gx = this.heightMap[idx + 1] - this.heightMap[idx - 1];
      const gy = this.heightMap[idx + this.gridW] - this.heightMap[idx - this.gridW];

      // Move downhill
      const len = Math.sqrt(gx * gx + gy * gy) + 0.001;
      dx -= (gx / len) * speed;
      dy -= (gy / len) * speed;

      const newIx = Math.floor(dx);
      const newIy = Math.floor(dy);
      if (newIx < 0 || newIx >= this.gridW || newIy < 0 || newIy >= this.gridH) break;

      const newIdx = newIy * this.gridW + newIx;
      const heightDiff = this.heightMap[newIdx] - this.heightMap[idx];

      if (heightDiff > 0) {
        // Going uphill: deposit
        const deposit = Math.min(sediment, heightDiff);
        this.heightMap[idx] += deposit * this.depositionRate;
        sediment -= deposit;
      } else {
        // Going downhill: erode
        const erode = Math.min(-heightDiff, this.erosionRate) * speed;
        this.heightMap[idx] -= erode;
        sediment += erode;
      }

      // Water mark
      this.waterMap[idx] = Math.min(1, this.waterMap[idx] + 0.1);
      speed = Math.min(3, speed + Math.abs(heightDiff) * 2);
    }
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);

    // Run droplets
    for (let i = 0; i < this.dropletsPerFrame; i++) this.simulateDroplet();

    // Fade water
    for (let i = 0; i < this.waterMap.length; i++) this.waterMap[i] *= 0.98;

    // Render
    this.renderAccum += dt;
    if (this.renderAccum >= 0.08) {
      this.renderAccum = 0;
      const img = this.ctx.getImageData(0, 0, this.gridW, this.gridH);
      const data = img.data;
      const pr = this.palette.primary.r * 255;
      const pg2 = this.palette.primary.g * 255;
      const pb = this.palette.primary.b * 255;
      const sr = this.palette.secondary.r * 255;
      const sg = this.palette.secondary.g * 255;
      const sb = this.palette.secondary.b * 255;

      for (let i = 0; i < this.heightMap.length; i++) {
        const h2 = this.heightMap[i];
        const w2 = this.waterMap[i];
        const idx = i * 4;

        // Contour lines
        const contourFreq = 10;
        const contour = Math.abs(Math.sin(h2 * contourFreq * Math.PI));
        const isContour = contour < 0.1;

        if (isContour) {
          data[idx] = pr * 0.8;
          data[idx + 1] = pg2 * 0.8;
          data[idx + 2] = pb * 0.8;
        } else {
          const shade = h2 * 0.4;
          data[idx] = pr * shade * (1 - w2) + sr * w2 * 0.8;
          data[idx + 1] = pg2 * shade * (1 - w2) + sg * w2 * 0.8;
          data[idx + 2] = pb * shade * (1 - w2) + sb * w2 * 0.8;
        }
        data[idx + 3] = 255;
      }
      this.ctx.putImageData(img, 0, 0);
      this.texture.needsUpdate = true;
    }

    (this.mesh.material as THREE.MeshBasicMaterial).opacity = opacity * 0.85;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Earthquake: add noise to heightmap
      for (let i = 0; i < this.heightMap.length; i++) {
        this.heightMap[i] += (this.rng.next() - 0.5) * 0.1;
      }
    }
    if (action === 'alert') {
      // Flood: water everywhere
      this.waterMap.fill(0.5);
      this.dropletsPerFrame *= 3;
      setTimeout(() => { this.dropletsPerFrame = Math.round(this.dropletsPerFrame / 3); }, 2000);
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level >= 3) this.dropletsPerFrame = 60;
    if (level >= 5) this.dropletsPerFrame = 120;
  }
}
