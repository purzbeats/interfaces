import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Schematic power distribution network with animated current flow.
 * Multi-level tree with horizontal bus bars, junction load indicators, and
 * flowing particles along paths. Sections can flicker independently.
 */
export class PowerGridElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'power-grid',
    meta: { shape: 'rectangular', roles: ['data-display', 'structural'], moods: ['diagnostic'], bandAffinity: 'bass', sizes: ['needs-medium', 'needs-large'] },
  };
  private treeLines!: THREE.LineSegments;
  private busLines!: THREE.LineSegments;
  private junctionPoints!: THREE.Points;
  private flowPoints!: THREE.Points;
  private borderLines!: THREE.LineSegments;
  private junctions: Array<{ x: number; y: number; load: number; loadTarget: number }> = [];
  private paths: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
  private flows: Array<{ path: number; t: number; speed: number }> = [];
  private loadTimer: number = 0;

  build(): void {
    this.glitchAmount = 5;
    const { x, y, w, h } = this.px;

    // Root at bottom-center
    const rootX = x + w / 2;
    const rootY = y + h * 0.92;
    this.junctions.push({ x: rootX, y: rootY, load: 1, loadTarget: 1 });

    // Build tree: 4 levels of branching
    const levels = 4;
    const branchFactor = this.rng.int(2, 3);
    let currentLevel = [0];
    const levelJunctions: number[][] = [[0]];

    for (let level = 1; level <= levels; level++) {
      const nextLevel: number[] = [];
      const levelY = rootY - (h * 0.8 / levels) * level;
      for (const parentIdx of currentLevel) {
        const parent = this.junctions[parentIdx];
        const branches = level === 1 ? branchFactor : this.rng.int(2, branchFactor);
        const spread = (w * 0.7) / Math.pow(1.5, level - 1);
        for (let b = 0; b < branches; b++) {
          const bx = parent.x + (b - (branches - 1) / 2) * spread / branches;
          const childIdx = this.junctions.length;
          const jy = levelY + this.rng.float(-3, 3);
          this.junctions.push({
            x: Math.max(x + 10, Math.min(x + w - 10, bx)),
            y: jy,
            load: this.rng.float(0.3, 0.9),
            loadTarget: this.rng.float(0.3, 0.9),
          });
          this.paths.push({ x1: parent.x, y1: parent.y, x2: this.junctions[childIdx].x, y2: this.junctions[childIdx].y });
          nextLevel.push(childIdx);
        }
      }
      currentLevel = nextLevel;
      levelJunctions.push([...nextLevel]);
    }

    // Horizontal bus bars connecting siblings at each level
    const busVerts: number[] = [];
    for (let level = 1; level <= levels; level++) {
      const siblings = levelJunctions[level];
      if (siblings.length < 2) continue;
      // Sort by x
      const sorted = siblings.map(i => this.junctions[i]).sort((a, b) => a.x - b.x);
      for (let i = 0; i < sorted.length - 1; i++) {
        busVerts.push(sorted[i].x, sorted[i].y, 0, sorted[i + 1].x, sorted[i + 1].y, 0);
      }
    }
    const busGeo = new THREE.BufferGeometry();
    busGeo.setAttribute('position', new THREE.Float32BufferAttribute(busVerts, 3));
    this.busLines = new THREE.LineSegments(busGeo, new THREE.LineBasicMaterial({
      color: this.palette.dim, transparent: true, opacity: 0,
    }));
    this.group.add(this.busLines);

    // Tree lines
    const lineVerts = new Float32Array(this.paths.length * 6);
    for (let i = 0; i < this.paths.length; i++) {
      const p = this.paths[i];
      lineVerts[i * 6] = p.x1; lineVerts[i * 6 + 1] = p.y1; lineVerts[i * 6 + 2] = 0;
      lineVerts[i * 6 + 3] = p.x2; lineVerts[i * 6 + 4] = p.y2; lineVerts[i * 6 + 5] = 0;
    }
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.BufferAttribute(lineVerts, 3));
    this.treeLines = new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({
      color: this.palette.dim, transparent: true, opacity: 0,
    }));
    this.group.add(this.treeLines);

    // Junction points (sized by load)
    const juncPos = new Float32Array(this.junctions.length * 3);
    for (let i = 0; i < this.junctions.length; i++) {
      juncPos[i * 3] = this.junctions[i].x;
      juncPos[i * 3 + 1] = this.junctions[i].y;
      juncPos[i * 3 + 2] = 1;
    }
    const juncGeo = new THREE.BufferGeometry();
    juncGeo.setAttribute('position', new THREE.BufferAttribute(juncPos, 3));
    this.junctionPoints = new THREE.Points(juncGeo, new THREE.PointsMaterial({
      color: this.palette.secondary,
      size: Math.max(4, Math.min(w, h) * 0.012),
      transparent: true, opacity: 0, sizeAttenuation: false,
    }));
    this.group.add(this.junctionPoints);

    // Flow particles — more of them
    const flowCount = this.rng.int(15, 35);
    for (let i = 0; i < flowCount; i++) {
      this.flows.push({
        path: this.rng.int(0, this.paths.length - 1),
        t: this.rng.float(0, 1),
        speed: this.rng.float(0.4, 1.2),
      });
    }
    const flowPos = new Float32Array(flowCount * 3);
    const flowGeo = new THREE.BufferGeometry();
    flowGeo.setAttribute('position', new THREE.BufferAttribute(flowPos, 3));
    this.flowPoints = new THREE.Points(flowGeo, new THREE.PointsMaterial({
      color: this.palette.primary,
      size: Math.max(2, Math.min(w, h) * 0.006),
      transparent: true, opacity: 0, sizeAttenuation: false,
    }));
    this.group.add(this.flowPoints);

    // Border
    const bv = new Float32Array([
      x, y, 0, x + w, y, 0, x + w, y, 0, x + w, y + h, 0,
      x + w, y + h, 0, x, y + h, 0, x, y + h, 0, x, y, 0,
    ]);
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.BufferAttribute(bv, 3));
    this.borderLines = new THREE.LineSegments(bg, new THREE.LineBasicMaterial({
      color: this.palette.dim, transparent: true, opacity: 0,
    }));
    this.group.add(this.borderLines);
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);

    // Update junction loads
    this.loadTimer += dt;
    if (this.loadTimer > 1.5) {
      this.loadTimer = 0;
      for (const j of this.junctions) {
        j.loadTarget = Math.max(0.1, Math.min(1, j.loadTarget + this.rng.float(-0.2, 0.2)));
      }
    }
    for (const j of this.junctions) {
      j.load += (j.loadTarget - j.load) * dt * 3;
    }

    // Update flow particles
    const flowPos = this.flowPoints.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < this.flows.length; i++) {
      const f = this.flows[i];
      f.t += f.speed * dt;
      if (f.t >= 1) {
        f.t = 0;
        f.path = this.rng.int(0, this.paths.length - 1);
      }
      const p = this.paths[f.path];
      flowPos.setXYZ(i,
        p.x1 + (p.x2 - p.x1) * f.t,
        p.y1 + (p.y2 - p.y1) * f.t,
        2
      );
    }
    flowPos.needsUpdate = true;

    // Junction brightness flicker based on load
    const juncColor = this.junctionPoints.material as THREE.PointsMaterial;
    const avgLoad = this.junctions.reduce((s, j) => s + j.load, 0) / this.junctions.length;
    const hasHot = this.junctions.some(j => j.load > 0.85);
    juncColor.color.copy(hasHot ? this.palette.alert : this.palette.secondary);

    // Tree line flicker for sections under stress
    const treeFlicker = hasHot ? (0.4 + Math.sin(time * 15) * 0.15) : 0.45;

    (this.treeLines.material as THREE.LineBasicMaterial).opacity = opacity * treeFlicker;
    (this.busLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.2;
    (this.junctionPoints.material as THREE.PointsMaterial).opacity = opacity * (0.5 + avgLoad * 0.4);
    (this.flowPoints.material as THREE.PointsMaterial).opacity = opacity * 0.85;
    (this.borderLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.3;
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) return;
    if (level >= 5) {
      for (const j of this.junctions) {
        j.loadTarget = 1.0;
      }
    } else if (level >= 3) {
      for (const j of this.junctions) {
        j.loadTarget = Math.min(1.0, j.loadTarget + level * 0.15);
      }
    }
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'alert') {
      this.pulseTimer = 2.0;
      for (const j of this.junctions) j.loadTarget = 1;
      (this.flowPoints.material as THREE.PointsMaterial).color.copy(this.palette.alert);
    }
  }
}
