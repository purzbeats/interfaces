import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Light rays entering a stack of materials with different refractive
 * indices. Snell's law bending at each interface. Shows how rays
 * bend through layers of varying optical density.
 */
export class RefractionStackElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'refraction-stack',
    meta: {
      shape: 'rectangular',
      roles: ['data-display', 'decorative'],
      moods: ['diagnostic', 'ambient'],
      bandAffinity: 'high',
      sizes: ['works-small', 'needs-medium'],
    },
  };

  private layerLines!: THREE.LineSegments;
  private rayLines!: THREE.LineSegments;
  private labelDots!: THREE.Points;
  private frameLine!: THREE.LineSegments;

  private layers: { n: number; yTop: number; yBot: number }[] = [];
  private rayCount: number = 5;
  private layerCount: number = 4;
  private incidentAngle: number = 0;
  private angleOscSpeed: number = 0.3;
  private speedMult: number = 1;

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;

    const variant = this.rng.int(0, 3);
    const presets = [
      { layers: [1.0, 1.5, 2.4, 1.5, 1.0], rays: 5, oscSpeed: 0.3 },
      { layers: [1.0, 1.33, 1.5, 1.7, 2.0, 1.0], rays: 4, oscSpeed: 0.5 },
      { layers: [1.0, 2.4, 1.0, 2.4, 1.0], rays: 6, oscSpeed: 0.2 },
      { layers: [1.0, 1.33, 1.52, 2.42], rays: 7, oscSpeed: 0.4 },
    ];
    const p = presets[variant];
    this.rayCount = p.rays;
    this.layerCount = p.layers.length;
    this.angleOscSpeed = p.oscSpeed;

    // Compute layer boundaries
    const layerH = h / this.layerCount;
    this.layers = [];
    for (let i = 0; i < this.layerCount; i++) {
      this.layers.push({
        n: p.layers[i],
        yTop: y + i * layerH,
        yBot: y + (i + 1) * layerH,
      });
    }

    // Layer boundary lines (horizontal interfaces)
    const interfaceCount = this.layerCount - 1;
    const layerPos = new Float32Array(interfaceCount * 6);
    for (let i = 0; i < interfaceCount; i++) {
      const ly = this.layers[i].yBot;
      layerPos[i * 6] = x;
      layerPos[i * 6 + 1] = ly;
      layerPos[i * 6 + 2] = 0;
      layerPos[i * 6 + 3] = x + w;
      layerPos[i * 6 + 4] = ly;
      layerPos[i * 6 + 5] = 0;
    }
    const layerGeo = new THREE.BufferGeometry();
    layerGeo.setAttribute('position', new THREE.BufferAttribute(layerPos, 3));
    this.layerLines = new THREE.LineSegments(layerGeo, new THREE.LineBasicMaterial({
      color: this.palette.dim, transparent: true, opacity: 0,
    }));
    this.group.add(this.layerLines);

    // Ray lines: each ray has (layerCount) segments = layerCount * 2 vertices
    const maxRayVerts = this.rayCount * this.layerCount * 2;
    const rayPos = new Float32Array(maxRayVerts * 3);
    const rayGeo = new THREE.BufferGeometry();
    rayGeo.setAttribute('position', new THREE.BufferAttribute(rayPos, 3));
    rayGeo.setDrawRange(0, 0);
    this.rayLines = new THREE.LineSegments(rayGeo, new THREE.LineBasicMaterial({
      color: this.palette.primary, transparent: true, opacity: 0,
    }));
    this.group.add(this.rayLines);

    // Dots at each refraction point
    const maxDots = this.rayCount * this.layerCount;
    const dotPos = new Float32Array(maxDots * 3);
    const dotGeo = new THREE.BufferGeometry();
    dotGeo.setAttribute('position', new THREE.BufferAttribute(dotPos, 3));
    dotGeo.setDrawRange(0, 0);
    this.labelDots = new THREE.Points(dotGeo, new THREE.PointsMaterial({
      color: this.palette.secondary, transparent: true, opacity: 0,
      size: Math.max(1, Math.min(w, h) * 0.013), sizeAttenuation: false,
    }));
    this.group.add(this.labelDots);

    // Frame
    const pad = 2;
    const fv = new Float32Array([
      x + pad, y + pad, 0, x + w - pad, y + pad, 0,
      x + w - pad, y + pad, 0, x + w - pad, y + h - pad, 0,
      x + w - pad, y + h - pad, 0, x + pad, y + h - pad, 0,
      x + pad, y + h - pad, 0, x + pad, y + pad, 0,
    ]);
    const fGeo = new THREE.BufferGeometry();
    fGeo.setAttribute('position', new THREE.BufferAttribute(fv, 3));
    this.frameLine = new THREE.LineSegments(fGeo, new THREE.LineBasicMaterial({
      color: this.palette.dim, transparent: true, opacity: 0,
    }));
    this.group.add(this.frameLine);
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    const { x, w } = this.px;

    // Oscillate incident angle
    this.incidentAngle = Math.sin(time * this.angleOscSpeed * this.speedMult) * 0.7 + 0.1;

    const rayPos = this.rayLines.geometry.getAttribute('position') as THREE.BufferAttribute;
    const dotPos = this.labelDots.geometry.getAttribute('position') as THREE.BufferAttribute;
    let vi = 0;
    let di = 0;

    const raySpacing = w / (this.rayCount + 1);

    for (let r = 0; r < this.rayCount; r++) {
      const entryX = x + (r + 1) * raySpacing;
      let curX = entryX;
      let curAngle = this.incidentAngle + (r - this.rayCount / 2) * 0.05;

      for (let i = 0; i < this.layerCount; i++) {
        const layer = this.layers[i];
        const layerH = layer.yBot - layer.yTop;

        // Start point of ray in this layer
        const startX = curX;
        const startY = layer.yTop;

        // Compute exit point using current angle
        const dx = Math.tan(curAngle) * layerH;
        const endX = startX + dx;
        const endY = layer.yBot;

        // Store segment
        rayPos.setXYZ(vi, startX, startY, 1);
        vi++;
        rayPos.setXYZ(vi, endX, endY, 1);
        vi++;

        // Refraction dot at interface
        dotPos.setXYZ(di, endX, endY, 1.5);
        di++;

        // Apply Snell's law at this interface
        if (i < this.layerCount - 1) {
          const n1 = layer.n;
          const n2 = this.layers[i + 1].n;
          const sinAngle2 = (n1 / n2) * Math.sin(curAngle);
          // Total internal reflection check
          if (Math.abs(sinAngle2) < 1) {
            curAngle = Math.asin(sinAngle2);
          } else {
            // Total internal reflection - reverse horizontal component
            curAngle = -curAngle;
          }
        }

        curX = endX;
      }
    }

    rayPos.needsUpdate = true;
    dotPos.needsUpdate = true;
    this.rayLines.geometry.setDrawRange(0, vi);
    this.labelDots.geometry.setDrawRange(0, di);

    // Opacities
    (this.layerLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.3;
    (this.rayLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.8;
    (this.labelDots.material as THREE.PointsMaterial).opacity = opacity * 0.6;
    (this.frameLine.material as THREE.LineBasicMaterial).opacity = opacity * 0.15;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Scramble refractive indices temporarily
      for (const layer of this.layers) {
        layer.n += this.rng.float(-0.5, 0.5);
        if (layer.n < 0.5) layer.n = 0.5;
      }
      this.speedMult = 4;
      setTimeout(() => { this.speedMult = 1; }, 400);
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level >= 3) this.speedMult = 1 + level * 0.3;
    else this.speedMult = 1;
  }
}
