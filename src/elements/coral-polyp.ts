import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

interface PolypPreset {
  maxPolyps: number;
  budInterval: number;
  branchAngle: number;
  tentacleLength: number;
}

interface Polyp {
  x: number;
  y: number;
  parentIdx: number;
  generation: number;
  growthProgress: number;
  angle: number;       // direction from parent
  branchLength: number;
  tentaclePhase: number;
}

/**
 * Coral polyp colony growth. Individual polyps bud and grow outward.
 * Branching or encrusting forms depending on preset. Growth animation.
 * Line geometry rendering.
 */
export class CoralPolypElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'coral-polyp',
    meta: {
      shape: 'rectangular',
      roles: ['decorative'],
      moods: ['ambient'],
      sizes: ['needs-medium', 'needs-large'],
      bandAffinity: 'mid',
    } satisfies ElementMeta,
  };

  private branchLines!: THREE.LineSegments;
  private branchMat!: THREE.LineBasicMaterial;
  private tentacleLines!: THREE.LineSegments;
  private tentacleMat!: THREE.LineBasicMaterial;
  private polypPoints!: THREE.Points;
  private polypMat!: THREE.PointsMaterial;

  private polyps: Polyp[] = [];
  private maxPolyps = 60;
  private budInterval = 0.8;
  private budTimer = 0;
  private branchAngle = 0.6;
  private tentacleLength = 8;
  private maxBranchSegments = 0;
  private maxTentacleSegments = 0;
  private intensityLevel = 0;

  private baseX = 0;
  private baseY = 0;

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;

    const variant = this.rng.int(0, 4);
    const presets: PolypPreset[] = [
      { maxPolyps: 60,  budInterval: 0.8, branchAngle: 0.6, tentacleLength: 8 },  // Branching
      { maxPolyps: 100, budInterval: 0.4, branchAngle: 0.3, tentacleLength: 5 },  // Dense encrusting
      { maxPolyps: 40,  budInterval: 1.2, branchAngle: 0.9, tentacleLength: 12 }, // Sparse branching
      { maxPolyps: 80,  budInterval: 0.6, branchAngle: 0.5, tentacleLength: 10 }, // Elkhorn-like
    ];
    const p = presets[variant];
    this.maxPolyps = p.maxPolyps;
    this.budInterval = p.budInterval;
    this.branchAngle = p.branchAngle;
    this.tentacleLength = p.tentacleLength * Math.min(w, h) / 200;

    this.baseX = x + w / 2;
    this.baseY = y + h * 0.85;

    // Seed polyp
    this.polyps.push({
      x: this.baseX,
      y: this.baseY,
      parentIdx: -1,
      generation: 0,
      growthProgress: 1,
      angle: -Math.PI / 2, // grow upward
      branchLength: h * 0.05,
      tentaclePhase: this.rng.float(0, Math.PI * 2),
    });

    // ── Branch lines (parent->child connections) ──
    this.maxBranchSegments = this.maxPolyps;
    const branchPos = new Float32Array(this.maxBranchSegments * 2 * 3);
    for (let i = 0; i < branchPos.length; i++) branchPos[i] = 0;
    const branchGeo = new THREE.BufferGeometry();
    branchGeo.setAttribute('position', new THREE.BufferAttribute(branchPos, 3));
    branchGeo.setDrawRange(0, 0);
    this.branchMat = new THREE.LineBasicMaterial({
      color: this.palette.secondary,
      transparent: true,
      opacity: 0,
    });
    this.branchLines = new THREE.LineSegments(branchGeo, this.branchMat);
    this.group.add(this.branchLines);

    // ── Tentacle lines (small lines at each polyp) ──
    const tentaclesPerPolyp = 6;
    this.maxTentacleSegments = this.maxPolyps * tentaclesPerPolyp;
    const tentPos = new Float32Array(this.maxTentacleSegments * 2 * 3);
    for (let i = 0; i < tentPos.length; i++) tentPos[i] = 0;
    const tentGeo = new THREE.BufferGeometry();
    tentGeo.setAttribute('position', new THREE.BufferAttribute(tentPos, 3));
    tentGeo.setDrawRange(0, 0);
    this.tentacleMat = new THREE.LineBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
    });
    this.tentacleLines = new THREE.LineSegments(tentGeo, this.tentacleMat);
    this.group.add(this.tentacleLines);

    // ── Polyp center points ──
    const polypPos = new Float32Array(this.maxPolyps * 3);
    for (let i = 0; i < polypPos.length; i++) polypPos[i] = 0;
    const polypGeo = new THREE.BufferGeometry();
    polypGeo.setAttribute('position', new THREE.BufferAttribute(polypPos, 3));
    polypGeo.setDrawRange(0, 0);
    this.polypMat = new THREE.PointsMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
      size: Math.max(3, Math.min(w, h) * 0.015),
      sizeAttenuation: false,
    });
    this.polypPoints = new THREE.Points(polypGeo, this.polypMat);
    this.group.add(this.polypPoints);

    this.budTimer = this.rng.float(0, this.budInterval);
  }

  private budNewPolyp(): void {
    if (this.polyps.length >= this.maxPolyps) return;

    // Pick a random existing polyp to bud from (prefer newer/higher gen)
    const weights = this.polyps.map((p) => p.growthProgress >= 0.8 ? 1 : 0.1);
    const parentIdx = this.rng.weighted(weights);
    const parent = this.polyps[parentIdx];

    const angleOffset = this.rng.float(-this.branchAngle, this.branchAngle);
    const newAngle = parent.angle + angleOffset;
    const branchLen = parent.branchLength * this.rng.float(0.7, 1.0);

    const newX = parent.x + Math.cos(newAngle) * branchLen;
    const newY = parent.y + Math.sin(newAngle) * branchLen;

    // Avoid growing too far from bounds
    const { x, y, w, h } = this.px;
    if (newX < x + 5 || newX > x + w - 5 || newY < y + 5 || newY > y + h - 5) return;

    this.polyps.push({
      x: newX,
      y: newY,
      parentIdx,
      generation: parent.generation + 1,
      growthProgress: 0,
      angle: newAngle,
      branchLength: branchLen,
      tentaclePhase: this.rng.float(0, Math.PI * 2),
    });
  }

  private updateGeometry(time: number): void {
    const branchPos = this.branchLines.geometry.getAttribute('position') as THREE.BufferAttribute;
    const tentPos = this.tentacleLines.geometry.getAttribute('position') as THREE.BufferAttribute;
    const polypPos = this.polypPoints.geometry.getAttribute('position') as THREE.BufferAttribute;

    let branchCount = 0;
    let tentCount = 0;
    const tentaclesPerPolyp = 6;

    for (let i = 0; i < this.polyps.length; i++) {
      const polyp = this.polyps[i];
      const prog = polyp.growthProgress;

      // Polyp position
      let px = polyp.x;
      let py = polyp.y;
      if (polyp.parentIdx >= 0 && prog < 1) {
        // Interpolate from parent during growth
        const par = this.polyps[polyp.parentIdx];
        px = par.x + (polyp.x - par.x) * prog;
        py = par.y + (polyp.y - par.y) * prog;
      }

      polypPos.setXYZ(i, px, py, 1);

      // Branch line to parent
      if (polyp.parentIdx >= 0 && branchCount < this.maxBranchSegments) {
        const par = this.polyps[polyp.parentIdx];
        branchPos.setXYZ(branchCount * 2, par.x, par.y, 0.5);
        branchPos.setXYZ(branchCount * 2 + 1, px, py, 0.5);
        branchCount++;
      }

      // Tentacles (only if sufficiently grown)
      if (prog > 0.5 && tentCount + tentaclesPerPolyp <= this.maxTentacleSegments) {
        for (let t = 0; t < tentaclesPerPolyp; t++) {
          const tAngle = (t / tentaclesPerPolyp) * Math.PI * 2;
          const wave = Math.sin(time * 2 + polyp.tentaclePhase + t) * 0.3;
          const tLen = this.tentacleLength * prog * (0.7 + 0.3 * Math.sin(time + polyp.tentaclePhase + t * 0.5));
          tentPos.setXYZ(tentCount * 2, px, py, 0.5);
          tentPos.setXYZ(tentCount * 2 + 1,
            px + Math.cos(tAngle + wave) * tLen,
            py + Math.sin(tAngle + wave) * tLen,
            0.5,
          );
          tentCount++;
        }
      }
    }

    branchPos.needsUpdate = true;
    tentPos.needsUpdate = true;
    polypPos.needsUpdate = true;

    this.branchLines.geometry.setDrawRange(0, branchCount * 2);
    this.tentacleLines.geometry.setDrawRange(0, tentCount * 2);
    this.polypPoints.geometry.setDrawRange(0, this.polyps.length);
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);

    // Grow existing polyps
    for (const polyp of this.polyps) {
      if (polyp.growthProgress < 1) {
        polyp.growthProgress = Math.min(1, polyp.growthProgress + dt * 1.5);
      }
    }

    // Bud new polyps
    const interval = this.budInterval / (1 + this.intensityLevel * 0.4);
    this.budTimer += dt;
    if (this.budTimer >= interval) {
      this.budTimer = 0;
      this.budNewPolyp();
    }

    // Reset when colony is full
    if (this.polyps.length >= this.maxPolyps) {
      // Check if all grown
      const allGrown = this.polyps.every((p) => p.growthProgress >= 1);
      if (allGrown) {
        this.budTimer += dt * 2; // accelerate reset timer
        if (this.budTimer > 3) {
          // Reset colony
          this.polyps.length = 0;
          this.polyps.push({
            x: this.baseX,
            y: this.baseY,
            parentIdx: -1,
            generation: 0,
            growthProgress: 1,
            angle: -Math.PI / 2,
            branchLength: this.px.h * 0.05,
            tentaclePhase: this.rng.float(0, Math.PI * 2),
          });
          this.budTimer = 0;
        }
      }
    }

    this.updateGeometry(time);

    this.branchMat.opacity = opacity * 0.6;
    this.tentacleMat.opacity = opacity * 0.8;
    this.polypMat.opacity = opacity;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Force-bud multiple polyps at once
      for (let i = 0; i < 5; i++) {
        this.budNewPolyp();
      }
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    this.intensityLevel = level;
    if (level >= 3) {
      // Burst growth
      for (let i = 0; i < level; i++) {
        this.budNewPolyp();
      }
    }
  }
}
