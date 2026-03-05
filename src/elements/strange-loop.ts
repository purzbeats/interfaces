import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Penrose impossible triangle rendered as an animated 3D-ish wireframe.
 * The rotating perspective creates the illusion of impossible geometry,
 * with vertices connected in ways that defy spatial logic.
 */
export class StrangeLoopElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'strange-loop',
    meta: {
      shape: 'radial',
      roles: ['decorative'],
      moods: ['ambient'],
      sizes: ['needs-medium', 'needs-large'],
    } satisfies ElementMeta,
  };

  private lines!: THREE.LineSegments;
  private linePositions!: Float32Array;
  private lineMat!: THREE.LineBasicMaterial;
  private accentLines!: THREE.LineSegments;
  private accentPositions!: Float32Array;
  private accentMat!: THREE.LineBasicMaterial;
  private borderLines!: THREE.LineSegments;
  private borderMat!: THREE.LineBasicMaterial;

  private cx: number = 0;
  private cy: number = 0;
  private scale: number = 0;
  private rotSpeed: number = 0;
  private barCount: number = 0;
  private morphSpeed: number = 0;
  private morphAmp: number = 0;
  private intensityLevel: number = 0;

  // Penrose triangle vertices in 2D (pseudo-3D projection)
  private triVerts: { x: number; y: number }[] = [];
  private segCount: number = 0;

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;
    this.cx = x + w / 2;
    this.cy = y + h / 2;
    this.scale = Math.min(w, h) * 0.38;

    const variant = this.rng.int(0, 3);
    const presets = [
      { rot: 0.15, bars: 6, morph: 0.3, mAmp: 0.08 },
      { rot: 0.08, bars: 10, morph: 0.5, mAmp: 0.12 },
      { rot: 0.25, bars: 4, morph: 0.2, mAmp: 0.05 },
      { rot: -0.12, bars: 8, morph: 0.4, mAmp: 0.15 },
    ];
    const p = presets[variant];
    this.rotSpeed = p.rot;
    this.barCount = p.bars;
    this.morphSpeed = p.morph;
    this.morphAmp = p.mAmp;

    // Build Penrose triangle outline segments
    // Three sides, each subdivided into barCount segments, with thickness
    const segsPerSide = this.barCount;
    this.segCount = segsPerSide * 3;
    const totalLineVerts = this.segCount * 4 * 2; // 4 lines per bar segment, 2 verts each
    this.linePositions = new Float32Array(totalLineVerts * 3);
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.BufferAttribute(this.linePositions, 3));
    this.lineMat = new THREE.LineBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
    });
    this.lines = new THREE.LineSegments(lineGeo, this.lineMat);
    this.group.add(this.lines);

    // Accent inner triangle
    this.accentPositions = new Float32Array(6 * 3); // 3 line segments
    const accentGeo = new THREE.BufferGeometry();
    accentGeo.setAttribute('position', new THREE.BufferAttribute(this.accentPositions, 3));
    this.accentMat = new THREE.LineBasicMaterial({
      color: this.palette.secondary,
      transparent: true,
      opacity: 0,
    });
    this.accentLines = new THREE.LineSegments(accentGeo, this.accentMat);
    this.group.add(this.accentLines);

    // Border
    const bv = new Float32Array([
      x, y, 0, x + w, y, 0, x + w, y, 0, x + w, y + h, 0,
      x + w, y + h, 0, x, y + h, 0, x, y + h, 0, x, y, 0,
    ]);
    const borderGeo = new THREE.BufferGeometry();
    borderGeo.setAttribute('position', new THREE.BufferAttribute(bv, 3));
    this.borderMat = new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    });
    this.borderLines = new THREE.LineSegments(borderGeo, this.borderMat);
    this.group.add(this.borderLines);
  }

  private project3D(px: number, py: number, pz: number, angle: number): { x: number; y: number } {
    // Rotate around Y axis
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);
    const rx = px * cosA - pz * sinA;
    const rz = px * sinA + pz * cosA;
    // Simple perspective
    const perspective = 1.0 / (1.0 + rz * 0.15);
    return { x: this.cx + rx * this.scale * perspective, y: this.cy + py * this.scale * perspective };
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    const angle = time * this.rotSpeed;
    const morph = Math.sin(time * this.morphSpeed) * this.morphAmp;

    // Penrose triangle: three vertices of equilateral triangle
    const triAngles = [
      -Math.PI / 2,
      -Math.PI / 2 + (2 * Math.PI / 3),
      -Math.PI / 2 + (4 * Math.PI / 3),
    ];

    const outerR = 1.0 + morph;
    const innerR = 0.5 + morph * 0.5;
    const thickness = 0.15;

    // Generate outer and inner triangle vertices
    const outer: { x: number; y: number; z: number }[] = [];
    const inner: { x: number; y: number; z: number }[] = [];

    for (let i = 0; i < 3; i++) {
      const a = triAngles[i] + angle * 0.3;
      // The "impossible" part: each vertex has a different Z depth
      const z = Math.sin(angle + i * (2 * Math.PI / 3)) * 0.3;
      outer.push({
        x: Math.cos(a) * outerR,
        y: Math.sin(a) * outerR,
        z: z,
      });
      inner.push({
        x: Math.cos(a) * innerR,
        y: Math.sin(a) * innerR,
        z: -z,
      });
    }

    let vi = 0;
    const segsPerSide = this.barCount;

    for (let side = 0; side < 3; side++) {
      const nextSide = (side + 1) % 3;
      for (let s = 0; s < segsPerSide; s++) {
        const t0 = s / segsPerSide;
        const t1 = (s + 1) / segsPerSide;

        // Outer edge points
        const ox0 = outer[side].x + (outer[nextSide].x - outer[side].x) * t0;
        const oy0 = outer[side].y + (outer[nextSide].y - outer[side].y) * t0;
        const oz0 = outer[side].z + (outer[nextSide].z - outer[side].z) * t0;
        const ox1 = outer[side].x + (outer[nextSide].x - outer[side].x) * t1;
        const oy1 = outer[side].y + (outer[nextSide].y - outer[side].y) * t1;
        const oz1 = outer[side].z + (outer[nextSide].z - outer[side].z) * t1;

        // Inner edge points
        const ix0 = inner[side].x + (inner[nextSide].x - inner[side].x) * t0;
        const iy0 = inner[side].y + (inner[nextSide].y - inner[side].y) * t0;
        const iz0 = inner[side].z + (inner[nextSide].z - inner[side].z) * t0;
        const ix1 = inner[side].x + (inner[nextSide].x - inner[side].x) * t1;
        const iy1 = inner[side].y + (inner[nextSide].y - inner[side].y) * t1;
        const iz1 = inner[side].z + (inner[nextSide].z - inner[side].z) * t1;

        // Project and write 4 line segments per bar
        const po0 = this.project3D(ox0, oy0, oz0, angle);
        const po1 = this.project3D(ox1, oy1, oz1, angle);
        const pi0 = this.project3D(ix0, iy0, iz0, angle);
        const pi1 = this.project3D(ix1, iy1, iz1, angle);

        // Outer edge
        this.linePositions[vi++] = po0.x; this.linePositions[vi++] = po0.y; this.linePositions[vi++] = 0;
        this.linePositions[vi++] = po1.x; this.linePositions[vi++] = po1.y; this.linePositions[vi++] = 0;
        // Inner edge
        this.linePositions[vi++] = pi0.x; this.linePositions[vi++] = pi0.y; this.linePositions[vi++] = 0;
        this.linePositions[vi++] = pi1.x; this.linePositions[vi++] = pi1.y; this.linePositions[vi++] = 0;
        // Cross strut start
        this.linePositions[vi++] = po0.x; this.linePositions[vi++] = po0.y; this.linePositions[vi++] = 0;
        this.linePositions[vi++] = pi0.x; this.linePositions[vi++] = pi0.y; this.linePositions[vi++] = 0;
        // Cross strut end
        this.linePositions[vi++] = po1.x; this.linePositions[vi++] = po1.y; this.linePositions[vi++] = 0;
        this.linePositions[vi++] = pi1.x; this.linePositions[vi++] = pi1.y; this.linePositions[vi++] = 0;
      }
    }

    const linePos = this.lines.geometry.getAttribute('position') as THREE.BufferAttribute;
    linePos.needsUpdate = true;

    // Inner accent triangle
    let ai = 0;
    for (let i = 0; i < 3; i++) {
      const n = (i + 1) % 3;
      const p0 = this.project3D(inner[i].x, inner[i].y, inner[i].z, angle);
      const p1 = this.project3D(inner[n].x, inner[n].y, inner[n].z, angle);
      this.accentPositions[ai++] = p0.x; this.accentPositions[ai++] = p0.y; this.accentPositions[ai++] = 0.1;
      this.accentPositions[ai++] = p1.x; this.accentPositions[ai++] = p1.y; this.accentPositions[ai++] = 0.1;
    }
    const accentPos = this.accentLines.geometry.getAttribute('position') as THREE.BufferAttribute;
    accentPos.needsUpdate = true;

    this.lineMat.opacity = opacity * 0.7;
    this.accentMat.opacity = opacity * 0.5;
    this.borderMat.opacity = opacity * 0.2;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      this.rotSpeed *= -1;
    }
    if (action === 'pulse') {
      this.morphAmp *= 3;
      setTimeout(() => { this.morphAmp /= 3; }, 600);
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    this.intensityLevel = level;
    if (level === 0) return;
    this.rotSpeed = Math.sign(this.rotSpeed) * (0.15 + level * 0.08);
  }
}
