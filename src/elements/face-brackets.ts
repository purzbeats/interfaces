import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';

/**
 * Camera autofocus-style corner brackets that wander and "lock on"
 * to random positions, evoking surveillance footage target tracking.
 */
export class FaceBracketsElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'face-brackets',
    meta: { shape: 'rectangular', roles: ['scanner', 'decorative'], moods: ['tactical', 'ambient'], sizes: ['needs-medium', 'needs-large'], bandAffinity: 'mid' },
  };
  private bracketGroups: THREE.LineSegments[] = [];
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private texture!: THREE.CanvasTexture;
  private labelMesh!: THREE.Mesh;
  private renderAccum: number = 0;
  private bracketCount: number = 0;
  private brackets: Array<{
    x: number; y: number;      // current position (center of bracket box)
    tx: number; ty: number;    // target position
    size: number;              // bracket box size
    locked: boolean;
    lockTimer: number;
    lockDuration: number;
    searchTimer: number;
    speed: number;
  }> = [];
  private regionX: number = 0;
  private regionY: number = 0;
  private regionW: number = 0;
  private regionH: number = 0;
  private bracketArmLen: number = 0;
  private currentLabel: string = 'SCANNING';

  build(): void {
    const variant = this.rng.int(0, 4);
    const presets = [
      { brackets: 3, speed: 40, armScale: 0.12 },   // Standard
      { brackets: 4, speed: 25, armScale: 0.10 },   // Surveillance
      { brackets: 2, speed: 60, armScale: 0.15 },   // Minimal
      { brackets: 4, speed: 70, armScale: 0.09 },   // Paranoid
    ];
    const p = presets[variant];

    this.glitchAmount = 5;
    const { x, y, w, h } = this.px;
    this.regionX = x;
    this.regionY = y;
    this.regionW = w;
    this.regionH = h;
    this.bracketCount = p.brackets;
    this.bracketArmLen = Math.min(w, h) * p.armScale;

    // Create bracket line segments
    for (let i = 0; i < this.bracketCount; i++) {
      // 4 corner L-shapes, each has 2 segments = 4 vertices, total 16 vertices
      const verts = new Float32Array(16 * 3);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
      const bracket = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
        color: this.palette.primary,
        transparent: true,
        opacity: 0,
      }));
      this.group.add(bracket);
      this.bracketGroups.push(bracket);

      const bx = x + this.rng.float(w * 0.1, w * 0.9);
      const by = y + this.rng.float(h * 0.1, h * 0.9);
      this.brackets.push({
        x: bx, y: by,
        tx: x + this.rng.float(w * 0.15, w * 0.85),
        ty: y + this.rng.float(h * 0.15, h * 0.85),
        size: this.bracketArmLen * 2,
        locked: false,
        lockTimer: 0,
        lockDuration: this.rng.float(1, 6),
        searchTimer: this.rng.float(0.5, 3),
        speed: p.speed + this.rng.float(-10, 10),
      });
    }

    // Label canvas
    const scale = Math.min(2, window.devicePixelRatio);
    const labelW = w * 0.4;
    const labelH = Math.max(14, h * 0.05);
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
    this.labelMesh.position.set(x + w / 2, y + h - labelH, 2);
    this.group.add(this.labelMesh);
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    const { regionX: rx, regionY: ry, regionW: rw, regionH: rh } = this;

    let anyLocked = false;

    for (let i = 0; i < this.bracketCount; i++) {
      const b = this.brackets[i];

      if (b.locked) {
        anyLocked = true;
        b.lockTimer -= dt;
        if (b.lockTimer <= 0) {
          b.locked = false;
          b.tx = rx + this.rng.float(rw * 0.15, rw * 0.85);
          b.ty = ry + this.rng.float(rh * 0.15, rh * 0.85);
          b.searchTimer = this.rng.float(0.5, 3);
        }
      } else {
        // Move toward target
        const dx = b.tx - b.x;
        const dy = b.ty - b.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < 3) {
          b.searchTimer -= dt;
          if (b.searchTimer <= 0) {
            // Lock on
            b.locked = true;
            b.lockTimer = b.lockDuration;
            b.lockDuration = this.rng.float(1, 6);
          }
        } else {
          const step = Math.min(b.speed * dt, dist);
          b.x += (dx / dist) * step;
          b.y += (dy / dist) * step;
        }

        // Retarget occasionally
        if (dist < 5 && !b.locked) {
          b.tx = rx + this.rng.float(rw * 0.15, rw * 0.85);
          b.ty = ry + this.rng.float(rh * 0.15, rh * 0.85);
        }
      }

      // Update bracket geometry
      const arm = b.locked ? this.bracketArmLen * (0.8 + 0.2 * Math.sin(time * 8)) : this.bracketArmLen;
      const halfSize = b.size / 2;
      const pos = this.bracketGroups[i].geometry.getAttribute('position') as THREE.BufferAttribute;

      // 4 corners: TL, TR, BR, BL — each has 2 segments (horizontal + vertical arm)
      const corners = [
        { cx: b.x - halfSize, cy: b.y - halfSize, dx: 1, dy: 1 },   // TL
        { cx: b.x + halfSize, cy: b.y - halfSize, dx: -1, dy: 1 },  // TR
        { cx: b.x + halfSize, cy: b.y + halfSize, dx: -1, dy: -1 }, // BR
        { cx: b.x - halfSize, cy: b.y + halfSize, dx: 1, dy: -1 },  // BL
      ];

      for (let c = 0; c < 4; c++) {
        const { cx, cy, dx, dy } = corners[c];
        const vi = c * 4;
        // Horizontal arm
        pos.setXYZ(vi,     cx, cy, 1);
        pos.setXYZ(vi + 1, cx + dx * arm, cy, 1);
        // Vertical arm
        pos.setXYZ(vi + 2, cx, cy, 1);
        pos.setXYZ(vi + 3, cx, cy + dy * arm, 1);
      }
      pos.needsUpdate = true;

      const mat = this.bracketGroups[i].material as THREE.LineBasicMaterial;
      mat.opacity = opacity * (b.locked ? 0.9 : 0.6);
      mat.color.copy(b.locked ? this.palette.alert : this.palette.primary);
    }

    // Label
    this.currentLabel = anyLocked ? 'TRACKING' : 'SCANNING';
    if (this.brackets.some(b => b.locked && b.lockTimer < 0.5)) {
      this.currentLabel = 'IDENTIFIED';
    }
    if (!anyLocked && this.brackets.every(b => {
      const dx = b.tx - b.x;
      const dy = b.ty - b.y;
      return Math.sqrt(dx * dx + dy * dy) > 20;
    })) {
      this.currentLabel = 'SUBJECT LOST';
    }

    this.renderAccum += dt;
    if (this.renderAccum >= 1 / 10) {
      this.renderAccum = 0;
      const { ctx, canvas } = this;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const hex = '#' + (anyLocked ? this.palette.alert : this.palette.primary).getHexString();
      const heightSize = Math.floor(canvas.height * 0.7);
      const widthSize = Math.floor(canvas.width / (this.currentLabel.length * 0.62));
      const fontSize = Math.max(6, Math.min(heightSize, widthSize));
      ctx.font = `${fontSize}px monospace`;
      ctx.fillStyle = hex;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(this.currentLabel, canvas.width / 2, canvas.height / 2);
      this.texture.needsUpdate = true;
    }
    (this.labelMesh.material as THREE.MeshBasicMaterial).opacity = opacity * 0.7;
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) return;
    if (level >= 3) {
      // Rapid cycling
      for (const b of this.brackets) {
        b.speed *= 1 + level * 0.3;
        b.searchTimer = 0.1;
      }
    }
    if (level >= 5) {
      // Lock all
      for (const b of this.brackets) {
        b.locked = true;
        b.lockTimer = 2;
      }
    }
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      for (const b of this.brackets) {
        b.x += this.rng.float(-30, 30);
        b.y += this.rng.float(-30, 30);
      }
    }
    if (action === 'alert') {
      for (const b of this.brackets) {
        b.locked = true;
        b.lockTimer = 3;
      }
    }
  }

  dispose(): void {
    this.texture.dispose();
    super.dispose();
  }
}
