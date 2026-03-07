import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';
import { hexCornersPixel, hexPerimeterPoint } from '../layout/hex-grid';

/**
 * Data border — tiny hex/numeric readouts along the edges using a canvas texture,
 * like memory address labels. Uses a single canvas + mesh for all text, throttled
 * at ~10fps. Four variants: hex addresses, binary strings, coordinates, countdown.
 */
export class DataBorderElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'data-border',
    meta: {
      shape: 'rectangular',
      roles: ['data-display', 'decorative', 'border'],
      moods: ['tactical', 'diagnostic'],
      bandAffinity: 'high',
      sizes: ['works-small', 'needs-medium', 'needs-large'],
    },
  };

  private variant: number = 0;
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private texture!: THREE.CanvasTexture;
  private mesh!: THREE.Mesh;
  private renderAccum: number = 0;
  private labelCount: number = 0;
  private cw: number = 0;
  private ch: number = 0;
  private isHex: boolean = false;
  private hexCorners: THREE.Vector3[] | null = null;
  private perimeterLength: number = 0;
  private speedBoost: number = 1;
  private frameCounter: number = 0;
  private baseAddresses!: number[];

  build(): void {
    this.variant = this.rng.int(0, 3);
    const { x, y, w, h } = this.px;

    const hexCell = this.region.hexCell;
    if (hexCell) {
      this.isHex = true;
      this.hexCorners = hexCornersPixel(hexCell, this.screenWidth, this.screenHeight);
      let perim = 0;
      for (let i = 0; i < 6; i++) {
        const c1 = this.hexCorners[i], c2 = this.hexCorners[(i + 1) % 6];
        perim += Math.sqrt((c2.x - c1.x) ** 2 + (c2.y - c1.y) ** 2);
      }
      this.perimeterLength = perim;
    } else {
      this.perimeterLength = 2 * (w + h);
    }

    // High-res canvas for text readability
    const maxRes = 400;
    const scale = Math.min(1, maxRes / Math.max(w, h));
    this.cw = Math.max(64, Math.floor(w * scale));
    this.ch = Math.max(64, Math.floor(h * scale));

    this.canvas = document.createElement('canvas');
    this.canvas.width = this.cw;
    this.canvas.height = this.ch;
    this.ctx = this.get2DContext(this.canvas);

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.magFilter = THREE.NearestFilter;

    const mat = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      opacity: 1,
      depthWrite: false,
    });
    const geo = new THREE.PlaneGeometry(w, h);
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.set(x + w * 0.5, y + h * 0.5, 0.5);
    this.group.add(this.mesh);

    // Label count proportional to perimeter
    const minDim = Math.min(w, h);
    this.labelCount = Math.max(4, Math.floor(this.perimeterLength / (minDim * 0.25)));
    this.labelCount = Math.min(this.labelCount, 24);

    // Pre-generate base addresses for hex variant
    this.baseAddresses = [];
    for (let i = 0; i < this.labelCount; i++) {
      this.baseAddresses.push(this.rng.int(0x1000, 0xFFFF));
    }
  }

  private perimeterPoint(t: number): { px: number; py: number } {
    if (this.isHex && this.hexCorners) {
      return hexPerimeterPoint(this.hexCorners, t);
    }
    const { x, y, w, h } = this.px;
    const perim = this.perimeterLength;
    t = ((t % 1) + 1) % 1;
    const dist = t * perim;
    if (dist <= w) return { px: x + dist, py: y };
    if (dist <= w + h) return { px: x + w, py: y + (dist - w) };
    if (dist <= 2 * w + h) return { px: x + w - (dist - w - h), py: y + h };
    return { px: x, py: y + h - (dist - 2 * w - h) };
  }

  private generateLabel(index: number): string {
    switch (this.variant) {
      case 0: { // hex addresses
        const addr = (this.baseAddresses[index] + this.frameCounter * 16) & 0xFFFF;
        return '0x' + addr.toString(16).toUpperCase().padStart(4, '0');
      }
      case 1: { // binary strings
        const val = (this.baseAddresses[index] + this.frameCounter) & 0xFF;
        return val.toString(2).padStart(8, '0');
      }
      case 2: { // coordinates
        const cx = ((index * 17 + this.frameCounter) % 999);
        const cy = ((index * 31 + this.frameCounter * 3) % 999);
        return `${cx},${cy}`;
      }
      case 3: { // countdown values
        const count = Math.max(0, 9999 - this.frameCounter * 7 + index * 100) % 10000;
        return count.toString().padStart(4, '0');
      }
      default:
        return '----';
    }
  }

  private renderCanvas(opacity: number): void {
    const ctx = this.ctx;
    const { x, y, w, h } = this.px;
    const cw = this.cw, ch = this.ch;

    ctx.clearRect(0, 0, cw, ch);

    const fontSize = Math.max(6, Math.floor(ch * 0.04));
    ctx.font = `${fontSize}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const margin = Math.max(1, Math.min(cw, ch) * 0.02);

    for (let i = 0; i < this.labelCount; i++) {
      const t = i / this.labelCount;
      const pt = this.perimeterPoint(t);

      // Convert world coords to canvas coords
      const canvasX = ((pt.px - x) / w) * cw;
      const canvasY = ((pt.py - y) / h) * ch;

      const label = this.generateLabel(i);

      // Flicker effect: some labels dim randomly
      const flicker = (Math.sin(i * 7.3 + this.frameCounter * 0.1) > 0.3) ? 1.0 : 0.4;

      const r = Math.floor(this.palette.primary.r * 255 * flicker);
      const g = Math.floor(this.palette.primary.g * 255 * flicker);
      const b = Math.floor(this.palette.primary.b * 255 * flicker);
      ctx.fillStyle = `rgba(${r},${g},${b},${opacity * 0.8})`;

      ctx.fillText(label, canvasX, canvasY);
    }

    this.texture.needsUpdate = true;
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);

    this.renderAccum += dt;
    if (this.renderAccum < 0.1) { // ~10fps throttle
      (this.mesh.material as THREE.MeshBasicMaterial).opacity = opacity;
      return;
    }
    this.renderAccum = 0;
    this.frameCounter++;

    this.renderCanvas(opacity);
    (this.mesh.material as THREE.MeshBasicMaterial).opacity = opacity;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'activate') {
      this.frameCounter = 0;
      this.speedBoost = 1;
    }
    if (action === 'alert') {
      this.pulseTimer = 2.0;
    }
    if (action === 'glitch') {
      // Randomize base addresses
      for (let i = 0; i < this.baseAddresses.length; i++) {
        this.baseAddresses[i] = this.rng.int(0x1000, 0xFFFF);
      }
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    this.speedBoost = level === 0 ? 1 : 1 + level * 0.3;
  }

  dispose(): void {
    if (this.texture) this.texture.dispose();
    super.dispose();
  }
}
