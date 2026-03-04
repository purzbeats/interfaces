import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * Row of narrow rectangles that topple one by one in sequence.
 * After all have fallen they reset and fall again, creating
 * a cascading domino chain reaction.
 */
export class DominoFallElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'domino-fall',
    meta: { shape: 'linear', roles: ['decorative'], moods: ['ambient'], sizes: ['needs-medium'] },
  };

  private dominoCount: number = 0;
  private dominoes: THREE.Mesh[] = [];
  private materials: THREE.MeshBasicMaterial[] = [];
  /** Pivot groups that rotate to simulate falling */
  private pivots: THREE.Group[] = [];

  /** Per-domino fall progress 0..1 (0 = upright, 1 = fallen) */
  private fallProgress: Float32Array = new Float32Array(0);
  /** Global timer driving the cascade */
  private cascadeTime: number = 0;
  /** Stagger delay between each domino starting to fall */
  private stagger: number = 0;
  /** Duration of one domino's fall */
  private fallDuration: number = 0;
  /** Total cycle time before reset */
  private cycleTime: number = 0;
  /** Pause at end before reset */
  private pauseTime: number = 0;

  build(): void {
    const { x, y, w, h } = this.px;

    const dominoW = this.rng.float(3, 6);
    const dominoH = h * this.rng.float(0.6, 0.85);
    const spacing = dominoW * this.rng.float(2.5, 4.0);
    this.dominoCount = Math.max(3, Math.floor(w / spacing));
    this.stagger = this.rng.float(0.06, 0.15);
    this.fallDuration = this.rng.float(0.25, 0.5);
    this.pauseTime = this.rng.float(0.8, 1.5);
    this.cycleTime = this.dominoCount * this.stagger + this.fallDuration + this.pauseTime;

    this.fallProgress = new Float32Array(this.dominoCount);
    this.dominoes = [];
    this.materials = [];
    this.pivots = [];

    const geo = new THREE.PlaneGeometry(dominoW, dominoH);
    // Shift geometry so the bottom edge is at local y=0 (pivot point)
    geo.translate(0, dominoH / 2, 0);

    const baseY = y + (h - dominoH) / 2;

    for (let i = 0; i < this.dominoCount; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: i % 2 === 0 ? this.palette.primary : this.palette.secondary,
        transparent: true,
        opacity: 0,
      });
      const mesh = new THREE.Mesh(geo, mat);

      // Pivot group positioned at the base of each domino
      const pivot = new THREE.Group();
      pivot.position.set(
        x + spacing * 0.5 + i * spacing,
        baseY,
        0,
      );
      pivot.add(mesh);
      this.group.add(pivot);

      this.dominoes.push(mesh);
      this.materials.push(mat);
      this.pivots.push(pivot);
    }

    this.cascadeTime = 0;
  }

  update(dt: number, _time: number): void {
    const opacity = this.applyEffects(dt);

    this.cascadeTime += dt;
    if (this.cascadeTime > this.cycleTime) {
      this.cascadeTime -= this.cycleTime;
    }

    for (let i = 0; i < this.dominoCount; i++) {
      const triggerTime = i * this.stagger;
      const elapsed = this.cascadeTime - triggerTime;

      let progress: number;
      if (elapsed < 0) {
        progress = 0;
      } else if (elapsed < this.fallDuration) {
        // Ease-in (accelerate like gravity)
        const t = elapsed / this.fallDuration;
        progress = t * t;
      } else {
        progress = 1;
      }

      this.fallProgress[i] = progress;

      // Rotate from 0 (upright) to -PI/2 (fallen to the right)
      this.pivots[i].rotation.z = -progress * Math.PI / 2;

      // Fade slightly when fully fallen
      const cellOpacity = progress < 1 ? 1.0 : 0.4;
      this.materials[i].opacity = opacity * cellOpacity;
    }
  }
}
