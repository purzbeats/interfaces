import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Kuramoto model of coupled oscillators. N oscillators on a circle
 * gradually synchronize their phases, visualizing the emergence of
 * phase coherence. The order parameter r rises from ~0 (incoherent)
 * toward 1 (fully synchronized). Periodically resets to re-demonstrate
 * the synchronization transition.
 */
export class KuramotoSyncElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'kuramoto-sync',
    meta: {
      shape: 'radial',
      roles: ['data-display', 'decorative'],
      moods: ['diagnostic', 'ambient'],
      bandAffinity: 'mid',
      sizes: ['needs-medium', 'needs-large'],
    } satisfies ElementMeta,
  };

  private oscCount = 0;
  private phases!: Float64Array;
  private naturalFreqs!: Float64Array;
  private coupling = 0;
  private baseCoupling = 0;
  private freqSpread = 0;
  private cx = 0;
  private cy = 0;
  private radius = 0;
  private dotsMesh!: THREE.Points;
  private dotsMat!: THREE.PointsMaterial;
  private orderLine!: THREE.Line;
  private orderMat!: THREE.LineBasicMaterial;
  private ringLine!: THREE.Line;
  private ringMat!: THREE.LineBasicMaterial;
  private orderVecLine!: THREE.LineSegments;
  private orderVecPositions!: Float32Array;
  private orderVecMat!: THREE.LineBasicMaterial;
  private connLines!: THREE.LineSegments;
  private connPositions!: Float32Array;
  private connMat!: THREE.LineBasicMaterial;
  private borderLines!: THREE.LineSegments;
  private borderMat!: THREE.LineBasicMaterial;
  private orderHistory: number[] = [];
  private histLen = 100;
  private resetTimer = 0;
  private resetInterval = 0;
  private intensityLevel = 0;
  private maxConnections = 0;

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;
    this.cx = x + w / 2;
    this.cy = y + h / 2;
    this.radius = Math.min(w, h) * 0.32;

    const variant = this.rng.int(0, 3);
    const presets = [
      { n: 24, K: 2.0, freqSpread: 1.5, reset: 18, conns: 40 },
      { n: 50, K: 1.5, freqSpread: 2.0, reset: 22, conns: 60 },
      { n: 16, K: 3.0, freqSpread: 1.0, reset: 14, conns: 30 },
      { n: 36, K: 0.8, freqSpread: 3.0, reset: 25, conns: 50 },
    ];
    const p = presets[variant];
    this.oscCount = p.n;
    this.coupling = p.K;
    this.baseCoupling = p.K;
    this.freqSpread = p.freqSpread;
    this.resetInterval = p.reset;
    this.maxConnections = p.conns;

    this.phases = new Float64Array(p.n);
    this.naturalFreqs = new Float64Array(p.n);
    this.initOscillators();
    this.orderHistory = new Array(this.histLen).fill(0);

    // Unit circle outline
    const segs = 64;
    const ringPos = new Float32Array((segs + 1) * 3);
    for (let i = 0; i <= segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      ringPos[i * 3] = this.cx + Math.cos(a) * this.radius;
      ringPos[i * 3 + 1] = this.cy + Math.sin(a) * this.radius;
    }
    const ringGeo = new THREE.BufferGeometry();
    ringGeo.setAttribute('position', new THREE.BufferAttribute(ringPos, 3));
    this.ringMat = new THREE.LineBasicMaterial({
      color: this.palette.dim, transparent: true, opacity: 0,
    });
    this.ringLine = new THREE.Line(ringGeo, this.ringMat);
    this.group.add(this.ringLine);

    // Connection lines between nearby oscillators
    this.connPositions = new Float32Array(this.maxConnections * 6);
    const connGeo = new THREE.BufferGeometry();
    connGeo.setAttribute('position', new THREE.BufferAttribute(this.connPositions, 3));
    connGeo.setDrawRange(0, 0);
    this.connMat = new THREE.LineBasicMaterial({
      color: this.palette.dim, transparent: true, opacity: 0,
    });
    this.connLines = new THREE.LineSegments(connGeo, this.connMat);
    this.group.add(this.connLines);

    // Oscillator dots
    const dotPos = new Float32Array(p.n * 3);
    const dotGeo = new THREE.BufferGeometry();
    dotGeo.setAttribute('position', new THREE.BufferAttribute(dotPos, 3));
    this.dotsMat = new THREE.PointsMaterial({
      color: this.palette.primary, transparent: true, opacity: 0, size: Math.max(1, Math.min(w, h) * 0.013), sizeAttenuation: false,
    });
    this.dotsMesh = new THREE.Points(dotGeo, this.dotsMat);
    this.group.add(this.dotsMesh);

    // Order parameter vector
    this.orderVecPositions = new Float32Array(6);
    const ovGeo = new THREE.BufferGeometry();
    ovGeo.setAttribute('position', new THREE.BufferAttribute(this.orderVecPositions, 3));
    this.orderVecMat = new THREE.LineBasicMaterial({
      color: this.palette.secondary, transparent: true, opacity: 0,
    });
    this.orderVecLine = new THREE.LineSegments(ovGeo, this.orderVecMat);
    this.group.add(this.orderVecLine);

    // Order parameter history line
    const histPos = new Float32Array(this.histLen * 3);
    const histGeo = new THREE.BufferGeometry();
    histGeo.setAttribute('position', new THREE.BufferAttribute(histPos, 3));
    this.orderMat = new THREE.LineBasicMaterial({
      color: this.palette.secondary, transparent: true, opacity: 0,
    });
    this.orderLine = new THREE.Line(histGeo, this.orderMat);
    this.group.add(this.orderLine);

    // Border
    const bv = new Float32Array([
      x, y, 0, x + w, y, 0, x + w, y, 0, x + w, y + h, 0,
      x + w, y + h, 0, x, y + h, 0, x, y + h, 0, x, y, 0,
    ]);
    const bGeo = new THREE.BufferGeometry();
    bGeo.setAttribute('position', new THREE.BufferAttribute(bv, 3));
    this.borderMat = new THREE.LineBasicMaterial({
      color: this.palette.dim, transparent: true, opacity: 0,
    });
    this.borderLines = new THREE.LineSegments(bGeo, this.borderMat);
    this.group.add(this.borderLines);
  }

  private initOscillators(): void {
    for (let i = 0; i < this.oscCount; i++) {
      this.phases[i] = this.rng.float(0, Math.PI * 2);
      // Lorentzian distribution
      this.naturalFreqs[i] = this.freqSpread * Math.tan((this.rng.next() - 0.5) * Math.PI * 0.8);
    }
    this.resetTimer = 0;
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);
    const n = this.oscCount;
    const clampDt = Math.min(dt, 0.05);

    // Reset periodically
    this.resetTimer += dt;
    if (this.resetTimer >= this.resetInterval) {
      this.initOscillators();
      this.orderHistory = new Array(this.histLen).fill(0);
    }

    // Kuramoto: dtheta_i/dt = omega_i + (K/N) * sum_j sin(theta_j - theta_i)
    const dPhase = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let j = 0; j < n; j++) {
        if (i !== j) sum += Math.sin(this.phases[j] - this.phases[i]);
      }
      dPhase[i] = this.naturalFreqs[i] + (this.coupling / n) * sum;
    }
    for (let i = 0; i < n; i++) {
      this.phases[i] += dPhase[i] * clampDt;
    }

    // Order parameter r = |1/N sum e^(i*theta)|
    let realSum = 0, imagSum = 0;
    for (let i = 0; i < n; i++) {
      realSum += Math.cos(this.phases[i]);
      imagSum += Math.sin(this.phases[i]);
    }
    const r = Math.sqrt(realSum * realSum + imagSum * imagSum) / n;
    const psi = Math.atan2(imagSum, realSum);

    this.orderHistory.shift();
    this.orderHistory.push(r);

    // Update dot positions
    const dp = this.dotsMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < n; i++) {
      dp.setXYZ(i, this.cx + Math.cos(this.phases[i]) * this.radius,
        this.cy + Math.sin(this.phases[i]) * this.radius, 0.1);
    }
    dp.needsUpdate = true;

    // Order parameter vector (center to mean phase direction, length = r)
    const vecLen = r * this.radius * 0.8;
    this.orderVecPositions[0] = this.cx;
    this.orderVecPositions[1] = this.cy;
    this.orderVecPositions[2] = 0.2;
    this.orderVecPositions[3] = this.cx + Math.cos(psi) * vecLen;
    this.orderVecPositions[4] = this.cy + Math.sin(psi) * vecLen;
    this.orderVecPositions[5] = 0.2;
    const ovPos = this.orderVecLine.geometry.getAttribute('position') as THREE.BufferAttribute;
    ovPos.needsUpdate = true;

    // Connection lines between oscillators with close phases
    let ci = 0;
    const threshold = 0.3; // radians
    for (let i = 0; i < n && ci < this.maxConnections; i++) {
      for (let j = i + 1; j < n && ci < this.maxConnections; j++) {
        let dph = Math.abs(this.phases[i] - this.phases[j]);
        dph = Math.min(dph, Math.PI * 2 - dph);
        if (dph < threshold) {
          const vi = ci * 6;
          this.connPositions[vi] = this.cx + Math.cos(this.phases[i]) * this.radius;
          this.connPositions[vi + 1] = this.cy + Math.sin(this.phases[i]) * this.radius;
          this.connPositions[vi + 2] = 0;
          this.connPositions[vi + 3] = this.cx + Math.cos(this.phases[j]) * this.radius;
          this.connPositions[vi + 4] = this.cy + Math.sin(this.phases[j]) * this.radius;
          this.connPositions[vi + 5] = 0;
          ci++;
        }
      }
    }
    const connPos = this.connLines.geometry.getAttribute('position') as THREE.BufferAttribute;
    connPos.needsUpdate = true;
    this.connLines.geometry.setDrawRange(0, ci * 2);

    // Order history plot
    const hp = this.orderLine.geometry.getAttribute('position') as THREE.BufferAttribute;
    const plotW = this.px.w * 0.7;
    const plotBaseY = this.cy + this.radius + Math.min(this.px.h * 0.1, 25);
    const plotH = Math.min(this.px.h * 0.18, 40);
    for (let i = 0; i < this.histLen; i++) {
      hp.setXYZ(i, this.cx - plotW / 2 + (i / this.histLen) * plotW,
        plotBaseY + this.orderHistory[i] * plotH, 0);
    }
    hp.needsUpdate = true;

    this.dotsMat.opacity = opacity;
    this.ringMat.opacity = opacity * 0.25;
    this.orderMat.opacity = opacity * 0.6;
    this.orderVecMat.opacity = opacity * 0.9;
    this.connMat.opacity = opacity * 0.15;
    this.borderMat.opacity = opacity * 0.2;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      for (let i = 0; i < this.oscCount; i++) {
        this.phases[i] = this.rng.float(0, Math.PI * 2);
      }
    }
    if (action === 'alert') {
      this.coupling *= 4;
      setTimeout(() => { this.coupling = this.baseCoupling; }, 2000);
    }
    if (action === 'pulse') {
      // Phase kick: push all phases by a random amount
      const kick = this.rng.float(-1, 1);
      for (let i = 0; i < this.oscCount; i++) {
        this.phases[i] += kick;
      }
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    this.intensityLevel = level;
    if (level === 0) {
      this.coupling = this.baseCoupling;
      return;
    }
    this.coupling = this.baseCoupling + level * 0.5;
    if (level >= 4) {
      for (let i = 0; i < this.oscCount; i++) {
        this.phases[i] += this.rng.float(-0.3, 0.3) * level;
      }
    }
  }
}
