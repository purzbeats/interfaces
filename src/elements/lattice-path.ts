import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Dyck paths (Catalan numbers). Random paths from (0,0) to (2n,0) that never
 * go below x-axis. Multiple paths overlaid. Step-by-step animation. Line geometry.
 */
export class LatticePathElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'lattice-path',
    meta: {
      shape: 'rectangular',
      roles: ['data-display', 'decorative'],
      moods: ['diagnostic', 'ambient'],
      bandAffinity: 'high',
      sizes: ['works-small', 'needs-medium'],
    },
  };

  private pathLines: THREE.Line[] = [];
  private paths: number[][] = [];
  private pathN: number = 6;
  private pathCount: number = 5;
  private animSpeed: number = 3;
  private animProgress: number = 0;
  private stepSize: number = 1;
  private ox: number = 0;
  private oy: number = 0;
  private axisLine!: THREE.LineSegments;

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;

    const variant = this.rng.int(0, 3);
    const presets = [
      { pathN: 6, pathCount: 5, animSpeed: 3 },
      { pathN: 8, pathCount: 4, animSpeed: 2.5 },
      { pathN: 5, pathCount: 8, animSpeed: 4 },
      { pathN: 10, pathCount: 3, animSpeed: 2 },
    ];
    const p = presets[variant];
    this.pathN = p.pathN;
    this.pathCount = p.pathCount;
    this.animSpeed = p.animSpeed;

    const totalSteps = 2 * this.pathN;
    const padX = w * 0.08;
    const padY = h * 0.12;
    this.stepSize = (w - padX * 2) / totalSteps;
    this.ox = x + padX;
    this.oy = y + h - padY;

    // Generate Dyck paths using ballot-style generation
    for (let pi = 0; pi < this.pathCount; pi++) {
      const path = this.generateDyckPath(this.pathN);
      this.paths.push(path);
    }

    // Axis line (x-axis)
    const axisPos = new Float32Array(6);
    axisPos[0] = this.ox;
    axisPos[1] = this.oy;
    axisPos[2] = 0;
    axisPos[3] = this.ox + totalSteps * this.stepSize;
    axisPos[4] = this.oy;
    axisPos[5] = 0;
    const axisGeo = new THREE.BufferGeometry();
    axisGeo.setAttribute('position', new THREE.BufferAttribute(axisPos, 3));
    this.axisLine = new THREE.LineSegments(axisGeo, new THREE.LineBasicMaterial({
      color: this.palette.dim, transparent: true, opacity: 0,
    }));
    this.group.add(this.axisLine);

    // Create line for each path
    for (let pi = 0; pi < this.pathCount; pi++) {
      const totalPts = totalSteps + 1;
      const pos = new Float32Array(totalPts * 3);
      // Fill initial positions at the origin
      for (let i = 0; i < totalPts; i++) {
        pos[i * 3] = this.ox;
        pos[i * 3 + 1] = this.oy;
        pos[i * 3 + 2] = 1;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setDrawRange(0, 0);
      const t = pi / Math.max(this.pathCount - 1, 1);
      const col = new THREE.Color().copy(this.palette.dim).lerp(this.palette.primary, t);
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
        color: col, transparent: true, opacity: 0,
      }));
      this.group.add(line);
      this.pathLines.push(line);
    }
  }

  /** Generate a valid Dyck path of semi-length n. Returns array of y-values at each step. */
  private generateDyckPath(n: number): number[] {
    const totalSteps = 2 * n;
    // Use rejection method: generate random balanced parentheses that stay >= 0
    for (let attempt = 0; attempt < 100; attempt++) {
      const yValues: number[] = [0];
      let yy = 0;
      let ups = 0;
      let valid = true;
      for (let s = 0; s < totalSteps; s++) {
        const remaining = totalSteps - s;
        const upsNeeded = n - ups;
        const downsNeeded = remaining - upsNeeded;
        // Must go up if y would go negative, or if we need all remaining to be ups
        let goUp: boolean;
        if (yy === 0) {
          goUp = true;
        } else if (ups >= n) {
          goUp = false;
        } else {
          // Probability proportional to valid continuations
          goUp = this.rng.float(0, 1) < (upsNeeded / remaining);
        }
        if (goUp) {
          yy++;
          ups++;
        } else {
          yy--;
        }
        if (yy < 0) { valid = false; break; }
        yValues.push(yy);
      }
      if (valid && yy === 0) return yValues;
    }
    // Fallback: simple up-then-down
    const yValues: number[] = [0];
    for (let i = 1; i <= n; i++) yValues.push(i);
    for (let i = n - 1; i >= 0; i--) yValues.push(i);
    return yValues;
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);
    const totalSteps = 2 * this.pathN;
    this.animProgress += dt * this.animSpeed;

    // Cycle animation
    if (this.animProgress > totalSteps + 3) {
      this.animProgress = 0;
      // Regenerate paths
      this.paths = [];
      for (let pi = 0; pi < this.pathCount; pi++) {
        this.paths.push(this.generateDyckPath(this.pathN));
      }
    }

    const stepsShown = Math.min(Math.floor(this.animProgress), totalSteps);
    const yScale = this.stepSize * 1.5;

    for (let pi = 0; pi < this.pathCount; pi++) {
      const path = this.paths[pi];
      const attr = this.pathLines[pi].geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i <= stepsShown; i++) {
        attr.setXYZ(i,
          this.ox + i * this.stepSize,
          this.oy - path[i] * yScale,
          1,
        );
      }
      attr.needsUpdate = true;
      this.pathLines[pi].geometry.setDrawRange(0, stepsShown + 1);
      const t = pi / Math.max(this.pathCount - 1, 1);
      (this.pathLines[pi].material as THREE.LineBasicMaterial).opacity = opacity * (0.3 + 0.5 * t);
    }

    (this.axisLine.material as THREE.LineBasicMaterial).opacity = opacity * 0.25;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      this.animProgress = 0;
      this.paths = [];
      for (let pi = 0; pi < this.pathCount; pi++) {
        this.paths.push(this.generateDyckPath(this.pathN));
      }
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) return;
    this.animSpeed = 3 + level * 1.5;
  }
}
