import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';
import { hexagonPoints, hexPerimeterPoint, hexCornersPixel } from '../layout/hex-grid';

/**
 * Multi-metric concentric arcs (3-5 rings), each with independent fill level.
 * No rotation — arcs are drawn via vertex positions.
 */
export class LevelRingsElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'level-rings',
    meta: { shape: 'radial', roles: ['gauge', 'data-display'], moods: ['diagnostic'], bandAffinity: 'bass', sizes: ['needs-medium'] },
  };
  private bgRings: THREE.Line[] = [];
  private fillRings: THREE.Line[] = [];
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private texture!: THREE.CanvasTexture;
  private labelMesh!: THREE.Mesh;
  private ringCount: number = 0;
  private values: number[] = [];
  private targets: number[] = [];
  private velocities: number[] = [];
  private labels: string[] = [];
  private segments: number = 48;
  private cycleTimer: number = 0;
  private renderAccum: number = 0;
  private springK: number = 15;
  private springDamping: number = 3;
  private isHex: boolean = false;
  private hexCorners: THREE.Vector3[] | null = null;

  build(): void {
    const variant = this.rng.int(0, 3);
    const presets = [
      { ringCount: [3, 5] as const, segments: 48, springK: 15, damping: 3, gapFactor: 1.0 },
      { ringCount: [5, 8] as const, segments: 72, springK: 28, damping: 2, gapFactor: 0.85 },
      { ringCount: [2, 3] as const, segments: 24, springK: 8, damping: 5, gapFactor: 1.3 },
      { ringCount: [4, 6] as const, segments: 36, springK: 40, damping: 1.5, gapFactor: 0.7 },
    ];
    const p = presets[variant];

    const { x, y, w, h } = this.px;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const maxR = Math.min(w, h) / 2 * 0.9;
    this.ringCount = this.rng.int(p.ringCount[0], p.ringCount[1]);
    this.segments = p.segments + this.rng.int(-4, 4);
    this.springK = p.springK + this.rng.float(-2, 2);
    this.springDamping = p.damping + this.rng.float(-0.3, 0.3);
    const ringGap = maxR / (this.ringCount + 1) * (p.gapFactor + this.rng.float(-0.05, 0.05));
    this.isHex = !!this.region.hexCell;
    if (this.region.hexCell) {
      this.hexCorners = hexCornersPixel(this.region.hexCell, this.screenWidth, this.screenHeight);
    }

    const allLabels = ['CPU', 'MEM', 'NET', 'DISK', 'GPU', 'TEMP', 'PWR', 'IO'];
    for (let r = 0; r < this.ringCount; r++) {
      const radius = maxR - ringGap * r;
      const initial = this.rng.float(0.2, 0.9);
      this.values.push(initial);
      this.targets.push(initial);
      this.velocities.push(0);
      this.labels.push(allLabels[r % allLabels.length]);

      // Background ring (full shape)
      const bgVerts: number[] = [];
      if (this.isHex) {
        const pts = hexagonPoints(cx, cy, radius, Math.max(1, Math.floor(this.segments / 6)));
        for (const pt of pts) bgVerts.push(pt.x, pt.y, 0);
        bgVerts.push(pts[0].x, pts[0].y, 0); // close
      } else {
        for (let i = 0; i <= this.segments; i++) {
          const a = (i / this.segments) * Math.PI * 2 - Math.PI / 2;
          bgVerts.push(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius, 0);
        }
      }
      const bgGeo = new THREE.BufferGeometry();
      bgGeo.setAttribute('position', new THREE.Float32BufferAttribute(bgVerts, 3));
      const bgRing = new THREE.Line(bgGeo, new THREE.LineBasicMaterial({
        color: this.palette.primary,
        transparent: true,
        opacity: 0,
      }));
      this.bgRings.push(bgRing);
      this.group.add(bgRing);

      // Fill ring (partial arc, updatable)
      const fillPos = new Float32Array((this.segments + 1) * 3);
      const fillGeo = new THREE.BufferGeometry();
      fillGeo.setAttribute('position', new THREE.BufferAttribute(fillPos, 3));
      const colors = [this.palette.primary, this.palette.secondary, this.palette.primary, this.palette.secondary, this.palette.primary];
      const fillRing = new THREE.Line(fillGeo, new THREE.LineBasicMaterial({
        color: colors[r % colors.length],
        transparent: true,
        opacity: 0,
      }));
      this.fillRings.push(fillRing);
      this.group.add(fillRing);
    }

    // Center label
    const scale = Math.min(2, window.devicePixelRatio);
    const labelR = ringGap * 0.8;
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.ceil(labelR * 2 * scale);
    this.canvas.height = Math.ceil(labelR * 2 * scale);
    this.ctx = this.get2DContext(this.canvas);
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.LinearFilter;
    const labelGeo = new THREE.PlaneGeometry(labelR * 2, labelR * 2);
    this.labelMesh = new THREE.Mesh(labelGeo, new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      opacity: 0,
    }));
    this.labelMesh.position.set(cx, cy, 2);
    this.group.add(this.labelMesh);
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);
    const { x, y, w, h } = this.px;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const maxR = Math.min(w, h) / 2 * 0.9;
    const ringGap = maxR / (this.ringCount + 1);

    // Cycle targets
    this.cycleTimer += dt;
    if (this.cycleTimer > 2) {
      this.cycleTimer = 0;
      for (let r = 0; r < this.ringCount; r++) {
        this.targets[r] = this.rng.float(0.1, 1.0);
      }
    }

    // Spring physics per ring
    for (let r = 0; r < this.ringCount; r++) {
      const force = (this.targets[r] - this.values[r]) * this.springK;
      this.velocities[r] += force * dt;
      this.velocities[r] *= Math.exp(-this.springDamping * dt);
      this.values[r] += this.velocities[r] * dt;
      this.values[r] = Math.max(0, Math.min(1.1, this.values[r]));

      const radius = maxR - ringGap * r;
      const fillPos = this.fillRings[r].geometry.getAttribute('position') as THREE.BufferAttribute;

      if (this.isHex && this.hexCorners) {
        const fillFrac = Math.min(this.values[r], 1);
        for (let i = 0; i <= this.segments; i++) {
          const t = (i / this.segments) * fillFrac;
          const pt = hexPerimeterPoint(this.hexCorners, t);
          // Scale to this ring's radius from center
          const dx = pt.px - cx, dy = pt.py - cy;
          const d = Math.sqrt(dx * dx + dy * dy);
          const scale = d > 0 ? radius / d : 0;
          fillPos.setXYZ(i, cx + dx * scale, cy + dy * scale, 1);
        }
      } else {
        const fillAngle = this.values[r] * Math.PI * 2;
        for (let i = 0; i <= this.segments; i++) {
          const a = (i / this.segments) * fillAngle - Math.PI / 2;
          fillPos.setXYZ(i, cx + Math.cos(a) * radius, cy + Math.sin(a) * radius, 1);
        }
      }
      fillPos.needsUpdate = true;

      // Color shift at high values
      const mat = this.fillRings[r].material as THREE.LineBasicMaterial;
      if (this.values[r] > 0.9) {
        mat.color.copy(this.palette.alert);
      }
      mat.opacity = opacity * 0.9;
      (this.bgRings[r].material as THREE.LineBasicMaterial).opacity = opacity * 0.2;
    }

    // Render center label
    this.renderAccum += dt;
    if (this.renderAccum >= 1 / 10) {
      this.renderAccum = 0;
      this.renderLabel();
    }
    (this.labelMesh.material as THREE.MeshBasicMaterial).opacity = opacity * 0.7;
  }

  private renderLabel(): void {
    const { ctx, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const primaryHex = '#' + this.palette.primary.getHexString();
    const dimHex = '#' + this.palette.dim.getHexString();
    const lineH = canvas.height / (this.ringCount + 1);
    const size = Math.floor(lineH * 0.7);

    ctx.font = `${size}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (let r = 0; r < this.ringCount; r++) {
      const pct = Math.round(Math.min(this.values[r], 1) * 100);
      ctx.fillStyle = pct > 90 ? '#' + this.palette.alert.getHexString() : primaryHex;
      ctx.fillText(`${this.labels[r]} ${pct}%`, canvas.width / 2, lineH * (r + 0.8));
    }

    this.texture.needsUpdate = true;
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) return;
    for (let i = 0; i < this.ringCount; i++) {
      if (level >= 5) {
        this.targets[i] = 1.0;
      }
      this.velocities[i] += level * (level >= 3 ? 2 : 1);
    }
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'pulse') {
      for (let r = 0; r < this.ringCount; r++) {
        this.velocities[r] += 3;
      }
    }
    if (action === 'glitch') {
      for (let r = 0; r < this.ringCount; r++) {
        this.targets[r] = this.rng.float(0, 1);
        this.velocities[r] = this.rng.float(-4, 4);
      }
    }
    if (action === 'alert') {
      for (let r = 0; r < this.ringCount; r++) {
        this.targets[r] = 1.0;
      }
    }
  }

  dispose(): void {
    this.texture.dispose();
    super.dispose();
  }
}
