import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';
import { hexCornersPixel } from '../layout/hex-grid';

/**
 * Animated bracket frame — corner brackets that expand outward from center,
 * with data labels and tick marks along edges. Classic sci-fi targeting overlay.
 */
export class BracketFrameElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'bracket-frame',
    meta: { shape: 'rectangular', roles: ['structural', 'scanner', 'border'], moods: ['tactical'], bandAffinity: 'bass', sizes: ['needs-medium', 'needs-large'] },
  };
  private corners: THREE.LineSegments[] = [];
  private edgeLines!: THREE.LineSegments;
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private texture!: THREE.CanvasTexture;
  private labelMesh!: THREE.Mesh;
  private expandProgress: number = 0;
  private expandTarget: number = 1;
  private renderAccum: number = 0;
  private coordText: string = '';
  private _overshootAmount: number = 0;
  private _labelRate: number = 0;

  build(): void {
    const variant = this.rng.int(0, 3);
    const presets = [
      { bracketScale: 0.2, tickMin: 8, tickMax: 16, overshoot: 0.05, labelRate: 10 },
      { bracketScale: 0.3, tickMin: 16, tickMax: 32, overshoot: 0.12, labelRate: 20 },
      { bracketScale: 0.12, tickMin: 4, tickMax: 8, overshoot: 0.02, labelRate: 5 },
      { bracketScale: 0.35, tickMin: 6, tickMax: 12, overshoot: 0.18, labelRate: 15 },
    ];
    const p = presets[variant];

    const { x, y, w, h } = this.px;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const bracketLen = Math.min(w, h) * p.bracketScale;
    this._overshootAmount = p.overshoot + this.rng.float(-0.01, 0.01);
    this._labelRate = p.labelRate;

    // Generate fake coordinates
    this.coordText = `X:${this.rng.int(100, 999)} Y:${this.rng.int(100, 999)}`;

    const hexCell = this.region.hexCell;
    if (hexCell) {
      // --- Hex mode: 6 V-shaped vertex brackets, ticks along hex edges ---
      const hexCorners = hexCornersPixel(hexCell, this.screenWidth, this.screenHeight);

      for (let i = 0; i < 6; i++) {
        const vertex = hexCorners[i];
        const prev = hexCorners[(i + 5) % 6];
        const next = hexCorners[(i + 1) % 6];

        // Direction vectors from vertex toward adjacent vertices
        const toPrevX = prev.x - vertex.x, toPrevY = prev.y - vertex.y;
        const toNextX = next.x - vertex.x, toNextY = next.y - vertex.y;
        const prevLen = Math.sqrt(toPrevX * toPrevX + toPrevY * toPrevY);
        const nextLen = Math.sqrt(toNextX * toNextX + toNextY * toNextY);

        const arm = Math.min(bracketLen, prevLen * 0.35);
        const verts = new Float32Array([
          // Arm toward previous vertex
          vertex.x, vertex.y, 1,
          vertex.x + (toPrevX / prevLen) * arm, vertex.y + (toPrevY / prevLen) * arm, 1,
          // Arm toward next vertex
          vertex.x, vertex.y, 1,
          vertex.x + (toNextX / nextLen) * arm, vertex.y + (toNextY / nextLen) * arm, 1,
          // Small inner tick (bisector direction)
          vertex.x + (toPrevX / prevLen + toNextX / nextLen) * arm * 0.15,
          vertex.y + (toPrevY / prevLen + toNextY / nextLen) * arm * 0.15, 1,
          vertex.x + (toPrevX / prevLen + toNextX / nextLen) * arm * 0.3,
          vertex.y + (toPrevY / prevLen + toNextY / nextLen) * arm * 0.3, 1,
        ]);
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
        const corner = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
          color: this.palette.primary,
          transparent: true,
          opacity: 0,
        }));
        this.corners.push(corner);
        this.group.add(corner);
      }

      // Edge ticks distributed along all 6 hex edges
      const edgeVerts: number[] = [];
      const tickCount = this.rng.int(p.tickMin, p.tickMax);
      const tickBase = Math.max(4, Math.min(w, h) * 0.015);
      const totalTicks = tickCount * 6;
      for (let edge = 0; edge < 6; edge++) {
        const p1 = hexCorners[edge];
        const p2 = hexCorners[(edge + 1) % 6];
        const edx = p2.x - p1.x, edy = p2.y - p1.y;
        const edgeLen = Math.sqrt(edx * edx + edy * edy);
        // Inward normal
        const nx = -edy / edgeLen, ny = edx / edgeLen;
        for (let i = 1; i < tickCount; i++) {
          const t = i / tickCount;
          const tx = p1.x + edx * t;
          const ty = p1.y + edy * t;
          const tickH = (i % 4 === 0) ? tickBase * 2 : tickBase;
          edgeVerts.push(tx, ty, 0.5, tx + nx * tickH, ty + ny * tickH, 0.5);
        }
      }
      const edgeGeo = new THREE.BufferGeometry();
      edgeGeo.setAttribute('position', new THREE.Float32BufferAttribute(edgeVerts, 3));
      this.edgeLines = new THREE.LineSegments(edgeGeo, new THREE.LineBasicMaterial({
        color: this.palette.dim,
        transparent: true,
        opacity: 0,
      }));
      this.group.add(this.edgeLines);

      // Label near bottom vertex
      const scale = Math.min(2, window.devicePixelRatio);
      const labelW = w * 0.5;
      const labelH = Math.max(16, h * 0.06);
      this.canvas = document.createElement('canvas');
      this.canvas.width = Math.ceil(labelW * scale);
      this.canvas.height = Math.ceil(labelH * scale);
      this.ctx = this.get2DContext(this.canvas);
      this.texture = new THREE.CanvasTexture(this.canvas);
      this.texture.minFilter = THREE.LinearFilter;
      this.texture.magFilter = THREE.LinearFilter;
      const labelGeo = new THREE.PlaneGeometry(labelW, labelH);
      this.labelMesh = new THREE.Mesh(labelGeo, new THREE.MeshBasicMaterial({
        map: this.texture,
        transparent: true,
        opacity: 0,
      }));
      // Position near bottom vertex (vertex 4 in flat-top hex is bottom-left area)
      const bottomVertex = hexCorners[4];
      this.labelMesh.position.set(cx, bottomVertex.y + labelH / 2 + 4, 2);
      this.group.add(this.labelMesh);
    } else {
      // --- Rect mode: original 4-corner brackets ---
      const cornerPositions = [
        { ox: x, oy: y, dx: 1, dy: 1 },
        { ox: x + w, oy: y, dx: -1, dy: 1 },
        { ox: x + w, oy: y + h, dx: -1, dy: -1 },
        { ox: x, oy: y + h, dx: 1, dy: -1 },
      ];

      for (const cp of cornerPositions) {
        const verts = new Float32Array([
          cp.ox, cp.oy, 1,
          cp.ox + cp.dx * bracketLen, cp.oy, 1,
          cp.ox, cp.oy, 1,
          cp.ox, cp.oy + cp.dy * bracketLen, 1,
          cp.ox + cp.dx * bracketLen * 0.3, cp.oy, 1,
          cp.ox + cp.dx * bracketLen * 0.3, cp.oy + cp.dy * bracketLen * 0.15, 1,
        ]);
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
        const corner = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
          color: this.palette.primary,
          transparent: true,
          opacity: 0,
        }));
        this.corners.push(corner);
        this.group.add(corner);
      }

      // Edge tick marks along top and bottom
      const edgeVerts: number[] = [];
      const tickCount = this.rng.int(p.tickMin, p.tickMax);
      const tickBase = Math.max(4, Math.min(w, h) * 0.015);
      for (let i = 0; i <= tickCount; i++) {
        const t = i / tickCount;
        const tx = x + w * t;
        const tickH = (i % 4 === 0) ? tickBase * 2 : tickBase;
        edgeVerts.push(tx, y, 0.5, tx, y + tickH, 0.5);
        edgeVerts.push(tx, y + h, 0.5, tx, y + h - tickH, 0.5);
      }
      const edgeGeo = new THREE.BufferGeometry();
      edgeGeo.setAttribute('position', new THREE.Float32BufferAttribute(edgeVerts, 3));
      this.edgeLines = new THREE.LineSegments(edgeGeo, new THREE.LineBasicMaterial({
        color: this.palette.dim,
        transparent: true,
        opacity: 0,
      }));
      this.group.add(this.edgeLines);

      // Label canvas in corner
      const scale = Math.min(2, window.devicePixelRatio);
      const labelW = w * 0.5;
      const labelH = Math.max(16, h * 0.06);
      this.canvas = document.createElement('canvas');
      this.canvas.width = Math.ceil(labelW * scale);
      this.canvas.height = Math.ceil(labelH * scale);
      this.ctx = this.get2DContext(this.canvas);
      this.texture = new THREE.CanvasTexture(this.canvas);
      this.texture.minFilter = THREE.LinearFilter;
      this.texture.magFilter = THREE.LinearFilter;
      const labelGeo = new THREE.PlaneGeometry(labelW, labelH);
      this.labelMesh = new THREE.Mesh(labelGeo, new THREE.MeshBasicMaterial({
        map: this.texture,
        transparent: true,
        opacity: 0,
      }));
      this.labelMesh.position.set(x + labelW / 2 + 10, y + h - labelH / 2 - 4, 2);
      this.group.add(this.labelMesh);
    }
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);

    // Corners expand from center with overshoot
    const diff = this.expandTarget - this.expandProgress;
    this.expandProgress += diff * dt * 5;
    const overshoot = this.expandProgress + Math.sin(this.expandProgress * Math.PI) * this._overshootAmount;

    for (let i = 0; i < this.corners.length; i++) {
      const s = Math.max(0.01, overshoot);
      this.corners[i].scale.set(s, s, 1);
      (this.corners[i].material as THREE.LineBasicMaterial).opacity = opacity * 0.8;
    }

    (this.edgeLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.4;

    // Render label
    this.renderAccum += dt;
    if (this.renderAccum >= 1 / this._labelRate) {
      this.renderAccum = 0;
      const { ctx, canvas } = this;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const timeText = `T+${time.toFixed(1)}`;
      const fullText = this.coordText + '  ' + timeText;
      const heightSize = Math.floor(canvas.height * 0.6);
      const widthSize = Math.floor(canvas.width / (fullText.length * 0.62));
      const fontSize = Math.max(6, Math.min(heightSize, widthSize));
      ctx.font = `${fontSize}px monospace`;
      ctx.fillStyle = '#' + this.palette.dim.getHexString();
      ctx.textBaseline = 'middle';
      ctx.fillText(this.coordText, 4, canvas.height / 2);
      ctx.fillText(timeText, canvas.width * 0.55, canvas.height / 2);
      this.texture.needsUpdate = true;
    }
    (this.labelMesh.material as THREE.MeshBasicMaterial).opacity = opacity * 0.6;
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) return;
    if (level >= 5) {
      for (const c of this.corners) {
        (c.material as THREE.LineBasicMaterial).color.copy(this.palette.alert);
      }
      setTimeout(() => {
        for (const c of this.corners) {
          (c.material as THREE.LineBasicMaterial).color.copy(this.palette.primary);
        }
      }, 2000);
    }
    this.expandTarget = level >= 3 ? 0.7 : 0.85;
    setTimeout(() => { this.expandTarget = 1; }, 500);
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'activate') {
      this.expandProgress = 0;
      this.expandTarget = 1;
    }
    if (action === 'pulse') {
      this.expandTarget = 0.8;
      setTimeout(() => { this.expandTarget = 1; }, 200);
    }
    if (action === 'alert') {
      this.pulseTimer = 1.5;
      for (const c of this.corners) {
        (c.material as THREE.LineBasicMaterial).color.copy(this.palette.alert);
      }
    }
  }

  dispose(): void {
    this.texture.dispose();
    super.dispose();
  }
}
