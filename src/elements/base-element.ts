import * as THREE from 'three';
import type { Region } from '../layout/region';
import { regionToPixels } from '../layout/region';
import type { Palette } from '../color/palettes';
import type { SeededRandom } from '../random';
import { StateMachine } from '../animation/state-machine';
import { randomEasing } from '../animation/easing';

/** Callback for elements to emit audio events */
export type AudioEmitter = (event: string, param?: number) => void;

export abstract class BaseElement {
  readonly id: string;
  readonly region: Region;
  readonly palette: Palette;
  readonly rng: SeededRandom;
  readonly stateMachine: StateMachine;
  readonly group: THREE.Group;
  protected emitAudio: AudioEmitter;

  protected px: { x: number; y: number; w: number; h: number };
  protected screenWidth: number;
  protected screenHeight: number;

  constructor(
    region: Region,
    palette: Palette,
    rng: SeededRandom,
    screenWidth: number,
    screenHeight: number,
    emitAudio?: AudioEmitter
  ) {
    this.id = region.id;
    this.region = region;
    this.palette = palette;
    this.rng = rng;
    this.screenWidth = screenWidth;
    this.screenHeight = screenHeight;
    this.px = regionToPixels(region, screenWidth, screenHeight);
    this.group = new THREE.Group();
    this.group.visible = false;
    this.emitAudio = emitAudio ?? (() => {});

    this.stateMachine = new StateMachine();
    this.stateMachine.config.activating.easing = randomEasing(rng);
    this.stateMachine.config.activating.duration = rng.float(0.3, 0.8);
    this.stateMachine.config.deactivating.duration = rng.float(0.2, 0.5);
  }

  abstract build(): void;
  abstract update(dt: number, time: number): void;

  onAction(action: string): void {
    switch (action) {
      case 'activate':
        this.group.visible = true;
        this.stateMachine.transition('activating');
        break;
      case 'deactivate':
        this.stateMachine.transition('deactivating');
        break;
    }
  }

  tick(dt: number, time: number): void {
    this.stateMachine.update(dt);
    if (this.stateMachine.state === 'idle' && this.group.visible) {
      this.group.visible = false;
    }
    if (this.group.visible) {
      this.update(dt, time);
    }
  }

  dispose(): void {
    this.group.traverse((obj) => {
      if (obj instanceof THREE.Mesh || obj instanceof THREE.Line || obj instanceof THREE.LineSegments) {
        obj.geometry.dispose();
        if (Array.isArray(obj.material)) {
          obj.material.forEach((m) => m.dispose());
        } else {
          obj.material.dispose();
        }
      }
    });
    this.group.clear();
  }
}
