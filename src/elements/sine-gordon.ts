import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Sine-Gordon soliton equation visualization. Kink and anti-kink solitons
 * propagate and collide on a 1D field rendered as a 3D ribbon surface.
 * The field value maps to ribbon height and twist.
 */
export class SineGordonElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'sine-gordon',
    meta: {
      shape: 'rectangular',
      roles: ['data-display', 'decorative'],
      moods: ['diagnostic', 'ambient'],
      bandAffinity: 'sub',
      sizes: ['needs-medium', 'needs-large'],
    } satisfies ElementMeta,
  };

  private ribbonMesh!: THREE.Mesh;
  private ribbonPositions!: Float32Array;
  private ribbonMat!: THREE.MeshBasicMaterial;
  private outlineLine!: THREE.Line;
  private outlinePositions!: Float32Array;
  private outlineMat!: THREE.LineBasicMaterial;
  private borderLines!: THREE.LineSegments;
  private borderMat!: THREE.LineBasicMaterial;

  private gridN: number = 0;
  private ribbonSlices: number = 0;
  private field!: Float64Array;
  private fieldPrev!: Float64Array;
  private dx: number = 0;
  private dtSim: number = 0;
  private stepsPerFrame: number = 0;
  private ribbonWidth: number = 0;
  private heightScale: number = 0;
  private intensityLevel: number = 0;

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;
    const variant = this.rng.int(0, 3);
    const presets = [
      { n: 200, slices: 8, steps: 4, solitons: 2, speed: 0.6 },
      { n: 300, slices: 12, steps: 6, solitons: 3, speed: 0.4 },
      { n: 160, slices: 6, steps: 3, solitons: 1, speed: 0.8 },
      { n: 250, slices: 10, steps: 5, solitons: 4, speed: 0.5 },
    ];
    const p = presets[variant];

    this.gridN = p.n;
    this.ribbonSlices = p.slices;
    this.stepsPerFrame = p.steps;
    this.dx = 1.0 / p.n;
    this.dtSim = 0.4 * this.dx;
    this.ribbonWidth = h * 0.08;
    this.heightScale = h * 0.3;

    // Initialize field with soliton(s)
    this.field = new Float64Array(this.gridN);
    this.fieldPrev = new Float64Array(this.gridN);

    for (let s = 0; s < p.solitons; s++) {
      const center = (s + 1) / (p.solitons + 1);
      const direction = s % 2 === 0 ? 1 : -1;
      const v = p.speed * direction * (0.5 + 0.5 * this.rng.next());
      const gamma = 1.0 / Math.sqrt(1 - v * v);
      for (let i = 0; i < this.gridN; i++) {
        const xn = (i / this.gridN - center) * 10;
        const kink = 4 * Math.atan(Math.exp(gamma * xn));
        this.field[i] += kink;
        this.fieldPrev[i] += kink;
      }
    }

    // Create ribbon mesh: gridN x ribbonSlices vertices
    const vertCount = this.gridN * this.ribbonSlices;
    this.ribbonPositions = new Float32Array(vertCount * 3);
    const indices: number[] = [];
    for (let i = 0; i < this.gridN - 1; i++) {
      for (let j = 0; j < this.ribbonSlices - 1; j++) {
        const a = i * this.ribbonSlices + j;
        const b = a + 1;
        const c = (i + 1) * this.ribbonSlices + j;
        const d = c + 1;
        indices.push(a, b, c, b, d, c);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.ribbonPositions, 3));
    geo.setIndex(indices);
    this.ribbonMat = new THREE.MeshBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      wireframe: true,
      depthWrite: false,
    });
    this.ribbonMesh = new THREE.Mesh(geo, this.ribbonMat);
    this.group.add(this.ribbonMesh);

    // Center line
    this.outlinePositions = new Float32Array(this.gridN * 3);
    const outGeo = new THREE.BufferGeometry();
    outGeo.setAttribute('position', new THREE.BufferAttribute(this.outlinePositions, 3));
    this.outlineMat = new THREE.LineBasicMaterial({
      color: this.palette.secondary,
      transparent: true,
      opacity: 0,
    });
    this.outlineLine = new THREE.Line(outGeo, this.outlineMat);
    this.group.add(this.outlineLine);

    // Border
    const bv = new Float32Array([
      x, y, 0, x + w, y, 0, x + w, y, 0, x + w, y + h, 0,
      x + w, y + h, 0, x, y + h, 0, x, y + h, 0, x, y, 0,
    ]);
    const bGeo = new THREE.BufferGeometry();
    bGeo.setAttribute('position', new THREE.BufferAttribute(bv, 3));
    this.borderMat = new THREE.LineBasicMaterial({
      color: this.palette.dim, transparent: true, opacity: 0,
    });
    this.borderLines = new THREE.LineSegments(bGeo, this.borderMat);
    this.group.add(this.borderLines);
  }

  private simulate(): void {
    const n = this.gridN;
    const r2 = (this.dtSim * this.dtSim) / (this.dx * this.dx);
    const dt2 = this.dtSim * this.dtSim;
    const newField = new Float64Array(n);

    for (let i = 1; i < n - 1; i++) {
      const laplacian = this.field[i + 1] - 2 * this.field[i] + this.field[i - 1];
      newField[i] = 2 * this.field[i] - this.fieldPrev[i] + r2 * laplacian - dt2 * Math.sin(this.field[i]);
    }
    // Periodic boundaries
    const lap0 = this.field[1] - 2 * this.field[0] + this.field[n - 1];
    newField[0] = 2 * this.field[0] - this.fieldPrev[0] + r2 * lap0 - dt2 * Math.sin(this.field[0]);
    const lapN = this.field[0] - 2 * this.field[n - 1] + this.field[n - 2];
    newField[n - 1] = 2 * this.field[n - 1] - this.fieldPrev[n - 1] + r2 * lapN - dt2 * Math.sin(this.field[n - 1]);

    this.fieldPrev.set(this.field);
    this.field.set(newField);
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    const { x, y, w, h } = this.px;

    for (let s = 0; s < this.stepsPerFrame; s++) {
      this.simulate();
    }

    const centerY = y + h / 2;

    // Update ribbon mesh
    for (let i = 0; i < this.gridN; i++) {
      const xp = x + (i / (this.gridN - 1)) * w;
      const val = this.field[i];
      const ht = (Math.sin(val) * this.heightScale) * 0.5;

      for (let j = 0; j < this.ribbonSlices; j++) {
        const t = (j / (this.ribbonSlices - 1)) - 0.5;
        const twist = val * 0.3;
        const cosT = Math.cos(twist);
        const sinT = Math.sin(twist);
        const localY = t * this.ribbonWidth;

        const vi = (i * this.ribbonSlices + j) * 3;
        this.ribbonPositions[vi] = xp;
        this.ribbonPositions[vi + 1] = centerY + ht + localY * cosT;
        this.ribbonPositions[vi + 2] = localY * sinT * 0.5;
      }

      // Outline (center line)
      this.outlinePositions[i * 3] = xp;
      this.outlinePositions[i * 3 + 1] = centerY + ht;
      this.outlinePositions[i * 3 + 2] = 0.1;
    }

    const rPos = this.ribbonMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    rPos.needsUpdate = true;
    this.ribbonMesh.geometry.computeBoundingSphere();
    const oPos = this.outlineLine.geometry.getAttribute('position') as THREE.BufferAttribute;
    oPos.needsUpdate = true;

    this.ribbonMat.opacity = opacity * 0.5;
    this.outlineMat.opacity = opacity * 0.8;
    this.borderMat.opacity = opacity * 0.2;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Inject a new kink at a random position
      const center = this.rng.float(0.2, 0.8);
      for (let i = 0; i < this.gridN; i++) {
        const xn = (i / this.gridN - center) * 10;
        this.field[i] += 4 * Math.atan(Math.exp(xn));
      }
    }
    if (action === 'pulse') {
      // Perturbation wave
      for (let i = 0; i < this.gridN; i++) {
        this.field[i] += 0.5 * Math.sin(i * 0.2);
      }
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    this.intensityLevel = level;
    if (level === 0) {
      this.stepsPerFrame = 4;
      return;
    }
    this.stepsPerFrame = 4 + level * 2;
  }
}
