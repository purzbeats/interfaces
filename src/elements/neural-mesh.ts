import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

interface Neuron {
  x: number;
  y: number;
  brightness: number;   // 0 = resting (dim), 1 = firing (secondary)
  cooldown: number;      // seconds until neuron can fire again
  edges: number[];       // indices into this.edges
}

interface Edge {
  from: number;
  to: number;
}

interface Pulse {
  edge: number;
  progress: number;      // 0 → 1 along edge
  speed: number;
  active: boolean;
}

/**
 * Neural network / brain activity visualization.
 * Neurons fire and send luminous pulses along synapses
 * that can cascade through the mesh in chain reactions.
 */
export class NeuralMeshElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'neural-mesh',
    meta: { shape: 'rectangular', roles: ['data-display', 'decorative'], moods: ['diagnostic', 'ambient'], bandAffinity: 'mid', sizes: ['needs-medium', 'needs-large'] },
  };
  private neuronPoints!: THREE.Points;
  private neuronColors!: Float32Array;
  private edgeLines!: THREE.LineSegments;
  private edgeColors!: Float32Array;
  private pulsePoints!: THREE.Points;
  private bgRings!: THREE.Line;
  private bgRingMat!: THREE.LineBasicMaterial;

  private neurons: Neuron[] = [];
  private edges: Edge[] = [];
  private pulses: Pulse[] = [];
  private maxPulses = 80;

  private fireTimer = 0;
  private fireInterval = 0.5;
  private alertBoostTimer = 0;

  private cx = 0;
  private cy = 0;

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;
    this.cx = x + w / 2;
    this.cy = y + h / 2;
    const padding = Math.min(w, h) * 0.08;

    // ── Neurons ──
    const neuronCount = this.rng.int(15, 25);
    for (let i = 0; i < neuronCount; i++) {
      this.neurons.push({
        x: x + padding + this.rng.float(0, w - padding * 2),
        y: y + padding + this.rng.float(0, h - padding * 2),
        brightness: 0,
        cooldown: 0,
        edges: [],
      });
    }

    // ── Edges — connect nearby neurons ──
    const threshold = Math.min(w, h) * 0.30;
    const thresh2 = threshold * threshold;
    for (let i = 0; i < neuronCount; i++) {
      for (let j = i + 1; j < neuronCount; j++) {
        const dx = this.neurons[i].x - this.neurons[j].x;
        const dy = this.neurons[i].y - this.neurons[j].y;
        if (dx * dx + dy * dy < thresh2) {
          const edgeIdx = this.edges.length;
          this.edges.push({ from: i, to: j });
          this.neurons[i].edges.push(edgeIdx);
          this.neurons[j].edges.push(edgeIdx);
        }
      }
    }

    // ── Neuron Points ──
    const neuronPos = new Float32Array(neuronCount * 3);
    this.neuronColors = new Float32Array(neuronCount * 3);
    for (let i = 0; i < neuronCount; i++) {
      neuronPos[i * 3] = this.neurons[i].x;
      neuronPos[i * 3 + 1] = this.neurons[i].y;
      neuronPos[i * 3 + 2] = 1;
      this.neuronColors[i * 3] = this.palette.dim.r;
      this.neuronColors[i * 3 + 1] = this.palette.dim.g;
      this.neuronColors[i * 3 + 2] = this.palette.dim.b;
    }
    const neuronGeo = new THREE.BufferGeometry();
    neuronGeo.setAttribute('position', new THREE.BufferAttribute(neuronPos, 3));
    neuronGeo.setAttribute('color', new THREE.BufferAttribute(this.neuronColors, 3));
    this.neuronPoints = new THREE.Points(neuronGeo, new THREE.PointsMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0,
      size: Math.max(4, Math.min(w, h) * 0.014),
      sizeAttenuation: false,
    }));
    this.group.add(this.neuronPoints);

    // ── Edge Lines ──
    const edgeVerts = new Float32Array(this.edges.length * 6);
    this.edgeColors = new Float32Array(this.edges.length * 6);
    for (let i = 0; i < this.edges.length; i++) {
      const e = this.edges[i];
      edgeVerts[i * 6]     = this.neurons[e.from].x;
      edgeVerts[i * 6 + 1] = this.neurons[e.from].y;
      edgeVerts[i * 6 + 2] = 0;
      edgeVerts[i * 6 + 3] = this.neurons[e.to].x;
      edgeVerts[i * 6 + 4] = this.neurons[e.to].y;
      edgeVerts[i * 6 + 5] = 0;
      // Default dim color
      this.edgeColors[i * 6]     = this.palette.dim.r * 0.4;
      this.edgeColors[i * 6 + 1] = this.palette.dim.g * 0.4;
      this.edgeColors[i * 6 + 2] = this.palette.dim.b * 0.4;
      this.edgeColors[i * 6 + 3] = this.palette.dim.r * 0.4;
      this.edgeColors[i * 6 + 4] = this.palette.dim.g * 0.4;
      this.edgeColors[i * 6 + 5] = this.palette.dim.b * 0.4;
    }
    const edgeGeo = new THREE.BufferGeometry();
    edgeGeo.setAttribute('position', new THREE.BufferAttribute(edgeVerts, 3));
    edgeGeo.setAttribute('color', new THREE.BufferAttribute(this.edgeColors, 3));
    this.edgeLines = new THREE.LineSegments(edgeGeo, new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.edgeLines);

    // ── Pulse packets (pre-allocated pool) ──
    for (let i = 0; i < this.maxPulses; i++) {
      this.pulses.push({ edge: 0, progress: 0, speed: 0, active: false });
    }
    const pulsePos = new Float32Array(this.maxPulses * 3);
    const pulseGeo = new THREE.BufferGeometry();
    pulseGeo.setAttribute('position', new THREE.BufferAttribute(pulsePos, 3));
    pulseGeo.setDrawRange(0, 0);
    this.pulsePoints = new THREE.Points(pulseGeo, new THREE.PointsMaterial({
      color: this.palette.secondary,
      transparent: true,
      opacity: 0,
      size: Math.max(2.5, Math.min(w, h) * 0.008),
      sizeAttenuation: false,
    }));
    this.group.add(this.pulsePoints);

    // ── Background concentric guide rings ──
    const ringCount = 3;
    const maxRing = Math.min(w, h) * 0.46;
    const ringPts: number[] = [];
    for (let r = 0; r < ringCount; r++) {
      const radius = maxRing * ((r + 1) / ringCount);
      const segs = 64;
      for (let s = 0; s <= segs; s++) {
        const a = (s / segs) * Math.PI * 2;
        ringPts.push(this.cx + Math.cos(a) * radius, this.cy + Math.sin(a) * radius, -0.5);
      }
      // NaN break between rings to prevent joining lines
      if (r < ringCount - 1) {
        ringPts.push(NaN, NaN, NaN);
      }
    }
    const ringGeo = new THREE.BufferGeometry();
    ringGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(ringPts), 3));
    this.bgRingMat = new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    });
    this.bgRings = new THREE.Line(ringGeo, this.bgRingMat);
    this.group.add(this.bgRings);

    // Set initial fire interval
    this.fireInterval = this.rng.float(0.3, 0.8);
    this.fireTimer = this.rng.float(0, this.fireInterval);
  }

  /** Fire a neuron: brighten it and send pulses along its edges */
  private fireNeuron(idx: number): void {
    const n = this.neurons[idx];
    if (n.cooldown > 0) return;
    n.brightness = 1.0;
    n.cooldown = 0.3;

    // Spawn pulses along each connected edge
    for (const edgeIdx of n.edges) {
      const e = this.edges[edgeIdx];
      // Only send pulse outward from the firing neuron
      const goingForward = e.from === idx;
      // Find an inactive pulse slot
      for (let p = 0; p < this.maxPulses; p++) {
        if (!this.pulses[p].active) {
          this.pulses[p].edge = edgeIdx;
          this.pulses[p].progress = goingForward ? 0.0 : 1.0;
          this.pulses[p].speed = (goingForward ? 1 : -1) * this.rng.float(1.2, 2.5);
          this.pulses[p].active = true;
          break;
        }
      }
    }
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);

    // ── Spontaneous firing ──
    if (this.alertBoostTimer > 0) this.alertBoostTimer -= dt;
    const interval = this.alertBoostTimer > 0 ? 0.08 : this.fireInterval;
    this.fireTimer -= dt;
    if (this.fireTimer <= 0) {
      this.fireTimer = interval;
      const idx = this.rng.int(0, this.neurons.length - 1);
      this.fireNeuron(idx);
    }

    // ── Update neuron brightness decay ──
    const dimR = this.palette.dim.r, dimG = this.palette.dim.g, dimB = this.palette.dim.b;
    const secR = this.palette.secondary.r, secG = this.palette.secondary.g, secB = this.palette.secondary.b;
    const priR = this.palette.primary.r, priG = this.palette.primary.g, priB = this.palette.primary.b;

    const neuronColorAttr = this.neuronPoints.geometry.getAttribute('color') as THREE.BufferAttribute;
    for (let i = 0; i < this.neurons.length; i++) {
      const n = this.neurons[i];
      if (n.cooldown > 0) n.cooldown -= dt;
      n.brightness = Math.max(0, n.brightness - dt * 1.8);

      // Lerp: dim → primary → secondary based on brightness
      const b = n.brightness;
      let r: number, g: number, bl: number;
      if (b < 0.5) {
        const t = b * 2;
        r = dimR + (priR - dimR) * t;
        g = dimG + (priG - dimG) * t;
        bl = dimB + (priB - dimB) * t;
      } else {
        const t = (b - 0.5) * 2;
        r = priR + (secR - priR) * t;
        g = priG + (secG - priG) * t;
        bl = priB + (secB - priB) * t;
      }
      neuronColorAttr.setXYZ(i, r, g, bl);
    }
    neuronColorAttr.needsUpdate = true;
    (this.neuronPoints.material as THREE.PointsMaterial).opacity = opacity;

    // ── Reset edge colors to base dim ──
    const edgeColorAttr = this.edgeLines.geometry.getAttribute('color') as THREE.BufferAttribute;
    for (let i = 0; i < this.edges.length; i++) {
      const ofs = i * 6;
      this.edgeColors[ofs]     = dimR * 0.4;
      this.edgeColors[ofs + 1] = dimG * 0.4;
      this.edgeColors[ofs + 2] = dimB * 0.4;
      this.edgeColors[ofs + 3] = dimR * 0.4;
      this.edgeColors[ofs + 4] = dimG * 0.4;
      this.edgeColors[ofs + 5] = dimB * 0.4;
    }

    // ── Update pulses ──
    const pulsePos = this.pulsePoints.geometry.getAttribute('position') as THREE.BufferAttribute;
    let activePulseCount = 0;
    for (let p = 0; p < this.maxPulses; p++) {
      const pulse = this.pulses[p];
      if (!pulse.active) continue;

      pulse.progress += pulse.speed * dt;

      const arrived = pulse.speed > 0 ? pulse.progress >= 1.0 : pulse.progress <= 0.0;
      if (arrived) {
        // Determine target neuron
        const e = this.edges[pulse.edge];
        const targetIdx = pulse.speed > 0 ? e.to : e.from;

        // Cascade: chance to fire the target neuron
        if (this.rng.chance(0.4)) {
          this.fireNeuron(targetIdx);
        }
        pulse.active = false;
        continue;
      }

      // Compute pulse world position by lerping along edge
      const e = this.edges[pulse.edge];
      const fromN = this.neurons[e.from];
      const toN = this.neurons[e.to];
      const t = Math.max(0, Math.min(1, pulse.progress));
      const px = fromN.x + (toN.x - fromN.x) * t;
      const py = fromN.y + (toN.y - fromN.y) * t;
      pulsePos.setXYZ(activePulseCount, px, py, 2);

      // Brighten the edge this pulse is on
      const ofs = pulse.edge * 6;
      this.edgeColors[ofs]     = Math.max(this.edgeColors[ofs],     priR * 0.8);
      this.edgeColors[ofs + 1] = Math.max(this.edgeColors[ofs + 1], priG * 0.8);
      this.edgeColors[ofs + 2] = Math.max(this.edgeColors[ofs + 2], priB * 0.8);
      this.edgeColors[ofs + 3] = Math.max(this.edgeColors[ofs + 3], priR * 0.8);
      this.edgeColors[ofs + 4] = Math.max(this.edgeColors[ofs + 4], priG * 0.8);
      this.edgeColors[ofs + 5] = Math.max(this.edgeColors[ofs + 5], priB * 0.8);

      activePulseCount++;
    }
    pulsePos.needsUpdate = true;
    this.pulsePoints.geometry.setDrawRange(0, activePulseCount);

    edgeColorAttr.needsUpdate = true;
    (this.edgeLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.5;
    (this.pulsePoints.material as THREE.PointsMaterial).opacity = opacity;

    // Background rings: subtle breathing
    this.bgRingMat.opacity = opacity * (0.06 + 0.02 * Math.sin(time * 0.8));
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Seizure: fire ALL neurons simultaneously
      for (let i = 0; i < this.neurons.length; i++) {
        this.neurons[i].cooldown = 0; // force allow
        this.fireNeuron(i);
      }
    }
    if (action === 'alert') {
      // Dramatically increase fire rate for 2 seconds
      this.alertBoostTimer = 2.0;
    }
    if (action === 'pulse') {
      // Wave outward from center — fire neurons sorted by distance from center
      const sorted = this.neurons
        .map((n, i) => ({ i, dist: Math.hypot(n.x - this.cx, n.y - this.cy) }))
        .sort((a, b) => a.dist - b.dist);

      // Fire in waves with staggered cooldowns so it ripples outward
      for (let k = 0; k < sorted.length; k++) {
        const n = this.neurons[sorted[k].i];
        n.cooldown = 0;
        // Delay by setting brightness inversely — closer neurons fire first
        n.brightness = Math.max(0, 1.0 - k * 0.06);
        if (k < 5) this.fireNeuron(sorted[k].i);
      }
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level === 0) {
      this.fireInterval = this.rng.float(0.3, 0.8);
      return;
    }
    // Scale fire rate continuously with level
    this.fireInterval = Math.max(0.05, 0.5 / level);
    // Lower cascade threshold at high levels
    const fireCount = level + (level >= 3 ? level : 0);
    for (let i = 0; i < fireCount; i++) {
      const idx = this.rng.int(0, this.neurons.length - 1);
      this.neurons[idx].cooldown = 0;
      this.fireNeuron(idx);
    }
    if (level >= 4) {
      for (const n of this.neurons) {
        n.cooldown *= 0.3;
      }
    }
    if (level >= 5) {
      for (let i = 0; i < this.neurons.length; i++) {
        this.neurons[i].cooldown = 0;
        this.fireNeuron(i);
      }
    }
  }
}
