import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

interface DiatomPreset {
  spokeCount: number;
  ringCount: number;
  poreRings: number;
  rotSpeed: number;
}

/**
 * Diatom radial symmetry patterns. Intricate circular microorganism with
 * radial features — pores, ribs, spokes. Procedurally generated.
 * Line geometry with fine detail.
 */
export class DiatomPatternElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'diatom-pattern',
    meta: {
      shape: 'radial',
      roles: ['decorative'],
      moods: ['ambient', 'diagnostic'],
      sizes: ['needs-medium', 'needs-large'],
      bandAffinity: 'high',
    } satisfies ElementMeta,
  };

  private outerRing!: THREE.Line;
  private outerMat!: THREE.LineBasicMaterial;
  private spokes!: THREE.LineSegments;
  private spokesMat!: THREE.LineBasicMaterial;
  private ribs!: THREE.Line[];
  private ribMats!: THREE.LineBasicMaterial[];
  private pores!: THREE.LineSegments;
  private poresMat!: THREE.LineBasicMaterial;

  private cx = 0;
  private cy = 0;
  private maxRadius = 0;
  private rotSpeed = 0.1;
  private spokeCount = 12;
  private intensityLevel = 0;

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;
    this.cx = x + w / 2;
    this.cy = y + h / 2;
    this.maxRadius = Math.min(w, h) * 0.44;

    const variant = this.rng.int(0, 4);
    const presets: DiatomPreset[] = [
      { spokeCount: 12, ringCount: 5, poreRings: 3, rotSpeed: 0.10 },
      { spokeCount: 24, ringCount: 7, poreRings: 4, rotSpeed: 0.05 },
      { spokeCount: 8,  ringCount: 4, poreRings: 2, rotSpeed: 0.15 },
      { spokeCount: 16, ringCount: 6, poreRings: 5, rotSpeed: 0.08 },
    ];
    const p = presets[variant];
    this.spokeCount = p.spokeCount;
    this.rotSpeed = p.rotSpeed;

    // ── Outer ring ──
    const ringVerts = 64;
    const outerPos = new Float32Array((ringVerts + 1) * 3);
    for (let i = 0; i <= ringVerts; i++) {
      const angle = (i / ringVerts) * Math.PI * 2;
      outerPos[i * 3] = this.cx + Math.cos(angle) * this.maxRadius;
      outerPos[i * 3 + 1] = this.cy + Math.sin(angle) * this.maxRadius;
      outerPos[i * 3 + 2] = 0;
    }
    const outerGeo = new THREE.BufferGeometry();
    outerGeo.setAttribute('position', new THREE.BufferAttribute(outerPos, 3));
    this.outerMat = new THREE.LineBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
    });
    this.outerRing = new THREE.Line(outerGeo, this.outerMat);
    this.group.add(this.outerRing);

    // ── Spokes (radial lines) ──
    const spokePos = new Float32Array(p.spokeCount * 2 * 3);
    const innerRadius = this.maxRadius * 0.15;
    for (let i = 0; i < p.spokeCount; i++) {
      const angle = (i / p.spokeCount) * Math.PI * 2;
      const wobble = 1 + this.rng.float(-0.05, 0.05);
      spokePos[i * 6] = this.cx + Math.cos(angle) * innerRadius;
      spokePos[i * 6 + 1] = this.cy + Math.sin(angle) * innerRadius;
      spokePos[i * 6 + 2] = 0;
      spokePos[i * 6 + 3] = this.cx + Math.cos(angle) * this.maxRadius * wobble;
      spokePos[i * 6 + 4] = this.cy + Math.sin(angle) * this.maxRadius * wobble;
      spokePos[i * 6 + 5] = 0;
    }
    const spokesGeo = new THREE.BufferGeometry();
    spokesGeo.setAttribute('position', new THREE.BufferAttribute(spokePos, 3));
    this.spokesMat = new THREE.LineBasicMaterial({
      color: this.palette.secondary,
      transparent: true,
      opacity: 0,
    });
    this.spokes = new THREE.LineSegments(spokesGeo, this.spokesMat);
    this.group.add(this.spokes);

    // ── Concentric rib rings ──
    this.ribs = [];
    this.ribMats = [];
    for (let r = 0; r < p.ringCount; r++) {
      const ringFrac = (r + 1) / (p.ringCount + 1);
      const radius = this.maxRadius * ringFrac;
      const segments = 48 + r * 8;
      const ribPos = new Float32Array((segments + 1) * 3);
      for (let i = 0; i <= segments; i++) {
        const angle = (i / segments) * Math.PI * 2;
        // Slight scalloping
        const scallop = 1 + 0.02 * Math.sin(angle * p.spokeCount);
        ribPos[i * 3] = this.cx + Math.cos(angle) * radius * scallop;
        ribPos[i * 3 + 1] = this.cy + Math.sin(angle) * radius * scallop;
        ribPos[i * 3 + 2] = 0;
      }
      const ribGeo = new THREE.BufferGeometry();
      ribGeo.setAttribute('position', new THREE.BufferAttribute(ribPos, 3));
      const ribMat = new THREE.LineBasicMaterial({
        color: new THREE.Color().copy(this.palette.dim).lerp(this.palette.primary, ringFrac),
        transparent: true,
        opacity: 0,
      });
      const ribLine = new THREE.Line(ribGeo, ribMat);
      this.ribs.push(ribLine);
      this.ribMats.push(ribMat);
      this.group.add(ribLine);
    }

    // ── Pores (small cross marks between spokes and rings) ──
    const poreVerts: number[] = [];
    const poreSize = this.maxRadius * 0.015;
    for (let r = 0; r < p.poreRings; r++) {
      const ringFrac = (r + 1) / (p.poreRings + 1);
      const radius = this.maxRadius * ringFrac;
      // Place pores between spokes
      for (let s = 0; s < p.spokeCount; s++) {
        const angle = ((s + 0.5) / p.spokeCount) * Math.PI * 2;
        const pcx = this.cx + Math.cos(angle) * radius;
        const pcy = this.cy + Math.sin(angle) * radius;
        // Small cross
        poreVerts.push(
          pcx - poreSize, pcy, 0,
          pcx + poreSize, pcy, 0,
          pcx, pcy - poreSize, 0,
          pcx, pcy + poreSize, 0,
        );
      }
    }
    const poresGeo = new THREE.BufferGeometry();
    poresGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(poreVerts), 3));
    this.poresMat = new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    });
    this.pores = new THREE.LineSegments(poresGeo, this.poresMat);
    this.group.add(this.pores);
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    const rot = time * this.rotSpeed * (1 + this.intensityLevel * 0.2);

    // Rotate the entire structure around center
    // We apply rotation by adjusting group pivot
    const cosR = Math.cos(rot);
    const sinR = Math.sin(rot);

    // Update outer ring positions with rotation
    const outerPos = this.outerRing.geometry.getAttribute('position') as THREE.BufferAttribute;
    const ringVerts = outerPos.count - 1;
    for (let i = 0; i <= ringVerts; i++) {
      const angle = (i / ringVerts) * Math.PI * 2;
      const breathe = 1 + 0.02 * Math.sin(time * 0.8);
      const r = this.maxRadius * breathe;
      const lx = Math.cos(angle) * r;
      const ly = Math.sin(angle) * r;
      outerPos.setXYZ(i,
        this.cx + lx * cosR - ly * sinR,
        this.cy + lx * sinR + ly * cosR,
        0,
      );
    }
    outerPos.needsUpdate = true;

    // Update spoke positions
    const spokePos = this.spokes.geometry.getAttribute('position') as THREE.BufferAttribute;
    const innerRadius = this.maxRadius * 0.15;
    for (let i = 0; i < this.spokeCount; i++) {
      const angle = (i / this.spokeCount) * Math.PI * 2;
      const ix = Math.cos(angle) * innerRadius;
      const iy = Math.sin(angle) * innerRadius;
      const ox = Math.cos(angle) * this.maxRadius;
      const oy = Math.sin(angle) * this.maxRadius;
      spokePos.setXYZ(i * 2,
        this.cx + ix * cosR - iy * sinR,
        this.cy + ix * sinR + iy * cosR,
        0,
      );
      spokePos.setXYZ(i * 2 + 1,
        this.cx + ox * cosR - oy * sinR,
        this.cy + ox * sinR + oy * cosR,
        0,
      );
    }
    spokePos.needsUpdate = true;

    // Apply opacity
    this.outerMat.opacity = opacity;
    this.spokesMat.opacity = opacity * 0.7;
    this.poresMat.opacity = opacity * 0.4;
    for (const mat of this.ribMats) {
      mat.opacity = opacity * 0.6;
    }
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      this.rotSpeed = -this.rotSpeed;
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    this.intensityLevel = level;
  }
}
