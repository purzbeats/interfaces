import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Lichtenberg figure / electrical discharge tree.
 * Branching lightning bolts grow from a strike point, forking randomly
 * with diminishing brightness — resembling fractal electrical breakdown.
 */
export class LightningTreeElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'lightning-tree',
    meta: { shape: 'rectangular', roles: ['decorative', 'data-display'], moods: ['tactical', 'ambient'], bandAffinity: 'high', audioSensitivity: 1.8, sizes: ['needs-medium', 'needs-large'] },
  };

  private segmentPool = 2000;
  private segPositions!: Float32Array;
  private segColors!: Float32Array;
  private segCount = 0;
  private segMesh!: THREE.LineSegments;

  private strikeTimer = 0;
  private strikeInterval = 1.5;
  private fadeSpeed = 2.5;
  private brightness = 0;
  private flashMesh!: THREE.Mesh;

  private cx = 0;
  private cy = 0;

  build(): void {
    const variant = this.rng.int(0, 3);
    const presets = [
      { pool: 2000, interval: 1.5, fade: 2.5, branchProb: 0.3, depth: 12 },
      { pool: 4000, interval: 0.8, fade: 3.0, branchProb: 0.4, depth: 16 },
      { pool: 800, interval: 2.5, fade: 1.8, branchProb: 0.25, depth: 8 },
      { pool: 3000, interval: 0.5, fade: 4.0, branchProb: 0.5, depth: 14 },
    ];
    const p = presets[variant];
    this.glitchAmount = 6;

    const { x, y, w, h } = this.px;
    this.cx = x + w / 2;
    this.cy = y + h / 2;
    this.segmentPool = p.pool;
    this.strikeInterval = p.interval;
    this.fadeSpeed = p.fade;

    this.segPositions = new Float32Array(this.segmentPool * 6);
    this.segColors = new Float32Array(this.segmentPool * 6);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.segPositions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.segColors, 3));
    geo.setDrawRange(0, 0);

    this.segMesh = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0,
    }));
    this.group.add(this.segMesh);

    // Flash overlay
    const fg = new THREE.PlaneGeometry(w, h);
    this.flashMesh = new THREE.Mesh(fg, new THREE.MeshBasicMaterial({
      color: this.palette.secondary, transparent: true, opacity: 0,
    }));
    this.flashMesh.position.set(x + w / 2, y + h / 2, 0.5);
    this.group.add(this.flashMesh);

    // Initial strike
    this.generateStrike(p.branchProb, p.depth);
    this.brightness = 1;
  }

  private generateStrike(branchProb: number, maxDepth: number): void {
    const { x, y, w, h } = this.px;
    this.segCount = 0;

    // Start from top or a random edge
    const startX = this.cx + this.rng.float(-w * 0.3, w * 0.3);
    const startY = y + 2;

    const pr = this.palette.primary.r;
    const pg = this.palette.primary.g;
    const pb = this.palette.primary.b;
    const sr = this.palette.secondary.r;
    const sg = this.palette.secondary.g;
    const sb = this.palette.secondary.b;

    interface Branch { x: number; y: number; angle: number; depth: number; energy: number; }
    const stack: Branch[] = [{ x: startX, y: startY, angle: Math.PI / 2, depth: 0, energy: 1.0 }];

    while (stack.length > 0 && this.segCount < this.segmentPool) {
      const b = stack.pop()!;
      if (b.depth >= maxDepth || b.energy < 0.05) continue;

      const segLen = this.rng.float(5, 20) * b.energy;
      const jitter = this.rng.float(-0.6, 0.6);
      const angle = b.angle + jitter;

      const ex = b.x + Math.cos(angle) * segLen;
      const ey = b.y + Math.sin(angle) * segLen;

      // Bounds check
      if (ex < x || ex > x + w || ey < y || ey > y + h) continue;

      const idx = this.segCount * 6;
      this.segPositions[idx] = b.x;
      this.segPositions[idx + 1] = b.y;
      this.segPositions[idx + 2] = 0;
      this.segPositions[idx + 3] = ex;
      this.segPositions[idx + 4] = ey;
      this.segPositions[idx + 5] = 0;

      // Color: brighter near trunk, dimmer at tips
      const t = b.energy;
      this.segColors[idx] = sr * t + pr * (1 - t);
      this.segColors[idx + 1] = sg * t + pg * (1 - t);
      this.segColors[idx + 2] = sb * t + pb * (1 - t);
      this.segColors[idx + 3] = sr * t * 0.7 + pr * (1 - t * 0.7);
      this.segColors[idx + 4] = sg * t * 0.7 + pg * (1 - t * 0.7);
      this.segColors[idx + 5] = sb * t * 0.7 + pb * (1 - t * 0.7);

      this.segCount++;

      // Continue main branch
      stack.push({ x: ex, y: ey, angle, depth: b.depth + 1, energy: b.energy * this.rng.float(0.75, 0.95) });

      // Branch?
      if (this.rng.chance(branchProb)) {
        const branchAngle = angle + this.rng.float(0.3, 1.0) * (this.rng.chance(0.5) ? 1 : -1);
        stack.push({ x: ex, y: ey, angle: branchAngle, depth: b.depth + 1, energy: b.energy * this.rng.float(0.4, 0.7) });
      }
    }

    const geo = this.segMesh.geometry;
    (geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (geo.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
    geo.setDrawRange(0, this.segCount * 2);
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);

    this.brightness = Math.max(0, this.brightness - this.fadeSpeed * dt);

    this.strikeTimer -= dt;
    if (this.strikeTimer <= 0) {
      this.strikeTimer = this.strikeInterval * this.rng.float(0.7, 1.3);
      this.generateStrike(0.3, 12);
      this.brightness = 1;
    }

    (this.segMesh.material as THREE.LineBasicMaterial).opacity = opacity * this.brightness;
    (this.flashMesh.material as THREE.MeshBasicMaterial).opacity = opacity * Math.max(0, this.brightness - 0.7) * 0.15;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch' || action === 'alert') {
      this.generateStrike(0.5, 16);
      this.brightness = 1;
    }
    if (action === 'pulse') {
      this.brightness = 1;
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level >= 3) {
      this.strikeInterval = Math.max(0.2, this.strikeInterval * 0.5);
    }
    if (level >= 5) {
      this.generateStrike(0.6, 18);
      this.brightness = 1;
    }
  }
}
