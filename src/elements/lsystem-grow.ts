import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

interface LsystemPreset {
  axiom: string;
  rules: Record<string, string>;
  angle: number;
  maxDepth: number;
  growthSpeed: number;
}

/**
 * L-system plant growth. Grammar rules produce branching structures.
 * Animated growth by increasing interpretation depth over time.
 * Line geometry rendered from turtle graphics interpretation.
 */
export class LsystemGrowElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'lsystem-grow',
    meta: {
      shape: 'rectangular',
      roles: ['decorative', 'data-display'],
      moods: ['ambient', 'diagnostic'],
      sizes: ['needs-medium', 'needs-large'],
      bandAffinity: 'bass',
    } satisfies ElementMeta,
  };

  private plantLines!: THREE.LineSegments;
  private axiom = 'F';
  private rules: Record<string, string> = {};
  private angle = 25;
  private maxDepth = 5;
  private growthSpeed = 0.5;
  private currentDepth = 0;
  private growthProgress = 0;
  private baseX = 0;
  private baseY = 0;
  private segmentLength = 0;
  private maxSegments = 4000;
  private intensityLevel = 0;
  private lastBuiltDepth = -1;

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;
    this.baseX = x + w / 2;
    this.baseY = y + h;
    this.segmentLength = Math.min(w, h) * 0.12;

    const variant = this.rng.int(0, 3);
    const presets: LsystemPreset[] = [
      // Bush
      { axiom: 'F', rules: { F: 'F[+F]F[-F]F' }, angle: 25.7, maxDepth: 5, growthSpeed: 0.5 },
      // Tree
      { axiom: 'X', rules: { X: 'F[+X][-X]FX', F: 'FF' }, angle: 30, maxDepth: 6, growthSpeed: 0.4 },
      // Weed
      { axiom: 'F', rules: { F: 'FF+[+F-F-F]-[-F+F+F]' }, angle: 22.5, maxDepth: 4, growthSpeed: 0.6 },
      // Fractal plant
      { axiom: 'X', rules: { X: 'F+[[X]-X]-F[-FX]+X', F: 'FF' }, angle: 25, maxDepth: 5, growthSpeed: 0.45 },
    ];
    const p = presets[variant];
    this.axiom = p.axiom;
    this.rules = p.rules;
    this.angle = p.angle + this.rng.float(-3, 3);
    this.maxDepth = p.maxDepth;
    this.growthSpeed = p.growthSpeed;

    // Pre-allocate line geometry
    const positions = new Float32Array(this.maxSegments * 6);
    for (let i = 0; i < positions.length; i++) positions[i] = 0;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setDrawRange(0, 0);
    this.plantLines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.plantLines);
  }

  private generateString(depth: number): string {
    let current = this.axiom;
    for (let d = 0; d < depth; d++) {
      let next = '';
      for (const ch of current) {
        next += this.rules[ch] ?? ch;
      }
      current = next;
      // Safety: cap string length
      if (current.length > 20000) break;
    }
    return current;
  }

  private interpretString(str: string, drawFraction: number): number {
    const positions = this.plantLines.geometry.getAttribute('position') as THREE.BufferAttribute;
    const posArr = positions.array as Float32Array;

    const stack: Array<{ x: number; y: number; angle: number }> = [];
    let cx = this.baseX;
    let cy = this.baseY;
    let currentAngle = -90; // Start pointing up
    const angleRad = (this.angle * Math.PI) / 180;
    let segIdx = 0;

    // Scale segment length based on depth to fit in region
    const scaleFactor = Math.pow(0.5, Math.max(0, this.currentDepth - 2));
    const len = this.segmentLength * scaleFactor;

    // Count total F commands for fraction-based drawing
    let totalF = 0;
    for (const ch of str) {
      if (ch === 'F') totalF++;
    }
    const maxF = Math.floor(totalF * drawFraction);
    let drawnF = 0;

    for (const ch of str) {
      if (segIdx >= this.maxSegments) break;

      switch (ch) {
        case 'F': {
          if (drawnF >= maxF) return segIdx;
          const rad = (currentAngle * Math.PI) / 180;
          const nx = cx + Math.cos(rad) * len;
          const ny = cy + Math.sin(rad) * len;
          const i6 = segIdx * 6;
          posArr[i6] = cx;
          posArr[i6 + 1] = cy;
          posArr[i6 + 2] = 0;
          posArr[i6 + 3] = nx;
          posArr[i6 + 4] = ny;
          posArr[i6 + 5] = 0;
          cx = nx;
          cy = ny;
          segIdx++;
          drawnF++;
          break;
        }
        case '+':
          currentAngle += this.angle;
          break;
        case '-':
          currentAngle -= this.angle;
          break;
        case '[':
          stack.push({ x: cx, y: cy, angle: currentAngle });
          break;
        case ']':
          if (stack.length > 0) {
            const s = stack.pop()!;
            cx = s.x;
            cy = s.y;
            currentAngle = s.angle;
          }
          break;
        default:
          // X or other symbols — skip in interpretation
          break;
      }
    }

    positions.needsUpdate = true;
    return segIdx;
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);
    const speed = this.growthSpeed * (1 + this.intensityLevel * 0.3);

    this.growthProgress += dt * speed;

    // Current depth based on growth progress
    const targetDepth = Math.min(this.maxDepth, Math.floor(this.growthProgress) + 1);
    const fraction = this.growthProgress - Math.floor(this.growthProgress);

    if (targetDepth !== this.currentDepth || fraction > 0) {
      this.currentDepth = targetDepth;
      const str = this.generateString(this.currentDepth);
      const drawFrac = this.currentDepth >= this.maxDepth ? 1.0 : Math.min(1.0, fraction * 1.5 + 0.3);
      const segCount = this.interpretString(str, drawFrac);
      this.plantLines.geometry.setDrawRange(0, segCount * 2);
      const posAttr = this.plantLines.geometry.getAttribute('position') as THREE.BufferAttribute;
      posAttr.needsUpdate = true;
    }

    // Restart when fully grown
    if (this.growthProgress > this.maxDepth + 2) {
      this.growthProgress = 0;
      this.currentDepth = 0;
      this.angle += this.rng.float(-5, 5);
    }

    (this.plantLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.8;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Mutate rules slightly
      this.angle = this.rng.float(15, 40);
      this.growthProgress = 0;
      this.currentDepth = 0;
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    this.intensityLevel = level;
  }
}
