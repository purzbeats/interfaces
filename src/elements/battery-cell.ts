import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Battery charge indicator with outline, fill bar, and terminal nub.
 * Charge level oscillates between charging and discharging states.
 * Fill color lerps from alert (low) to primary (high).
 */
export class BatteryCellElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'battery-cell',
    meta: {
      shape: 'rectangular',
      roles: ['gauge'],
      moods: ['diagnostic'],
      sizes: ['works-small'],
    },
  };

  private outline!: THREE.LineSegments;
  private nub!: THREE.LineSegments;
  private fillMesh!: THREE.Mesh;
  private fillMat!: THREE.MeshBasicMaterial;
  private segmentLines!: THREE.LineSegments;

  private chargeLevel: number = 0.5;
  private chargeTarget: number = 0.5;
  private chargeSpeed: number = 0.08;
  private cycleTimer: number = 0;
  private cycleInterval: number = 4.0;
  private isCharging: boolean = true;
  private variant: number = 0;
  private hasSegments: boolean = false;
  private segmentCount: number = 5;

  // Cached layout
  private bx: number = 0;
  private by: number = 0;
  private bw: number = 0;
  private bh: number = 0;
  private inset: number = 3;
  private isVertical: boolean = true;

  build(): void {
    this.variant = this.rng.int(0, 3);
    const presets = [
      // 0: Vertical battery, smooth fill, medium speed
      { vertical: true, segments: false, segCount: 0, speed: 0.08, interval: [3.0, 5.0] as const, startCharge: 0.6 },
      // 1: Horizontal battery, segmented fill, slow
      { vertical: false, segments: true, segCount: 5, speed: 0.05, interval: [4.0, 7.0] as const, startCharge: 0.4 },
      // 2: Vertical battery, segmented fill, fast nervous
      { vertical: true, segments: true, segCount: 4, speed: 0.15, interval: [1.5, 3.0] as const, startCharge: 0.3 },
      // 3: Horizontal battery, smooth fill, medium
      { vertical: false, segments: false, segCount: 0, speed: 0.10, interval: [2.5, 4.5] as const, startCharge: 0.7 },
    ];
    const p = presets[this.variant];

    this.isVertical = p.vertical;
    this.hasSegments = p.segments;
    this.segmentCount = p.segCount;
    this.chargeSpeed = p.speed + this.rng.float(-0.02, 0.02);
    this.cycleInterval = this.rng.float(p.interval[0], p.interval[1]);
    this.chargeLevel = p.startCharge + this.rng.float(-0.1, 0.1);
    this.chargeTarget = this.chargeLevel;
    this.isCharging = this.rng.chance(0.5);

    const { x, y, w, h } = this.px;
    const ins = this.inset;

    // Battery body area (leave room for nub)
    if (this.isVertical) {
      const nubH = Math.min(h * 0.08, 6);
      this.bx = x + ins;
      this.by = y + ins + nubH;
      this.bw = w - ins * 2;
      this.bh = h - ins * 2 - nubH;
    } else {
      const nubW = Math.min(w * 0.08, 6);
      this.bx = x + ins;
      this.by = y + ins;
      this.bw = w - ins * 2 - nubW;
      this.bh = h - ins * 2;
    }

    // --- Battery outline ---
    const ov: number[] = [
      this.bx, this.by, 0, this.bx + this.bw, this.by, 0,
      this.bx + this.bw, this.by, 0, this.bx + this.bw, this.by + this.bh, 0,
      this.bx + this.bw, this.by + this.bh, 0, this.bx, this.by + this.bh, 0,
      this.bx, this.by + this.bh, 0, this.bx, this.by, 0,
    ];
    const outGeo = new THREE.BufferGeometry();
    outGeo.setAttribute('position', new THREE.Float32BufferAttribute(ov, 3));
    this.outline = new THREE.LineSegments(outGeo, new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.outline);

    // --- Terminal nub ---
    const nv: number[] = [];
    if (this.isVertical) {
      // Nub on top center
      const nubW = this.bw * 0.3;
      const nubH = Math.min((this.by - y - ins + this.inset), 6);
      const nx = this.bx + this.bw / 2 - nubW / 2;
      const ny = this.by - nubH;
      nv.push(
        nx, ny, 0, nx + nubW, ny, 0,
        nx + nubW, ny, 0, nx + nubW, this.by, 0,
        nx, ny, 0, nx, this.by, 0,
      );
    } else {
      // Nub on right center
      const nubH = this.bh * 0.3;
      const nubW = Math.min(w * 0.08, 6);
      const nx = this.bx + this.bw;
      const ny = this.by + this.bh / 2 - nubH / 2;
      nv.push(
        nx, ny, 0, nx + nubW, ny, 0,
        nx + nubW, ny, 0, nx + nubW, ny + nubH, 0,
        nx, ny + nubH, 0, nx + nubW, ny + nubH, 0,
      );
    }
    const nubGeo = new THREE.BufferGeometry();
    nubGeo.setAttribute('position', new THREE.Float32BufferAttribute(nv, 3));
    this.nub = new THREE.LineSegments(nubGeo, new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.nub);

    // --- Fill rectangle mesh (dynamic size) ---
    const fillGeo = new THREE.PlaneGeometry(1, 1);
    this.fillMat = new THREE.MeshBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
    });
    this.fillMesh = new THREE.Mesh(fillGeo, this.fillMat);
    this.fillMesh.position.z = 0.5;
    this.group.add(this.fillMesh);

    // --- Segment divider lines ---
    if (this.hasSegments && this.segmentCount > 1) {
      const sv: number[] = [];
      const gap = 2;
      for (let i = 1; i < this.segmentCount; i++) {
        const t = i / this.segmentCount;
        if (this.isVertical) {
          const sy = this.by + this.bh - t * this.bh;
          sv.push(
            this.bx + gap, sy, 1, this.bx + this.bw - gap, sy, 1,
          );
        } else {
          const sx = this.bx + t * this.bw;
          sv.push(
            sx, this.by + gap, 1, sx, this.by + this.bh - gap, 1,
          );
        }
      }
      const segGeo = new THREE.BufferGeometry();
      segGeo.setAttribute('position', new THREE.Float32BufferAttribute(sv, 3));
      this.segmentLines = new THREE.LineSegments(segGeo, new THREE.LineBasicMaterial({
        color: this.palette.bg,
        transparent: true,
        opacity: 0,
      }));
      this.group.add(this.segmentLines);
    }
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);

    // Update charge cycle
    this.cycleTimer += dt;
    if (this.cycleTimer >= this.cycleInterval) {
      this.cycleTimer = 0;
      this.cycleInterval = this.rng.float(2.5, 6.0);
      if (this.isCharging) {
        this.chargeTarget = this.rng.float(0.6, 0.95);
      } else {
        this.chargeTarget = this.rng.float(0.05, 0.4);
      }
      this.isCharging = !this.isCharging;
    }

    // Smooth interpolation
    this.chargeLevel += (this.chargeTarget - this.chargeLevel) * this.chargeSpeed * 10 * dt;
    this.chargeLevel = Math.max(0.02, Math.min(1.0, this.chargeLevel));

    // Update fill color: lerp from alert (low) to primary (high)
    const lerpColor = new THREE.Color();
    lerpColor.lerpColors(this.palette.alert, this.palette.primary, this.chargeLevel);
    this.fillMat.color.copy(lerpColor);

    // Update fill mesh size and position
    const gap = 2;
    if (this.isVertical) {
      const fillH = (this.bh - gap * 2) * this.chargeLevel;
      const fillW = this.bw - gap * 2;
      this.fillMesh.scale.set(fillW, fillH, 1);
      this.fillMesh.position.set(
        this.bx + this.bw / 2,
        this.by + this.bh - gap - fillH / 2,
        0.5,
      );
    } else {
      const fillW = (this.bw - gap * 2) * this.chargeLevel;
      const fillH = this.bh - gap * 2;
      this.fillMesh.scale.set(fillW, fillH, 1);
      this.fillMesh.position.set(
        this.bx + gap + fillW / 2,
        this.by + this.bh / 2,
        0.5,
      );
    }

    // Opacities
    this.fillMat.opacity = opacity * 0.5;
    (this.outline.material as THREE.LineBasicMaterial).opacity = opacity * 0.6;
    (this.nub.material as THREE.LineBasicMaterial).opacity = opacity * 0.5;
    if (this.hasSegments && this.segmentLines) {
      (this.segmentLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.7;
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) return;
    if (level >= 4) {
      this.chargeTarget = this.rng.float(0.02, 0.15);
      this.isCharging = false;
    }
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'alert') {
      this.chargeTarget = 0.05;
      this.isCharging = false;
    }
    if (action === 'pulse') {
      this.chargeTarget = Math.min(1.0, this.chargeLevel + 0.2);
    }
  }
}
