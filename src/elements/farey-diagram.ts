import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Farey sequence visualized on a circle.
 * Fractions p/q and r/s are connected by an arc if |ps - qr| = 1.
 * Produces beautiful nested arc / Ford circle patterns.
 */
export class FareyDiagramElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'farey-diagram',
    meta: {
      shape: 'radial',
      roles: ['decorative', 'data-display'],
      moods: ['ambient'],
      bandAffinity: 'high',
      sizes: ['needs-medium', 'needs-large'],
    },
  };

  private arcLines!: THREE.LineSegments;
  private circleLine!: THREE.Line;
  private cx: number = 0;
  private cy: number = 0;
  private radius: number = 0;
  private fareyOrder: number = 6;
  private rotSpeed: number = 0.05;
  private arcCount: number = 0;
  private revealProgress: number = 0;
  private revealSpeed: number = 0.2;

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;
    this.cx = x + w / 2;
    this.cy = y + h / 2;
    this.radius = Math.min(w, h) * 0.42;

    const variant = this.rng.int(0, 3);
    const presets = [
      { order: 6, rotSpeed: 0.05, revealSpeed: 0.2, arcSegments: 16 },
      { order: 8, rotSpeed: 0.03, revealSpeed: 0.15, arcSegments: 20 },
      { order: 5, rotSpeed: 0.08, revealSpeed: 0.3, arcSegments: 12 },
      { order: 10, rotSpeed: 0.02, revealSpeed: 0.1, arcSegments: 24 },
    ];
    const p = presets[variant];

    this.fareyOrder = p.order;
    this.rotSpeed = p.rotSpeed;
    this.revealSpeed = p.revealSpeed;

    // Generate Farey sequence F_n
    const fractions: Array<[number, number]> = [];
    for (let q = 1; q <= this.fareyOrder; q++) {
      for (let pn = 0; pn <= q; pn++) {
        if (this.gcd(pn, q) === 1) {
          fractions.push([pn, q]);
        }
      }
    }
    // Sort by value
    fractions.sort((a, b) => a[0] / a[1] - b[0] / b[1]);

    // Find Farey neighbors: |ps - qr| = 1
    const pairs: Array<[number, number]> = [];
    for (let i = 0; i < fractions.length; i++) {
      for (let j = i + 1; j < fractions.length; j++) {
        const [pi, qi] = fractions[i];
        const [pj, qj] = fractions[j];
        if (Math.abs(pi * qj - qi * pj) === 1) {
          pairs.push([i, j]);
        }
      }
    }

    // Map fractions to angles on a circle [0, 2*PI]
    const angles = fractions.map(([pn, q]) => (pn / q) * Math.PI * 2);

    // Build arc segments: each pair connected by a chord (line segment)
    // For visual beauty, use multiple segments per arc (semicircular arcs)
    const segsPerArc = p.arcSegments;
    this.arcCount = pairs.length;
    const totalVerts = this.arcCount * segsPerArc * 2; // LineSegments needs pairs
    const arcPos = new Float32Array(totalVerts * 3);

    for (let a = 0; a < pairs.length; a++) {
      const [i, j] = pairs[a];
      const a1 = angles[i];
      const a2 = angles[j];

      // Draw a geodesic arc (chord through interior, bent inward)
      // Use a semicircular arc between the two points, curving inward
      const midAngle = (a1 + a2) / 2;
      let dAngle = a2 - a1;
      if (dAngle > Math.PI) dAngle -= Math.PI * 2;
      if (dAngle < -Math.PI) dAngle += Math.PI * 2;
      const arcRadius = Math.abs(this.radius * Math.sin(dAngle / 2));
      const depth = this.radius * (1 - Math.abs(Math.cos(dAngle / 2))) * 0.5;

      for (let s = 0; s < segsPerArc; s++) {
        const t0 = s / segsPerArc;
        const t1 = (s + 1) / segsPerArc;

        const getPoint = (t: number): [number, number] => {
          const angle = a1 + dAngle * t;
          const inward = 1 - Math.sin(t * Math.PI) * depth / this.radius;
          const r = this.radius * inward;
          return [this.cx + Math.cos(angle) * r, this.cy + Math.sin(angle) * r];
        };

        const [x0, y0] = getPoint(t0);
        const [x1, y1] = getPoint(t1);

        const base = (a * segsPerArc + s) * 6;
        arcPos[base] = x0;
        arcPos[base + 1] = y0;
        arcPos[base + 2] = 0;
        arcPos[base + 3] = x1;
        arcPos[base + 4] = y1;
        arcPos[base + 5] = 0;
      }
    }

    const arcGeo = new THREE.BufferGeometry();
    arcGeo.setAttribute('position', new THREE.BufferAttribute(arcPos, 3));
    this.arcLines = new THREE.LineSegments(arcGeo, new THREE.LineBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.arcLines);

    // Outer circle
    const circleSegs = 128;
    const circlePos = new Float32Array((circleSegs + 1) * 3);
    for (let i = 0; i <= circleSegs; i++) {
      const angle = (i / circleSegs) * Math.PI * 2;
      circlePos[i * 3] = this.cx + Math.cos(angle) * this.radius;
      circlePos[i * 3 + 1] = this.cy + Math.sin(angle) * this.radius;
      circlePos[i * 3 + 2] = 0;
    }
    const circleGeo = new THREE.BufferGeometry();
    circleGeo.setAttribute('position', new THREE.BufferAttribute(circlePos, 3));
    this.circleLine = new THREE.Line(circleGeo, new THREE.LineBasicMaterial({
      color: this.palette.secondary,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.circleLine);
  }

  private gcd(a: number, b: number): number {
    while (b) { const t = b; b = a % b; a = t; }
    return a;
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);

    this.revealProgress = Math.min(this.revealProgress + dt * this.revealSpeed, 1);

    // Slow rotation
    const rot = time * this.rotSpeed;
    this.group.rotation.z = 0; // We rotate positions instead

    // Update arc positions with rotation
    const pos = this.arcLines.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    for (let i = 0; i < arr.length; i += 3) {
      const dx = arr[i] - this.cx;
      const dy = arr[i + 1] - this.cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const angle = Math.atan2(dy, dx) + rot * 0.001; // very subtle drift
      arr[i] = this.cx + Math.cos(angle) * dist;
      arr[i + 1] = this.cy + Math.sin(angle) * dist;
    }
    pos.needsUpdate = true;

    const visibleSegments = Math.floor(this.revealProgress * this.arcCount * 16) * 2;
    this.arcLines.geometry.setDrawRange(0, visibleSegments);

    (this.arcLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.6;
    (this.circleLine.material as THREE.LineBasicMaterial).opacity = opacity * 0.8;
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
      this.revealSpeed = 0.2 + level * 0.15;
    }
  }
}
