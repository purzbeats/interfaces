import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Ant colony pheromone trail simulation.
 * Ants wander, discover food sources, and lay pheromone trails
 * that other ants follow — emergent pathfinding on a research terminal.
 */
export class AntColonyElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'ant-colony',
    meta: { shape: 'rectangular', roles: ['data-display', 'decorative'], moods: ['diagnostic', 'ambient'], bandAffinity: 'bass', sizes: ['needs-medium', 'needs-large'] },
  };

  private antCount = 0;
  private antX!: Float32Array;
  private antY!: Float32Array;
  private antAngle!: Float32Array;
  private antCarrying!: Uint8Array; // 0=searching, 1=returning

  private gridW = 0;
  private gridH = 0;
  private pheromoneGrid!: Float32Array; // pheromone strength per cell

  private foodX: number[] = [];
  private foodY: number[] = [];
  private nestX = 0;
  private nestY = 0;
  private cellSize = 4;

  private antMesh!: THREE.Points;
  private pheromoneCanvas!: HTMLCanvasElement;
  private pheromoneCtx!: CanvasRenderingContext2D;
  private pheromoneTex!: THREE.CanvasTexture;
  private pheromoneQuad!: THREE.Mesh;
  private nestMesh!: THREE.Points;
  private foodMesh!: THREE.Points;

  private renderAccum = 0;
  private antSpeed = 0;

  build(): void {
    const variant = this.rng.int(0, 3);
    const presets = [
      { ants: 150, foods: 3, speed: 50, cellSize: 4 },
      { ants: 300, foods: 5, speed: 70, cellSize: 3 },
      { ants: 60, foods: 2, speed: 35, cellSize: 6 },
      { ants: 200, foods: 4, speed: 90, cellSize: 3 },
    ];
    const p = presets[variant];
    this.glitchAmount = 4;

    const { x, y, w, h } = this.px;
    this.cellSize = p.cellSize;
    this.gridW = Math.ceil(w / this.cellSize);
    this.gridH = Math.ceil(h / this.cellSize);
    this.pheromoneGrid = new Float32Array(this.gridW * this.gridH);
    this.antSpeed = p.speed;

    // Nest at center
    this.nestX = x + w / 2;
    this.nestY = y + h / 2;

    // Random food sources
    for (let i = 0; i < p.foods; i++) {
      this.foodX.push(x + this.rng.float(w * 0.15, w * 0.85));
      this.foodY.push(y + this.rng.float(h * 0.15, h * 0.85));
    }

    // Initialize ants at nest
    this.antCount = p.ants;
    this.antX = new Float32Array(this.antCount);
    this.antY = new Float32Array(this.antCount);
    this.antAngle = new Float32Array(this.antCount);
    this.antCarrying = new Uint8Array(this.antCount);

    for (let i = 0; i < this.antCount; i++) {
      this.antX[i] = this.nestX + this.rng.float(-10, 10);
      this.antY[i] = this.nestY + this.rng.float(-10, 10);
      this.antAngle[i] = this.rng.float(0, Math.PI * 2);
      this.antCarrying[i] = 0;
    }

    // Pheromone canvas
    this.pheromoneCanvas = document.createElement('canvas');
    this.pheromoneCanvas.width = this.gridW;
    this.pheromoneCanvas.height = this.gridH;
    this.pheromoneCtx = this.get2DContext(this.pheromoneCanvas);
    this.pheromoneTex = new THREE.CanvasTexture(this.pheromoneCanvas);
    this.pheromoneTex.minFilter = THREE.LinearFilter;
    this.pheromoneTex.magFilter = THREE.LinearFilter;

    const qg = new THREE.PlaneGeometry(w, h);
    this.pheromoneQuad = new THREE.Mesh(qg, new THREE.MeshBasicMaterial({ map: this.pheromoneTex, transparent: true, opacity: 0 }));
    this.pheromoneQuad.position.set(x + w / 2, y + h / 2, -0.5);
    this.group.add(this.pheromoneQuad);

    // Ant points
    const ap = new Float32Array(this.antCount * 3);
    const ag = new THREE.BufferGeometry();
    ag.setAttribute('position', new THREE.BufferAttribute(ap, 3));
    this.antMesh = new THREE.Points(ag, new THREE.PointsMaterial({ color: this.palette.primary, transparent: true, opacity: 0, size: 1.5, sizeAttenuation: false }));
    this.group.add(this.antMesh);

    // Nest point
    const np = new Float32Array([this.nestX, this.nestY, 1]);
    const ng = new THREE.BufferGeometry();
    ng.setAttribute('position', new THREE.BufferAttribute(np, 3));
    this.nestMesh = new THREE.Points(ng, new THREE.PointsMaterial({ color: this.palette.secondary, transparent: true, opacity: 0, size: 6, sizeAttenuation: false }));
    this.group.add(this.nestMesh);

    // Food points
    const fp = new Float32Array(this.foodX.length * 3);
    for (let i = 0; i < this.foodX.length; i++) {
      fp[i * 3] = this.foodX[i]; fp[i * 3 + 1] = this.foodY[i]; fp[i * 3 + 2] = 1;
    }
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.BufferAttribute(fp, 3));
    this.foodMesh = new THREE.Points(fg, new THREE.PointsMaterial({ color: this.palette.secondary, transparent: true, opacity: 0, size: 5, sizeAttenuation: false }));
    this.group.add(this.foodMesh);
  }

  private samplePheromone(wx: number, wy: number): number {
    const { x, y } = this.px;
    const gx = Math.floor((wx - x) / this.cellSize);
    const gy = Math.floor((wy - y) / this.cellSize);
    if (gx < 0 || gx >= this.gridW || gy < 0 || gy >= this.gridH) return 0;
    return this.pheromoneGrid[gy * this.gridW + gx];
  }

  private depositPheromone(wx: number, wy: number, amount: number): void {
    const { x, y } = this.px;
    const gx = Math.floor((wx - x) / this.cellSize);
    const gy = Math.floor((wy - y) / this.cellSize);
    if (gx >= 0 && gx < this.gridW && gy >= 0 && gy < this.gridH) {
      this.pheromoneGrid[gy * this.gridW + gx] = Math.min(1.0, this.pheromoneGrid[gy * this.gridW + gx] + amount);
    }
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);
    const { x, y, w, h } = this.px;
    const cdt = Math.min(dt, 0.033);

    // Evaporate pheromones
    const decay = 1 - 0.3 * cdt;
    for (let i = 0; i < this.pheromoneGrid.length; i++) {
      this.pheromoneGrid[i] *= decay;
      if (this.pheromoneGrid[i] < 0.001) this.pheromoneGrid[i] = 0;
    }

    // Update ants
    const sensorDist = 8;
    const sensorAngle = 0.5;
    for (let i = 0; i < this.antCount; i++) {
      // Sense pheromones in 3 directions
      const fwd = this.samplePheromone(
        this.antX[i] + Math.cos(this.antAngle[i]) * sensorDist,
        this.antY[i] + Math.sin(this.antAngle[i]) * sensorDist
      );
      const left = this.samplePheromone(
        this.antX[i] + Math.cos(this.antAngle[i] - sensorAngle) * sensorDist,
        this.antY[i] + Math.sin(this.antAngle[i] - sensorAngle) * sensorDist
      );
      const right = this.samplePheromone(
        this.antX[i] + Math.cos(this.antAngle[i] + sensorAngle) * sensorDist,
        this.antY[i] + Math.sin(this.antAngle[i] + sensorAngle) * sensorDist
      );

      // Steer toward strongest pheromone
      if (left > fwd && left > right) this.antAngle[i] -= 0.3;
      else if (right > fwd && right > left) this.antAngle[i] += 0.3;
      // Random wander
      this.antAngle[i] += (this.rng.next() - 0.5) * 0.6;

      // Move
      this.antX[i] += Math.cos(this.antAngle[i]) * this.antSpeed * cdt;
      this.antY[i] += Math.sin(this.antAngle[i]) * this.antSpeed * cdt;

      // Bounce off edges
      if (this.antX[i] < x + 2) { this.antX[i] = x + 2; this.antAngle[i] = Math.PI - this.antAngle[i]; }
      if (this.antX[i] > x + w - 2) { this.antX[i] = x + w - 2; this.antAngle[i] = Math.PI - this.antAngle[i]; }
      if (this.antY[i] < y + 2) { this.antY[i] = y + 2; this.antAngle[i] = -this.antAngle[i]; }
      if (this.antY[i] > y + h - 2) { this.antY[i] = y + h - 2; this.antAngle[i] = -this.antAngle[i]; }

      if (this.antCarrying[i] === 0) {
        // Searching: check if near food
        for (let f = 0; f < this.foodX.length; f++) {
          const d = Math.hypot(this.antX[i] - this.foodX[f], this.antY[i] - this.foodY[f]);
          if (d < 12) {
            this.antCarrying[i] = 1;
            this.antAngle[i] += Math.PI; // turn around
            break;
          }
        }
      } else {
        // Returning: deposit pheromone and check if near nest
        this.depositPheromone(this.antX[i], this.antY[i], 0.15);
        const d = Math.hypot(this.antX[i] - this.nestX, this.antY[i] - this.nestY);
        if (d < 12) {
          this.antCarrying[i] = 0;
          this.antAngle[i] += Math.PI;
        }
      }
    }

    // Render pheromone canvas
    this.renderAccum += dt;
    if (this.renderAccum >= 0.08) {
      this.renderAccum = 0;
      const img = this.pheromoneCtx.getImageData(0, 0, this.gridW, this.gridH);
      const data = img.data;
      const cr = Math.floor(this.palette.secondary.r * 255);
      const cg = Math.floor(this.palette.secondary.g * 255);
      const cb = Math.floor(this.palette.secondary.b * 255);
      for (let i = 0; i < this.pheromoneGrid.length; i++) {
        const v = this.pheromoneGrid[i];
        data[i * 4] = cr * v;
        data[i * 4 + 1] = cg * v;
        data[i * 4 + 2] = cb * v;
        data[i * 4 + 3] = v > 0.01 ? 255 : 0;
      }
      this.pheromoneCtx.putImageData(img, 0, 0);
      this.pheromoneTex.needsUpdate = true;
    }

    // GPU: ants
    const apos = this.antMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < this.antCount; i++) apos.setXYZ(i, this.antX[i], this.antY[i], 0.5);
    apos.needsUpdate = true;

    (this.antMesh.material as THREE.PointsMaterial).opacity = opacity * 0.9;
    (this.pheromoneQuad.material as THREE.MeshBasicMaterial).opacity = opacity * 0.6;
    (this.nestMesh.material as THREE.PointsMaterial).opacity = opacity;
    (this.foodMesh.material as THREE.PointsMaterial).opacity = opacity * 0.8;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Scramble all ant directions
      for (let i = 0; i < this.antCount; i++) this.antAngle[i] = this.rng.float(0, Math.PI * 2);
    }
    if (action === 'alert') {
      // New food source appears
      const { x, y, w, h } = this.px;
      this.foodX.push(x + this.rng.float(w * 0.1, w * 0.9));
      this.foodY.push(y + this.rng.float(h * 0.1, h * 0.9));
      // Update food mesh
      const fp = new Float32Array(this.foodX.length * 3);
      for (let i = 0; i < this.foodX.length; i++) {
        fp[i * 3] = this.foodX[i]; fp[i * 3 + 1] = this.foodY[i]; fp[i * 3 + 2] = 1;
      }
      this.foodMesh.geometry.setAttribute('position', new THREE.BufferAttribute(fp, 3));
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level >= 3) this.antSpeed *= 1.5;
    if (level >= 5) {
      // Mass pheromone dump
      for (let i = 0; i < this.pheromoneGrid.length; i++) {
        this.pheromoneGrid[i] = Math.min(1, this.pheromoneGrid[i] + 0.3);
      }
    }
  }
}
