import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';
import { applyScanlines, drawGlowText } from '../animation/retro-text';

/**
 * Scrolling tabular data with column headers and active row highlight.
 * Canvas table, rows scroll up, values change periodically, highlighted row.
 */
export class DataTableElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'data-table',
    meta: { shape: 'rectangular', roles: ['data-display', 'text'], moods: ['diagnostic'], sizes: ['needs-medium', 'needs-large'] },
  };
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private texture!: THREE.CanvasTexture;
  private mesh!: THREE.Mesh;
  private borderLines!: THREE.LineSegments;
  private headers: string[] = [];
  private rows: string[][] = [];
  private scrollOffset: number = 0;
  private scrollSpeed: number = 0;
  private activeRow: number = 0;
  private changeTimer: number = 0;
  private renderAccum: number = 0;

  build(): void {
    this.glitchAmount = 3;
    const { x, y, w, h } = this.px;

    const headerSets = [
      ['NODE', 'STATUS', 'LOAD', 'TEMP'],
      ['PID', 'CPU%', 'MEM', 'STATE'],
      ['PORT', 'PROTO', 'PKTS', 'ERR'],
      ['SECTOR', 'FREQ', 'PWR', 'LOCK'],
    ];
    this.headers = this.rng.pick(headerSets);
    this.scrollSpeed = this.rng.float(8, 25);
    this.activeRow = this.rng.int(0, 5);

    // Generate rows
    for (let i = 0; i < 20; i++) {
      this.rows.push(this.generateRow());
    }

    const scale = Math.min(2, window.devicePixelRatio);
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.ceil(w * scale);
    this.canvas.height = Math.ceil(h * scale);
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.LinearFilter;

    const geo = new THREE.PlaneGeometry(w, h);
    this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      opacity: 0,
    }));
    this.mesh.position.set(x + w / 2, y + h / 2, 1);
    this.group.add(this.mesh);

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

  private generateRow(): string[] {
    return this.headers.map((h) => {
      switch (h) {
        case 'NODE': case 'SECTOR': return `${String.fromCharCode(65 + this.rng.int(0, 25))}${this.rng.int(0, 99)}`;
        case 'STATUS': case 'STATE': return this.rng.pick(['OK', 'WARN', 'FAIL', 'RUN', 'IDLE']);
        case 'LOAD': case 'CPU%': return `${this.rng.int(0, 100)}%`;
        case 'TEMP': return `${this.rng.int(20, 95)}C`;
        case 'PID': return String(this.rng.int(1000, 9999));
        case 'MEM': return `${this.rng.int(1, 512)}M`;
        case 'PORT': return String(this.rng.int(1, 65535));
        case 'PROTO': return this.rng.pick(['TCP', 'UDP', 'ICMP']);
        case 'PKTS': return String(this.rng.int(0, 99999));
        case 'ERR': return String(this.rng.int(0, 50));
        case 'FREQ': return `${(this.rng.float(1, 10)).toFixed(1)}G`;
        case 'PWR': return `${this.rng.int(10, 100)}W`;
        case 'LOCK': return this.rng.pick(['YES', 'NO', '---']);
        default: return `${this.rng.int(0, 999)}`;
      }
    });
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);

    this.scrollOffset += this.scrollSpeed * dt;

    // Change some values periodically
    this.changeTimer += dt;
    if (this.changeTimer > 2) {
      this.changeTimer = 0;
      const rowIdx = this.rng.int(0, this.rows.length - 1);
      this.rows[rowIdx] = this.generateRow();
      this.activeRow = this.rng.int(0, this.rows.length - 1);
    }

    this.renderAccum += dt;
    if (this.renderAccum >= 1 / 12) {
      this.renderAccum = 0;
      this.renderCanvas(time);
    }

    (this.mesh.material as THREE.MeshBasicMaterial).opacity = opacity;
    (this.borderLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.3;
  }

  private renderCanvas(time: number): void {
    const { ctx, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const primaryHex = '#' + this.palette.primary.getHexString();
    const dimHex = '#' + this.palette.dim.getHexString();
    const alertHex = '#' + this.palette.alert.getHexString();
    const secondaryHex = '#' + this.palette.secondary.getHexString();

    const fontSize = Math.max(8, Math.floor(canvas.height * 0.06));
    ctx.font = `${fontSize}px monospace`;
    const rowH = fontSize * 1.8;
    const colW = canvas.width / this.headers.length;

    // Headers
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    for (let c = 0; c < this.headers.length; c++) {
      drawGlowText(ctx, this.headers[c], colW * c + 4, 4, secondaryHex, 4);
    }

    // Separator line
    ctx.strokeStyle = dimHex;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, rowH);
    ctx.lineTo(canvas.width, rowH);
    ctx.stroke();

    // Data rows (scrolling)
    const startRow = Math.floor(this.scrollOffset / rowH) % this.rows.length;
    const yOffset = -(this.scrollOffset % rowH);
    const visibleRows = Math.ceil(canvas.height / rowH) + 1;

    for (let i = 0; i < visibleRows; i++) {
      const rowIdx = (startRow + i) % this.rows.length;
      const ry = rowH + yOffset + i * rowH;
      if (ry < rowH - 2 || ry > canvas.height) continue;

      // Active row highlight
      if (rowIdx === this.activeRow) {
        ctx.fillStyle = primaryHex;
        ctx.globalAlpha = 0.1;
        ctx.fillRect(0, ry, canvas.width, rowH);
        ctx.globalAlpha = 1;
      }

      const row = this.rows[rowIdx];
      for (let c = 0; c < row.length; c++) {
        const isAlert = row[c] === 'FAIL' || row[c] === 'WARN';
        const color = isAlert ? alertHex : (rowIdx === this.activeRow ? primaryHex : dimHex);
        drawGlowText(ctx, row[c], colW * c + 4, ry + 2, color, isAlert ? 6 : 2);
      }
    }

    applyScanlines(ctx, canvas, 0.06, time);
    this.texture.needsUpdate = true;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'alert') {
      this.pulseTimer = 2.0;
      this.scrollSpeed *= 3;
    }
  }

  dispose(): void {
    this.texture.dispose();
    super.dispose();
  }
}
