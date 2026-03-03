import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

interface Particle {
  fromNode: number;
  toNode: number;
  progress: number;
  active: boolean;
}

/**
 * Biotech enzyme cascade visualization.
 * Nodes arranged in a zigzag vertical chain fire sequentially —
 * activation particles travel between nodes creating a domino-chain effect.
 */
export class EnzymeCascadeElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'enzyme-cascade',
    meta: {
      shape: 'rectangular',
      roles: ['data-display', 'gauge'],
      moods: ['diagnostic', 'tactical'],
      sizes: ['works-small', 'needs-medium'],
      bandAffinity: 'mid',
    } satisfies ElementMeta,
  };

  private nodePoints!: THREE.Points;
  private nodeColors!: Float32Array;
  private nodeSizes!: Float32Array;
  private connectorLines!: THREE.LineSegments;
  private particlePoints!: THREE.Points;
  private feedbackArc!: THREE.Line | null;
  private feedbackArcMat!: THREE.LineBasicMaterial | null;

  private nodePositions: Array<{ x: number; y: number }> = [];
  private nodeBrightness: number[] = [];
  private particles: Particle[] = [];
  private maxParticles = 20;

  private nodeCount = 8;
  private particleSpeed = 2.0;
  private triggerInterval = 4.0;
  private triggerTimer = 0;
  private hasFeedback = false;
  private amplify = false;
  private intensityLevel = 0;

  build(): void {
    const variant = this.rng.int(0, 3);
    const presets = [
      { nodeCount: 8,  speed: 2.0, interval: 4.0, feedback: false, amplify: false }, // Standard
      { nodeCount: 6,  speed: 4.0, interval: 2.0, feedback: false, amplify: false }, // Rapid
      { nodeCount: 12, speed: 1.5, interval: 5.0, feedback: false, amplify: true  }, // Extended
      { nodeCount: 8,  speed: 2.0, interval: 3.0, feedback: true,  amplify: false }, // Feedback
    ];
    const p = presets[variant];

    this.nodeCount = p.nodeCount;
    this.particleSpeed = p.speed;
    this.triggerInterval = p.interval;
    this.hasFeedback = p.feedback;
    this.amplify = p.amplify;
    this.triggerTimer = this.rng.float(0, this.triggerInterval);

    const { x, y, w, h } = this.px;
    const paddingY = h * 0.08;

    // ── Node positions: zigzag vertical chain ──
    for (let i = 0; i < this.nodeCount; i++) {
      const t = this.nodeCount > 1 ? i / (this.nodeCount - 1) : 0.5;
      const ny = y + paddingY + t * (h - paddingY * 2);
      const nx = i % 2 === 0 ? x + w * 0.3 : x + w * 0.7;
      this.nodePositions.push({ x: nx, y: ny });
      this.nodeBrightness.push(0);
    }

    // ── Node Points ──
    const nodePos = new Float32Array(this.nodeCount * 3);
    this.nodeColors = new Float32Array(this.nodeCount * 3);
    this.nodeSizes = new Float32Array(this.nodeCount);
    const baseSize = Math.max(4, Math.min(w, h) * 0.018);
    for (let i = 0; i < this.nodeCount; i++) {
      nodePos[i * 3] = this.nodePositions[i].x;
      nodePos[i * 3 + 1] = this.nodePositions[i].y;
      nodePos[i * 3 + 2] = 1;
      this.nodeColors[i * 3] = this.palette.dim.r;
      this.nodeColors[i * 3 + 1] = this.palette.dim.g;
      this.nodeColors[i * 3 + 2] = this.palette.dim.b;
      // Node sizes decrease downstream to show amplification visual
      this.nodeSizes[i] = baseSize * (1.0 - i * 0.4 / this.nodeCount);
    }
    const nodeGeo = new THREE.BufferGeometry();
    nodeGeo.setAttribute('position', new THREE.BufferAttribute(nodePos, 3));
    nodeGeo.setAttribute('color', new THREE.BufferAttribute(this.nodeColors, 3));
    nodeGeo.setAttribute('size', new THREE.BufferAttribute(this.nodeSizes, 1));
    this.nodePoints = new THREE.Points(nodeGeo, new THREE.PointsMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0,
      size: baseSize,
      sizeAttenuation: false,
    }));
    this.group.add(this.nodePoints);

    // ── Connector lines with arrowheads (LineSegments) ──
    // Each connection: 1 main line + 2 arrowhead lines = 3 segments = 6 vertices
    const segmentCount = (this.nodeCount - 1) * 3;
    const connVerts = new Float32Array(segmentCount * 6);
    const arrowLen = Math.min(w, h) * 0.03;
    const arrowAngle = Math.PI / 6; // 30 degrees

    for (let i = 0; i < this.nodeCount - 1; i++) {
      const from = this.nodePositions[i];
      const to = this.nodePositions[i + 1];
      const baseOfs = i * 18; // 3 segments * 6 floats

      // Main line
      connVerts[baseOfs]     = from.x;
      connVerts[baseOfs + 1] = from.y;
      connVerts[baseOfs + 2] = 0;
      connVerts[baseOfs + 3] = to.x;
      connVerts[baseOfs + 4] = to.y;
      connVerts[baseOfs + 5] = 0;

      // Direction vector (normalized)
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      const ux = dx / len;
      const uy = dy / len;

      // Arrowhead line 1
      const a1x = to.x - arrowLen * (ux * Math.cos(arrowAngle) - uy * Math.sin(arrowAngle));
      const a1y = to.y - arrowLen * (uy * Math.cos(arrowAngle) + ux * Math.sin(arrowAngle));
      connVerts[baseOfs + 6]  = to.x;
      connVerts[baseOfs + 7]  = to.y;
      connVerts[baseOfs + 8]  = 0;
      connVerts[baseOfs + 9]  = a1x;
      connVerts[baseOfs + 10] = a1y;
      connVerts[baseOfs + 11] = 0;

      // Arrowhead line 2
      const a2x = to.x - arrowLen * (ux * Math.cos(-arrowAngle) - uy * Math.sin(-arrowAngle));
      const a2y = to.y - arrowLen * (uy * Math.cos(-arrowAngle) + ux * Math.sin(-arrowAngle));
      connVerts[baseOfs + 12] = to.x;
      connVerts[baseOfs + 13] = to.y;
      connVerts[baseOfs + 14] = 0;
      connVerts[baseOfs + 15] = a2x;
      connVerts[baseOfs + 16] = a2y;
      connVerts[baseOfs + 17] = 0;
    }
    const connGeo = new THREE.BufferGeometry();
    connGeo.setAttribute('position', new THREE.BufferAttribute(connVerts, 3));
    this.connectorLines = new THREE.LineSegments(connGeo, new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.connectorLines);

    // ── Activation particles (pre-allocated pool) ──
    for (let i = 0; i < this.maxParticles; i++) {
      this.particles.push({ fromNode: 0, toNode: 0, progress: 0, active: false });
    }
    const particlePos = new Float32Array(this.maxParticles * 3);
    const particleGeo = new THREE.BufferGeometry();
    particleGeo.setAttribute('position', new THREE.BufferAttribute(particlePos, 3));
    particleGeo.setDrawRange(0, 0);
    this.particlePoints = new THREE.Points(particleGeo, new THREE.PointsMaterial({
      color: this.palette.secondary,
      transparent: true,
      opacity: 0,
      size: Math.max(3, Math.min(w, h) * 0.010),
      sizeAttenuation: false,
    }));
    this.group.add(this.particlePoints);

    // ── Feedback arc (variant 4 only) ──
    if (this.hasFeedback) {
      const bottom = this.nodePositions[this.nodeCount - 1];
      const top = this.nodePositions[0];
      const arcSegments = 32;
      const arcPts: number[] = [];
      const midX = x + w * 0.9; // arc bows out to the right
      for (let s = 0; s <= arcSegments; s++) {
        const t = s / arcSegments;
        // Quadratic bezier: bottom → control → top
        const cx = midX;
        const cy = (bottom.y + top.y) / 2;
        const ax = (1 - t) * (1 - t) * bottom.x + 2 * (1 - t) * t * cx + t * t * top.x;
        const ay = (1 - t) * (1 - t) * bottom.y + 2 * (1 - t) * t * cy + t * t * top.y;
        arcPts.push(ax, ay, 0);
      }
      const arcGeo = new THREE.BufferGeometry();
      arcGeo.setAttribute('position', new THREE.Float32BufferAttribute(arcPts, 3));
      this.feedbackArcMat = new THREE.LineBasicMaterial({
        color: this.palette.secondary,
        transparent: true,
        opacity: 0,
      });
      this.feedbackArc = new THREE.Line(arcGeo, this.feedbackArcMat);
      this.group.add(this.feedbackArc);
    } else {
      this.feedbackArc = null;
      this.feedbackArcMat = null;
    }
  }

  /** Fire a node: set brightness and spawn activation particle(s) to next node */
  private fireNode(idx: number): void {
    this.nodeBrightness[idx] = 1.0;

    // Spawn particle to next node (or wrap for feedback variant)
    const nextIdx = idx + 1;
    if (nextIdx < this.nodeCount) {
      const count = this.amplify ? 2 : 1;
      for (let c = 0; c < count; c++) {
        this.spawnParticle(idx, nextIdx);
      }
    } else if (this.hasFeedback) {
      // Feedback: last node fires particle back to first
      this.spawnParticle(idx, 0);
    }
  }

  private spawnParticle(from: number, to: number): void {
    for (let i = 0; i < this.maxParticles; i++) {
      if (!this.particles[i].active) {
        this.particles[i].fromNode = from;
        this.particles[i].toNode = to;
        this.particles[i].progress = 0;
        this.particles[i].active = true;
        return;
      }
    }
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);

    // ── Trigger top node periodically ──
    this.triggerTimer -= dt;
    if (this.triggerTimer <= 0) {
      const interval = this.intensityLevel >= 3
        ? this.triggerInterval * 0.3
        : this.triggerInterval;
      this.triggerTimer = interval;
      this.fireNode(0);
    }

    // ── Intensity 5: all nodes fire simultaneously ──
    if (this.intensityLevel >= 5) {
      for (let i = 0; i < this.nodeCount; i++) {
        this.nodeBrightness[i] = 1.0;
      }
    }

    // ── Update particles ──
    const particlePos = this.particlePoints.geometry.getAttribute('position') as THREE.BufferAttribute;
    let activeParticleCount = 0;

    for (let i = 0; i < this.maxParticles; i++) {
      const part = this.particles[i];
      if (!part.active) continue;

      part.progress += this.particleSpeed * dt;

      if (part.progress >= 1.0) {
        // Particle arrived — fire target node
        this.fireNode(part.toNode);
        part.active = false;
        continue;
      }

      // Lerp position along connection
      const from = this.nodePositions[part.fromNode];
      const to = this.nodePositions[part.toNode];
      const px = from.x + (to.x - from.x) * part.progress;
      const py = from.y + (to.y - from.y) * part.progress;
      particlePos.setXYZ(activeParticleCount, px, py, 2);
      activeParticleCount++;
    }
    particlePos.needsUpdate = true;
    this.particlePoints.geometry.setDrawRange(0, activeParticleCount);

    // ── Decay node brightness ──
    const dimR = this.palette.dim.r, dimG = this.palette.dim.g, dimB = this.palette.dim.b;
    const priR = this.palette.primary.r, priG = this.palette.primary.g, priB = this.palette.primary.b;
    const alertR = this.palette.alert.r, alertG = this.palette.alert.g, alertB = this.palette.alert.b;

    const colorAttr = this.nodePoints.geometry.getAttribute('color') as THREE.BufferAttribute;
    for (let i = 0; i < this.nodeCount; i++) {
      this.nodeBrightness[i] = Math.max(0, this.nodeBrightness[i] - dt * 1.5);

      const b = this.nodeBrightness[i];
      let r: number, g: number, bl: number;

      if (this.intensityLevel >= 5 && b > 0.5) {
        // At intensity 5, flash alert color
        const t = (b - 0.5) * 2;
        r = priR + (alertR - priR) * t;
        g = priG + (alertG - priG) * t;
        bl = priB + (alertB - priB) * t;
      } else {
        // Lerp dim → primary based on brightness 0..1
        r = dimR + (priR - dimR) * b;
        g = dimG + (priG - dimG) * b;
        bl = dimB + (priB - dimB) * b;
      }

      colorAttr.setXYZ(i, r, g, bl);
    }
    colorAttr.needsUpdate = true;

    // ── Set opacities ──
    (this.nodePoints.material as THREE.PointsMaterial).opacity = opacity;
    (this.connectorLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.4;
    (this.particlePoints.material as THREE.PointsMaterial).opacity = opacity;

    if (this.feedbackArcMat) {
      this.feedbackArcMat.opacity = opacity * 0.3;
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    this.intensityLevel = level;

    if (level === 0) {
      this.intensityLevel = 0;
      return;
    }

    // Increase trigger frequency with level
    if (level >= 3) {
      // Overlapping cascades: fire top node immediately
      this.fireNode(0);
    }

    if (level >= 5) {
      // All nodes fire simultaneously
      for (let i = 0; i < this.nodeCount; i++) {
        this.nodeBrightness[i] = 1.0;
      }
    }
  }
}
