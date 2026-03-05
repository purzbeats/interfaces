import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Cayley graph of a small group (Z_n, dihedral). Nodes arranged on a circle,
 * colored edges for each generator. Points + colored line segments. Slowly rotates.
 */
export class CayleyGraphElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'cayley-graph',
    meta: {
      shape: 'radial',
      roles: ['data-display', 'decorative'],
      moods: ['diagnostic', 'ambient'],
      bandAffinity: 'mid',
      sizes: ['needs-medium', 'needs-large'],
    },
  };

  private nodeDots!: THREE.Points;
  private edgeGroups: THREE.LineSegments[] = [];
  private generators: number[][] = [];
  private nodeAngles: number[] = [];
  private cx: number = 0;
  private cy: number = 0;
  private radius: number = 1;
  private rotSpeed: number = 0.05;
  private groupOrder: number = 8;

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;
    this.cx = x + w / 2;
    this.cy = y + h / 2;
    this.radius = Math.min(w, h) * 0.38;

    const variant = this.rng.int(0, 3);
    const presets = [
      { order: 8, rotSpeed: 0.05 },
      { order: 12, rotSpeed: 0.04 },
      { order: 10, rotSpeed: 0.06 },
      { order: 16, rotSpeed: 0.03 },
    ];
    const p = presets[variant];
    this.groupOrder = p.order;
    this.rotSpeed = p.rotSpeed;

    // Node angles on circle
    for (let i = 0; i < this.groupOrder; i++) {
      this.nodeAngles.push((i / this.groupOrder) * Math.PI * 2 - Math.PI / 2);
    }

    // Node dots
    const nodePos = new Float32Array(this.groupOrder * 3);
    for (let i = 0; i < this.groupOrder; i++) {
      nodePos[i * 3] = this.cx + Math.cos(this.nodeAngles[i]) * this.radius;
      nodePos[i * 3 + 1] = this.cy + Math.sin(this.nodeAngles[i]) * this.radius;
      nodePos[i * 3 + 2] = 1;
    }
    const nodeGeo = new THREE.BufferGeometry();
    nodeGeo.setAttribute('position', new THREE.BufferAttribute(nodePos, 3));
    this.nodeDots = new THREE.Points(nodeGeo, new THREE.PointsMaterial({
      color: this.palette.secondary, size: Math.max(1, Math.min(w, h) * 0.02), transparent: true, opacity: 0, sizeAttenuation: false,
    }));
    this.group.add(this.nodeDots);

    // Build generators: +1 mod n, and +step mod n
    const step2 = Math.max(2, Math.floor(this.groupOrder / 3));
    const gen1: number[] = [];
    const gen2: number[] = [];
    for (let i = 0; i < this.groupOrder; i++) {
      gen1.push((i + 1) % this.groupOrder);
      gen2.push((i + step2) % this.groupOrder);
    }
    this.generators = [gen1, gen2];

    // Optional third generator for larger groups
    if (this.groupOrder >= 12) {
      const step3 = Math.floor(this.groupOrder / 2);
      const gen3: number[] = [];
      for (let i = 0; i < this.groupOrder; i++) {
        gen3.push((i + step3) % this.groupOrder);
      }
      this.generators.push(gen3);
    }

    // Create edge line segments for each generator
    const genColors = [this.palette.primary, this.palette.dim, this.palette.secondary];
    for (let g = 0; g < this.generators.length; g++) {
      const gen = this.generators[g];
      const edgePos = new Float32Array(this.groupOrder * 6);
      for (let i = 0; i < this.groupOrder; i++) {
        const target = gen[i];
        edgePos[i * 6] = this.cx + Math.cos(this.nodeAngles[i]) * this.radius;
        edgePos[i * 6 + 1] = this.cy + Math.sin(this.nodeAngles[i]) * this.radius;
        edgePos[i * 6 + 2] = 0;
        edgePos[i * 6 + 3] = this.cx + Math.cos(this.nodeAngles[target]) * this.radius;
        edgePos[i * 6 + 4] = this.cy + Math.sin(this.nodeAngles[target]) * this.radius;
        edgePos[i * 6 + 5] = 0;
      }
      const edgeGeo = new THREE.BufferGeometry();
      edgeGeo.setAttribute('position', new THREE.BufferAttribute(edgePos, 3));
      const lines = new THREE.LineSegments(edgeGeo, new THREE.LineBasicMaterial({
        color: genColors[g % genColors.length], transparent: true, opacity: 0,
      }));
      this.group.add(lines);
      this.edgeGroups.push(lines);
    }
  }

  private nodeXY(i: number, rot: number): [number, number] {
    const a = this.nodeAngles[i] + rot;
    return [
      this.cx + Math.cos(a) * this.radius,
      this.cy + Math.sin(a) * this.radius,
    ];
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    const rot = time * this.rotSpeed;

    // Update node positions
    const nodeAttr = this.nodeDots.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < this.groupOrder; i++) {
      const [nx, ny] = this.nodeXY(i, rot);
      nodeAttr.setXYZ(i, nx, ny, 1);
    }
    nodeAttr.needsUpdate = true;
    (this.nodeDots.material as THREE.PointsMaterial).opacity = opacity * 0.9;

    // Update edge positions
    for (let g = 0; g < this.generators.length; g++) {
      const gen = this.generators[g];
      const edgeAttr = this.edgeGroups[g].geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < this.groupOrder; i++) {
        const [fx, fy] = this.nodeXY(i, rot);
        const [tx, ty] = this.nodeXY(gen[i], rot);
        edgeAttr.setXYZ(i * 2, fx, fy, 0);
        edgeAttr.setXYZ(i * 2 + 1, tx, ty, 0);
      }
      edgeAttr.needsUpdate = true;
      const baseOpacity = g === 0 ? 0.5 : g === 1 ? 0.35 : 0.25;
      (this.edgeGroups[g].material as THREE.LineBasicMaterial).opacity = opacity * baseOpacity;
    }
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      this.rotSpeed += this.rng.float(-0.1, 0.1);
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) return;
    this.rotSpeed = 0.05 + level * 0.04;
  }
}
