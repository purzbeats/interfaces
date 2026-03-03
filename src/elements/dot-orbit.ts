import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

interface OrbitalDot {
  orbitIndex: number;   // which orbit ring this dot belongs to
  angle: number;        // current angle in radians
  speed: number;        // radians per second (signed for direction)
  radiusX: number;      // semi-major axis
  radiusY: number;      // semi-minor axis (equal to radiusX for circular, less for elliptical)
  dotIndex: number;     // index in the points buffer
}

/**
 * Multiple dots orbiting around a central point at different radii and speeds.
 * Like electrons around a nucleus. Connecting lines optional per variant.
 * Variants: 2 circular orbits, 3 circular orbits, elliptical orbits, orbits with connecting lines.
 */
export class DotOrbitElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'dot-orbit',
    meta: {
      shape: 'radial',
      roles: ['decorative', 'data-display'],
      moods: ['ambient', 'diagnostic'],
      sizes: ['works-small', 'needs-medium'],
      bandAffinity: 'bass',
    },
  };

  private dotsMesh!: THREE.Points;
  private orbitRings: THREE.Line[] = [];
  private connectLines: THREE.LineSegments | null = null;
  private nucleusMesh!: THREE.Mesh;
  private orbitDots: OrbitalDot[] = [];
  private variant: number = 0;
  private cx: number = 0;
  private cy: number = 0;
  private alertMode: boolean = false;
  private speedMultiplier: number = 1;
  private baseSpeedMultiplier: number = 1;

  build(): void {
    this.variant = this.rng.int(0, 3);
    const { x, y, w, h } = this.px;
    this.cx = x + w / 2;
    this.cy = y + h / 2;

    const maxR = Math.min(w, h) / 2 * 0.85;

    const presets = [
      // 2 circular orbits, 1-2 dots each
      { orbitCount: 2, dotsPerOrbit: [1, 2], elliptical: false, hasConnectLines: false },
      // 3 circular orbits, varying dot count
      { orbitCount: 3, dotsPerOrbit: [1, 2, 3], elliptical: false, hasConnectLines: false },
      // 2 elliptical orbits, 1-2 dots each
      { orbitCount: 2, dotsPerOrbit: [2, 1], elliptical: true, hasConnectLines: false },
      // 2 orbits with connecting lines between dots
      { orbitCount: 2, dotsPerOrbit: [2, 3], elliptical: false, hasConnectLines: true },
    ];
    const p = presets[this.variant];

    // Build orbit rings and dots
    let dotIndex = 0;
    const dotPositions: number[] = [];
    const dotColors: number[] = [];

    for (let o = 0; o < p.orbitCount; o++) {
      const orbitFrac = (o + 1) / (p.orbitCount + 0.5);
      const rx = maxR * orbitFrac;
      const ry = p.elliptical ? rx * this.rng.float(0.4, 0.7) : rx;

      // Draw the orbit ring ellipse
      const ringSegments = 64;
      const ringPositions = new Float32Array((ringSegments + 1) * 3);
      for (let s = 0; s <= ringSegments; s++) {
        const a = (s / ringSegments) * Math.PI * 2;
        ringPositions[s * 3 + 0] = this.cx + Math.cos(a) * rx;
        ringPositions[s * 3 + 1] = this.cy + Math.sin(a) * ry;
        ringPositions[s * 3 + 2] = 0;
      }
      const ringGeo = new THREE.BufferGeometry();
      ringGeo.setAttribute('position', new THREE.BufferAttribute(ringPositions, 3));
      const ring = new THREE.Line(ringGeo, new THREE.LineBasicMaterial({
        color: this.palette.dim,
        transparent: true,
        opacity: 0,
      }));
      this.orbitRings.push(ring);
      this.group.add(ring);

      // Dots for this orbit
      const dotsOnOrbit = p.dotsPerOrbit[o] ?? 1;
      const baseSpeed = this.rng.float(0.5, 1.5) * (this.rng.chance(0.3) ? -1 : 1);
      for (let d = 0; d < dotsOnOrbit; d++) {
        const startAngle = (d / dotsOnOrbit) * Math.PI * 2 + this.rng.float(0, 0.5);
        this.orbitDots.push({
          orbitIndex: o,
          angle: startAngle,
          speed: baseSpeed * this.rng.float(0.8, 1.2),
          radiusX: rx,
          radiusY: ry,
          dotIndex: dotIndex,
        });
        dotPositions.push(this.cx + Math.cos(startAngle) * rx, this.cy + Math.sin(startAngle) * ry, 2);
        // Alternate colors: primary for inner, secondary for outer
        const c = o % 2 === 0 ? this.palette.primary : this.palette.secondary;
        dotColors.push(c.r, c.g, c.b);
        dotIndex++;
      }
    }

    // Dot points mesh
    const posArr = new Float32Array(dotPositions);
    const colArr = new Float32Array(dotColors);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colArr, 3));
    const dotSize = Math.max(3, maxR * 0.06);
    this.dotsMesh = new THREE.Points(geo, new THREE.PointsMaterial({
      vertexColors: true,
      size: dotSize,
      transparent: true,
      opacity: 0,
      sizeAttenuation: false,
    }));
    this.group.add(this.dotsMesh);

    // Nucleus (center dot)
    const nucR = Math.max(3, maxR * 0.05);
    const nucGeo = new THREE.CircleGeometry(nucR, 16);
    this.nucleusMesh = new THREE.Mesh(nucGeo, new THREE.MeshBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
    }));
    this.nucleusMesh.position.set(this.cx, this.cy, 3);
    this.group.add(this.nucleusMesh);

    // Connecting lines (variant 3): lines between all dots
    if (p.hasConnectLines) {
      const maxLines = (dotIndex * (dotIndex - 1)) / 2;
      const linePositions = new Float32Array(maxLines * 2 * 3);
      const lineColors = new Float32Array(maxLines * 2 * 3);
      const lineGeo = new THREE.BufferGeometry();
      lineGeo.setAttribute('position', new THREE.BufferAttribute(linePositions, 3));
      lineGeo.setAttribute('color', new THREE.BufferAttribute(lineColors, 3));
      lineGeo.setDrawRange(0, 0);
      this.connectLines = new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0,
      }));
      this.group.add(this.connectLines);
    }
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    const effectiveSpeed = this.speedMultiplier;

    // Advance all orbiting dots
    for (const dot of this.orbitDots) {
      dot.angle += dot.speed * effectiveSpeed * dt;
    }

    // Update dot positions
    const positions = this.dotsMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    const gx = this.group.position.x;

    for (const dot of this.orbitDots) {
      const px = this.cx + Math.cos(dot.angle) * dot.radiusX + gx;
      const py = this.cy + Math.sin(dot.angle) * dot.radiusY;
      positions.setXYZ(dot.dotIndex, px, py, 2);
    }
    positions.needsUpdate = true;

    // Nucleus pulse
    const nucPulse = 0.6 + 0.4 * Math.sin(time * 2.5);
    const primary = this.alertMode ? this.palette.alert : this.palette.primary;
    (this.nucleusMesh.material as THREE.MeshBasicMaterial).color.copy(primary);
    (this.nucleusMesh.material as THREE.MeshBasicMaterial).opacity = opacity * nucPulse;
    this.nucleusMesh.position.x = this.cx + gx;

    // Orbit rings: subtle dim opacity
    for (const ring of this.orbitRings) {
      const mat = ring.material as THREE.LineBasicMaterial;
      mat.opacity = opacity * 0.2;
      // Shift ring positions with group glitch
      const rpos = ring.geometry.getAttribute('position') as THREE.BufferAttribute;
      // Rings are static in local space — group.position.x handles glitch drift
    }

    // Dot material opacity
    (this.dotsMesh.material as THREE.PointsMaterial).opacity = opacity;

    // Connecting lines update
    if (this.connectLines) {
      const linePos = this.connectLines.geometry.getAttribute('position') as THREE.BufferAttribute;
      const lineCol = this.connectLines.geometry.getAttribute('color') as THREE.BufferAttribute;
      let li = 0;
      const maxDist = Math.min(this.px.w, this.px.h) * 0.45;
      const maxLines = (this.orbitDots.length * (this.orbitDots.length - 1)) / 2;

      for (let a = 0; a < this.orbitDots.length && li < maxLines; a++) {
        for (let b = a + 1; b < this.orbitDots.length && li < maxLines; b++) {
          const da = this.orbitDots[a];
          const db = this.orbitDots[b];
          const ax = this.cx + Math.cos(da.angle) * da.radiusX + gx;
          const ay = this.cy + Math.sin(da.angle) * da.radiusY;
          const bx = this.cx + Math.cos(db.angle) * db.radiusX + gx;
          const by = this.cy + Math.sin(db.angle) * db.radiusY;
          const dist = Math.sqrt((bx - ax) ** 2 + (by - ay) ** 2);
          const fade = Math.max(0, 1 - dist / maxDist);

          linePos.setXYZ(li * 2,     ax, ay, 1);
          linePos.setXYZ(li * 2 + 1, bx, by, 1);
          lineCol.setXYZ(li * 2,     primary.r * fade, primary.g * fade, primary.b * fade);
          lineCol.setXYZ(li * 2 + 1, primary.r * fade, primary.g * fade, primary.b * fade);
          li++;
        }
      }
      linePos.needsUpdate = true;
      lineCol.needsUpdate = true;
      this.connectLines.geometry.setDrawRange(0, li * 2);
      (this.connectLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.4;
    }
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Scatter speeds temporarily
      for (const dot of this.orbitDots) {
        dot.speed *= -1.5;
      }
      setTimeout(() => {
        for (const dot of this.orbitDots) {
          dot.speed = Math.sign(dot.speed) * Math.abs(dot.speed) / 1.5;
          dot.speed *= -1; // restore original direction
        }
      }, 500);
    }
    if (action === 'alert') {
      this.alertMode = true;
      this.speedMultiplier = 3;
      this.pulseTimer = 1.5;
      setTimeout(() => {
        this.alertMode = false;
        this.speedMultiplier = this.baseSpeedMultiplier;
      }, 2000);
    }
    if (action === 'pulse') {
      // Brief speed surge, all dots race around
      this.speedMultiplier = 4;
      setTimeout(() => { this.speedMultiplier = this.baseSpeedMultiplier; }, 350);
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) {
      this.speedMultiplier = this.baseSpeedMultiplier;
      this.alertMode = false;
      return;
    }
    this.speedMultiplier = this.baseSpeedMultiplier * (1 + level * 0.4);
    if (level >= 4) {
      this.alertMode = true;
    }
    if (level >= 5) {
      // All dots converge briefly
      for (const dot of this.orbitDots) {
        dot.angle = 0;
      }
    }
  }
}
