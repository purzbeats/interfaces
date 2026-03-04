import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Two interlocking gear outlines that rotate in opposite directions.
 * Gear teeth are drawn as small rectangular bumps around each circumference.
 * Variants differ in tooth count and gear size ratio.
 */
export class GearTrainElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'gear-train',
    meta: {
      shape: 'radial',
      roles: ['decorative'],
      moods: ['ambient'],
      sizes: ['needs-medium'],
    },
  };

  private gearLines: THREE.LineSegments[] = [];
  private gearParams: { cx: number; cy: number; radius: number; teeth: number; speed: number; direction: number }[] = [];
  private variant: number = 0;

  build(): void {
    const { x, y, w, h } = this.px;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const maxR = Math.min(w, h) / 2 * 0.85;

    this.variant = this.rng.int(0, 3);

    const presets = [
      // Variant 0: Equal sized gears
      { r1: 0.45, r2: 0.45, teeth1: 16, teeth2: 16, speed: 0.6 },
      // Variant 1: Large + small gear (2:1 ratio)
      { r1: 0.55, r2: 0.275, teeth1: 20, teeth2: 10, speed: 0.5 },
      // Variant 2: Small + large gear
      { r1: 0.3, r2: 0.6, teeth1: 10, teeth2: 20, speed: 0.8 },
      // Variant 3: Medium gears, many teeth
      { r1: 0.42, r2: 0.38, teeth1: 24, teeth2: 22, speed: 0.4 },
    ];

    const p = presets[this.variant];
    const r1 = maxR * p.r1;
    const r2 = maxR * p.r2;

    // Position gears so they mesh: centers separated by r1 + r2
    const separation = r1 + r2;
    const cx1 = cx - separation / 2;
    const cx2 = cx + separation / 2;

    // Speed ratio ensures teeth mesh properly
    const speed1 = p.speed;
    const speed2 = -p.speed * (p.teeth1 / p.teeth2);

    this.gearParams = [
      { cx: cx1, cy, radius: r1, teeth: p.teeth1, speed: speed1, direction: 1 },
      { cx: cx2, cy, radius: r2, teeth: p.teeth2, speed: speed2, direction: -1 },
    ];

    const colors = [this.palette.primary, this.palette.secondary];

    for (let g = 0; g < 2; g++) {
      const gp = this.gearParams[g];
      const verts = this.buildGearVerts(gp.cx, gp.cy, gp.radius, gp.teeth, 0);

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
      const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
        color: colors[g],
        transparent: true,
        opacity: 0,
      }));
      this.gearLines.push(lines);
      this.group.add(lines);
    }

    // Center dots for each gear
    for (let g = 0; g < 2; g++) {
      const gp = this.gearParams[g];
      const dotR = Math.max(2, gp.radius * 0.06);
      const dotGeo = new THREE.CircleGeometry(dotR, 10);
      const dot = new THREE.Mesh(dotGeo, new THREE.MeshBasicMaterial({
        color: colors[g],
        transparent: true,
        opacity: 0,
      }));
      dot.position.set(gp.cx, gp.cy, 1);
      this.group.add(dot);
    }
  }

  private buildGearVerts(cx: number, cy: number, radius: number, teeth: number, angle: number): number[] {
    const verts: number[] = [];
    const toothHeight = radius * 0.15;
    const innerR = radius - toothHeight * 0.5;
    const outerR = radius + toothHeight * 0.5;
    const segments = teeth * 4; // 4 segments per tooth cycle

    // Draw gear outline: alternating inner and outer radii to create teeth
    for (let i = 0; i < segments; i++) {
      const a1 = angle + (i / segments) * Math.PI * 2;
      const a2 = angle + ((i + 1) / segments) * Math.PI * 2;
      const phase1 = i % 4;
      const phase2 = (i + 1) % 4;

      // Tooth profile: 0=inner, 1=rising, 2=outer, 3=falling
      const r1 = (phase1 < 2) ? (phase1 === 0 ? innerR : outerR) : (phase1 === 2 ? outerR : innerR);
      const r2 = (phase2 < 2) ? (phase2 === 0 ? innerR : outerR) : (phase2 === 2 ? outerR : innerR);

      verts.push(
        cx + Math.cos(a1) * r1, cy + Math.sin(a1) * r1, 0,
        cx + Math.cos(a2) * r2, cy + Math.sin(a2) * r2, 0,
      );
    }

    // Hub circle (inner ring)
    const hubR = radius * 0.25;
    const hubSegs = 20;
    for (let i = 0; i < hubSegs; i++) {
      const a1 = angle + (i / hubSegs) * Math.PI * 2;
      const a2 = angle + ((i + 1) / hubSegs) * Math.PI * 2;
      verts.push(
        cx + Math.cos(a1) * hubR, cy + Math.sin(a1) * hubR, 0,
        cx + Math.cos(a2) * hubR, cy + Math.sin(a2) * hubR, 0,
      );
    }

    // Spokes connecting hub to gear ring
    const spokeCount = Math.min(teeth, 6);
    for (let i = 0; i < spokeCount; i++) {
      const a = angle + (i / spokeCount) * Math.PI * 2;
      verts.push(
        cx + Math.cos(a) * hubR, cy + Math.sin(a) * hubR, 0,
        cx + Math.cos(a) * innerR * 0.85, cy + Math.sin(a) * innerR * 0.85, 0,
      );
    }

    return verts;
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);

    for (let g = 0; g < 2; g++) {
      const gp = this.gearParams[g];
      const angle = time * gp.speed;
      const verts = this.buildGearVerts(gp.cx, gp.cy, gp.radius, gp.teeth, angle);

      const posAttr = this.gearLines[g].geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < verts.length / 3; i++) {
        posAttr.setXYZ(i, verts[i * 3], verts[i * 3 + 1], verts[i * 3 + 2]);
      }
      posAttr.needsUpdate = true;

      (this.gearLines[g].material as THREE.LineBasicMaterial).opacity = opacity * 0.7;

      // Center dots
      const dot = this.group.children[2 + g] as THREE.Mesh;
      (dot.material as THREE.MeshBasicMaterial).opacity = opacity * 0.8;
    }
  }
}
