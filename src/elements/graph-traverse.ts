import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

interface GNode { x: number; y: number; visited: boolean; vTime: number; inFront: boolean; }

/** BFS/DFS graph traversal animation. Points + LineSegments geometry. */
export class GraphTraverseElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'graph-traverse',
    meta: { shape: 'rectangular', roles: ['data-display', 'decorative'], moods: ['diagnostic', 'ambient'], bandAffinity: 'mid', sizes: ['needs-medium', 'needs-large'] },
  };
  private nodePoints!: THREE.Points; private edgeLines!: THREE.LineSegments; private frontierPts!: THREE.Points;
  private gn: GNode[] = []; private edges: Array<{ from: number; to: number }> = []; private adj: number[][] = [];
  private frontier: number[] = []; private vis = new Set<number>();
  private sTimer = 0; private sInterval = 0.5; private bfs = true; private sMult = 1; private t = 0; private rTimer = 0;
  private nCount = 16; private ePer = 2;

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;
    const v = this.rng.int(0, 3);
    const ps = [
      { n: 16, e: 2, int: 0.5, bfs: true },  { n: 24, e: 3, int: 0.25, bfs: true },
      { n: 12, e: 2, int: 0.8, bfs: false },  { n: 20, e: 2, int: 0.35, bfs: false },
    ];
    const p = ps[v]; this.nCount = p.n; this.ePer = p.e; this.sInterval = p.int; this.bfs = p.bfs;
    this.genGraph(x, y, w, h); this.startTrav();

    // Nodes
    const nPos = new Float32Array(this.gn.length * 3); const nCol = new Float32Array(this.gn.length * 3);
    for (let i = 0; i < this.gn.length; i++) {
      nPos[i * 3] = this.gn[i].x; nPos[i * 3 + 1] = this.gn[i].y; nPos[i * 3 + 2] = 2;
      nCol[i * 3] = this.palette.dim.r; nCol[i * 3 + 1] = this.palette.dim.g; nCol[i * 3 + 2] = this.palette.dim.b;
    }
    const nGeo = new THREE.BufferGeometry();
    nGeo.setAttribute('position', new THREE.BufferAttribute(nPos, 3));
    nGeo.setAttribute('color', new THREE.BufferAttribute(nCol, 3));
    this.nodePoints = new THREE.Points(nGeo, new THREE.PointsMaterial({
      size: Math.max(5, Math.min(w, h) * 0.015), vertexColors: true, transparent: true, opacity: 0, sizeAttenuation: false,
    }));
    this.group.add(this.nodePoints);

    // Edges
    const eV = new Float32Array(this.edges.length * 6); const eC = new Float32Array(this.edges.length * 6);
    for (let i = 0; i < this.edges.length; i++) {
      const e = this.edges[i];
      eV[i * 6] = this.gn[e.from].x; eV[i * 6 + 1] = this.gn[e.from].y; eV[i * 6 + 2] = 1;
      eV[i * 6 + 3] = this.gn[e.to].x; eV[i * 6 + 4] = this.gn[e.to].y; eV[i * 6 + 5] = 1;
      for (let c = 0; c < 2; c++) { eC[i * 6 + c * 3] = this.palette.dim.r; eC[i * 6 + c * 3 + 1] = this.palette.dim.g; eC[i * 6 + c * 3 + 2] = this.palette.dim.b; }
    }
    const eGeo = new THREE.BufferGeometry();
    eGeo.setAttribute('position', new THREE.BufferAttribute(eV, 3));
    eGeo.setAttribute('color', new THREE.BufferAttribute(eC, 3));
    this.edgeLines = new THREE.LineSegments(eGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0 }));
    this.group.add(this.edgeLines);

    // Frontier
    const fPos = new Float32Array(this.gn.length * 3);
    for (let i = 0; i < this.gn.length; i++) { fPos[i * 3] = -9999; fPos[i * 3 + 1] = -9999; fPos[i * 3 + 2] = 3; }
    const fGeo = new THREE.BufferGeometry();
    fGeo.setAttribute('position', new THREE.BufferAttribute(fPos, 3));
    this.frontierPts = new THREE.Points(fGeo, new THREE.PointsMaterial({
      color: this.palette.secondary, size: Math.max(8, Math.min(w, h) * 0.02), transparent: true, opacity: 0, sizeAttenuation: false,
    }));
    this.group.add(this.frontierPts);
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt); this.t = time; const ed = dt * this.sMult;
    if (this.rTimer > 0 && (this.rTimer -= ed) <= 0) this.startTrav();
    this.sTimer += ed;
    if (this.sTimer >= this.sInterval && this.rTimer <= 0) { this.sTimer -= this.sInterval; this.step(); }

    // Node colors
    const nc = (this.nodePoints.geometry.getAttribute('color') as THREE.BufferAttribute).array as Float32Array;
    for (let i = 0; i < this.gn.length; i++) {
      const g = this.gn[i]; let r: number, gg: number, b: number;
      if (g.visited) { const f = time - g.vTime < 0.3 ? 1.5 : 1; r = Math.min(1, this.palette.primary.r * f); gg = Math.min(1, this.palette.primary.g * f); b = Math.min(1, this.palette.primary.b * f); }
      else if (g.inFront) { const p = 0.7 + 0.3 * Math.sin(time * 6 + i); r = this.palette.secondary.r * p; gg = this.palette.secondary.g * p; b = this.palette.secondary.b * p; }
      else { r = this.palette.dim.r * 0.5; gg = this.palette.dim.g * 0.5; b = this.palette.dim.b * 0.5; }
      nc[i * 3] = r; nc[i * 3 + 1] = gg; nc[i * 3 + 2] = b;
    }
    (this.nodePoints.geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;

    // Edge colors
    const ec = (this.edgeLines.geometry.getAttribute('color') as THREE.BufferAttribute).array as Float32Array;
    for (let i = 0; i < this.edges.length; i++) {
      const e = this.edges[i]; const bv = this.gn[e.from].visited && this.gn[e.to].visited;
      const col = bv ? this.palette.primary : this.palette.dim; const m = bv ? 0.6 : 0.2;
      for (let c = 0; c < 2; c++) { ec[i * 6 + c * 3] = col.r * m; ec[i * 6 + c * 3 + 1] = col.g * m; ec[i * 6 + c * 3 + 2] = col.b * m; }
    }
    (this.edgeLines.geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;

    // Frontier positions
    const fp = this.frontierPts.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < this.gn.length; i++) {
      if (i < this.frontier.length) { const fi = this.frontier[i]; fp.setXYZ(i, this.gn[fi].x, this.gn[fi].y, 3); }
      else fp.setXYZ(i, -9999, -9999, 3);
    }
    fp.needsUpdate = true;
    (this.nodePoints.material as THREE.PointsMaterial).opacity = opacity * 0.9;
    (this.edgeLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.5;
    (this.frontierPts.material as THREE.PointsMaterial).opacity = opacity * (0.5 + 0.3 * Math.sin(time * 4));
  }

  private genGraph(ox: number, oy: number, w: number, h: number): void {
    const pad = Math.min(w, h) * 0.1; this.gn = []; this.edges = []; this.adj = [];
    for (let i = 0; i < this.nCount; i++) {
      this.gn.push({ x: ox + pad + this.rng.float(0, w - pad * 2), y: oy + pad + this.rng.float(0, h - pad * 2), visited: false, vTime: 0, inFront: false });
      this.adj.push([]);
    }
    for (let i = 0; i < this.nCount; i++) {
      const cn = this.rng.int(1, this.ePer);
      for (let c = 0; c < cn; c++) {
        let cl = -1, cd = Infinity;
        for (let j = 0; j < this.nCount; j++) {
          if (j === i || this.adj[i].includes(j)) continue;
          const dx = this.gn[i].x - this.gn[j].x, dy = this.gn[i].y - this.gn[j].y;
          const d = Math.sqrt(dx * dx + dy * dy) + this.rng.float(0, 40);
          if (d < cd) { cd = d; cl = j; }
        }
        if (cl >= 0) { this.edges.push({ from: i, to: cl }); this.adj[i].push(cl); this.adj[cl].push(i); }
      }
    }
  }

  private startTrav(): void {
    const s = this.rng.int(0, this.gn.length - 1); this.frontier = [s]; this.vis.clear();
    for (const g of this.gn) { g.visited = false; g.inFront = false; } this.gn[s].inFront = true;
  }

  private step(): void {
    if (!this.frontier.length) { this.rTimer = this.rng.float(1.5, 3); return; }
    const cur = this.bfs ? this.frontier.shift()! : this.frontier.pop()!;
    if (this.vis.has(cur)) return;
    this.vis.add(cur); this.gn[cur].visited = true; this.gn[cur].vTime = this.t; this.gn[cur].inFront = false;
    for (const nb of this.adj[cur]) { if (!this.vis.has(nb) && !this.gn[nb].inFront) { this.frontier.push(nb); this.gn[nb].inFront = true; } }
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') { for (let i = 0; i < this.gn.length; i++) if (!this.gn[i].visited) { this.gn[i].visited = true; this.gn[i].vTime = this.t + this.rng.float(-0.3, 0); } this.frontier = []; }
  }

  onIntensity(level: number): void {
    super.onIntensity(level); if (level === 0) { this.sMult = 1; return; } this.sMult = 1 + level * 0.6;
  }
}
