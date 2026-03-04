import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Cascading depth layers — multiple offset rectangles stacked with decreasing
 * opacity, creating a shadow / depth effect. Layers slowly shift position to
 * give a sense of parallax depth.
 *
 * Variants:
 *   0 - Diagonal shadow   (layers offset down-right, slow drift)
 *   1 - Spread            (layers expand outward in all directions)
 *   2 - Pulsing depth     (opacity and offset pulse rhythmically)
 *   3 - Rotating offset   (offset angle slowly rotates over time)
 */

interface DepthLayer {
  /** The outline rect LineSegments */
  lines: THREE.LineSegments;
  mat: THREE.LineBasicMaterial;
  /** Filled plane behind the outline */
  fill: THREE.Mesh;
  fillMat: THREE.MeshBasicMaterial;
  /** Layer depth index (0 = furthest back) */
  depth: number;
  /** Base offset from centre [x, y] in pixels */
  baseOffset: [number, number];
}

export class DropShadowElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'drop-shadow',
    meta: {
      shape: 'rectangular',
      roles: ['decorative', 'structural'],
      moods: ['tactical', 'ambient'],
      sizes: ['works-small', 'needs-medium'],
      bandAffinity: 'sub',
    },
  };

  private layers: DepthLayer[] = [];
  private borderMat!: THREE.LineBasicMaterial;
  private variant: number = 0;
  private numLayers: number = 0;
  private shadowAngle: number = 0;   // radians — direction of shadow offset
  private shadowDist: number = 0;    // max pixel offset for furthest layer
  private intensityLevel: number = 0;
  private rotationPhase: number = 0; // for variant 3

  build(): void {
    this.variant = this.rng.int(0, 3);
    const { x, y, w, h } = this.px;

    const presets = [
      { numLayers: 6, distRatio: 0.12, angleMin: Math.PI / 5, angleMax: Math.PI / 4 },    // diagonal
      { numLayers: 7, distRatio: 0.09, angleMin: 0, angleMax: Math.PI * 2 },              // spread (angle unused)
      { numLayers: 5, distRatio: 0.10, angleMin: Math.PI / 6, angleMax: Math.PI / 3 },    // pulsing
      { numLayers: 6, distRatio: 0.11, angleMin: 0, angleMax: Math.PI * 2 },              // rotating offset
    ];
    const pr = presets[this.variant];

    this.numLayers = pr.numLayers;
    this.shadowDist = Math.min(w, h) * pr.distRatio;
    this.shadowAngle = this.rng.float(pr.angleMin, pr.angleMax);

    // Inset the "top" layer rect slightly so shadow extends outside it
    const pad = 4;
    const rx = x + pad;
    const ry = y + pad;
    const rw = w - pad * 2;
    const rh = h - pad * 2;

    const makeRectVerts = (cx: number, cy: number, lw: number, lh: number): Float32Array => {
      const hx = lw * 0.5;
      const hy = lh * 0.5;
      return new Float32Array([
        cx - hx, cy - hy, 0, cx + hx, cy - hy, 0,
        cx + hx, cy - hy, 0, cx + hx, cy + hy, 0,
        cx + hx, cy + hy, 0, cx - hx, cy + hy, 0,
        cx - hx, cy + hy, 0, cx - hx, cy - hy, 0,
      ]);
    };

    const cx = rx + rw * 0.5;
    const cy = ry + rh * 0.5;

    // Build layers from back to front
    for (let i = 0; i < this.numLayers; i++) {
      // depth 0 = back (most offset, most transparent)
      // depth numLayers-1 = front (least offset, most opaque)
      const depth = i;
      const depthFraction = depth / (this.numLayers - 1); // 0..1 front
      const backFraction = 1 - depthFraction;              // 0..1 back

      // Shadow offset: deeper layers offset more
      let offsetX: number;
      let offsetY: number;

      if (this.variant === 1) {
        // Spread: each layer expands outward — no lateral offset, just scale
        offsetX = 0;
        offsetY = 0;
      } else {
        offsetX = Math.cos(this.shadowAngle) * this.shadowDist * backFraction;
        offsetY = Math.sin(this.shadowAngle) * this.shadowDist * backFraction;
      }

      // Layer slightly larger when spread variant
      const scaleFactor = this.variant === 1 ? 1 + backFraction * 0.15 : 1.0;
      const lw = rw * scaleFactor;
      const lh = rh * scaleFactor;

      // Fill mesh (plane)
      const fillGeo = new THREE.PlaneGeometry(lw, lh);
      const fillMat = new THREE.MeshBasicMaterial({
        color: this.palette.bg.clone(),
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      const fill = new THREE.Mesh(fillGeo, fillMat);
      fill.position.set(cx + offsetX, cy + offsetY, -0.5 - backFraction * 2);
      this.group.add(fill);

      // Outline LineSegments
      const verts = makeRectVerts(cx + offsetX, cy + offsetY, lw, lh);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
      const mat = new THREE.LineBasicMaterial({
        color: depthFraction > 0.7 ? this.palette.primary.clone() : this.palette.dim.clone(),
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      const lines = new THREE.LineSegments(geo, mat);
      this.group.add(lines);

      this.layers.push({
        lines,
        mat,
        fill,
        fillMat,
        depth,
        baseOffset: [offsetX, offsetY],
      });
    }

    // Foreground border (the "top" surface)
    const bv = makeRectVerts(cx, cy, rw, rh);
    const borderGeo = new THREE.BufferGeometry();
    borderGeo.setAttribute('position', new THREE.BufferAttribute(bv, 3));
    this.borderMat = new THREE.LineBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
    });
    const border = new THREE.LineSegments(borderGeo, this.borderMat);
    border.position.z = 1;
    this.group.add(border);
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    const { x, y, w, h } = this.px;
    const pad = 4;
    const cx = x + pad + (w - pad * 2) * 0.5;
    const cy = y + pad + (h - pad * 2) * 0.5;
    const rw = w - pad * 2;
    const rh = h - pad * 2;

    // Rotating offset angle for variant 3
    if (this.variant === 3) {
      this.rotationPhase += dt;
      this.shadowAngle = this.rotationPhase * 0.4;
    }

    for (const layer of this.layers) {
      const depthFraction = layer.depth / (this.numLayers - 1);
      const backFraction = 1 - depthFraction;

      // --- Compute animated offset ---
      let ox: number;
      let oy: number;
      let lw: number;
      let lh: number;

      if (this.variant === 0) {
        // Diagonal: layers slowly drift along shadow direction
        const drift = Math.sin(time * 0.3 + backFraction * 1.2) * this.shadowDist * 0.15;
        ox = Math.cos(this.shadowAngle) * (this.shadowDist * backFraction + drift);
        oy = Math.sin(this.shadowAngle) * (this.shadowDist * backFraction + drift);
        lw = rw;
        lh = rh;
      } else if (this.variant === 1) {
        // Spread: layers breathe in/out
        const breathe = 1.0 + Math.sin(time * 0.6 + backFraction * 0.8) * 0.04 * backFraction;
        ox = 0;
        oy = 0;
        lw = rw * (1 + backFraction * 0.18) * breathe;
        lh = rh * (1 + backFraction * 0.18) * breathe;
      } else if (this.variant === 2) {
        // Pulsing depth: offset pulses rhythmically
        const pulse = 0.5 + 0.5 * Math.sin(time * 1.8 - backFraction * 1.5);
        ox = Math.cos(this.shadowAngle) * this.shadowDist * backFraction * pulse;
        oy = Math.sin(this.shadowAngle) * this.shadowDist * backFraction * pulse;
        lw = rw;
        lh = rh;
      } else {
        // Rotating offset
        const angle = this.shadowAngle + backFraction * 0.4;
        const dist = this.shadowDist * backFraction;
        ox = Math.cos(angle) * dist;
        oy = Math.sin(angle) * dist;
        lw = rw;
        lh = rh;
      }

      // Intensity bumps the offset distance
      const intensityMul = Math.min(1.3, 1 + this.intensityLevel * 0.15);
      ox *= intensityMul;
      oy *= intensityMul;

      // Update fill position and scale
      layer.fill.position.set(cx + ox, cy + oy, -0.5 - backFraction * 2);
      layer.fill.scale.set(lw / rw, lh / rh, 1);

      // Update outline geometry by repositioning
      const pos = layer.lines.geometry.getAttribute('position') as THREE.BufferAttribute;
      const hx = lw * 0.5;
      const hy = lh * 0.5;
      const bx = cx + ox;
      const by = cy + oy;
      // 8 verts: 4 line segments forming a rect
      pos.setXYZ(0, bx - hx, by - hy, 0); pos.setXYZ(1, bx + hx, by - hy, 0);
      pos.setXYZ(2, bx + hx, by - hy, 0); pos.setXYZ(3, bx + hx, by + hy, 0);
      pos.setXYZ(4, bx + hx, by + hy, 0); pos.setXYZ(5, bx - hx, by + hy, 0);
      pos.setXYZ(6, bx - hx, by + hy, 0); pos.setXYZ(7, bx - hx, by - hy, 0);
      pos.needsUpdate = true;

      // Opacity: back layers dimmer, front layer brightest
      const layerOpacity = opacity * depthFraction * (0.5 + depthFraction * 0.5);
      layer.mat.opacity = layerOpacity * 0.8;
      // Fill opacity for back layers gives depth colour
      layer.fillMat.opacity = opacity * backFraction * 0.20;

      // Pulsing variant: extra opacity modulation
      if (this.variant === 2) {
        const pulse = 0.6 + 0.4 * Math.sin(time * 1.8 - backFraction * 1.5);
        layer.mat.opacity = layerOpacity * 0.8 * pulse;
      }
    }

    this.borderMat.opacity = opacity * 0.9;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Randomly scatter layers momentarily
      for (const layer of this.layers) {
        const glitchX = (Math.random() - 0.5) * this.shadowDist * 3;
        const glitchY = (Math.random() - 0.5) * this.shadowDist * 3;
        layer.baseOffset[0] += glitchX;
        layer.baseOffset[1] += glitchY;
        setTimeout(() => {
          layer.baseOffset[0] -= glitchX;
          layer.baseOffset[1] -= glitchY;
        }, 200 + Math.random() * 200);
      }
    }
    if (action === 'alert') {
      for (const layer of this.layers) {
        if (layer.depth >= this.numLayers - 2) {
          layer.mat.color.copy(this.palette.alert);
        }
      }
      this.borderMat.color.copy(this.palette.alert);
      setTimeout(() => {
        for (const layer of this.layers) {
          const depthFraction = layer.depth / (this.numLayers - 1);
          layer.mat.color.copy(depthFraction > 0.7 ? this.palette.primary : this.palette.dim);
        }
        this.borderMat.color.copy(this.palette.primary);
      }, 2000);
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    this.intensityLevel = level;
    if (level === 0) return;
    if (level >= 4) {
      this.borderMat.color.copy(this.palette.alert);
      for (const layer of this.layers) {
        if (layer.depth >= this.numLayers - 2) {
          layer.mat.color.copy(this.palette.alert);
        }
      }
    } else {
      this.borderMat.color.copy(this.palette.primary);
      for (const layer of this.layers) {
        const depthFraction = layer.depth / (this.numLayers - 1);
        layer.mat.color.copy(depthFraction > 0.7 ? this.palette.primary : this.palette.dim);
      }
    }
  }

  dispose(): void {
    for (const layer of this.layers) {
      layer.lines.geometry.dispose();
      layer.mat.dispose();
      layer.fill.geometry.dispose();
      layer.fillMat.dispose();
    }
    this.layers = [];
    super.dispose();
  }
}
