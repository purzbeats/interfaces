import * as THREE from 'three';
import { BaseElement } from './base-element';
import { pulse, glitchOffset } from '../animation/fx';

export class GraphElement extends BaseElement {
  private line!: THREE.Line;
  private bars: THREE.Mesh[] = [];
  private isBarGraph: boolean = false;
  private dataPoints: number[] = [];
  private targetPoints: number[] = [];
  private numPoints: number = 0;
  private updateTimer: number = 0;
  private updateInterval: number = 0;
  private pulseTimer: number = 0;
  private glitchTimer: number = 0;
  private barBaseWidth: number = 0;

  build(): void {
    const { x, y, w, h } = this.px;
    this.isBarGraph = this.rng.chance(0.4);
    this.numPoints = this.rng.int(8, 32);
    this.updateInterval = this.rng.float(0.3, 1.5);

    this.dataPoints = Array.from({ length: this.numPoints }, () => this.rng.float(0.1, 0.9));
    this.targetPoints = [...this.dataPoints];

    if (this.isBarGraph) {
      // Create bars with unit geometry, animate via scale.y and position.y
      this.barBaseWidth = (w / this.numPoints) * 0.7;
      for (let i = 0; i < this.numPoints; i++) {
        const bx = x + (w / this.numPoints) * (i + 0.5);
        const geo = new THREE.PlaneGeometry(this.barBaseWidth, 1);
        const mat = new THREE.MeshBasicMaterial({
          color: this.palette.primary,
          transparent: true,
          opacity: 0,
        });
        const mesh = new THREE.Mesh(geo, mat);
        const bh = h * this.dataPoints[i];
        mesh.scale.y = bh;
        mesh.position.set(bx, y + bh / 2, 1);
        this.bars.push(mesh);
        this.group.add(mesh);
      }
    } else {
      const positions = new Float32Array(this.numPoints * 3);
      for (let i = 0; i < this.numPoints; i++) {
        positions[i * 3] = x + (w / (this.numPoints - 1)) * i;
        positions[i * 3 + 1] = y + h * this.dataPoints[i];
        positions[i * 3 + 2] = 1;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const mat = new THREE.LineBasicMaterial({
        color: this.palette.primary,
        transparent: true,
        opacity: 0,
      });
      this.line = new THREE.Line(geo, mat);
      this.group.add(this.line);
    }

    // Border frame
    const borderVerts = new Float32Array([
      x, y, 0, x + w, y, 0,
      x + w, y, 0, x + w, y + h, 0,
      x + w, y + h, 0, x, y + h, 0,
      x, y + h, 0, x, y, 0,
    ]);
    const borderGeo = new THREE.BufferGeometry();
    borderGeo.setAttribute('position', new THREE.BufferAttribute(borderVerts, 3));
    const borderMat = new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    });
    this.group.add(new THREE.LineSegments(borderGeo, borderMat));
  }

  update(dt: number, time: number): void {
    const state = this.stateMachine.state;
    const progress = this.stateMachine.progress;

    let opacity: number;
    if (state === 'activating') opacity = progress;
    else if (state === 'deactivating') opacity = 1 - progress;
    else opacity = 1;

    if (this.pulseTimer > 0) {
      this.pulseTimer -= dt;
      opacity *= pulse(this.pulseTimer);
    }

    // Animate data
    this.updateTimer += dt;
    if (this.updateTimer >= this.updateInterval) {
      this.updateTimer = 0;
      this.targetPoints = this.dataPoints.map(() => this.rng.float(0.1, 0.9));
    }

    for (let i = 0; i < this.numPoints; i++) {
      this.dataPoints[i] += (this.targetPoints[i] - this.dataPoints[i]) * dt * 4;
    }

    const { x, y, w, h } = this.px;

    // Glitch: horizontal jitter
    const gx = this.glitchTimer > 0 ? glitchOffset(this.glitchTimer, 4) : 0;
    if (this.glitchTimer > 0) this.glitchTimer -= dt;

    if (this.isBarGraph) {
      for (let i = 0; i < this.bars.length; i++) {
        const bar = this.bars[i];
        const bh = Math.max(1, h * this.dataPoints[i]);
        bar.scale.y = bh;
        bar.position.y = y + bh / 2;
        bar.position.x = x + (w / this.numPoints) * (i + 0.5) + gx;
        (bar.material as THREE.MeshBasicMaterial).opacity = opacity * 0.7;
      }
    } else {
      const positions = this.line.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < this.numPoints; i++) {
        positions.setXY(i, x + (w / (this.numPoints - 1)) * i + gx, y + h * this.dataPoints[i]);
      }
      positions.needsUpdate = true;
      (this.line.material as THREE.LineBasicMaterial).opacity = opacity;
    }

    this.group.children.forEach((child) => {
      if (child instanceof THREE.LineSegments) {
        (child.material as THREE.LineBasicMaterial).opacity = opacity * 0.4;
      }
    });
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'pulse') this.pulseTimer = 0.5;
    if (action === 'glitch') this.glitchTimer = 0.4;
    if (action === 'alert') {
      this.targetPoints = this.dataPoints.map(() => this.rng.float(0.7, 1.0));
      this.pulseTimer = 1.0;
    }
  }
}
