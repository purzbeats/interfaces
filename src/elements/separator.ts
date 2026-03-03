import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';
import { stateOpacity } from '../animation/fx';

/** Shared divider settings, set from engine config. */
let _dividerBrightness = 3;
let _dividerThickness = 1;
export function setDividerBrightness(v: number): void { _dividerBrightness = v; }
export function setDividerThickness(v: number): void { _dividerThickness = v; }

export class SeparatorElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'separator',
    meta: { shape: 'linear', roles: ['structural'], moods: ['ambient'], bandAffinity: 'bass', sizes: ['works-small'] },
  };
  private lines!: LineSegments2;
  private mat!: LineMaterial;
  private flickerTimer: number = 0;   // brief opacity dip
  private rebootTimer: number = 0;    // fade out then back in
  private rebootDuration: number = 0;
  private accentTimer: number = 0;    // flash accent color
  private nextEventIn: number = 0;
  private hazardStripes: LineSegments2 | null = null;
  private hazardStripeMat: LineMaterial | null = null;
  private hazardStripeSpacing: number = 0;
  private hazardBg: THREE.Mesh | null = null;
  private hazardBgMat: THREE.MeshBasicMaterial | null = null;

  build(): void {
    const { x, y, w, h } = this.px;
    const verts: number[] = [];
    const style = this.rng.int(0, 4);

    switch (style) {
      case 0: { // Corner brackets
        const cs = Math.min(w, h) * 0.15;
        verts.push(x, y + cs, 0, x, y, 0, x, y, 0, x + cs, y, 0);
        verts.push(x + w - cs, y, 0, x + w, y, 0, x + w, y, 0, x + w, y + cs, 0);
        verts.push(x + w, y + h - cs, 0, x + w, y + h, 0, x + w, y + h, 0, x + w - cs, y + h, 0);
        verts.push(x + cs, y + h, 0, x, y + h, 0, x, y + h, 0, x, y + h - cs, 0);
        break;
      }
      case 1: { // Horizontal lines with ticks
        verts.push(x, y + h / 2, 0, x + w, y + h / 2, 0);
        const tickCount = this.rng.int(5, 15);
        for (let i = 0; i <= tickCount; i++) {
          const tx = x + (w / tickCount) * i;
          const tickH = (i % 5 === 0) ? h * 0.3 : h * 0.15;
          verts.push(tx, y + h / 2 - tickH, 0, tx, y + h / 2 + tickH, 0);
        }
        break;
      }
      case 2: { // Dashed cross
        const cx = x + w / 2, cy = y + h / 2;
        const dashLen = Math.min(w, h) * 0.05;
        const gap = dashLen * 0.5;
        for (let d = 0; d < w / 2; d += dashLen + gap) {
          verts.push(cx + d, cy, 0, cx + d + dashLen, cy, 0);
          verts.push(cx - d - dashLen, cy, 0, cx - d, cy, 0);
        }
        for (let d = 0; d < h / 2; d += dashLen + gap) {
          verts.push(cx, cy + d, 0, cx, cy + d + dashLen, 0);
          verts.push(cx, cy - d - dashLen, 0, cx, cy - d, 0);
        }
        break;
      }
      default: { // Hazard stripe — outer rectangle with drifting diagonal lines
        // Outer rectangle (static)
        verts.push(x, y, 0, x + w, y, 0);
        verts.push(x + w, y, 0, x + w, y + h, 0);
        verts.push(x + w, y + h, 0, x, y + h, 0);
        verts.push(x, y + h, 0, x, y, 0);

        // Opaque background quad — occludes anything underneath
        const bgGeo = new THREE.PlaneGeometry(w, h);
        this.hazardBgMat = new THREE.MeshBasicMaterial({
          color: this.palette.bg,
          depthTest: false,
          depthWrite: false,
        });
        this.hazardBg = new THREE.Mesh(bgGeo, this.hazardBgMat);
        this.hazardBg.position.set(x + w / 2, y + h / 2, 0);
        this.hazardBg.renderOrder = 20;
        this.group.add(this.hazardBg);

        // Diagonal stripes: extend well beyond bounds for drift headroom
        const stripe = Math.min(w, h) * 0.4;
        this.hazardStripeSpacing = stripe;
        const extra = w + h; // enough headroom for drift
        const stripeVerts: number[] = [];
        // Full-length diagonal lines (unclipped) — clipping planes handle masking
        for (let d = -extra; d <= extra; d += stripe) {
          const lx0 = x + d;
          const ly0 = y;
          const lx1 = x + d + h;
          const ly1 = y + h;
          stripeVerts.push(lx0, ly0, 0, lx1, ly1, 0);
        }

        // Clipping planes to mask stripes to the rectangle
        const clipPlanes = [
          new THREE.Plane(new THREE.Vector3(1, 0, 0), -x),       // left
          new THREE.Plane(new THREE.Vector3(-1, 0, 0), x + w),   // right
          new THREE.Plane(new THREE.Vector3(0, 1, 0), -y),       // bottom
          new THREE.Plane(new THREE.Vector3(0, -1, 0), y + h),   // top
        ];

        this.hazardStripeMat = new LineMaterial({
          color: this.palette.dim.getHex(),
          linewidth: _dividerThickness,
          transparent: true,
          opacity: 0,
          resolution: new THREE.Vector2(this.screenWidth, this.screenHeight),
          clippingPlanes: clipPlanes,
        });

        const stripeGeo = new LineSegmentsGeometry();
        stripeGeo.setPositions(stripeVerts);
        this.hazardStripes = new LineSegments2(stripeGeo, this.hazardStripeMat);
        this.hazardStripes.computeLineDistances();
        this.hazardStripes.renderOrder = 21;
        this.group.add(this.hazardStripes);
        break;
      }
    }

    const geo = new LineSegmentsGeometry();
    geo.setPositions(verts);

    this.mat = new LineMaterial({
      color: this.palette.dim.getHex(),
      linewidth: _dividerThickness,
      transparent: true,
      opacity: 0,
      resolution: new THREE.Vector2(this.screenWidth, this.screenHeight),
    });

    this.lines = new LineSegments2(geo, this.mat);
    this.lines.computeLineDistances();
    this.lines.renderOrder = this.hazardBg ? 21 : 11;
    this.group.add(this.lines);

  }

  private baseColor(): void {
    if (_dividerBrightness <= 1) {
      this.mat.color.copy(this.palette.dim);
    } else {
      const t = Math.min((_dividerBrightness - 1) / 2, 1);
      this.mat.color.copy(this.palette.dim).lerp(this.palette.primary, t);
    }
  }

  update(dt: number, _time: number): void {
    let opacity = stateOpacity(this.stateMachine.state, this.stateMachine.progress);

    // Self-driven random events while active
    if (this.stateMachine.state === 'active') {
      this.nextEventIn -= dt;
      if (this.nextEventIn <= 0) {
        const roll = Math.random();
        if (roll < 0.3) {
          // Flicker: brief opacity dip
          this.flickerTimer = 0.08 + Math.random() * 0.12;
        } else if (roll < 0.6) {
          // Accent flash: briefly turn accent color
          this.accentTimer = 0.2 + Math.random() * 0.3;
        } else {
          // Reboot: fade out then back in
          this.rebootDuration = 0.6 + Math.random() * 0.8;
          this.rebootTimer = this.rebootDuration;
        }
        this.nextEventIn = 5 + Math.random() * 10;
      }
    }

    // Flicker: snap opacity to near-zero briefly
    if (this.flickerTimer > 0) {
      this.flickerTimer -= dt;
      opacity *= 0.05;
    }

    // Reboot: fade out first half, fade back in second half
    if (this.rebootTimer > 0) {
      this.rebootTimer -= dt;
      const progress = 1 - Math.max(this.rebootTimer, 0) / this.rebootDuration;
      if (progress < 0.5) {
        // Fading out
        opacity *= 1 - (progress / 0.5);
      } else {
        // Fading back in
        opacity *= (progress - 0.5) / 0.5;
      }
    }

    this.mat.opacity = Math.min(opacity * _dividerBrightness, 1);
    this.mat.linewidth = _dividerThickness;

    // Drift hazard stripes slowly to the left
    if (this.hazardStripes && this.hazardStripeMat) {
      const speed = 8; // pixels per second
      const offset = (_time * speed) % this.hazardStripeSpacing;
      this.hazardStripes.position.x = -offset;
      // Sync stripe material with main material
      this.hazardStripeMat.opacity = this.mat.opacity;
      this.hazardStripeMat.linewidth = this.mat.linewidth;
      // Show/hide background quad to occlude things underneath
      if (this.hazardBg) {
        this.hazardBg.visible = this.mat.opacity > 0.01;
      }
    }

    // Color: accent flash or normal brightness-based color
    if (this.accentTimer > 0) {
      this.accentTimer -= dt;
      this.mat.color.copy(this.palette.secondary);
      if (this.hazardStripeMat) this.hazardStripeMat.color.copy(this.palette.secondary);
    } else {
      this.baseColor();
      if (this.hazardStripeMat) this.hazardStripeMat.color.copy(this.mat.color);
    }
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'pulse') {
      this.flickerTimer = 0.1;
    }
    if (action === 'glitch') {
      this.rebootDuration = 0.8;
      this.rebootTimer = 0.8;
    }
    if (action === 'alert') {
      this.accentTimer = 1.5;
    }
  }
}
