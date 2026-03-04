import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Newton's Cradle: 5 balls hanging from lines at a top bar.
 * The leftmost or rightmost ball swings out and back while
 * the others stay still. The active end alternates periodically.
 */
export class NewtonCradleElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'newton-cradle',
    meta: {
      shape: 'linear',
      roles: ['decorative'],
      moods: ['ambient'],
      sizes: ['needs-medium'],
    },
  };

  private stringLines!: THREE.LineSegments;
  private topBar!: THREE.LineSegments;
  private ballMeshes: THREE.Mesh[] = [];

  private topY: number = 0;
  private barLeft: number = 0;
  private stringLength: number = 0;
  private ballRadius: number = 0;
  private ballSpacing: number = 0;
  private ballCentersX: number[] = [];
  private swingAngle: number = 0;
  private speed: number = 0;
  private cyclePeriod: number = 0;
  private variant: number = 0;

  build(): void {
    const { x, y, w, h } = this.px;
    this.variant = this.rng.int(0, 3);

    const presets = [
      // Variant 0: Standard cradle
      { speed: 2.5, swingAngle: 0.6, cyclePeriod: 6.0 },
      // Variant 1: Fast, small swing
      { speed: 3.5, swingAngle: 0.4, cyclePeriod: 4.0 },
      // Variant 2: Slow, dramatic swing
      { speed: 1.5, swingAngle: 0.75, cyclePeriod: 8.0 },
      // Variant 3: Medium, moderate swing
      { speed: 2.0, swingAngle: 0.55, cyclePeriod: 5.0 },
    ];

    const p = presets[this.variant];
    this.speed = p.speed;
    this.swingAngle = p.swingAngle;
    this.cyclePeriod = p.cyclePeriod;

    const cx = x + w / 2;
    this.topY = y + h * 0.15;
    this.stringLength = h * 0.5;
    this.ballRadius = Math.max(3, Math.min(w * 0.06, h * 0.06));
    this.ballSpacing = this.ballRadius * 2.1;

    // Center the 5 balls
    const totalWidth = this.ballSpacing * 4;
    this.barLeft = cx - totalWidth / 2;

    for (let i = 0; i < 5; i++) {
      this.ballCentersX.push(this.barLeft + i * this.ballSpacing);
    }

    // Top bar
    const barVerts = [
      this.barLeft - this.ballRadius, this.topY, 0,
      this.barLeft + totalWidth + this.ballRadius, this.topY, 0,
    ];
    const barGeo = new THREE.BufferGeometry();
    barGeo.setAttribute('position', new THREE.Float32BufferAttribute(barVerts, 3));
    this.topBar = new THREE.LineSegments(barGeo, new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.topBar);

    // String lines (5 strings, each from top bar to ball center — 2 verts each)
    const stringVerts = new Float32Array(5 * 2 * 3);
    const restBallY = this.topY + this.stringLength;
    for (let i = 0; i < 5; i++) {
      const bx = this.ballCentersX[i];
      stringVerts[i * 6 + 0] = bx;
      stringVerts[i * 6 + 1] = this.topY;
      stringVerts[i * 6 + 2] = 0;
      stringVerts[i * 6 + 3] = bx;
      stringVerts[i * 6 + 4] = restBallY;
      stringVerts[i * 6 + 5] = 0;
    }
    const stringGeo = new THREE.BufferGeometry();
    stringGeo.setAttribute('position', new THREE.BufferAttribute(stringVerts, 3));
    this.stringLines = new THREE.LineSegments(stringGeo, new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.stringLines);

    // Ball meshes
    for (let i = 0; i < 5; i++) {
      const ballGeo = new THREE.CircleGeometry(this.ballRadius, 16);
      const ball = new THREE.Mesh(ballGeo, new THREE.MeshBasicMaterial({
        color: i === 0 || i === 4 ? this.palette.primary : this.palette.secondary,
        transparent: true,
        opacity: 0,
      }));
      ball.position.set(this.ballCentersX[i], restBallY, 1);
      this.ballMeshes.push(ball);
      this.group.add(ball);
    }
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);

    // Determine which end is swinging based on cycle
    // Use a pattern: left swings, pause, right swings, pause
    const cycleTime = time % (this.cyclePeriod * 2);
    const isLeftSwinging = cycleTime < this.cyclePeriod;
    const activeIndex = isLeftSwinging ? 0 : 4;
    const oppositeIndex = isLeftSwinging ? 4 : 0;

    // Compute swing angle: smooth sinusoidal, only positive angles on one side
    const halfCycle = this.cyclePeriod / 2;
    const localTime = cycleTime % this.cyclePeriod;

    // The active ball swings: outward then back, then the opposite ball responds
    let activeAngle = 0;
    let reactAngle = 0;

    if (localTime < halfCycle) {
      // Active ball swinging out and back
      const t = localTime / halfCycle;
      const swing = Math.sin(t * Math.PI);
      activeAngle = swing * this.swingAngle * (isLeftSwinging ? -1 : 1);
    } else {
      // Reaction: opposite ball swings out and back
      const t = (localTime - halfCycle) / halfCycle;
      const swing = Math.sin(t * Math.PI);
      reactAngle = swing * this.swingAngle * (isLeftSwinging ? 1 : -1);
    }

    // Position all balls
    const restBallY = this.topY + this.stringLength;
    const stringPos = this.stringLines.geometry.getAttribute('position') as THREE.BufferAttribute;

    for (let i = 0; i < 5; i++) {
      let angle = 0;
      if (i === activeIndex) angle = activeAngle;
      if (i === oppositeIndex && localTime >= this.cyclePeriod / 2) angle = reactAngle;

      // Ball position based on pendulum swing from top anchor
      const anchorX = this.ballCentersX[i];
      const ballX = anchorX + Math.sin(angle) * this.stringLength;
      const ballY = this.topY + Math.cos(angle) * this.stringLength;

      this.ballMeshes[i].position.set(ballX, ballY, 1);

      // Update string
      stringPos.setXYZ(i * 2, anchorX, this.topY, 0);
      stringPos.setXYZ(i * 2 + 1, ballX, ballY, 0);

      // Ball opacity
      (this.ballMeshes[i].material as THREE.MeshBasicMaterial).opacity = opacity * 0.8;
    }
    stringPos.needsUpdate = true;

    (this.topBar.material as THREE.LineBasicMaterial).opacity = opacity * 0.5;
    (this.stringLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.45;
  }
}
