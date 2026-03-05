import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * 4D tesseract (hypercube) projected to 2D. 16 vertices, 32 edges.
 * Rotates in 4D (XW and YZ planes), projected via perspective.
 * Wireframe line geometry.
 */
export class HypercubeRotateElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'hypercube-rotate',
    meta: {
      shape: 'rectangular',
      roles: ['decorative', 'data-display'],
      moods: ['ambient', 'tactical'],
      bandAffinity: 'sub',
      sizes: ['needs-medium', 'needs-large'],
    },
  };

  private edgeLines!: THREE.LineSegments;
  private vertDots!: THREE.Points;
  private verts4D: number[][] = [];
  private edges: [number, number][] = [];
  private rotSpeedXW: number = 0.3;
  private rotSpeedYZ: number = 0.2;
  private rotSpeedXY: number = 0;
  private projDist: number = 3;
  private cx: number = 0;
  private cy: number = 0;
  private scale: number = 1;

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;
    this.cx = x + w / 2;
    this.cy = y + h / 2;
    this.scale = Math.min(w, h) * 0.3;

    const variant = this.rng.int(0, 3);
    const presets = [
      { rotXW: 0.3, rotYZ: 0.2, rotXY: 0, projDist: 3 },
      { rotXW: 0.5, rotYZ: 0.4, rotXY: 0.1, projDist: 2.5 },
      { rotXW: 0.15, rotYZ: 0.35, rotXY: 0.05, projDist: 4 },
      { rotXW: 0.4, rotYZ: 0.1, rotXY: 0.25, projDist: 2 },
    ];
    const p = presets[variant];
    this.rotSpeedXW = p.rotXW;
    this.rotSpeedYZ = p.rotYZ;
    this.rotSpeedXY = p.rotXY;
    this.projDist = p.projDist;

    // Generate 16 vertices of a 4D unit hypercube centered at origin
    for (let i = 0; i < 16; i++) {
      this.verts4D.push([
        ((i & 1) ? 1 : -1),
        ((i & 2) ? 1 : -1),
        ((i & 4) ? 1 : -1),
        ((i & 8) ? 1 : -1),
      ]);
    }

    // Generate 32 edges: connect vertices differing in exactly one coordinate
    for (let i = 0; i < 16; i++) {
      for (let j = i + 1; j < 16; j++) {
        let diff = 0;
        for (let d = 0; d < 4; d++) {
          if (this.verts4D[i][d] !== this.verts4D[j][d]) diff++;
        }
        if (diff === 1) this.edges.push([i, j]);
      }
    }

    // Edge line segments (32 edges x 2 endpoints x 3 coords)
    const edgePos = new Float32Array(this.edges.length * 6);
    // Fill with center pos initially
    for (let i = 0; i < this.edges.length * 2; i++) {
      edgePos[i * 3] = this.cx;
      edgePos[i * 3 + 1] = this.cy;
      edgePos[i * 3 + 2] = 0;
    }
    const edgeGeo = new THREE.BufferGeometry();
    edgeGeo.setAttribute('position', new THREE.BufferAttribute(edgePos, 3));
    this.edgeLines = new THREE.LineSegments(edgeGeo, new THREE.LineBasicMaterial({
      color: this.palette.primary, transparent: true, opacity: 0,
    }));
    this.group.add(this.edgeLines);

    // Vertex dots
    const vertPos = new Float32Array(16 * 3);
    for (let i = 0; i < 16; i++) {
      vertPos[i * 3] = this.cx;
      vertPos[i * 3 + 1] = this.cy;
      vertPos[i * 3 + 2] = 1;
    }
    const vertGeo = new THREE.BufferGeometry();
    vertGeo.setAttribute('position', new THREE.BufferAttribute(vertPos, 3));
    this.vertDots = new THREE.Points(vertGeo, new THREE.PointsMaterial({
      color: this.palette.secondary, size: Math.max(1, Math.min(w, h) * 0.013), transparent: true, opacity: 0, sizeAttenuation: false,
    }));
    this.group.add(this.vertDots);
  }

  private rotate4D(v: number[], angleXW: number, angleYZ: number, angleXY: number): number[] {
    let [xv, yv, zv, wv] = v;
    // XW rotation
    let cos = Math.cos(angleXW), sin = Math.sin(angleXW);
    let nx = xv * cos - wv * sin;
    let nw = xv * sin + wv * cos;
    xv = nx; wv = nw;
    // YZ rotation
    cos = Math.cos(angleYZ); sin = Math.sin(angleYZ);
    let ny = yv * cos - zv * sin;
    let nz = yv * sin + zv * cos;
    yv = ny; zv = nz;
    // XY rotation
    if (angleXY !== 0) {
      cos = Math.cos(angleXY); sin = Math.sin(angleXY);
      nx = xv * cos - yv * sin;
      ny = xv * sin + yv * cos;
      xv = nx; yv = ny;
    }
    return [xv, yv, zv, wv];
  }

  private project(v4: number[]): [number, number] {
    // Perspective projection from 4D -> 2D
    const w = 1 / (this.projDist - v4[3]);
    return [
      this.cx + v4[0] * w * this.scale,
      this.cy + v4[1] * w * this.scale,
    ];
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    const aXW = time * this.rotSpeedXW;
    const aYZ = time * this.rotSpeedYZ;
    const aXY = time * this.rotSpeedXY;

    // Project all vertices
    const projected: [number, number][] = [];
    const vertAttr = this.vertDots.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < 16; i++) {
      const r = this.rotate4D(this.verts4D[i], aXW, aYZ, aXY);
      const [px, py] = this.project(r);
      projected.push([px, py]);
      vertAttr.setXYZ(i, px, py, 1);
    }
    vertAttr.needsUpdate = true;

    // Update edges
    const edgeAttr = this.edgeLines.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < this.edges.length; i++) {
      const [a, b] = this.edges[i];
      edgeAttr.setXYZ(i * 2, projected[a][0], projected[a][1], 0);
      edgeAttr.setXYZ(i * 2 + 1, projected[b][0], projected[b][1], 0);
    }
    edgeAttr.needsUpdate = true;

    (this.edgeLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.6;
    (this.vertDots.material as THREE.PointsMaterial).opacity = opacity * 0.9;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      this.rotSpeedXW += this.rng.float(-0.5, 0.5);
      this.rotSpeedYZ += this.rng.float(-0.5, 0.5);
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) return;
    this.rotSpeedXW = 0.3 + level * 0.15;
    this.rotSpeedYZ = 0.2 + level * 0.1;
  }
}
