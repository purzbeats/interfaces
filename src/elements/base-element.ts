import * as THREE from 'three';
import type { Region } from '../layout/region';
import { regionToPixels } from '../layout/region';
import type { Palette } from '../color/palettes';
import type { SeededRandom } from '../random';
import { StateMachine } from '../animation/state-machine';
import { randomEasing } from '../animation/easing';
import {
  stateOpacity, pulse, glitchOffset,
  powerOnOpacity, powerOffOpacity, bootFlicker, bootStutter,
  powerOnBrightness,
} from '../animation/fx';
import type { ElementMeta } from './tags';
import type { AudioFrame } from '../audio/audio-reactive';

/** Callback for elements to emit audio events */
export type AudioEmitter = (event: string, param?: number) => void;

/** Static registration data declared on each element subclass. */
export interface ElementRegistration {
  name: string;
  meta: ElementMeta;
}

/**
 * Shared config object for audio-reactive intensity gating.
 * One instance per engine, passed by reference to all elements.
 */
export interface IntensityConfig {
  audioFlickerEnabled: boolean;
  audioJiggleEnabled: boolean;
  intensityFromAudio: boolean;
}

/** Default config used when no engine config is provided (e.g. standalone tests). */
export function createIntensityConfig(): IntensityConfig {
  return { audioFlickerEnabled: true, audioJiggleEnabled: true, intensityFromAudio: false };
}

/** Shared default for backward compat — used when elements are created without an explicit config. */
const DEFAULT_INTENSITY_CONFIG: IntensityConfig = createIntensityConfig();

export abstract class BaseElement {
  readonly id: string;
  readonly region: Region;
  readonly palette: Palette;
  readonly rng: SeededRandom;
  readonly stateMachine: StateMachine;
  readonly group: THREE.Group;
  protected emitAudio: AudioEmitter;
  protected intensityConfig: IntensityConfig;

  protected px: { x: number; y: number; w: number; h: number };
  protected screenWidth: number;
  protected screenHeight: number;

  protected pulseTimer: number = 0;
  protected glitchTimer: number = 0;
  protected glitchAmount: number = 4;

  /** Power-on/off animation style. Chosen randomly per element. */
  private bootStyle: 'clean' | 'glitchy' | 'stuttery' | 'flashy';
  /** Whether this element flickers on power-off. */
  private shutdownFlicker: boolean;

  constructor(
    region: Region,
    palette: Palette,
    rng: SeededRandom,
    screenWidth: number,
    screenHeight: number,
    emitAudio?: AudioEmitter,
    intensityConfig?: IntensityConfig,
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
    this.intensityConfig = intensityConfig ?? DEFAULT_INTENSITY_CONFIG;

    this.stateMachine = new StateMachine();
    this.stateMachine.config.activating.easing = randomEasing(rng);
    // Slow, dramatic activation/deactivation for power-on/off feel
    this.stateMachine.config.activating.duration = rng.float(1.5, 3.0);
    this.stateMachine.config.deactivating.duration = rng.float(1.0, 2.0);

    // Choose a random boot style — ~40% clean, ~25% glitchy, ~20% stuttery, ~15% flashy
    const roll = rng.float(0, 1);
    if (roll < 0.40) this.bootStyle = 'clean';
    else if (roll < 0.65) this.bootStyle = 'glitchy';
    else if (roll < 0.85) this.bootStyle = 'stuttery';
    else this.bootStyle = 'flashy';

    // ~40% chance of glitch/shake on shutdown
    this.shutdownFlicker = rng.float(0, 1) < 0.4;
  }

  abstract build(): void;
  abstract update(dt: number, time: number): void;

  /** Compute opacity with pulse, apply glitch offset. Call at top of update(). */
  protected applyEffects(dt: number): number {
    const state = this.stateMachine.state;
    const progress = this.stateMachine.progress;
    let opacity: number;

    if (state === 'activating') {
      // Power-on animation varies by boot style (flicker/strobe only, no shake)
      switch (this.bootStyle) {
        case 'glitchy':
          // Flicker during first 60% of boot
          opacity = powerOnOpacity(progress) * (progress < 0.6 ? bootFlicker(progress) : 1);
          break;
        case 'stuttery':
          // Step-quantized opacity — feels like a CRT warming up in jumps
          opacity = bootStutter(progress, 4 + Math.floor(progress * 3));
          break;
        case 'flashy':
          // Flicker on/off during mid-boot, with brightness surge
          opacity = powerOnOpacity(progress) * bootFlicker(progress) * powerOnBrightness(progress);
          break;
        default: // 'clean'
          opacity = powerOnOpacity(progress);
          break;
      }
    } else if (state === 'deactivating') {
      // Power-off: fade with optional flicker
      opacity = powerOffOpacity(progress);

      // Strobe flicker during shutdown
      if (this.shutdownFlicker && progress < 0.5) {
        opacity *= bootFlicker(progress * 2);
      }
    } else {
      opacity = stateOpacity(state, progress);
    }

    // Ongoing pulse effect (from intensity broadcasts)
    if (this.pulseTimer > 0) {
      this.pulseTimer -= dt;
      opacity *= pulse(this.pulseTimer);
    }

    // Ongoing glitch effect (not from boot — from intensity)
    if (state !== 'activating' && this.glitchTimer > 0) {
      this.group.position.x = glitchOffset(this.glitchTimer, this.glitchAmount);
      this.glitchTimer -= dt;
    } else if (state !== 'activating') {
      this.group.position.x = 0;
    }

    return Math.max(opacity, 0);
  }

  onAction(action: string): void {
    switch (action) {
      case 'activate':
        this.group.visible = true;
        this.group.position.x = 0;
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
    const fromAudio = this.intensityConfig.intensityFromAudio;
    const canFlicker = !fromAudio || this.intensityConfig.audioFlickerEnabled;
    const canJiggle = !fromAudio || this.intensityConfig.audioJiggleEnabled;

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
      this.group.position.x = 0;
      this.group.visible = false;
    }
    if (this.group.visible) {
      this.update(dt, time);
    }
  }

  /** Get a 2D rendering context, throwing a clear error instead of a null deref. */
  protected get2DContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error(`Failed to get 2D context for element ${this.id}`);
    return ctx;
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
