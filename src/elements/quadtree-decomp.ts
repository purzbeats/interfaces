import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

interface QTNode {
  x: number;
  y: number;
  w: number;
  h: number;
  children: QTNode[] | null;
  points: number[]; // indices into this.pts
}

/**
 * Quadtree spatial decomposition. Random points trigger recursive
 * subdivision of cells with too many points. Nested rectangles
 * show the tree structure. LineSegments for boundaries, Points for data.
 */
export class QuadtreeDecompElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'quadtree-decomp',
    meta: {
      shape: 'rectangular',
      roles: ['data-display', 'structural'],
      moods: ['diagnostic', 'tactical'],
      bandAffinity: 'high',
      sizes: ['needs-medium', 'needs-large'],
    } satisfies ElementMeta,
  };

  private pointsMesh!: THREE.Points;
  private cellLines!: THREE.LineSegments;

  private pts: { x: number; y: number }[] = [];
  private root!: QTNode;
  private maxPerCell: number = 4;
  private maxDepth: number = 6;
  private pointCount: number = 40;
  private insertIdx: number = 0;
  private insertDone: boolean = false;

  private stepTimer: number = 0;
  private stepInterval: number = 0.1;
  private resetTimer: number = 0;
  private resetInterval: number = 7;
  private maxLineVerts: number = 0;

  build(): void {
    this.glitchAmount = 4;
    const variant = this.rng.int(0, 3);

    const presets = [
      { points: 40,  perCell: 4, depth: 6, speed: 0.10, resetTime: 7 },
      { points: 80,  perCell: 3, depth: 7, speed: 0.05, resetTime: 5 },
      { points: 20,  perCell: 2, depth: 5, speed: 0.20, resetTime: 10 },
      { points: 60,  perCell: 5, depth: 8, speed: 0.07, resetTime: 6 },
    ];
    const p = presets[variant];

    this.pointCount = p.points;
    this.maxPerCell = p.perCell;
    this.maxDepth = p.depth;
    this.stepInterval = p.speed;
    this.resetInterval = p.resetTime;
    this.maxLineVerts = this.pointCount * 40; // generous

    this.initTree();
    this.buildGeometry();
  }

  private initTree(): void {
    const { x, y, w, h } = this.px;
    this.pts = [];
    this.insertIdx = 0;
    this.insertDone = false;
    this.resetTimer = 0;

    for (let i = 0; i < this.pointCount; i++) {
      this.pts.push({
        x: x + this.rng.float(0, w),
        y: y + this.rng.float(0, h),
      });
    }

    this.root = { x, y, w, h, children: null, points: [] };
  }

  private insertPoint(node: QTNode, pi: number, depth: number): void {
    const px = this.pts[pi].x;
    const py = this.pts[pi].y;

    if (px < node.x || px > node.x + node.w || py < node.y || py > node.y + node.h) return;

    if (node.children !== null) {
      for (const child of node.children) {
        this.insertPoint(child, pi, depth + 1);
      }
      return;
    }

    node.points.push(pi);

    if (node.points.length > this.maxPerCell && depth < this.maxDepth) {
      this.subdivide(node, depth);
    }
  }

  private subdivide(node: QTNode, depth: number): void {
    const hw = node.w / 2;
    const hh = node.h / 2;
    node.children = [
      { x: node.x,      y: node.y,      w: hw, h: hh, children: null, points: [] },
      { x: node.x + hw, y: node.y,      w: hw, h: hh, children: null, points: [] },
      { x: node.x,      y: node.y + hh, w: hw, h: hh, children: null, points: [] },
      { x: node.x + hw, y: node.y + hh, w: hw, h: hh, children: null, points: [] },
    ];

    const oldPts = node.points;
    node.points = [];
    for (const pi of oldPts) {
      for (const child of node.children) {
        this.insertPoint(child, pi, depth + 1);
      }
    }
  }

  private collectEdges(node: QTNode, out: number[]): void {
    // Draw this node's boundary
    const { x, y, w, h } = node;
    out.push(
      x, y, 0, x + w, y, 0,
      x + w, y, 0, x + w, y + h, 0,
      x + w, y + h, 0, x, y + h, 0,
      x, y + h, 0, x, y, 0,
    );
    if (node.children) {
      // Draw subdivision cross
      const hw = w / 2;
      const hh = h / 2;
      out.push(
        x + hw, y, 0, x + hw, y + h, 0,
        x, y + hh, 0, x + w, y + hh, 0,
      );
      for (const child of node.children) {
        this.collectEdges(child, out);
      }
    }
  }

  private buildGeometry(): void {
    const { w, h } = this.px;

    // Points
    const posArr = new Float32Array(this.pointCount * 3);
    posArr.fill(0);
    const ptGeo = new THREE.BufferGeometry();
    ptGeo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
    ptGeo.setDrawRange(0, 0);
    this.pointsMesh = new THREE.Points(ptGeo, new THREE.PointsMaterial({
      color: this.palette.secondary,
      size: Math.max(3, Math.min(w, h) * 0.012),
      transparent: true,
      opacity: 0,
      sizeAttenuation: false,
    }));
    this.group.add(this.pointsMesh);

    // Cell boundary lines
    const lineVerts = new Float32Array(this.maxLineVerts * 3);
    lineVerts.fill(0);
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.BufferAttribute(lineVerts, 3));
    lineGeo.setDrawRange(0, 0);
    this.cellLines = new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.cellLines);
  }

  private updateGeometry(): void {
    // Points
    const posAttr = this.pointsMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const shown = Math.min(this.insertIdx, this.pointCount);
    for (let i = 0; i < shown; i++) {
      posAttr.setXYZ(i, this.pts[i].x, this.pts[i].y, 1);
    }
    posAttr.needsUpdate = true;
    this.pointsMesh.geometry.setDrawRange(0, shown);

    // Cell edges
    const edgeData: number[] = [];
    this.collectEdges(this.root, edgeData);
    const lineAttr = this.cellLines.geometry.getAttribute('position') as THREE.BufferAttribute;
    const maxFloats = this.maxLineVerts * 3;
    const count = Math.min(edgeData.length, maxFloats);
    for (let i = 0; i < count; i++) {
      (lineAttr.array as Float32Array)[i] = edgeData[i];
    }
    lineAttr.needsUpdate = true;
    this.cellLines.geometry.setDrawRange(0, Math.floor(count / 3));
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);

    if (this.insertDone) {
      this.resetTimer += dt;
      if (this.resetTimer >= this.resetInterval) {
        this.initTree();
      }
    } else {
      this.stepTimer += dt;
      while (this.stepTimer >= this.stepInterval && !this.insertDone) {
        this.stepTimer -= this.stepInterval;
        if (this.insertIdx < this.pointCount) {
          this.insertPoint(this.root, this.insertIdx, 0);
          this.insertIdx++;
        }
        if (this.insertIdx >= this.pointCount) {
          this.insertDone = true;
        }
      }
    }

    this.updateGeometry();

    (this.pointsMesh.material as THREE.PointsMaterial).opacity = opacity * 0.9;
    (this.cellLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.5;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      this.initTree();
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) {
      this.stepInterval = 0.1;
      return;
    }
    this.stepInterval = Math.max(0.01, 0.1 - level * 0.018);
    if (level >= 4) {
      this.initTree();
    }
  }
}
