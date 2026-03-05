import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Phase portrait of a damped driven pendulum showing trajectories in
 * angle-velocity space. Multiple initial conditions trace attractors,
 * revealing the chaotic dynamics of the forced pendulum.
 */
export class PendulumPhaseElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'pendulum-phase',
    meta: {
      shape: 'rectangular',
      roles: ['data-display', 'decorative'],
      moods: ['diagnostic', 'ambient'],
      bandAffinity: 'bass',
      sizes: ['needs-medium', 'needs-large'],
    },
  };

  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private texture!: THREE.CanvasTexture;
  private mesh!: THREE.Mesh;
  private material!: THREE.MeshBasicMaterial;

  private cw: number = 0;
  private ch: number = 0;

  // Pendulum parameters
  private damping: number = 0.1;
  private driveAmp: number = 1.2;
  private driveFreq: number = 0.667;
  private gravity: number = 1.0;
  private numTrajectories: number = 8;

  // State for each trajectory: [theta, omega]
  private states: { theta: number; omega: number }[] = [];
  private simTime: number = 0;
  private fadeAlpha: number = 0.01;
  private stepsPerFrame: number = 5;
  private dtSim: number = 0.02;
  private intensityLevel: number = 0;

  build(): void {
    const variant = this.rng.int(0, 3);
    const presets = [
      { damp: 0.1, amp: 1.2, freq: 0.667, g: 1.0, n: 8, fade: 0.01, steps: 5 },    // Classic chaotic
      { damp: 0.05, amp: 1.5, freq: 0.8, g: 1.0, n: 12, fade: 0.005, steps: 8 },   // High drive
      { damp: 0.2, amp: 0.8, freq: 0.5, g: 1.0, n: 6, fade: 0.02, steps: 4 },      // Damped
      { damp: 0.08, amp: 1.35, freq: 0.72, g: 1.0, n: 16, fade: 0.003, steps: 10 }, // Dense chaos
    ];
    const p = presets[variant];

    this.damping = p.damp;
    this.driveAmp = p.amp;
    this.driveFreq = p.freq;
    this.gravity = p.g;
    this.numTrajectories = p.n;
    this.fadeAlpha = p.fade;
    this.stepsPerFrame = p.steps;
    this.simTime = 0;
    this.glitchAmount = 4;

    // Initialize trajectories with spread initial conditions
    this.states = [];
    for (let i = 0; i < this.numTrajectories; i++) {
      this.states.push({
        theta: this.rng.float(-Math.PI, Math.PI),
        omega: this.rng.float(-2, 2),
      });
    }

    const { x, y, w, h } = this.px;
    this.cw = Math.max(64, Math.floor(w * 0.7));
    this.ch = Math.max(64, Math.floor(h * 0.7));

    this.canvas = document.createElement('canvas');
    this.canvas.width = this.cw;
    this.canvas.height = this.ch;
    this.ctx = this.get2DContext(this.canvas);

    // Fill background
    const bg = this.palette.bg;
    this.ctx.fillStyle = `rgb(${Math.floor(bg.r * 255)},${Math.floor(bg.g * 255)},${Math.floor(bg.b * 255)})`;
    this.ctx.fillRect(0, 0, this.cw, this.ch);

    // Draw axes
    this.drawAxes();

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.magFilter = THREE.NearestFilter;

    this.material = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      opacity: 0,
    });

    const geo = new THREE.PlaneGeometry(w, h);
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.position.set(x + w / 2, y + h / 2, 0);
    this.group.add(this.mesh);
  }

  private drawAxes(): void {
    const ctx = this.ctx;
    const dm = this.palette.dim;
    ctx.strokeStyle = `rgba(${Math.floor(dm.r * 255)},${Math.floor(dm.g * 255)},${Math.floor(dm.b * 255)},0.3)`;
    ctx.lineWidth = 0.5;

    // Horizontal axis (theta = 0)
    ctx.beginPath();
    ctx.moveTo(0, this.ch / 2);
    ctx.lineTo(this.cw, this.ch / 2);
    ctx.stroke();

    // Vertical axis (omega = 0)
    ctx.beginPath();
    ctx.moveTo(this.cw / 2, 0);
    ctx.lineTo(this.cw / 2, this.ch);
    ctx.stroke();
  }

  private thetaToX(theta: number): number {
    // Wrap theta to [-pi, pi] and map to canvas
    let t = theta % (2 * Math.PI);
    if (t > Math.PI) t -= 2 * Math.PI;
    if (t < -Math.PI) t += 2 * Math.PI;
    return (t / Math.PI + 1) * 0.5 * this.cw;
  }

  private omegaToY(omega: number): number {
    // Map omega range [-4, 4] to canvas
    return (1 - (omega + 4) / 8) * this.ch;
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);
    this.material.opacity = opacity;

    // Gentle fade
    const bg = this.palette.bg;
    this.ctx.fillStyle = `rgba(${Math.floor(bg.r * 255)},${Math.floor(bg.g * 255)},${Math.floor(bg.b * 255)},${this.fadeAlpha})`;
    this.ctx.fillRect(0, 0, this.cw, this.ch);

    const steps = this.stepsPerFrame + this.intensityLevel * 2;
    const ctx = this.ctx;
    const pr = this.palette.primary;
    const sr = this.palette.secondary;

    for (let step = 0; step < steps; step++) {
      for (let i = 0; i < this.states.length; i++) {
        const s = this.states[i];
        const prevX = this.thetaToX(s.theta);
        const prevY = this.omegaToY(s.omega);

        // RK4 integration of damped driven pendulum
        // d(theta)/dt = omega
        // d(omega)/dt = -damping*omega - g*sin(theta) + amp*cos(freq*t)
        const drive = this.driveAmp * Math.cos(this.driveFreq * this.simTime);
        const k1t = s.omega;
        const k1o = -this.damping * s.omega - this.gravity * Math.sin(s.theta) + drive;

        const t2 = s.theta + k1t * this.dtSim * 0.5;
        const o2 = s.omega + k1o * this.dtSim * 0.5;
        const d2 = this.driveAmp * Math.cos(this.driveFreq * (this.simTime + this.dtSim * 0.5));
        const k2t = o2;
        const k2o = -this.damping * o2 - this.gravity * Math.sin(t2) + d2;

        const t3 = s.theta + k2t * this.dtSim * 0.5;
        const o3 = s.omega + k2o * this.dtSim * 0.5;
        const k3t = o3;
        const k3o = -this.damping * o3 - this.gravity * Math.sin(t3) + d2;

        const t4 = s.theta + k3t * this.dtSim;
        const o4 = s.omega + k3o * this.dtSim;
        const d4 = this.driveAmp * Math.cos(this.driveFreq * (this.simTime + this.dtSim));
        const k4t = o4;
        const k4o = -this.damping * o4 - this.gravity * Math.sin(t4) + d4;

        s.theta += (k1t + 2 * k2t + 2 * k3t + k4t) / 6 * this.dtSim;
        s.omega += (k1o + 2 * k2o + 2 * k3o + k4o) / 6 * this.dtSim;

        const newX = this.thetaToX(s.theta);
        const newY = this.omegaToY(s.omega);

        // Don't draw wrapping lines
        if (Math.abs(newX - prevX) < this.cw * 0.5) {
          const t = i / this.states.length;
          const r = Math.floor((pr.r * (1 - t) + sr.r * t) * 255);
          const g = Math.floor((pr.g * (1 - t) + sr.g * t) * 255);
          const b = Math.floor((pr.b * (1 - t) + sr.b * t) * 255);
          ctx.strokeStyle = `rgba(${r},${g},${b},0.4)`;
          ctx.lineWidth = 0.8;
          ctx.beginPath();
          ctx.moveTo(prevX, prevY);
          ctx.lineTo(newX, newY);
          ctx.stroke();
        }
      }
      this.simTime += this.dtSim;
    }

    this.texture.needsUpdate = true;
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      // Perturb all trajectories
      for (const s of this.states) {
        s.omega += this.rng.float(-1, 1);
      }
    }
    if (action === 'pulse') {
      // Add new trajectories
      for (let i = 0; i < 4; i++) {
        this.states.push({
          theta: this.rng.float(-Math.PI, Math.PI),
          omega: this.rng.float(-3, 3),
        });
      }
      // Cap total
      if (this.states.length > 32) {
        this.states.splice(0, this.states.length - 32);
      }
    }
    if (action === 'alert') {
      // Sudden drive amplitude spike
      this.driveAmp *= 2;
      setTimeout(() => { this.driveAmp /= 2; }, 1000);
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    this.intensityLevel = level;
    if (level >= 3) {
      this.driveAmp = 1.2 + level * 0.2;
    }
  }
}
