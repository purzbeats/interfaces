import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';
import { hexCornersPixel, hexCellToPixel, hexagonPoints } from '../layout/hex-grid';

/**
 * Tactical grid with wandering point, trailing path, and coordinate readout.
 * Geometry-based grid lines with canvas overlay for coordinates.
 */
export class CoordGridElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'coord-grid',
    meta: { shape: 'rectangular', roles: ['scanner', 'data-display'], moods: ['tactical'], bandAffinity: 'mid', sizes: ['needs-medium', 'needs-large'] },
  };
  private gridLines!: THREE.LineSegments;
  private pathLine!: THREE.Line;
  private pointMesh!: THREE.Mesh;
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private texture!: THREE.CanvasTexture;
  private labelMesh!: THREE.Mesh;
  private borderLines!: THREE.LineSegments;
  private pointX: number = 0;
  private pointY: number = 0;
  private pointVx: number = 0;
  private pointVy: number = 0;
  private trail: number[] = [];
  private maxTrail: number = 60;
  private renderAccum: number = 0;
  private renderInterval: number = 1 / 10;
  private isHex: boolean = false;
  private hexCx: number = 0;
  private hexCy: number = 0;
  private hexMaxR: number = 0;

  build(): void {
    const variant = this.rng.int(0, 3);
    const presets = [
      { divPicks: [8, 10, 12, 15], trailLen: 60, wanderScale: 1.0, renderFps: 10 },    // Standard
      { divPicks: [16, 20, 24], trailLen: 120, wanderScale: 1.8, renderFps: 15 },       // Dense
      { divPicks: [4, 5, 6], trailLen: 25, wanderScale: 0.5, renderFps: 6 },            // Minimal
      { divPicks: [6, 8, 10], trailLen: 200, wanderScale: 0.3, renderFps: 8 },          // Exotic (long slow trail)
    ];
    const p = presets[variant];

    const { x, y, w, h } = this.px;
    const minDim = Math.min(w, h);
    this.pointX = x + w / 2;
    this.pointY = y + h / 2;
    this.pointVx = this.rng.float(-30, 30) * p.wanderScale;
    this.pointVy = this.rng.float(-30, 30) * p.wanderScale;
    this.maxTrail = p.trailLen;
    this.renderInterval = 1 / p.renderFps;

    const hexCell = this.region.hexCell;
    const gridVerts: number[] = [];

    if (hexCell) {
      this.isHex = true;
      const hexCorners = hexCornersPixel(hexCell, this.screenWidth, this.screenHeight);
      const hpx = hexCellToPixel(hexCell, this.screenWidth, this.screenHeight);
      this.hexCx = hpx.cx;
      this.hexCy = hpx.cy;
      this.hexMaxR = hpx.size * 0.85;

      // 6 radial lines from center to each vertex
      for (let i = 0; i < 6; i++) {
        gridVerts.push(hpx.cx, hpx.cy, 0, hexCorners[i].x, hexCorners[i].y, 0);
      }
      // 2-3 concentric hex rings
      const ringCount = Math.min(3, Math.max(2, Math.floor(minDim / 80)));
      for (let r = 1; r <= ringCount; r++) {
        const ringR = hpx.size * (r / (ringCount + 1));
        const pts = hexagonPoints(hpx.cx, hpx.cy, ringR, 1);
        for (let i = 0; i < pts.length; i++) {
          const next = pts[(i + 1) % pts.length];
          gridVerts.push(pts[i].x, pts[i].y, 0, next.x, next.y, 0);
        }
      }
    } else {
      // Rect mode: orthogonal grid
      const divisions = this.rng.pick(p.divPicks);
      const gridSpacing = Math.max(10, Math.floor(minDim / divisions));
      for (let gx2 = x; gx2 <= x + w; gx2 += gridSpacing) {
        gridVerts.push(gx2, y, 0, gx2, y + h, 0);
      }
      for (let gy = y; gy <= y + h; gy += gridSpacing) {
        gridVerts.push(x, gy, 0, x + w, gy, 0);
      }
    }

    const gridGeo = new THREE.BufferGeometry();
    gridGeo.setAttribute('position', new THREE.Float32BufferAttribute(gridVerts, 3));
    this.gridLines = new THREE.LineSegments(gridGeo, new THREE.LineBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.gridLines);

    // Trail line
    const trailPos = new Float32Array(this.maxTrail * 3);
    const trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPos, 3));
    trailGeo.setDrawRange(0, 0);
    this.pathLine = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.pathLine);

    // Point indicator — scale to region
    const ptSize = Math.max(8, minDim * 0.025);
    const ptGeo = new THREE.PlaneGeometry(ptSize, ptSize);
    this.pointMesh = new THREE.Mesh(ptGeo, new THREE.MeshBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
    }));
    this.pointMesh.position.set(this.pointX, this.pointY, 2);
    this.group.add(this.pointMesh);

    // Coordinate label canvas — scale to region
    const scale = Math.min(2, window.devicePixelRatio);
    const labelW = Math.max(100, Math.min(w * 0.3, 300));
    const labelH = Math.max(20, Math.min(h * 0.04, 40));
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.ceil(labelW * scale);
    this.canvas.height = Math.ceil(labelH * scale);
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.LinearFilter;
    const labelGeo = new THREE.PlaneGeometry(labelW, labelH);
    this.labelMesh = new THREE.Mesh(labelGeo, new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      opacity: 0,
    }));
    this.labelMesh.position.set(x + labelW / 2 + 4, y + h - labelH / 2 - 8, 3);
    this.group.add(this.labelMesh);

    // Border
    let bv: Float32Array;
    if (hexCell) {
      const hc = hexCornersPixel(hexCell, this.screenWidth, this.screenHeight);
      const borderVerts: number[] = [];
      for (let i = 0; i < 6; i++) {
        borderVerts.push(hc[i].x, hc[i].y, 0, hc[(i + 1) % 6].x, hc[(i + 1) % 6].y, 0);
      }
      bv = new Float32Array(borderVerts);
    } else {
      bv = new Float32Array([
        x, y, 0, x + w, y, 0,
        x + w, y, 0, x + w, y + h, 0,
        x + w, y + h, 0, x, y + h, 0,
        x, y + h, 0, x, y, 0,
      ]);
    }
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.BufferAttribute(bv, 3));
    this.borderLines = new THREE.LineSegments(bg, new THREE.LineBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.borderLines);
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);
    const { x, y, w, h } = this.px;

    // Move point with random acceleration — scale to region size
    const speed = Math.min(w, h) * 0.15;
    const maxSpeed = speed * 1.5;
    this.pointVx += this.rng.float(-speed * 2, speed * 2) * dt;
    this.pointVy += this.rng.float(-speed * 2, speed * 2) * dt;
    this.pointVx *= Math.exp(-1 * dt); // drag
    this.pointVy *= Math.exp(-1 * dt);
    this.pointVx = Math.max(-maxSpeed, Math.min(maxSpeed, this.pointVx));
    this.pointVy = Math.max(-maxSpeed, Math.min(maxSpeed, this.pointVy));

    this.pointX += this.pointVx * dt;
    this.pointY += this.pointVy * dt;

    // Bounce off bounds
    if (this.isHex) {
      const dx = this.pointX - this.hexCx;
      const dy = this.pointY - this.hexCy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const bound = this.hexMaxR;
      if (dist > bound) {
        // Reflect velocity and clamp position
        const nx = dx / dist, ny = dy / dist;
        const dot = this.pointVx * nx + this.pointVy * ny;
        this.pointVx -= 2 * dot * nx;
        this.pointVy -= 2 * dot * ny;
        this.pointX = this.hexCx + nx * bound;
        this.pointY = this.hexCy + ny * bound;
      }
    } else {
      if (this.pointX < x + 4 || this.pointX > x + w - 4) {
        this.pointVx *= -1;
        this.pointX = Math.max(x + 4, Math.min(x + w - 4, this.pointX));
      }
      if (this.pointY < y + 4 || this.pointY > y + h - 4) {
        this.pointVy *= -1;
        this.pointY = Math.max(y + 4, Math.min(y + h - 4, this.pointY));
      }
    }

    this.pointMesh.position.set(this.pointX, this.pointY, 2);

    // Update trail
    this.trail.push(this.pointX, this.pointY, 1);
    if (this.trail.length > this.maxTrail * 3) {
      this.trail.splice(0, 3);
    }

    const trailPos = this.pathLine.geometry.getAttribute('position') as THREE.BufferAttribute;
    const pointCount = this.trail.length / 3;
    for (let i = 0; i < pointCount; i++) {
      trailPos.setXYZ(i, this.trail[i * 3], this.trail[i * 3 + 1], this.trail[i * 3 + 2]);
    }
    trailPos.needsUpdate = true;
    this.pathLine.geometry.setDrawRange(0, pointCount);

    (this.gridLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.35;
    (this.pathLine.material as THREE.LineBasicMaterial).opacity = opacity * 0.8;
    (this.pointMesh.material as THREE.MeshBasicMaterial).opacity = opacity;
    (this.borderLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.6;

    // Render coordinate label
    this.renderAccum += dt;
    if (this.renderAccum >= this.renderInterval) {
      this.renderAccum = 0;
      this.renderLabel();
    }
    (this.labelMesh.material as THREE.MeshBasicMaterial).opacity = opacity * 0.7;
  }

  private renderLabel(): void {
    const { ctx, canvas } = this;
    const { x, y, w, h } = this.px;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Normalize coordinates to grid space
    const nx = ((this.pointX - x) / w * 100).toFixed(1);
    const ny = ((this.pointY - y) / h * 100).toFixed(1);

    const text = `X:${nx} Y:${ny}`;
    const heightSize = Math.floor(canvas.height * 0.65);
    const widthSize = Math.floor(canvas.width / (text.length * 0.62));
    const size = Math.max(6, Math.min(heightSize, widthSize));
    ctx.font = `${size}px monospace`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#' + this.palette.primary.getHexString();
    ctx.fillText(text, 4, canvas.height / 2);

    this.texture.needsUpdate = true;
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) return;
    const kick = level * (level >= 3 ? 40 : 15);
    this.pointVx += (this.rng.float(-1, 1)) * kick;
    this.pointVy += (this.rng.float(-1, 1)) * kick;
    if (level >= 5) {
      this.trail.length = 0;
    }
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      const { w, h } = this.px;
      const kick = Math.min(w, h) * 0.2;
      this.pointVx = this.rng.float(-kick, kick);
      this.pointVy = this.rng.float(-kick, kick);
    }
    if (action === 'alert') {
      // Center the point
      const { x, y, w, h } = this.px;
      this.pointX = x + w / 2;
      this.pointY = y + h / 2;
      this.trail = [];
    }
  }

  dispose(): void {
    this.texture.dispose();
    super.dispose();
  }
}
