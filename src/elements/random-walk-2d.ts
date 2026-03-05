import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Ensemble of 2D random walkers from a common origin. Shows diffusion
 * spreading: multiple walkers each leave a trail line. Root-mean-square
 * distance grows as sqrt(t). Line geometry with vertex colors.
 */
export class RandomWalk2dElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'random-walk-2d',
    meta: {
      shape: 'rectangular',
      roles: ['data-display', 'decorative'],
      moods: ['ambient', 'diagnostic'],
      bandAffinity: 'sub',
      sizes: ['works-small', 'needs-medium', 'needs-large'],
    } satisfies ElementMeta,
  };

  private walkerCount = 12;
  private trailLength = 200;
  private stepSize = 2;
  private stepsPerSecond = 30;
  private speedMult = 1;
  private accumulator = 0;
  private positionsX!: Float32Array;
  private positionsY!: Float32Array;
  private trailsX!: Float32Array;
  private trailsY!: Float32Array;
  private trailHeads!: Uint32Array;
  private lineMeshes: THREE.Line[] = [];
  private lineMats: THREE.LineBasicMaterial[] = [];
  private borderLines!: THREE.LineSegments;
  private borderMat!: THREE.LineBasicMaterial;
  private rmsMesh!: THREE.Line;
  private rmsMat!: THREE.LineBasicMaterial;
  private cx = 0; private cy = 0;
  private totalSteps = 0;
  private maxSteps = 3000;

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;

    const variant = this.rng.int(0, 3);
    const presets = [
      { walkers: 12, trail: 200, step: 2, sps: 30 },
      { walkers: 24, trail: 150, step: 1.5, sps: 50 },
      { walkers: 6, trail: 400, step: 3, sps: 20 },
      { walkers: 16, trail: 250, step: 2.5, sps: 40 },
    ];
    const p = presets[variant];
    this.walkerCount = p.walkers;
    this.trailLength = p.trail;
    this.stepSize = p.step * Math.min(w, h) / 200;
    this.stepsPerSecond = p.sps;

    this.cx = x + w / 2;
    this.cy = y + h / 2;

    // Initialize walkers at center
    this.positionsX = new Float32Array(this.walkerCount);
    this.positionsY = new Float32Array(this.walkerCount);
    this.trailsX = new Float32Array(this.walkerCount * this.trailLength);
    this.trailsY = new Float32Array(this.walkerCount * this.trailLength);
    this.trailHeads = new Uint32Array(this.walkerCount);

    for (let i = 0; i < this.walkerCount; i++) {
      this.positionsX[i] = this.cx; this.positionsY[i] = this.cy;
      for (let t = 0; t < this.trailLength; t++) { this.trailsX[i * this.trailLength + t] = this.cx; this.trailsY[i * this.trailLength + t] = this.cy; }
    }
    const pri = this.palette.primary; const sec = this.palette.secondary;
    for (let i = 0; i < this.walkerCount; i++) {
      const positions = new Float32Array(this.trailLength * 3);
      for (let t = 0; t < this.trailLength; t++) { positions[t * 3] = this.cx; positions[t * 3 + 1] = this.cy; }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const blend = i / Math.max(1, this.walkerCount - 1);
      const color = new THREE.Color(pri.r * (1 - blend) + sec.r * blend, pri.g * (1 - blend) + sec.g * blend, pri.b * (1 - blend) + sec.b * blend);
      const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0 });
      const line = new THREE.Line(geo, mat);
      this.group.add(line); this.lineMeshes.push(line); this.lineMats.push(mat);
    }

    // Border
    const bv = new Float32Array([
      x, y, 0, x + w, y, 0,
      x + w, y, 0, x + w, y + h, 0,
      x + w, y + h, 0, x, y + h, 0,
      x, y + h, 0, x, y, 0,
    ]);
    const borderGeo = new THREE.BufferGeometry();
    borderGeo.setAttribute('position', new THREE.BufferAttribute(bv, 3));
    this.borderMat = new THREE.LineBasicMaterial({
      color: this.palette.dim, transparent: true, opacity: 0,
    });
    this.borderLines = new THREE.LineSegments(borderGeo, this.borderMat);
    this.group.add(this.borderLines);

    // RMS circle
    const circSegs = 48;
    const circPos = new Float32Array((circSegs + 1) * 3);
    for (let i = 0; i <= circSegs; i++) {
      circPos[i * 3] = this.cx;
      circPos[i * 3 + 1] = this.cy;
      circPos[i * 3 + 2] = 0;
    }
    const circGeo = new THREE.BufferGeometry();
    circGeo.setAttribute('position', new THREE.BufferAttribute(circPos, 3));
    this.rmsMat = new THREE.LineBasicMaterial({
      color: this.palette.dim, transparent: true, opacity: 0,
    });
    this.rmsMesh = new THREE.Line(circGeo, this.rmsMat);
    this.group.add(this.rmsMesh);
  }

  private stepWalkers(): void {
    const { x, y, w, h } = this.px;
    for (let i = 0; i < this.walkerCount; i++) {
      const angle = this.rng.float(0, Math.PI * 2);
      this.positionsX[i] += Math.cos(angle) * this.stepSize;
      this.positionsY[i] += Math.sin(angle) * this.stepSize;

      // Reflect off boundaries
      if (this.positionsX[i] < x) { this.positionsX[i] = x; }
      if (this.positionsX[i] > x + w) { this.positionsX[i] = x + w; }
      if (this.positionsY[i] < y) { this.positionsY[i] = y; }
      if (this.positionsY[i] > y + h) { this.positionsY[i] = y + h; }

      // Record trail
      const head = this.trailHeads[i];
      this.trailsX[i * this.trailLength + head] = this.positionsX[i];
      this.trailsY[i * this.trailLength + head] = this.positionsY[i];
      this.trailHeads[i] = (head + 1) % this.trailLength;
    }
    this.totalSteps++;
  }

  private resetWalkers(): void {
    for (let i = 0; i < this.walkerCount; i++) {
      this.positionsX[i] = this.cx;
      this.positionsY[i] = this.cy;
      for (let t = 0; t < this.trailLength; t++) {
        this.trailsX[i * this.trailLength + t] = this.cx;
        this.trailsY[i * this.trailLength + t] = this.cy;
      }
      this.trailHeads[i] = 0;
    }
    this.totalSteps = 0;
  }

  private updateRmsCircle(): void {
    // Compute RMS distance
    let sumSq = 0;
    for (let i = 0; i < this.walkerCount; i++) {
      const dx = this.positionsX[i] - this.cx;
      const dy = this.positionsY[i] - this.cy;
      sumSq += dx * dx + dy * dy;
    }
    const rms = Math.sqrt(sumSq / this.walkerCount);

    const attr = this.rmsMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const segs = attr.count - 1;
    for (let i = 0; i <= segs; i++) {
      const angle = (i / segs) * Math.PI * 2;
      attr.setXYZ(i, this.cx + Math.cos(angle) * rms, this.cy + Math.sin(angle) * rms, 0);
    }
    attr.needsUpdate = true;
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);

    this.accumulator += dt * this.stepsPerSecond * this.speedMult;
    const steps = Math.floor(this.accumulator);
    this.accumulator -= steps;
    for (let s = 0; s < steps; s++) {
      this.stepWalkers();
    }

    if (this.totalSteps > this.maxSteps) {
      this.resetWalkers();
    }

    // Update line meshes from ring buffers
    for (let i = 0; i < this.walkerCount; i++) {
      const attr = this.lineMeshes[i].geometry.getAttribute('position') as THREE.BufferAttribute;
      const head = this.trailHeads[i];
      for (let t = 0; t < this.trailLength; t++) {
        const ringIdx = (head + t) % this.trailLength;
        attr.setXYZ(t,
          this.trailsX[i * this.trailLength + ringIdx],
          this.trailsY[i * this.trailLength + ringIdx],
          0,
        );
      }
      attr.needsUpdate = true;
      this.lineMats[i].opacity = opacity * 0.5;
    }

    this.updateRmsCircle();

    this.borderMat.opacity = opacity * 0.2;
    this.rmsMat.opacity = opacity * 0.4;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Big random jump for all walkers
      for (let i = 0; i < this.walkerCount; i++) {
        this.positionsX[i] += this.rng.float(-20, 20) * this.stepSize;
        this.positionsY[i] += this.rng.float(-20, 20) * this.stepSize;
      }
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) {
      this.speedMult = 1;
      return;
    }
    this.speedMult = 1 + level * 0.5;
    if (level >= 5) {
      this.resetWalkers();
    }
  }
}
