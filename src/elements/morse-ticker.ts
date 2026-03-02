import * as THREE from 'three';
import { BaseElement, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

/**
 * A strip that blinks dots and dashes like Morse code transmission.
 * Each square lights up or dims following a pseudo-morse pattern based on time.
 */
export class MorseTickerElement extends BaseElement {
  static readonly registration: ElementRegistration = {
    name: 'morse-ticker',
    meta: { shape: 'linear', roles: ['text', 'data-display'], moods: ['tactical', 'ambient'], sizes: ['works-small'] },
  };
  private squares: THREE.Mesh[] = [];
  private squareCount: number = 0;
  private scrollSpeed: number = 0;
  private morseSpeed: number = 0;

  build(): void {
    this.glitchAmount = 3;
    const { x, y, w, h } = this.px;
    this.squareCount = Math.max(10, Math.min(40, Math.floor(w / (h * 0.8))));
    this.scrollSpeed = this.rng.float(2, 6);
    this.morseSpeed = this.rng.float(4, 10);

    const squareSize = Math.min(h * 0.6, w / this.squareCount * 0.8);
    const spacing = w / this.squareCount;

    for (let i = 0; i < this.squareCount; i++) {
      const geo = new THREE.PlaneGeometry(squareSize, squareSize);
      const mat = new THREE.MeshBasicMaterial({
        color: i % 3 === 0 ? this.palette.secondary : this.palette.primary,
        transparent: true,
        opacity: 0,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x + spacing * (i + 0.5), y + h / 2, 1);
      this.squares.push(mesh);
      this.group.add(mesh);
    }
  }

  update(dt: number, time: number): void {
    const opacity = this.applyEffects(dt);
    const gx = this.group.position.x;
    const { x, y, w, h } = this.px;
    const spacing = w / this.squareCount;

    const scroll = time * this.scrollSpeed;

    for (let i = 0; i < this.squareCount; i++) {
      const mesh = this.squares[i];
      mesh.position.set(x + spacing * (i + 0.5) + gx, y + h / 2, 1);

      // Pseudo-morse pattern: hash index + scrolled time
      const idx = i + Math.floor(scroll);
      const hash = ((idx * 2654435761) >>> 0) & 0xFFFF;
      // Morse-like: dots are short on, dashes are long on, spaces are off
      const phase = (time * this.morseSpeed + i * 0.7) % 4;
      const isDash = (hash & 3) === 0;
      const isDot = (hash & 3) === 1;
      let bright = 0;

      if (isDash && phase < 2.0) {
        bright = 1;
      } else if (isDot && phase < 0.8) {
        bright = 1;
      } else if ((hash & 3) === 2 && phase > 2.5 && phase < 3.3) {
        bright = 0.5;
      }

      (mesh.material as THREE.MeshBasicMaterial).opacity = opacity * bright;
    }
  }

  onAction(action: string): void {
    super.onAction(action);
    if (action === 'glitch') {
      this.morseSpeed *= 3;
      setTimeout(() => { this.morseSpeed /= 3; }, 400);
    }
    if (action === 'alert') {
      this.pulseTimer = 1.5;
      // Flash all squares on
      this.morseSpeed *= 2;
      setTimeout(() => { this.morseSpeed /= 2; }, 1000);
    }
  }
}
