import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

interface PackedCircle {
  x: number;
  y: number;
  r: number;
  depth: number;
}

/**
 * Apollonian circle packing / gasket. Circles fit into gaps between other
 * circles, filling space fractally. Rendered as wireframe circles with
 * depth-based coloring. Slowly rotates and breathes.
 */
export class ApollonianGasketElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'apollonian-gasket',
    meta: {
      shape: 'radial',
      roles: ['decorative'],
      moods: ['ambient'],
      sizes: ['needs-medium', 'needs-large'],
    } satisfies ElementMeta,
  };

  private circles: PackedCircle[] = [];
  private circleMeshes: THREE.Line[] = [];
  private circleMats: THREE.LineBasicMaterial[] = [];
  private borderLines!: THREE.LineSegments;
  private borderMat!: THREE.LineBasicMaterial;

  private cx: number = 0;
  private cy: number = 0;
  private outerRadius: number = 0;
  private maxDepth: number = 0;
  private minRadius: number = 0;
  private rotSpeed: number = 0;
  private breathSpeed: number = 0;
  private breathAmp: number = 0;
  private circleSegments: number = 32;
  private intensityLevel: number = 0;

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;
    this.cx = x + w / 2;
    this.cy = y + h / 2;
    this.outerRadius = Math.min(w, h) * 0.42;

    const variant = this.rng.int(0, 3);
    const presets = [
      { maxDepth: 5, minR: 3, rot: 0.05, breath: 0.3, bAmp: 0.05 },
      { maxDepth: 6, minR: 2, rot: 0.03, breath: 0.2, bAmp: 0.08 },
      { maxDepth: 4, minR: 5, rot: 0.1, breath: 0.5, bAmp: 0.04 },
      { maxDepth: 7, minR: 1.5, rot: -0.04, breath: 0.15, bAmp: 0.06 },
    ];
    const p = presets[variant];
    this.maxDepth = p.maxDepth;
    this.minRadius = p.minR;
    this.rotSpeed = p.rot;
    this.breathSpeed = p.breath;
    this.breathAmp = p.bAmp;

    // Generate Apollonian gasket
    this.generateGasket();

    // Create line objects for each circle
    for (const circle of this.circles) {
      const positions = new Float32Array((this.circleSegments + 1) * 3);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

      const t = Math.min(circle.depth / this.maxDepth, 1);
      const color = new THREE.Color().copy(this.palette.primary).lerp(this.palette.secondary, t);
      const mat = new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity: 0,
      });
      const line = new THREE.Line(geo, mat);
      this.group.add(line);
      this.circleMeshes.push(line);
      this.circleMats.push(mat);
    }

    // Border
    const bv = new Float32Array([
      x, y, 0, x + w, y, 0, x + w, y, 0, x + w, y + h, 0,
      x + w, y + h, 0, x, y + h, 0, x, y + h, 0, x, y, 0,
    ]);
    const bGeo = new THREE.BufferGeometry();
    bGeo.setAttribute('position', new THREE.BufferAttribute(bv, 3));
    this.borderMat = new THREE.LineBasicMaterial({
      color: this.palette.dim, transparent: true, opacity: 0,
    });
    this.borderLines = new THREE.LineSegments(bGeo, this.borderMat);
    this.group.add(this.borderLines);
  }

  private generateGasket(): void {
    this.circles = [];
    const R = this.outerRadius;

    // Start with three mutually tangent circles inside the outer circle
    // Descartes circle theorem approach simplified: use 3 equal circles
    const innerR = R / (1 + 2 / Math.sqrt(3));
    const centerDist = R - innerR;

    const c1: PackedCircle = { x: 0, y: -centerDist, r: innerR, depth: 0 };
    const c2: PackedCircle = {
      x: centerDist * Math.cos(Math.PI / 6),
      y: centerDist * Math.sin(Math.PI / 6),
      r: innerR,
      depth: 0,
    };
    const c3: PackedCircle = {
      x: -centerDist * Math.cos(Math.PI / 6),
      y: centerDist * Math.sin(Math.PI / 6),
      r: innerR,
      depth: 0,
    };

    this.circles.push(c1, c2, c3);

    // Recursively fill gaps using Descartes theorem
    this.fillGap(c1, c2, { x: 0, y: 0, r: -R, depth: -1 }, 1);
    this.fillGap(c2, c3, { x: 0, y: 0, r: -R, depth: -1 }, 1);
    this.fillGap(c3, c1, { x: 0, y: 0, r: -R, depth: -1 }, 1);
    // Center soddy circle
    this.fillGap(c1, c2, c3, 1);
  }

  private fillGap(c1: PackedCircle, c2: PackedCircle, c3: PackedCircle, depth: number): void {
    if (depth > this.maxDepth) return;

    // Descartes circle theorem: k4 = k1 + k2 + k3 + 2*sqrt(k1*k2 + k2*k3 + k3*k1)
    const k1 = 1 / c1.r;
    const k2 = 1 / c2.r;
    const k3 = 1 / c3.r;
    const sum = k1 + k2 + k3;
    const disc = k1 * k2 + k2 * k3 + k3 * k1;
    if (disc < 0) return;
    const k4 = sum + 2 * Math.sqrt(disc);
    const r4 = Math.abs(1 / k4);

    if (r4 < this.minRadius) return;

    // Find center using complex Descartes theorem (approximate with geometry)
    // Place new circle tangent to all three
    const cx = (c1.x / c1.r + c2.x / c2.r + c3.x / c3.r) / (k1 + k2 + k3) * (k4 / (k1 + k2 + k3)) * (k1 + k2 + k3) / k4;
    // Simplified: find position by solving tangency constraints
    const newCircle = this.findTangentCircle(c1, c2, c3, r4, depth);
    if (!newCircle) return;

    this.circles.push(newCircle);

    // Recurse into 3 new gaps
    this.fillGap(c1, c2, newCircle, depth + 1);
    this.fillGap(c2, c3, newCircle, depth + 1);
    this.fillGap(c3, c1, newCircle, depth + 1);
  }

  private findTangentCircle(c1: PackedCircle, c2: PackedCircle, c3: PackedCircle, r: number, depth: number): PackedCircle | null {
    // Numerically find circle center tangent to c1, c2, c3 with radius r
    // Start from centroid of the three circles
    let x = (c1.x + c2.x + c3.x) / 3;
    let y = (c1.y + c2.y + c3.y) / 3;

    for (let iter = 0; iter < 30; iter++) {
      let fx = 0, fy = 0;
      const targets = [c1, c2, c3];
      for (const c of targets) {
        const dx = x - c.x;
        const dy = y - c.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 0.001) continue;
        const targetDist = c.r < 0 ? Math.abs(c.r) - r : c.r + r;
        const error = dist - targetDist;
        fx -= (dx / dist) * error * 0.3;
        fy -= (dy / dist) * error * 0.3;
      }
      x += fx;
      y += fy;
      if (Math.abs(fx) < 0.01 && Math.abs(fy) < 0.01) break;
    }

    // Verify within outer radius
    const distFromCenter = Math.sqrt(x * x + y * y);
    if (distFromCenter + r > this.outerRadius * 1.05) return null;

    return { x, y, r, depth };
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    const rotation = time * this.rotSpeed;
    const breath = 1 + Math.sin(time * this.breathSpeed * Math.PI * 2) * this.breathAmp;
    const cosR = Math.cos(rotation);
    const sinR = Math.sin(rotation);

    for (let ci = 0; ci < this.circles.length; ci++) {
      const c = this.circles[ci];
      // Rotate around center
      const rx = c.x * cosR - c.y * sinR;
      const ry = c.x * sinR + c.y * cosR;
      const worldX = this.cx + rx * breath;
      const worldY = this.cy + ry * breath;
      const r = c.r * breath;

      const pos = this.circleMeshes[ci].geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let s = 0; s <= this.circleSegments; s++) {
        const a = (s / this.circleSegments) * Math.PI * 2;
        pos.setXYZ(s, worldX + Math.cos(a) * r, worldY + Math.sin(a) * r, 0);
      }
      pos.needsUpdate = true;

      const depthFade = 1 - c.depth / (this.maxDepth + 1) * 0.5;
      this.circleMats[ci].opacity = opacity * depthFade * 0.6;
    }

    this.borderMat.opacity = opacity * 0.2;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') { this.rotSpeed *= -1; }
    if (action === 'pulse') {
      this.breathAmp *= 4;
      setTimeout(() => { this.breathAmp /= 4; }, 600);
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    this.intensityLevel = level;
    if (level === 0) return;
    this.rotSpeed = Math.sign(this.rotSpeed || 1) * (0.05 + level * 0.03);
  }
}
