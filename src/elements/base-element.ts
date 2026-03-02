import * as THREE from 'three';
import type { Region } from '../layout/region';
import { regionToPixels } from '../layout/region';
import type { Palette } from '../color/palettes';
import type { SeededRandom } from '../random';
import { StateMachine } from '../animation/state-machine';
import { randomEasing } from '../animation/easing';
import { stateOpacity, pulse, glitchOffset } from '../animation/fx';
import type { ElementMeta } from './tags';
import type { AudioFrame } from '../audio/audio-reactive';

/** Callback for elements to emit audio events */
export type AudioEmitter = (event: string, param?: number) => void;

/** Static registration data declared on each element subclass. */
export interface ElementRegistration {
  name: string;
  meta: ElementMeta;
}

export abstract class BaseElement {
  /** When false, audio-reactive intensity won't trigger pulse (flicker). */
  static audioFlickerEnabled: boolean = true;
  /** When false, audio-reactive intensity won't trigger glitch (jiggle). */
  static audioJiggleEnabled: boolean = true;
  /** Set by engine before audio-reactive intensity broadcasts. */
  static intensityFromAudio: boolean = false;

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

  protected pulseTimer: number = 0;
  protected glitchTimer: number = 0;
  protected glitchAmount: number = 4;

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

  /** Compute opacity with pulse, apply glitch offset. Call at top of update(). */
  protected applyEffects(dt: number): number {
    let opacity = stateOpacity(this.stateMachine.state, this.stateMachine.progress);
    if (this.pulseTimer > 0) {
      this.pulseTimer -= dt;
      opacity *= pulse(this.pulseTimer);
    }
    if (this.glitchTimer > 0) {
      this.group.position.x = glitchOffset(this.glitchTimer, this.glitchAmount);
      this.glitchTimer -= dt;
    } else {
      this.group.position.x = 0;
    }
    return opacity;
  }

  onAction(action: string): void {
    switch (action) {
      case 'activate':
        this.group.visible = true;
        this.stateMachine.transition('activating');
        break;
      case 'deactivate':
        this.stateMachine.transition('deactivating');
        break;
      case 'pulse':
        this.pulseTimer = 0.5;
        break;
      case 'glitch':
        this.glitchTimer = 0.5;
        break;
    }
  }

  /**
   * Called every frame with real audio analysis data when audio-reactive is active.
   * Override in audio-visualization elements to render real frequency/waveform data.
   * Default implementation is a no-op.
   */
  tickAudio(_frame: AudioFrame): void {}

  /**
   * Intensity broadcast (1–5). Called on ALL active elements simultaneously.
   * Level 0 = return to baseline (clear timers). Override for custom behavior.
   */
  onIntensity(level: number): void {
    const fromAudio = BaseElement.intensityFromAudio;
    const canFlicker = !fromAudio || BaseElement.audioFlickerEnabled;
    const canJiggle = !fromAudio || BaseElement.audioJiggleEnabled;

    switch (level) {
      case 0:
        if (canFlicker) this.pulseTimer = 0;
        if (canJiggle) this.glitchTimer = 0;
        break;
      case 1:
        if (canFlicker) this.pulseTimer = 0.15;
        break;
      case 2:
        if (canFlicker) this.pulseTimer = 0.3;
        break;
      case 3:
        if (canFlicker) this.pulseTimer = 0.4;
        if (canJiggle) this.glitchTimer = 0.2;
        break;
      case 4:
        if (canFlicker) this.pulseTimer = 0.6;
        if (canJiggle) this.glitchTimer = 0.4;
        break;
      case 5:
        if (canFlicker) this.pulseTimer = 1.0;
        if (canJiggle) this.glitchTimer = 0.8;
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
