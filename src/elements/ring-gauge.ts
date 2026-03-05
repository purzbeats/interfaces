import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';
import { drawGlowText } from '../animation/retro-text';
import { hexagonPoints, hexPerimeterPoint, hexCornersPixel } from '../layout/hex-grid';

/**
 * Circular ring gauge — a thick arc that fills clockwise to indicate a value,
 * with numerical readout and tick marks. Think fuel gauge, AT field strength.
 */
export class RingGaugeElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'ring-gauge',
    meta: { shape: 'radial', roles: ['gauge'], moods: ['diagnostic'], bandAffinity: 'bass', sizes: ['needs-medium'] },
  };
  private bgRing!: THREE.Line;
  private fillRing!: THREE.Line;
  private ticks!: THREE.LineSegments;
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private texture!: THREE.CanvasTexture;
  private labelMesh!: THREE.Mesh;
  private value: number = 0;
  private targetValue: number = 0;
  private velocity: number = 0;
  private label: string = '';
  private segments: number = 64;
  private cycleTimer: number = 0;
  private renderAccum: number = 0;
  private springK: number = 15;
  private springDamping: number = 3;
  private warningThreshold: number = 0.7;
  private alertThreshold: number = 0.9;
  private isHex: boolean = false;
  private hexCorners: THREE.Vector3[] | null = null;

  build(): void {
    const variant = this.rng.int(0, 3);
    const presets = [
      { tickCount: 12, arcThickness: 0.7, segments: 64, springK: 15, damping: 3, warningThreshold: 0.7, alertThreshold: 0.9 },
      { tickCount: 24, arcThickness: 0.55, segments: 96, springK: 30, damping: 2, warningThreshold: 0.6, alertThreshold: 0.8 },
      { tickCount: 6, arcThickness: 0.82, segments: 32, springK: 8, damping: 5, warningThreshold: 0.85, alertThreshold: 0.95 },
      { tickCount: 16, arcThickness: 0.6, segments: 48, springK: 45, damping: 1.5, warningThreshold: 0.5, alertThreshold: 0.75 },
    ];
    const p = presets[variant];

    const { x, y, w, h } = this.px;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const outerR = Math.min(w, h) / 2 * 0.85;
    const innerR = outerR * (p.arcThickness + this.rng.float(-0.03, 0.03));
    const midR = (outerR + innerR) / 2;
    this.targetValue = this.rng.float(0.3, 0.95);
    this.segments = p.segments + this.rng.int(-4, 4);
    this.springK = p.springK + this.rng.float(-2, 2);
    this.springDamping = p.damping + this.rng.float(-0.3, 0.3);
    this.warningThreshold = p.warningThreshold;
    this.alertThreshold = p.alertThreshold;
    this.isHex = !!this.region.hexCell;
    if (this.region.hexCell) {
      this.hexCorners = hexCornersPixel(this.region.hexCell, this.screenWidth, this.screenHeight);
    }

    const labels = ['AT FIELD', 'PWR LVL', 'SYNC', 'SHIELD', 'CHARGE', 'OUTPUT', 'SIGNAL', 'CORE'];
    this.label = this.rng.pick(labels);

    // Background ring (full shape, dim)
    const bgPositions: number[] = [];
    if (this.isHex) {
      const pts = hexagonPoints(cx, cy, midR, Math.max(1, Math.floor(this.segments / 6)));
      for (const pt of pts) bgPositions.push(pt.x, pt.y, 0);
      bgPositions.push(pts[0].x, pts[0].y, 0); // close
    } else {
      for (let i = 0; i <= this.segments; i++) {
        const a = (i / this.segments) * Math.PI * 2 - Math.PI / 2;
        bgPositions.push(cx + Math.cos(a) * midR, cy + Math.sin(a) * midR, 0);
      }
    }
    const bgGeo = new THREE.BufferGeometry();
    bgGeo.setAttribute('position', new THREE.Float32BufferAttribute(bgPositions, 3));
    this.bgRing = new THREE.Line(bgGeo, new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.bgRing);

    // Fill ring (partial arc)
    const fillPositions = new Float32Array((this.segments + 1) * 3);
    const fillGeo = new THREE.BufferGeometry();
    fillGeo.setAttribute('position', new THREE.BufferAttribute(fillPositions, 3));
    this.fillRing = new THREE.Line(fillGeo, new THREE.LineBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
      linewidth: 2,
    }));
    this.group.add(this.fillRing);

    // Tick marks
    const tickCount = p.tickCount + this.rng.int(-1, 1);
    const tickVerts: number[] = [];
    if (this.isHex && this.hexCorners) {
      // Major ticks at hex vertices, minor ticks along edges
      for (let i = 0; i < tickCount; i++) {
        const t = i / tickCount;
        const pt = hexPerimeterPoint(this.hexCorners, t);
        // Direction: outward from center
        const dx = pt.px - cx, dy = pt.py - cy;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < 1) continue;
        const nx = dx / d, ny = dy / d;
        const isMajor = i % Math.max(1, Math.floor(tickCount / 6)) === 0;
        const inner = d * (isMajor ? 0.85 : 0.9);
        const outer = d * (isMajor ? 1.05 : 1.0);
        tickVerts.push(
          cx + nx * inner, cy + ny * inner, 1,
          cx + nx * outer, cy + ny * outer, 1,
        );
      }
    } else {
      for (let i = 0; i < tickCount; i++) {
        const a = (i / tickCount) * Math.PI * 2 - Math.PI / 2;
        const t1 = i % 3 === 0 ? outerR * 1.05 : outerR;
        tickVerts.push(
          cx + Math.cos(a) * innerR * 0.95, cy + Math.sin(a) * innerR * 0.95, 1,
          cx + Math.cos(a) * t1, cy + Math.sin(a) * t1, 1,
        );
      }
    }
    const tickGeo = new THREE.BufferGeometry();
    tickGeo.setAttribute('position', new THREE.Float32BufferAttribute(tickVerts, 3));
    this.ticks = new THREE.LineSegments(tickGeo, new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.ticks);

    // Center label
    const scale = Math.min(2, window.devicePixelRatio);
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.ceil(innerR * 1.6 * scale);
    this.canvas.height = Math.ceil(innerR * 1.2 * scale);
    this.ctx = this.get2DContext(this.canvas);
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.NearestFilter;
    const labelGeo = new THREE.PlaneGeometry(innerR * 1.6, innerR * 1.2);
    this.labelMesh = new THREE.Mesh(labelGeo, new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      opacity: 0,
    }));
    this.labelMesh.position.set(cx, cy, 2);
    this.group.add(this.labelMesh);
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    const { x, y, w, h } = this.px;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const outerR = Math.min(w, h) / 2 * 0.85;
    const innerR = outerR * 0.7;
    const midR = (outerR + innerR) / 2;

    // Cycle target
    this.cycleTimer += dt;
    if (this.cycleTimer > 3) {
      this.cycleTimer = 0;
      this.targetValue = this.rng.float(0.15, 1.0);
    }

    // Spring physics for value
    const force = (this.targetValue - this.value) * this.springK;
    this.velocity += force * dt;
    this.velocity *= Math.exp(-this.springDamping * dt);
    this.value += this.velocity * dt;
    this.value = Math.max(0, Math.min(1.1, this.value));

    // Update fill arc
    const fillPos = this.fillRing.geometry.getAttribute('position') as THREE.BufferAttribute;
    if (this.isHex && this.hexCorners) {
      // Trace along hex perimeter proportionally
      const fillFrac = Math.min(this.value, 1);
      for (let i = 0; i <= this.segments; i++) {
        const t = (i / this.segments) * fillFrac;
        const pt = hexPerimeterPoint(this.hexCorners, t);
        // Scale to midR from center
        const dx = pt.px - cx, dy = pt.py - cy;
        const d = Math.sqrt(dx * dx + dy * dy);
        const scale = d > 0 ? midR / d : 0;
        fillPos.setXYZ(i, cx + dx * scale, cy + dy * scale, 1);
      }
    } else {
      const fillAngle = this.value * Math.PI * 2;
      for (let i = 0; i <= this.segments; i++) {
        const a = (i / this.segments) * fillAngle - Math.PI / 2;
        fillPos.setXYZ(i, cx + Math.cos(a) * midR, cy + Math.sin(a) * midR, 1);
      }
    }
    fillPos.needsUpdate = true;

    // Color shifts at high values
    const fillColor = this.value > this.alertThreshold ? this.palette.alert
      : this.value > this.warningThreshold ? this.palette.secondary
      : this.palette.primary;
    (this.fillRing.material as THREE.LineBasicMaterial).color.copy(fillColor);
    (this.fillRing.material as THREE.LineBasicMaterial).opacity = opacity * 0.8;
    (this.bgRing.material as THREE.LineBasicMaterial).opacity = opacity * 0.2;
    (this.ticks.material as THREE.LineBasicMaterial).opacity = opacity * 0.3;

    // Render label at reduced rate
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

    const bigSize = Math.floor(canvas.height * 0.4);
    const smallSize = Math.floor(canvas.height * 0.2);
    const primaryHex = '#' + this.palette.primary.getHexString();
    const dimHex = '#' + this.palette.dim.getHexString();

    // Value percentage with phosphor glow
    ctx.font = `bold ${bigSize}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const pct = Math.round(Math.min(this.value, 1) * 100);
    const valueColor = this.value > 0.9 ? '#' + this.palette.alert.getHexString() : primaryHex;
    drawGlowText(ctx, `${pct}%`, canvas.width / 2, canvas.height * 0.4, valueColor, 6);

    // Label
    ctx.font = `${smallSize}px monospace`;
    drawGlowText(ctx, this.label, canvas.width / 2, canvas.height * 0.72, dimHex, 2);

    this.texture.needsUpdate = true;
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) return;
    if (level >= 5) {
      this.targetValue = 1.0;
    }
    this.velocity += level * (level >= 3 ? 2 : 1);
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'pulse') {
      this.velocity += 3;
    }
    if (action === 'alert') {
      this.targetValue = 1.0;
      this.pulseTimer = 2.0;
    }
  }

  dispose(): void {
    this.texture.dispose();
    super.dispose();
  }
}
