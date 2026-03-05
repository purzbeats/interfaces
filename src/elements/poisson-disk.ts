import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Poisson disk sampling via Bridson's algorithm. Points appear progressively
 * with guaranteed minimum distance. Rejected candidates shown briefly.
 */
export class PoissonDiskElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'poisson-disk',
    meta: {
      shape: 'rectangular',
      roles: ['data-display', 'decorative'],
      moods: ['diagnostic', 'ambient'],
      sizes: ['needs-medium', 'needs-large'],
      bandAffinity: 'high',
    } satisfies ElementMeta,
  };

  private acceptedPoints!: THREE.Points;
  private candidatePoints!: THREE.Points;

  private accepted: Array<{ x: number; y: number }> = [];
  private activeList: number[] = [];
  private candidates: Array<{ x: number; y: number; life: number }> = [];
  private maxPoints = 500;

  private minDist = 15;
  private candidatesPerStep = 30;
  private placeRate = 20;
  private pointSize = 3;

  // Grid for fast spatial lookup
  private gridCellSize = 0;
  private gridW = 0;
  private gridH = 0;
  private grid!: Int32Array;

  private regionX = 0;
  private regionY = 0;
  private regionW = 0;
  private regionH = 0;
  private placeAccum = 0;
  private complete = false;
  private restartTimer = 0;
  private intensityLevel = 0;

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;
    this.regionX = x;
    this.regionY = y;
    this.regionW = w;
    this.regionH = h;

    const variant = this.rng.int(0, 3);
    const presets = [
      [15, 30, 20, 3], [8, 30, 40, 2], [25, 20, 10, 4], [12, 40, 35, 2.5],
    ];
    const [md, cps, pr, ps] = presets[variant];
    this.minDist = md * Math.min(w, h) / 200;
    this.candidatesPerStep = cps;
    this.placeRate = pr;
    this.pointSize = ps;

    this.maxPoints = Math.floor((w * h) / (this.minDist * this.minDist * 0.8));
    this.maxPoints = Math.min(this.maxPoints, 800);

    this.initGrid();

    const acceptedPos = new Float32Array(this.maxPoints * 3);
    const acceptedGeo = new THREE.BufferGeometry();
    acceptedGeo.setAttribute('position', new THREE.BufferAttribute(acceptedPos, 3));
    acceptedGeo.setDrawRange(0, 0);
    this.acceptedPoints = new THREE.Points(acceptedGeo, new THREE.PointsMaterial({
      color: this.palette.primary,
      size: this.pointSize,
      transparent: true,
      opacity: 0,
      sizeAttenuation: false,
    }));
    this.group.add(this.acceptedPoints);

    const maxCandidates = 60;
    const candidatePos = new Float32Array(maxCandidates * 3);
    for (let i = 0; i < maxCandidates * 3; i++) candidatePos[i] = 0;
    const candidateGeo = new THREE.BufferGeometry();
    candidateGeo.setAttribute('position', new THREE.BufferAttribute(candidatePos, 3));
    candidateGeo.setDrawRange(0, 0);
    this.candidatePoints = new THREE.Points(candidateGeo, new THREE.PointsMaterial({
      color: this.palette.dim,
      size: 2,
      transparent: true,
      opacity: 0,
      sizeAttenuation: false,
    }));
    this.group.add(this.candidatePoints);

    // Seed after Points meshes exist (addPoint updates acceptedPoints geometry)
    this.seedFirstPoint();
  }

  private initGrid(): void {
    this.gridCellSize = this.minDist / Math.SQRT2;
    this.gridW = Math.ceil(this.regionW / this.gridCellSize);
    this.gridH = Math.ceil(this.regionH / this.gridCellSize);
    this.grid = new Int32Array(this.gridW * this.gridH);
    this.grid.fill(-1);
  }

  private seedFirstPoint(): void {
    this.accepted = [];
    this.activeList = [];
    this.candidates = [];
    this.complete = false;
    this.grid.fill(-1);

    const px = this.regionX + this.rng.float(this.regionW * 0.3, this.regionW * 0.7);
    const py = this.regionY + this.rng.float(this.regionH * 0.3, this.regionH * 0.7);
    this.addPoint(px, py);
  }

  private addPoint(px: number, py: number): void {
    const idx = this.accepted.length;
    this.accepted.push({ x: px, y: py });
    this.activeList.push(idx);

    const gx = Math.floor((px - this.regionX) / this.gridCellSize);
    const gy = Math.floor((py - this.regionY) / this.gridCellSize);
    if (gx >= 0 && gx < this.gridW && gy >= 0 && gy < this.gridH) {
      this.grid[gy * this.gridW + gx] = idx;
    }

    // Update accepted positions buffer
    const posAttr = this.acceptedPoints.geometry.getAttribute('position') as THREE.BufferAttribute;
    if (idx < this.maxPoints) {
      posAttr.setXYZ(idx, px, py, 0.5);
      posAttr.needsUpdate = true;
      this.acceptedPoints.geometry.setDrawRange(0, idx + 1);
    }
  }

  private isValid(px: number, py: number): boolean {
    if (px < this.regionX || px > this.regionX + this.regionW) return false;
    if (py < this.regionY || py > this.regionY + this.regionH) return false;

    const gx = Math.floor((px - this.regionX) / this.gridCellSize);
    const gy = Math.floor((py - this.regionY) / this.gridCellSize);
    const searchRadius = 2;

    for (let dy = -searchRadius; dy <= searchRadius; dy++) {
      for (let dx = -searchRadius; dx <= searchRadius; dx++) {
        const nx = gx + dx;
        const ny = gy + dy;
        if (nx < 0 || nx >= this.gridW || ny < 0 || ny >= this.gridH) continue;
        const neighbor = this.grid[ny * this.gridW + nx];
        if (neighbor >= 0) {
          const ddx = px - this.accepted[neighbor].x;
          const ddy = py - this.accepted[neighbor].y;
          if (ddx * ddx + ddy * ddy < this.minDist * this.minDist) return false;
        }
      }
    }
    return true;
  }

  private stepBridson(): void {
    if (this.activeList.length === 0 || this.accepted.length >= this.maxPoints) {
      this.complete = true;
      return;
    }

    const activeIdx = this.rng.int(0, this.activeList.length - 1);
    const pointIdx = this.activeList[activeIdx];
    const base = this.accepted[pointIdx];
    let found = false;

    for (let k = 0; k < this.candidatesPerStep; k++) {
      const angle = this.rng.float(0, Math.PI * 2);
      const dist = this.rng.float(this.minDist, this.minDist * 2);
      const cx = base.x + Math.cos(angle) * dist;
      const cy = base.y + Math.sin(angle) * dist;

      if (this.isValid(cx, cy)) {
        this.addPoint(cx, cy);
        found = true;
        break;
      } else if (this.candidates.length < 60) {
        this.candidates.push({ x: cx, y: cy, life: 0.3 });
      }
    }

    if (!found) {
      this.activeList.splice(activeIdx, 1);
    }
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);
    const speed = 1 + this.intensityLevel * 0.5;

    if (this.complete) {
      this.restartTimer += dt;
      if (this.restartTimer > 5) {
        this.restartTimer = 0;
        this.initGrid();
        this.seedFirstPoint();
      }
    } else {
      this.placeAccum += dt * this.placeRate * speed;
      while (this.placeAccum >= 1 && !this.complete) {
        this.placeAccum -= 1;
        this.stepBridson();
      }
    }

    // Update candidate points
    const candPos = this.candidatePoints.geometry.getAttribute('position') as THREE.BufferAttribute;
    let candCount = 0;
    for (let i = this.candidates.length - 1; i >= 0; i--) {
      this.candidates[i].life -= dt;
      if (this.candidates[i].life <= 0) {
        this.candidates.splice(i, 1);
      }
    }
    for (let i = 0; i < Math.min(this.candidates.length, 60); i++) {
      candPos.setXYZ(i, this.candidates[i].x, this.candidates[i].y, 0.3);
      candCount++;
    }
    candPos.needsUpdate = true;
    this.candidatePoints.geometry.setDrawRange(0, candCount);

    (this.acceptedPoints.material as THREE.PointsMaterial).opacity = opacity;
    (this.candidatePoints.material as THREE.PointsMaterial).opacity = opacity * 0.3;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      this.initGrid();
      this.seedFirstPoint();
      this.restartTimer = 0;
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    this.intensityLevel = level;
  }
}
