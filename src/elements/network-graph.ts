import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Node-link diagram with pulsing data packets along edges.
 * Points for nodes, LineSegments for edges, packet Points travel between nodes.
 */
export class NetworkGraphElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'network-graph',
    meta: { shape: 'rectangular', roles: ['data-display', 'decorative'], moods: ['diagnostic', 'ambient'], bandAffinity: 'mid', sizes: ['needs-medium', 'needs-large'] },
  };
  private nodePoints!: THREE.Points;
  private edgeLines!: THREE.LineSegments;
  private packetPoints!: THREE.Points;
  private nodes: Array<{ x: number; y: number }> = [];
  private edges: Array<{ from: number; to: number }> = [];
  private packets: Array<{ edge: number; t: number; speed: number }> = [];
  build(): void {
    const { x, y, w, h } = this.px;
    const nodeCount = this.rng.int(8, 16);
    const padding = Math.min(w, h) * 0.1;

    // Generate node positions
    for (let i = 0; i < nodeCount; i++) {
      this.nodes.push({
        x: x + padding + this.rng.float(0, w - padding * 2),
        y: y + padding + this.rng.float(0, h - padding * 2),
      });
    }

    // Generate edges (connect nearby nodes)
    for (let i = 0; i < nodeCount; i++) {
      const connections = this.rng.int(1, 3);
      for (let c = 0; c < connections; c++) {
        let closest = -1;
        let closestDist = Infinity;
        for (let j = 0; j < nodeCount; j++) {
          if (j === i) continue;
          if (this.edges.some(e => (e.from === i && e.to === j) || (e.from === j && e.to === i))) continue;
          const dx = this.nodes[i].x - this.nodes[j].x;
          const dy = this.nodes[i].y - this.nodes[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy) + this.rng.float(0, 50);
          if (dist < closestDist) {
            closestDist = dist;
            closest = j;
          }
        }
        if (closest >= 0) {
          this.edges.push({ from: i, to: closest });
        }
      }
    }

    // Node points
    const nodePos = new Float32Array(nodeCount * 3);
    for (let i = 0; i < nodeCount; i++) {
      nodePos[i * 3] = this.nodes[i].x;
      nodePos[i * 3 + 1] = this.nodes[i].y;
      nodePos[i * 3 + 2] = 1;
    }
    const nodeGeo = new THREE.BufferGeometry();
    nodeGeo.setAttribute('position', new THREE.BufferAttribute(nodePos, 3));
    this.nodePoints = new THREE.Points(nodeGeo, new THREE.PointsMaterial({
      color: this.palette.secondary,
      size: Math.max(4, Math.min(w, h) * 0.012),
      transparent: true,
      opacity: 0,
      sizeAttenuation: false,
    }));
    this.group.add(this.nodePoints);

    // Edge lines
    const edgeVerts = new Float32Array(this.edges.length * 6);
    for (let i = 0; i < this.edges.length; i++) {
      const e = this.edges[i];
      edgeVerts[i * 6] = this.nodes[e.from].x;
      edgeVerts[i * 6 + 1] = this.nodes[e.from].y;
      edgeVerts[i * 6 + 2] = 0;
      edgeVerts[i * 6 + 3] = this.nodes[e.to].x;
      edgeVerts[i * 6 + 4] = this.nodes[e.to].y;
      edgeVerts[i * 6 + 5] = 0;
    }
    const edgeGeo = new THREE.BufferGeometry();
    edgeGeo.setAttribute('position', new THREE.BufferAttribute(edgeVerts, 3));
    this.edgeLines = new THREE.LineSegments(edgeGeo, new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.edgeLines);

    // Packets
    const packetCount = this.rng.int(4, 10);
    for (let i = 0; i < packetCount; i++) {
      this.packets.push({
        edge: this.rng.int(0, this.edges.length - 1),
        t: this.rng.float(0, 1),
        speed: this.rng.float(0.3, 1.0),
      });
    }
    const packetPos = new Float32Array(packetCount * 3);
    const packetGeo = new THREE.BufferGeometry();
    packetGeo.setAttribute('position', new THREE.BufferAttribute(packetPos, 3));
    this.packetPoints = new THREE.Points(packetGeo, new THREE.PointsMaterial({
      color: this.palette.primary,
      size: Math.max(3, Math.min(w, h) * 0.008),
      transparent: true,
      opacity: 0,
      sizeAttenuation: false,
    }));
    this.group.add(this.packetPoints);
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);

    // Update packets
    const packetPos = this.packetPoints.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < this.packets.length; i++) {
      const p = this.packets[i];
      p.t += p.speed * dt;
      if (p.t >= 1) {
        p.t = 0;
        p.edge = this.rng.int(0, this.edges.length - 1);
        p.speed = this.rng.float(0.3, 1.0);
      }
      const e = this.edges[p.edge];
      const fromNode = this.nodes[e.from];
      const toNode = this.nodes[e.to];
      const px = fromNode.x + (toNode.x - fromNode.x) * p.t;
      const py = fromNode.y + (toNode.y - fromNode.y) * p.t;
      packetPos.setXYZ(i, px, py, 2);
    }
    packetPos.needsUpdate = true;

    (this.nodePoints.material as THREE.PointsMaterial).opacity = opacity * 0.8;
    (this.edgeLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.3;
    (this.packetPoints.material as THREE.PointsMaterial).opacity = opacity;
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) return;
    if (level >= 3) {
      // Boost packet speeds (additive, not multiplicative)
      for (const p of this.packets) {
        p.speed += level * 0.5;
      }
    }
    if (level >= 5) {
      (this.nodePoints.material as THREE.PointsMaterial).color.copy(this.palette.alert);
      setTimeout(() => {
        (this.nodePoints.material as THREE.PointsMaterial).color.copy(this.palette.secondary);
      }, 2000);
    }
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      for (const p of this.packets) p.speed = this.rng.float(1.5, 4);
    }
    if (action === 'alert') {
      (this.nodePoints.material as THREE.PointsMaterial).color.copy(this.palette.alert);
    }
  }
}
