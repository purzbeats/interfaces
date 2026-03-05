import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Stern-Brocot tree of rational numbers.
 * Binary tree where each node is the mediant of its parent fractions.
 * Rendered as a tree graph with nodes (Points) and edges (LineSegments).
 */
export class SternBrocotElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'stern-brocot',
    meta: {
      shape: 'rectangular',
      roles: ['data-display', 'decorative'],
      moods: ['ambient', 'diagnostic'],
      bandAffinity: 'mid',
      sizes: ['needs-medium', 'needs-large'],
    },
  };

  private nodePoints!: THREE.Points;
  private edgeLines!: THREE.LineSegments;
  private labelLine!: THREE.Line;

  private nodes: Array<{ x: number; y: number; p: number; q: number }> = [];
  private edges: Array<[number, number]> = [];
  private maxDepth: number = 5;
  private nodeSize: number = 4;
  private revealProgress: number = 0;
  private revealSpeed: number = 0.3;
  private breathSpeed: number = 0.5;
  private totalNodes: number = 0;

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;

    const variant = this.rng.int(0, 3);
    const presets = [
      { depth: 5, nodeSize: 5, revealSpeed: 0.3, breathSpeed: 0.4 },
      { depth: 6, nodeSize: 4, revealSpeed: 0.2, breathSpeed: 0.3 },
      { depth: 4, nodeSize: 7, revealSpeed: 0.5, breathSpeed: 0.6 },
      { depth: 7, nodeSize: 3, revealSpeed: 0.15, breathSpeed: 0.2 },
    ];
    const p = presets[variant];

    this.maxDepth = p.depth;
    this.nodeSize = p.nodeSize;
    this.revealSpeed = p.revealSpeed;
    this.breathSpeed = p.breathSpeed;

    // Build the tree using BFS
    // Root: 1/1, left parent fraction 0/1, right parent fraction 1/0
    this.nodes = [];
    this.edges = [];

    interface QueueItem {
      lp: number; lq: number; rp: number; rq: number;
      depth: number; parentIdx: number;
    }

    const queue: QueueItem[] = [];
    // Root node: mediant of 0/1 and 1/0 = 1/1
    const rootX = x + w / 2;
    const rootY = y + h * 0.08;
    this.nodes.push({ x: rootX, y: rootY, p: 1, q: 1 });

    queue.push({ lp: 0, lq: 1, rp: 1, rq: 1, depth: 1, parentIdx: 0 }); // left child
    queue.push({ lp: 1, lq: 1, rp: 1, rq: 0, depth: 1, parentIdx: 0 }); // right child

    while (queue.length > 0) {
      const item = queue.shift()!;
      if (item.depth > this.maxDepth) continue;

      const mp = item.lp + item.rp;
      const mq = item.lq + item.rq;

      // Position: spread based on depth
      const levelWidth = w * 0.9;
      const nodeIdx = this.nodes.length;

      // Use index within level to position horizontally
      const depthY = y + h * 0.08 + (item.depth / this.maxDepth) * h * 0.84;
      // Position relative to parent with some offset
      const parent = this.nodes[item.parentIdx];
      const spread = levelWidth / Math.pow(2, item.depth) * 0.5;
      const isLeftChild = (mp / mq) < (parent.p / parent.q);
      const nodeX = parent.x + (isLeftChild ? -spread : spread);

      this.nodes.push({ x: nodeX, y: depthY, p: mp, q: mq });
      this.edges.push([item.parentIdx, nodeIdx]);

      if (item.depth < this.maxDepth) {
        // Left child: mediant of (lp/lq, mp/mq)
        queue.push({ lp: item.lp, lq: item.lq, rp: mp, rq: mq, depth: item.depth + 1, parentIdx: nodeIdx });
        // Right child: mediant of (mp/mq, rp/rq)
        queue.push({ lp: mp, lq: mq, rp: item.rp, rq: item.rq, depth: item.depth + 1, parentIdx: nodeIdx });
      }
    }

    this.totalNodes = this.nodes.length;

    // Create node geometry
    const nodePos = new Float32Array(this.totalNodes * 3);
    for (let i = 0; i < this.totalNodes; i++) {
      nodePos[i * 3] = this.nodes[i].x;
      nodePos[i * 3 + 1] = this.nodes[i].y;
      nodePos[i * 3 + 2] = 1;
    }
    const nodeGeo = new THREE.BufferGeometry();
    nodeGeo.setAttribute('position', new THREE.BufferAttribute(nodePos, 3));
    this.nodePoints = new THREE.Points(nodeGeo, new THREE.PointsMaterial({
      color: this.palette.secondary,
      size: this.nodeSize,
      transparent: true,
      opacity: 0,
      sizeAttenuation: false,
    }));
    this.group.add(this.nodePoints);

    // Create edge geometry
    const edgePos = new Float32Array(this.edges.length * 6);
    for (let i = 0; i < this.edges.length; i++) {
      const [from, to] = this.edges[i];
      edgePos[i * 6] = this.nodes[from].x;
      edgePos[i * 6 + 1] = this.nodes[from].y;
      edgePos[i * 6 + 2] = 0;
      edgePos[i * 6 + 3] = this.nodes[to].x;
      edgePos[i * 6 + 4] = this.nodes[to].y;
      edgePos[i * 6 + 5] = 0;
    }
    const edgeGeo = new THREE.BufferGeometry();
    edgeGeo.setAttribute('position', new THREE.BufferAttribute(edgePos, 3));
    this.edgeLines = new THREE.LineSegments(edgeGeo, new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.edgeLines);

    // Highlight path line (traces a path from root)
    const pathLen = this.maxDepth + 1;
    const pathPos = new Float32Array(pathLen * 3);
    // Initialize all to root position so no lines to origin
    for (let i = 0; i < pathLen; i++) {
      pathPos[i * 3] = this.nodes[0].x;
      pathPos[i * 3 + 1] = this.nodes[0].y;
      pathPos[i * 3 + 2] = 2;
    }
    const pathGeo = new THREE.BufferGeometry();
    pathGeo.setAttribute('position', new THREE.BufferAttribute(pathPos, 3));
    this.labelLine = new THREE.Line(pathGeo, new THREE.LineBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.labelLine);
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);

    this.revealProgress = Math.min(this.revealProgress + dt * this.revealSpeed, 1);
    const visibleNodes = Math.floor(this.revealProgress * this.totalNodes);
    const visibleEdges = Math.floor(this.revealProgress * this.edges.length);

    // Animate node sizes with breathing
    const breath = 1 + 0.15 * Math.sin(time * this.breathSpeed * Math.PI * 2);
    (this.nodePoints.material as THREE.PointsMaterial).size = this.nodeSize * breath;
    (this.nodePoints.material as THREE.PointsMaterial).opacity = opacity * 0.9;
    (this.edgeLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.4;

    // Draw range based on reveal
    this.nodePoints.geometry.setDrawRange(0, visibleNodes);
    this.edgeLines.geometry.setDrawRange(0, visibleEdges * 2);

    // Animate a highlight path that wanders the tree
    const pathPos = this.labelLine.geometry.getAttribute('position') as THREE.BufferAttribute;
    const pathLen = this.maxDepth + 1;
    let nodeIdx = 0;
    pathPos.setXYZ(0, this.nodes[0].x, this.nodes[0].y, 2);
    for (let d = 1; d < pathLen; d++) {
      // Find children of current node
      const children = this.edges
        .filter(e => e[0] === nodeIdx)
        .map(e => e[1]);
      if (children.length === 0) {
        pathPos.setXYZ(d, this.nodes[nodeIdx].x, this.nodes[nodeIdx].y, 2);
      } else {
        // Alternate left/right based on time
        const pick = Math.floor(time * 0.5 + d * 0.7) % children.length;
        nodeIdx = children[pick];
        pathPos.setXYZ(d, this.nodes[nodeIdx].x, this.nodes[nodeIdx].y, 2);
      }
    }
    pathPos.needsUpdate = true;
    (this.labelLine.material as THREE.LineBasicMaterial).opacity = opacity * 0.7;

    // Reset reveal when complete for looping
    if (this.revealProgress >= 1) {
      this.revealProgress = 1;
    }
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      this.revealProgress = 0;
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) return;
    if (level >= 3) {
      this.revealSpeed = 0.3 + level * 0.2;
    }
    if (level >= 5) {
      this.revealProgress = 0;
    }
  }
}
