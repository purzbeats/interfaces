import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Spinning segmented roulette wheel with a fixed pointer at the top.
 * The wheel accelerates and decelerates in cycles.
 * One segment is highlighted as the "selected" segment.
 */
export class RouletteSpinElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'roulette-spin',
    meta: {
      shape: 'radial',
      roles: ['decorative', 'gauge'],
      moods: ['tactical'],
      sizes: ['needs-medium', 'needs-large'],
    },
  };

  private wheelGroup!: THREE.Group;
  private outerRing!: THREE.Line;
  private segmentLines!: THREE.LineSegments;
  private highlightMesh!: THREE.Mesh;
  private pointer!: THREE.Mesh;
  private centerDot!: THREE.Mesh;

  private cx: number = 0;
  private cy: number = 0;
  private radius: number = 0;
  private segmentCount: number = 12;
  private segmentAngle: number = 0;

  private wheelAngle: number = 0;
  private wheelSpeed: number = 1.0;
  private cycleTimer: number = 0;
  private cycleDuration: number = 4.0;
  private minSpeed: number = 0.3;
  private maxSpeed: number = 3.0;
  private accelerating: boolean = true;

  build(): void {
    const { x, y, w, h } = this.px;
    this.cx = x + w / 2;
    this.cy = y + h / 2;
    this.radius = Math.min(w, h) / 2 * 0.85;

    this.segmentCount = this.rng.int(8, 16);
    this.segmentAngle = (Math.PI * 2) / this.segmentCount;
    this.cycleDuration = this.rng.float(3.0, 6.0);
    this.minSpeed = this.rng.float(0.15, 0.4);
    this.maxSpeed = this.rng.float(2.0, 4.0);
    this.wheelSpeed = this.rng.float(this.minSpeed, this.maxSpeed);

    // Wheel group (rotates)
    this.wheelGroup = new THREE.Group();
    this.wheelGroup.position.set(this.cx, this.cy, 0);
    this.group.add(this.wheelGroup);

    // Outer ring
    const ringSegments = 64;
    const ringPositions = new Float32Array((ringSegments + 1) * 3);
    for (let s = 0; s <= ringSegments; s++) {
      const a = (s / ringSegments) * Math.PI * 2;
      ringPositions[s * 3 + 0] = Math.cos(a) * this.radius;
      ringPositions[s * 3 + 1] = Math.sin(a) * this.radius;
      ringPositions[s * 3 + 2] = 0;
    }
    const ringGeo = new THREE.BufferGeometry();
    ringGeo.setAttribute('position', new THREE.BufferAttribute(ringPositions, 3));
    this.outerRing = new THREE.Line(ringGeo, new THREE.LineBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
    }));
    this.wheelGroup.add(this.outerRing);

    // Segment divider lines (radial lines from center to edge)
    const segVerts: number[] = [];
    for (let i = 0; i < this.segmentCount; i++) {
      const a = i * this.segmentAngle;
      segVerts.push(
        0, 0, 0,
        Math.cos(a) * this.radius, Math.sin(a) * this.radius, 0,
      );
    }
    const segGeo = new THREE.BufferGeometry();
    segGeo.setAttribute('position', new THREE.Float32BufferAttribute(segVerts, 3));
    this.segmentLines = new THREE.LineSegments(segGeo, new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    }));
    this.wheelGroup.add(this.segmentLines);

    // Highlighted segment (a filled triangle/wedge for one segment)
    const highlightGeo = this.createWedgeGeometry(this.radius * 0.95, 0, this.segmentAngle);
    this.highlightMesh = new THREE.Mesh(highlightGeo, new THREE.MeshBasicMaterial({
      color: this.palette.secondary,
      transparent: true,
      opacity: 0,
    }));
    this.highlightMesh.position.z = -0.1;
    this.wheelGroup.add(this.highlightMesh);

    // Center dot
    const dotR = this.radius * 0.06;
    const dotGeo = new THREE.CircleGeometry(dotR, 16);
    this.centerDot = new THREE.Mesh(dotGeo, new THREE.MeshBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
    }));
    this.centerDot.position.z = 1;
    this.wheelGroup.add(this.centerDot);

    // Fixed pointer triangle at top (not part of wheel group — stationary)
    const pointerSize = this.radius * 0.12;
    const pointerGeo = new THREE.BufferGeometry();
    const pointerVerts = new Float32Array([
      this.cx, this.cy + this.radius + pointerSize * 0.5, 2,
      this.cx - pointerSize * 0.5, this.cy + this.radius + pointerSize * 1.3, 2,
      this.cx + pointerSize * 0.5, this.cy + this.radius + pointerSize * 1.3, 2,
    ]);
    pointerGeo.setAttribute('position', new THREE.BufferAttribute(pointerVerts, 3));
    pointerGeo.setIndex([0, 1, 2]);
    this.pointer = new THREE.Mesh(pointerGeo, new THREE.MeshBasicMaterial({
      color: this.palette.alert,
      transparent: true,
      opacity: 0,
    }));
    this.group.add(this.pointer);
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);

    // Acceleration / deceleration cycle
    this.cycleTimer += dt;
    if (this.cycleTimer >= this.cycleDuration) {
      this.cycleTimer = 0;
      this.accelerating = !this.accelerating;
      this.cycleDuration = this.rng.float(3.0, 6.0);
    }

    // Smoothly adjust speed
    const targetSpeed = this.accelerating ? this.maxSpeed : this.minSpeed;
    const lerpRate = 1 - Math.exp(-1.5 * dt);
    this.wheelSpeed += (targetSpeed - this.wheelSpeed) * lerpRate;

    // Rotate wheel
    this.wheelAngle += this.wheelSpeed * dt;
    this.wheelGroup.rotation.z = this.wheelAngle;

    // Update opacities
    (this.outerRing.material as THREE.LineBasicMaterial).opacity = opacity * 0.6;
    (this.segmentLines.material as THREE.LineBasicMaterial).opacity = opacity * 0.35;
    (this.highlightMesh.material as THREE.MeshBasicMaterial).opacity = opacity * 0.2;
    (this.centerDot.material as THREE.MeshBasicMaterial).opacity = opacity * 0.8;
    (this.pointer.material as THREE.MeshBasicMaterial).opacity = opacity * 0.9;
  }

  private createWedgeGeometry(radius: number, startAngle: number, spanAngle: number): THREE.BufferGeometry {
    const segments = 12;
    const vertices: number[] = [];
    const indices: number[] = [];

    // Center vertex
    vertices.push(0, 0, 0);

    // Arc vertices
    for (let i = 0; i <= segments; i++) {
      const a = startAngle + (i / segments) * spanAngle;
      vertices.push(Math.cos(a) * radius, Math.sin(a) * radius, 0);
    }

    // Triangle fan
    for (let i = 1; i <= segments; i++) {
      indices.push(0, i, i + 1);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geo.setIndex(indices);
    return geo;
  }
}
