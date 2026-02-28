import * as THREE from 'three';
import { BaseElement } from './base-element';
import { stateOpacity, pulse, glitchOffset } from '../animation/fx';

/**
 * Animated bracket frame — corner brackets that expand outward from center,
 * with data labels and tick marks along edges. Classic sci-fi targeting overlay.
 */
export class BracketFrameElement extends BaseElement {
  private corners: THREE.LineSegments[] = [];
  private edgeLines!: THREE.LineSegments;
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private texture!: THREE.CanvasTexture;
  private labelMesh!: THREE.Mesh;
  private expandProgress: number = 0;
  private expandTarget: number = 1;
  private pulseTimer: number = 0;
  private glitchTimer: number = 0;
  private renderAccum: number = 0;
  private coordText: string = '';

  build(): void {
    const { x, y, w, h } = this.px;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const bracketLen = Math.min(w, h) * 0.2;
    const bracketThick = 2;

    // Generate fake coordinates
    this.coordText = `X:${this.rng.int(100, 999)} Y:${this.rng.int(100, 999)}`;

    // Four corners — each is a LineSegments that will animate from center
    const cornerPositions = [
      { ox: x, oy: y, dx: 1, dy: 1 },           // top-left
      { ox: x + w, oy: y, dx: -1, dy: 1 },       // top-right
      { ox: x + w, oy: y + h, dx: -1, dy: -1 },  // bottom-right
      { ox: x, oy: y + h, dx: 1, dy: -1 },       // bottom-left
    ];

    for (const cp of cornerPositions) {
      const verts = new Float32Array([
        // Horizontal arm
        cp.ox, cp.oy, 1,
        cp.ox + cp.dx * bracketLen, cp.oy, 1,
        // Vertical arm
        cp.ox, cp.oy, 1,
        cp.ox, cp.oy + cp.dy * bracketLen, 1,
        // Small inner tick
        cp.ox + cp.dx * bracketLen * 0.3, cp.oy, 1,
        cp.ox + cp.dx * bracketLen * 0.3, cp.oy + cp.dy * 6, 1,
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

    // Edge tick marks along top and right
    const edgeVerts: number[] = [];
    const tickCount = this.rng.int(8, 16);
    for (let i = 0; i <= tickCount; i++) {
      const t = i / tickCount;
      // Top edge ticks
      const tx = x + w * t;
      const tickH = (i % 4 === 0) ? 8 : 4;
      edgeVerts.push(tx, y, 0.5, tx, y + tickH, 0.5);
      // Bottom edge ticks
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

    // Small label canvas in corner
    const scale = Math.min(2, window.devicePixelRatio);
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.ceil(w * 0.4 * scale);
    this.canvas.height = Math.ceil(24 * scale);
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    const labelGeo = new THREE.PlaneGeometry(w * 0.4, 24);
    this.labelMesh = new THREE.Mesh(labelGeo, new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      opacity: 0,
    }));
    this.labelMesh.position.set(x + w * 0.2 + 10, y + h - 14, 2);
    this.group.add(this.labelMesh);
  }

  update(dt: number, time: number): void {
    let opacity = stateOpacity(this.stateMachine.state, this.stateMachine.progress);

    if (this.pulseTimer > 0) {
      this.pulseTimer -= dt;
      opacity *= pulse(this.pulseTimer);
    }

    const gx = this.glitchTimer > 0 ? glitchOffset(this.glitchTimer, 4) : 0;
    if (this.glitchTimer > 0) this.glitchTimer -= dt;
    this.group.position.x = gx;

    // Corners expand from center with overshoot
    const diff = this.expandTarget - this.expandProgress;
    this.expandProgress += diff * dt * 5;
    const overshoot = this.expandProgress + Math.sin(this.expandProgress * Math.PI) * 0.05;

    for (let i = 0; i < this.corners.length; i++) {
      const s = Math.max(0.01, overshoot);
      this.corners[i].scale.set(s, s, 1);
      (this.corners[i].material as THREE.LineBasicMaterial).opacity = opacity * 0.8;
    }

    (this.edgeLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.25;

    // Render label
    this.renderAccum += dt;
    if (this.renderAccum >= 1 / 10) {
      this.renderAccum = 0;
      const { ctx, canvas } = this;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const fontSize = Math.floor(canvas.height * 0.6);
      ctx.font = `${fontSize}px monospace`;
      ctx.fillStyle = '#' + this.palette.dim.getHexString();
      ctx.fillText(this.coordText, 4, canvas.height * 0.65);
      ctx.fillText(`T+${time.toFixed(1)}`, canvas.width * 0.55, canvas.height * 0.65);
      this.texture.needsUpdate = true;
    }
    (this.labelMesh.material as THREE.MeshBasicMaterial).opacity = opacity * 0.6;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'activate') {
      this.expandProgress = 0;
      this.expandTarget = 1;
    }
    if (action === 'pulse') {
      this.pulseTimer = 0.5;
      this.expandTarget = 0.8;
      setTimeout(() => { this.expandTarget = 1; }, 200);
    }
    if (action === 'glitch') this.glitchTimer = 0.4;
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
