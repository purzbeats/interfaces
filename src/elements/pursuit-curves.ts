import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Pursuit curves: N agents each chasing the next in a cycle. Produces
 * beautiful spiral patterns that converge toward the center. Each agent
 * leaves a fading trail. Reset when agents converge.
 */
export class PursuitCurvesElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'pursuit-curves',
    meta: { shape: 'radial', roles: ['decorative', 'data-display'], moods: ['ambient', 'tactical'], bandAffinity: 'high', sizes: ['needs-medium', 'needs-large'] },
  };

  private trailLines: THREE.Line[] = [];
  private trailMats: THREE.LineBasicMaterial[] = [];
  private trailPositions: Float32Array[] = [];
  private trailHeads: number[] = [];
  private maxTrailPoints: number = 500;
  private agentX: number[] = [];
  private agentY: number[] = [];
  private numAgents: number = 0;
  private speed: number = 0;
  private cx: number = 0;
  private cy: number = 0;
  private spawnRadius: number = 0;

  build(): void {
    this.glitchAmount = 4;
    const { x, y, w, h } = this.px;
    this.cx = x + w / 2;
    this.cy = y + h / 2;
    this.spawnRadius = Math.min(w, h) * 0.4;

    const variant = this.rng.int(0, 3);
    const presets = [
      { agents: 4, speed: 60, trail: 300 },
      { agents: 5, speed: 50, trail: 300 },
      { agents: 3, speed: 80, trail: 300 },
      { agents: 6, speed: 40, trail: 300 },
    ];
    const pr = presets[variant];
    this.numAgents = pr.agents;
    this.speed = pr.speed;
    this.maxTrailPoints = pr.trail;

    this.spawnAgents();

    // Create trail lines for each agent
    for (let a = 0; a < this.numAgents; a++) {
      const positions = new Float32Array(this.maxTrailPoints * 3);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geo.setDrawRange(0, 0);

      const t = a / this.numAgents;
      const color = new THREE.Color().copy(this.palette.primary).lerp(this.palette.secondary, t);
      const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0 });
      const line = new THREE.Line(geo, mat);

      this.trailPositions.push(positions);
      this.trailMats.push(mat);
      this.trailLines.push(line);
      this.trailHeads.push(0);
      this.group.add(line);
    }
  }

  private spawnAgents(): void {
    this.agentX = [];
    this.agentY = [];
    const R = this.spawnRadius;
    for (let a = 0; a < this.numAgents; a++) {
      const angle = (a / this.numAgents) * Math.PI * 2 + this.rng.float(0, 0.2);
      this.agentX.push(this.cx + Math.cos(angle) * R);
      this.agentY.push(this.cy + Math.sin(angle) * R);
    }
    for (let a = 0; a < this.numAgents; a++) {
      this.trailHeads[a] = 0;
    }
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);
    const step = this.speed * dt;

    // Check convergence
    let maxDist = 0;
    for (let a = 0; a < this.numAgents; a++) {
      const target = (a + 1) % this.numAgents;
      const dx = this.agentX[target] - this.agentX[a];
      const dy = this.agentY[target] - this.agentY[a];
      maxDist = Math.max(maxDist, dx * dx + dy * dy);
    }
    if (maxDist < 4) {
      this.spawnAgents();
      for (const pos of this.trailPositions) pos.fill(0);
      return;
    }

    // Move each agent toward the next
    const newX = new Float64Array(this.numAgents);
    const newY = new Float64Array(this.numAgents);
    for (let a = 0; a < this.numAgents; a++) {
      const target = (a + 1) % this.numAgents;
      const dx = this.agentX[target] - this.agentX[a];
      const dy = this.agentY[target] - this.agentY[a];
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > 0.1) {
        newX[a] = this.agentX[a] + (dx / dist) * step;
        newY[a] = this.agentY[a] + (dy / dist) * step;
      } else {
        newX[a] = this.agentX[a];
        newY[a] = this.agentY[a];
      }
    }
    for (let a = 0; a < this.numAgents; a++) {
      this.agentX[a] = newX[a];
      this.agentY[a] = newY[a];
    }

    // Record trail positions
    for (let a = 0; a < this.numAgents; a++) {
      const head = this.trailHeads[a];
      if (head < this.maxTrailPoints) {
        const idx = head * 3;
        this.trailPositions[a][idx] = this.agentX[a];
        this.trailPositions[a][idx + 1] = this.agentY[a];
        this.trailPositions[a][idx + 2] = 0;
        this.trailHeads[a]++;
      }
    }

    // Update geometries
    for (let a = 0; a < this.numAgents; a++) {
      const geo = this.trailLines[a].geometry;
      geo.setDrawRange(0, this.trailHeads[a]);
      (geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
      this.trailMats[a].opacity = opacity * 0.7;
    }
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') this.glitchTimer = 0.5;
    if (action === 'alert') {
      this.spawnAgents();
      for (const pos of this.trailPositions) pos.fill(0);
    }
  }

  onIntensity(level: number): void {
    super.onIntensity(level);
    if (level >= 2) this.speed *= 1 + level * 0.1;
  }
}
