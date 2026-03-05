import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Typewriter carriage that steps left-to-right along a guide rail.
 * Dots appear below the rail where the head has visited, then fade.
 * At the right edge the carriage snaps back (carriage return).
 */
export class TypewriterHeadElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'typewriter-head',
    meta: { shape: 'linear', roles: ['data-display', 'text'], moods: ['diagnostic'], sizes: ['works-small', 'needs-medium'] },
  };

  private railLine!: THREE.Line;
  private railMat!: THREE.LineBasicMaterial;
  private headMesh!: THREE.Mesh;
  private headMat!: THREE.MeshBasicMaterial;

  /** Dot pool */
  private dotMeshes: THREE.Mesh[] = [];
  private dotMats: THREE.MeshBasicMaterial[] = [];
  private dotAges: Float32Array = new Float32Array(0);
  private dotActive: Uint8Array = new Uint8Array(0);
  private dotIndex: number = 0;
  private maxDots: number = 0;

  private stepSize: number = 0;
  private headX: number = 0;
  private stepTimer: number = 0;
  private stepInterval: number = 0;
  private dotLifetime: number = 0;

  private railY: number = 0;
  private dotY: number = 0;
  private leftEdge: number = 0;
  private rightEdge: number = 0;

  build(): void {
    const { x, y, w, h } = this.px;

    this.railY = y + h * 0.25;
    this.dotY = y + h * 0.55;
    this.leftEdge = x + 2;
    this.rightEdge = x + w - 2;
    this.stepSize = this.rng.float(4, 8);
    this.stepInterval = this.rng.float(0.06, 0.15);
    this.dotLifetime = this.rng.float(3.0, 6.0);
    this.headX = this.leftEdge;
    this.stepTimer = 0;

    // Guide rail line
    const railGeo = new THREE.BufferGeometry();
    railGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
      x, this.railY, 0,
      x + w, this.railY, 0,
    ]), 3));
    this.railMat = new THREE.LineBasicMaterial({
      color: this.palette.dim,
      transparent: true,
      opacity: 0,
    });
    this.railLine = new THREE.Line(railGeo, this.railMat);
    this.group.add(this.railLine);

    // Carriage head
    const headW = this.stepSize * 1.2;
    const headH = h * 0.15;
    const headGeo = new THREE.PlaneGeometry(headW, headH);
    this.headMat = new THREE.MeshBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0,
    });
    this.headMesh = new THREE.Mesh(headGeo, this.headMat);
    this.headMesh.position.set(this.headX, this.railY - headH * 0.7, 1);
    this.group.add(this.headMesh);

    // Dot pool
    this.maxDots = Math.max(20, Math.ceil(w / this.stepSize) * 3);
    this.dotAges = new Float32Array(this.maxDots);
    this.dotActive = new Uint8Array(this.maxDots);
    this.dotIndex = 0;

    const dotSize = Math.max(2, this.stepSize * 0.5);
    const dotGeo = new THREE.PlaneGeometry(dotSize, dotSize);

    for (let i = 0; i < this.maxDots; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: this.palette.primary,
        transparent: true,
        opacity: 0,
      });
      const mesh = new THREE.Mesh(dotGeo, mat);
      mesh.visible = false;
      mesh.position.set(0, this.dotY, 0);
      this.group.add(mesh);
      this.dotMeshes.push(mesh);
      this.dotMats.push(mat);
    }
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);

    this.railMat.opacity = opacity * 0.3;
    this.headMat.opacity = opacity;

    // Step the carriage head
    this.stepTimer += dt;
    if (this.stepTimer >= this.stepInterval) {
      this.stepTimer -= this.stepInterval;

      // Spawn a dot at current head position (randomly skip some for variety)
      if (this.rng.next() < 0.75) {
        this.spawnDot(this.headX);
      }

      // Move head one step to the right
      this.headX += this.stepSize;

      // Carriage return
      if (this.headX > this.rightEdge) {
        this.headX = this.leftEdge;
        // Bump dot Y down a line for multi-line feel, wrap back
        const { y, h } = this.px;
        this.dotY += this.stepSize * 1.4;
        if (this.dotY > y + h - 4) {
          this.dotY = y + h * 0.55;
        }
      }

      this.headMesh.position.x = this.headX;
    }

    // Age and fade dots
    for (let i = 0; i < this.maxDots; i++) {
      if (this.dotActive[i] === 0) continue;
      this.dotAges[i] += dt;
      if (this.dotAges[i] >= this.dotLifetime) {
        this.dotActive[i] = 0;
        this.dotMeshes[i].visible = false;
        continue;
      }
      const life = 1 - this.dotAges[i] / this.dotLifetime;
      this.dotMats[i].opacity = opacity * life * 0.7;
    }
  }

  private spawnDot(posX: number): void {
    const i = this.dotIndex;
    this.dotIndex = (this.dotIndex + 1) % this.maxDots;
    this.dotActive[i] = 1;
    this.dotAges[i] = 0;
    this.dotMeshes[i].position.x = posX;
    this.dotMeshes[i].position.y = this.dotY;
    this.dotMeshes[i].visible = true;
    this.dotMats[i].opacity = 0;
  }
}
