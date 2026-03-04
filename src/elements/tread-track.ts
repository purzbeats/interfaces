import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Tank tread / caterpillar track animation.
 * Two parallel oval tracks with evenly-spaced rectangular link segments
 * that travel around the loop continuously.
 *
 * Variants:
 *   0 - Horizontal tracks (default orientation)
 *   1 - Vertical tracks
 *   2 - Horizontal fast (high-speed, denser segments)
 *   3 - Horizontal with wear marks (extra grime detail lines on segments)
 */

interface TreadLink {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  /** Normalised position along the oval track [0..1) */
  t: number;
}

export class TreadTrackElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'tread-track',
    meta: {
      shape: 'rectangular',
      roles: ['decorative', 'structural'],
      moods: ['tactical', 'diagnostic'],
      sizes: ['needs-medium', 'needs-large'],
      bandAffinity: 'bass',
    },
  };

  private linksTop: TreadLink[] = [];
  private linksBottom: TreadLink[] = [];
  /** Track oval parameters */
  private trackCx: number = 0;
  private trackCy: number = 0;
  private trackRx: number = 0; // half-length of straight section
  private trackRy: number = 0; // half-height (radius of end caps)
  private trackSpacing: number = 0; // vertical distance between track centres
  private segW: number = 0;
  private segH: number = 0;
  private speed: number = 0;
  private variant: number = 0;
  private totalProgress: number = 0;
  private trackLineMat!: THREE.LineBasicMaterial;
  private wearLineMat!: THREE.LineBasicMaterial;
  private borderMat!: THREE.LineBasicMaterial;
  private intensityLevel: number = 0;
  private baseSpeed: number = 0;

  /** Evaluate position on an oval (two straight runs + two semicircles) */
  private ovalPoint(t: number, cx: number, cy: number, rx: number, ry: number): [number, number, number] {
    // Perimeter breakdown: two straight segments + two semicircles
    const straight = rx * 2;
    const arc = Math.PI * ry;
    const total = straight * 2 + arc * 2;
    const norm = ((t % 1) + 1) % 1;
    const pos = norm * total;

    // Segment boundaries
    const s1 = straight;                     // top straight: left→right
    const a1 = s1 + arc;                     // right cap semicircle
    const s2 = a1 + straight;               // bottom straight: right→left
    // remainder is left cap

    let px: number;
    let py: number;
    let angle: number; // tangent angle in radians

    if (pos < s1) {
      // Top straight: left to right
      px = cx - rx + pos;
      py = cy - ry;
      angle = 0;
    } else if (pos < a1) {
      // Right semicircle (clockwise from top)
      const a = ((pos - s1) / arc) * Math.PI;
      px = cx + rx + Math.sin(a) * ry;
      py = cy - ry + (1 - Math.cos(a)) * ry;
      angle = a + Math.PI / 2;
    } else if (pos < s2) {
      // Bottom straight: right to left
      px = cx + rx - (pos - a1);
      py = cy + ry;
      angle = Math.PI;
    } else {
      // Left semicircle (clockwise from bottom)
      const a = ((pos - s2) / arc) * Math.PI;
      px = cx - rx - Math.sin(a) * ry;
      py = cy + ry - (1 - Math.cos(a)) * ry;
      angle = a - Math.PI / 2;
    }

    return [px, py, angle];
  }

  build(): void {
    this.variant = this.rng.int(0, 3);
    const { x, y, w, h } = this.px;

    // Per-variant presets
    const presets = [
      { numLinks: 28, speedMin: 40, speedMax: 80,  segWRatio: 0.06, segHRatio: 0.35 },   // horizontal
      { numLinks: 24, speedMin: 35, speedMax: 65,  segWRatio: 0.35, segHRatio: 0.06 },   // vertical
      { numLinks: 40, speedMin: 100, speedMax: 160, segWRatio: 0.05, segHRatio: 0.3 },   // fast
      { numLinks: 28, speedMin: 40, speedMax: 80,  segWRatio: 0.06, segHRatio: 0.35 },   // wear marks
    ];
    const pr = presets[this.variant];

    const isVertical = this.variant === 1;

    // Track oval geometry depends on orientation
    if (!isVertical) {
      this.trackCx = x + w * 0.5;
      this.trackCy = y + h * 0.5;
      this.trackRx = w * 0.4;
      this.trackRy = h * 0.12;
      this.trackSpacing = h * 0.32;
      this.segW = w * pr.segWRatio;
      this.segH = this.trackRy * pr.segHRatio * 6;
    } else {
      this.trackCx = x + w * 0.5;
      this.trackCy = y + h * 0.5;
      this.trackRx = h * 0.38;
      this.trackRy = w * 0.1;
      this.trackSpacing = w * 0.30;
      this.segW = this.trackRy * pr.segHRatio * 6;
      this.segH = h * pr.segWRatio;
    }

    this.baseSpeed = this.rng.float(pr.speedMin, pr.speedMax);
    this.speed = this.baseSpeed;

    const numLinks = pr.numLinks + this.rng.int(-2, 4);

    // Estimate oval perimeter for spacing
    const straight = this.trackRx * 2;
    const arc = Math.PI * this.trackRy;
    const perim = (straight + arc) * 2;

    // Create track outline (two ovals)
    const ovalResolution = 64;
    const makeOvalVerts = (cy: number): Float32Array => {
      const verts: number[] = [];
      for (let i = 0; i <= ovalResolution; i++) {
        const tt = i / ovalResolution;
        const [px, py] = this.ovalPoint(tt, this.trackCx, cy, this.trackRx, this.trackRy);
        if (i > 0) {
          // line segment: prev→current
          const [ppx, ppy] = this.ovalPoint((i - 1) / ovalResolution, this.trackCx, cy, this.trackRx, this.trackRy);
          verts.push(ppx, ppy, -1, px, py, -1);
        }
      }
      return new Float32Array(verts);
    };

    const topTrackY = this.trackCy - this.trackSpacing * 0.5;
    const botTrackY = this.trackCy + this.trackSpacing * 0.5;

    for (const trackCy of [topTrackY, botTrackY]) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(makeOvalVerts(trackCy), 3));
      this.trackLineMat = new THREE.LineBasicMaterial({
        color: this.palette.dim,
        transparent: true,
        opacity: 0,
      });
      this.group.add(new THREE.LineSegments(geo, this.trackLineMat));
    }

    // Wear marks material (variant 3 only)
    this.wearLineMat = new THREE.LineBasicMaterial({
      color: this.palette.bg,
      transparent: true,
      opacity: 0,
    });

    // Create tread links for each track
    const createLinks = (trackCy: number, links: TreadLink[]): void => {
      for (let i = 0; i < numLinks; i++) {
        const geo = new THREE.PlaneGeometry(this.segW, this.segH);
        const mat = new THREE.MeshBasicMaterial({
          color: this.palette.primary.clone().multiplyScalar(0.55),
          transparent: true,
          opacity: 0,
          depthWrite: false,
        });
        const mesh = new THREE.Mesh(geo, mat);
        this.group.add(mesh);
        links.push({ mesh, mat, t: i / numLinks });
      }
    };

    createLinks(topTrackY, this.linksTop);
    createLinks(botTrackY, this.linksBottom);

    // Wear mark line segments per segment (variant 3)
    if (this.variant === 3) {
      // These are added in update() as they need to move with links
      // We use a single pre-built LineSegments updated each frame
      const maxWearLines = numLinks * 2 * 3; // 3 wear lines per link * both tracks
      const wearVerts = new Float32Array(maxWearLines * 2 * 3);
      const wearGeo = new THREE.BufferGeometry();
      wearGeo.setAttribute('position', new THREE.BufferAttribute(wearVerts, 3));
      wearGeo.setDrawRange(0, 0);
      const wearLines = new THREE.LineSegments(wearGeo, this.wearLineMat);
      this.group.add(wearLines);
      (this as unknown as { wearLines: THREE.LineSegments }).wearLines = wearLines;
    }

    // Border
    const bv = new Float32Array([
      x, y, 0, x + w, y, 0,
      x + w, y, 0, x + w, y + h, 0,
      x + w, y + h, 0, x, y + h, 0,
      x, y + h, 0, x, y, 0,
    ]);
    const borderGeo = new THREE.BufferGeometry();
    borderGeo.setAttribute('position', new THREE.BufferAttribute(bv, 3));
    this.borderMat = new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    });
    this.group.add(new THREE.LineSegments(borderGeo, this.borderMat));
  }

  private updateLinks(links: TreadLink[], trackCy: number, dt: number, opacity: number, time: number): void {
    const straight = this.trackRx * 2;
    const arc = Math.PI * this.trackRy;
    const perim = (straight + arc) * 2;
    const tStep = this.speed * dt / perim;

    for (const link of links) {
      link.t = (link.t + tStep) % 1;
      const [px, py, angle] = this.ovalPoint(link.t, this.trackCx, trackCy, this.trackRx, this.trackRy);

      link.mesh.position.set(px, py, 0);
      link.mesh.rotation.z = angle;

      // Darken links on curved sections vs straight
      const isOnStraight = (py < trackCy - this.trackRy * 0.8) || (py > trackCy + this.trackRy * 0.8);
      const brightness = isOnStraight ? 0.6 : 0.35;

      // Oscillate slight brightness for realism
      const shimmer = 0.9 + 0.1 * Math.sin(time * 3.0 + link.t * Math.PI * 4);

      link.mat.opacity = opacity * brightness * shimmer;
    }
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    this.totalProgress += dt;

    const topTrackY = this.trackCy - this.trackSpacing * 0.5;
    const botTrackY = this.trackCy + this.trackSpacing * 0.5;

    this.updateLinks(this.linksTop, topTrackY, dt, opacity, time);
    // Bottom track moves in opposite direction
    const savedSpeed = this.speed;
    this.speed = -savedSpeed;
    this.updateLinks(this.linksBottom, botTrackY, dt, opacity, time);
    this.speed = savedSpeed;

    // Track outlines
    this.group.traverse((obj) => {
      if (obj instanceof THREE.LineSegments && obj !== (this as unknown as { wearLines?: THREE.LineSegments }).wearLines) {
        (obj.material as THREE.LineBasicMaterial).opacity = opacity * 0.35;
      }
    });

    // Wear marks (variant 3)
    const wearLines = (this as unknown as { wearLines?: THREE.LineSegments }).wearLines;
    if (wearLines && this.variant === 3) {
      const pos = wearLines.geometry.getAttribute('position') as THREE.BufferAttribute;
      let vi = 0;
      const allLinks = [...this.linksTop, ...this.linksBottom];
      for (const link of allLinks) {
        const [lx, ly, ang] = [link.mesh.position.x, link.mesh.position.y, link.mesh.rotation.z];
        const cos = Math.cos(ang);
        const sin = Math.sin(ang);
        // Draw 3 horizontal wear marks across the segment
        for (let m = 0; m < 3; m++) {
          const yOff = (m / 2 - 0.5) * this.segH * 0.5;
          const halfW = this.segW * 0.35;
          const sx = lx + (-halfW) * cos - yOff * sin;
          const sy = ly + (-halfW) * sin + yOff * cos;
          const ex = lx + halfW * cos - yOff * sin;
          const ey = ly + halfW * sin + yOff * cos;
          pos.setXYZ(vi, sx, sy, 1);
          pos.setXYZ(vi + 1, ex, ey, 1);
          vi += 2;
        }
      }
      pos.needsUpdate = true;
      wearLines.geometry.setDrawRange(0, vi);
      this.wearLineMat.opacity = opacity * 0.25;
    }

    this.borderMat.opacity = opacity * 0.2;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Momentary speed spike
      const saved = this.speed;
      this.speed = saved * 5;
      setTimeout(() => { this.speed = saved; }, 300);
    }
    if (action === 'alert') {
      for (const link of [...this.linksTop, ...this.linksBottom]) {
        link.mat.color.copy(this.palette.alert);
      }
      setTimeout(() => {
        for (const link of [...this.linksTop, ...this.linksBottom]) {
          link.mat.color.copy(this.palette.primary);
        }
      }, 2000);
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    this.intensityLevel = level;
    if (level === 0) {
      this.speed = this.baseSpeed;
      return;
    }
    // Scale speed with intensity
    this.speed = this.baseSpeed * (1 + level * 0.4);
    if (level >= 4) {
      for (const link of [...this.linksTop, ...this.linksBottom]) {
        link.mat.color.copy(this.palette.secondary);
      }
    }
    if (level === 0 || level < 4) {
      for (const link of [...this.linksTop, ...this.linksBottom]) {
        link.mat.color.copy(this.palette.primary);
      }
    }
  }

  dispose(): void {
    for (const link of [...this.linksTop, ...this.linksBottom]) {
      link.mesh.geometry.dispose();
      link.mat.dispose();
    }
    this.linksTop = [];
    this.linksBottom = [];
    super.dispose();
  }
}
