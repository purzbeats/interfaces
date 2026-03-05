import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Monte Carlo pi estimation. Random points in a square, counting those
 * inside a quarter circle. The ratio converges to pi/4. Shows accumulating
 * points colored by in/out of the circle. Points geometry with vertex colors.
 */
export class MonteCarloElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'monte-carlo-pi',
    meta: {
      shape: 'rectangular',
      roles: ['data-display'],
      moods: ['diagnostic', 'tactical'],
      bandAffinity: 'high',
      sizes: ['works-small', 'needs-medium', 'needs-large'],
    } satisfies ElementMeta,
  };

  private pointsMesh!: THREE.Points;
  private borderLines!: THREE.LineSegments;
  private arcLine!: THREE.Line;
  private pointsMat!: THREE.PointsMaterial;
  private borderMat!: THREE.LineBasicMaterial;
  private arcMat!: THREE.LineBasicMaterial;

  private maxPoints: number = 2000;
  private pointSize: number = 2;
  private pointsPerSecond: number = 50;
  private currentCount: number = 0;
  private insideCount: number = 0;
  private speedMult: number = 1;
  private accumulator: number = 0;

  // Region geometry
  private rx: number = 0;
  private ry: number = 0;
  private rw: number = 0;
  private rh: number = 0;
  private side: number = 0;

  // Label mesh (optional canvas for pi display)
  private labelCanvas!: HTMLCanvasElement;
  private labelCtx!: CanvasRenderingContext2D;
  private labelTexture!: THREE.CanvasTexture;
  private labelMesh!: THREE.Mesh;

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;

    const variant = this.rng.int(0, 3);
    const presets = [
      { maxPoints: 2000, pointSize: 2, pps: 50 },
      { maxPoints: 4000, pointSize: 1.5, pps: 100 },
      { maxPoints: 1000, pointSize: 3, pps: 30 },
      { maxPoints: 3000, pointSize: 2, pps: 80 },
    ];
    const p = presets[variant];
    this.maxPoints = p.maxPoints;
    this.pointSize = p.pointSize;
    this.pointsPerSecond = p.pps;

    // Use a square region within the available area
    this.side = Math.min(w, h) * 0.85;
    this.rx = x + (w - this.side) / 2;
    this.ry = y + (h - this.side) / 2;
    this.rw = this.side;
    this.rh = this.side;

    // Border
    const bv = new Float32Array([
      this.rx, this.ry, 0, this.rx + this.rw, this.ry, 0,
      this.rx + this.rw, this.ry, 0, this.rx + this.rw, this.ry + this.rh, 0,
      this.rx + this.rw, this.ry + this.rh, 0, this.rx, this.ry + this.rh, 0,
      this.rx, this.ry + this.rh, 0, this.rx, this.ry, 0,
    ]);
    const borderGeo = new THREE.BufferGeometry();
    borderGeo.setAttribute('position', new THREE.BufferAttribute(bv, 3));
    this.borderMat = new THREE.LineBasicMaterial({
      color: this.palette.dim, transparent: true, opacity: 0,
    });
    this.borderLines = new THREE.LineSegments(borderGeo, this.borderMat);
    this.group.add(this.borderLines);

    // Quarter circle arc (from bottom-left corner)
    const arcSegs = 64;
    const arcPos = new Float32Array((arcSegs + 1) * 3);
    for (let i = 0; i <= arcSegs; i++) {
      const angle = (i / arcSegs) * Math.PI / 2;
      arcPos[i * 3] = this.rx + Math.cos(angle) * this.side;
      arcPos[i * 3 + 1] = this.ry + Math.sin(angle) * this.side;
      arcPos[i * 3 + 2] = 0;
    }
    const arcGeo = new THREE.BufferGeometry();
    arcGeo.setAttribute('position', new THREE.BufferAttribute(arcPos, 3));
    this.arcMat = new THREE.LineBasicMaterial({
      color: this.palette.secondary, transparent: true, opacity: 0,
    });
    this.arcLine = new THREE.Line(arcGeo, this.arcMat);
    this.group.add(this.arcLine);

    // Points
    const positions = new Float32Array(this.maxPoints * 3);
    const colors = new Float32Array(this.maxPoints * 3);
    // Fill all positions to origin to avoid undefined
    for (let i = 0; i < this.maxPoints * 3; i++) {
      positions[i] = 0;
      colors[i] = 0;
    }
    const pointsGeo = new THREE.BufferGeometry();
    pointsGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    pointsGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    pointsGeo.setDrawRange(0, 0);

    this.pointsMat = new THREE.PointsMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0,
      size: this.pointSize,
      sizeAttenuation: false,
    });
    this.pointsMesh = new THREE.Points(pointsGeo, this.pointsMat);
    this.group.add(this.pointsMesh);

    // Label canvas for pi estimate — scale with tile size
    const labelW = Math.max(128, Math.round(w * 0.5));
    const labelH = Math.max(24, Math.round(labelW * 0.2));
    this.labelCanvas = document.createElement('canvas');
    this.labelCanvas.width = labelW;
    this.labelCanvas.height = labelH;
    this.labelCtx = this.get2DContext(this.labelCanvas);
    this.labelTexture = new THREE.CanvasTexture(this.labelCanvas);
    this.labelTexture.minFilter = THREE.NearestFilter;
    const planeW = Math.min(w * 0.7, this.side);
    const planeH = planeW * (labelH / labelW);
    const labelGeo = new THREE.PlaneGeometry(planeW, planeH);
    const labelMat = new THREE.MeshBasicMaterial({
      map: this.labelTexture, transparent: true, opacity: 0,
    });
    this.labelMesh = new THREE.Mesh(labelGeo, labelMat);
    // Position below the square region, clamped within tile bounds
    const labelYPos = Math.max(y + planeH / 2, Math.min(y + h - planeH / 2, this.ry - planeH * 0.6));
    this.labelMesh.position.set(x + w / 2, labelYPos, 1);
    this.group.add(this.labelMesh);
  }

  private addPoint(): void {
    if (this.currentCount >= this.maxPoints) {
      this.resetPoints();
      return;
    }

    const nx = this.rng.float(0, 1);
    const ny = this.rng.float(0, 1);
    const dist = Math.sqrt(nx * nx + ny * ny);
    const inside = dist <= 1;
    if (inside) this.insideCount++;

    const px = this.rx + nx * this.side;
    const py = this.ry + ny * this.side;

    const posAttr = this.pointsMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const colAttr = this.pointsMesh.geometry.getAttribute('color') as THREE.BufferAttribute;

    posAttr.setXYZ(this.currentCount, px, py, 0.5);

    const col = inside ? this.palette.primary : this.palette.dim;
    colAttr.setXYZ(this.currentCount, col.r, col.g, col.b);

    this.currentCount++;
    this.pointsMesh.geometry.setDrawRange(0, this.currentCount);
    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
  }

  private resetPoints(): void {
    this.currentCount = 0;
    this.insideCount = 0;
    this.pointsMesh.geometry.setDrawRange(0, 0);
  }

  private updateLabel(): void {
    const piEstimate = this.currentCount > 0 ? (4 * this.insideCount / this.currentCount) : 0;
    const lw = this.labelCanvas.width;
    const lh = this.labelCanvas.height;
    this.labelCtx.clearRect(0, 0, lw, lh);
    this.labelCtx.fillStyle = '#' + this.palette.primary.getHexString();
    const fontSize = Math.max(10, Math.floor(lh * 0.55));
    this.labelCtx.font = `${fontSize}px monospace`;
    this.labelCtx.textAlign = 'center';
    this.labelCtx.fillText(
      `\u03C0 \u2248 ${piEstimate.toFixed(4)}  n=${this.currentCount}`,
      lw / 2, lh * 0.7,
    );
    this.labelTexture.needsUpdate = true;
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);

    this.accumulator += dt * this.pointsPerSecond * this.speedMult;
    const newPoints = Math.floor(this.accumulator);
    this.accumulator -= newPoints;
    for (let i = 0; i < newPoints; i++) {
      this.addPoint();
    }

    this.updateLabel();

    this.pointsMat.opacity = opacity;
    this.borderMat.opacity = opacity * 0.3;
    this.arcMat.opacity = opacity * 0.6;
    (this.labelMesh.material as THREE.MeshBasicMaterial).opacity = opacity * 0.8;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Burst of points
      for (let i = 0; i < 50; i++) {
        this.addPoint();
      }
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) {
      this.speedMult = 1;
      return;
    }
    this.speedMult = 1 + level * 0.8;
    if (level >= 5) {
      this.resetPoints();
    }
  }
}
