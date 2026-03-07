import type { BaseElement } from '../elements/base-element';
import type { MicrogameEffects } from './effects';

/** Result of a completed microgame round */
export type MicrogameResult = 'win' | 'lose' | 'pending';

/** Input state passed to microgames each frame */
export interface MicrogameInput {
  /** Keys currently held down */
  keysDown: Set<string>;
  /** Keys pressed this frame (just went down) */
  keysPressed: Set<string>;
  /** Mouse/touch position in normalized canvas coords (0-1), null if outside */
  pointer: { nx: number; ny: number } | null;
  /** Whether pointer is currently down */
  pointerDown: boolean;
  /** Whether pointer was just pressed this frame */
  pointerJustDown: boolean;
}

/** Per-round state for a microgame instance */
export interface MicrogameState {
  /** The visual element playing in the background */
  element: BaseElement;
  /** Time remaining in seconds */
  timeLeft: number;
  /** Total time for this round */
  totalTime: number;
  /** Current speed multiplier (increases with level) */
  speed: number;
  /** Arbitrary per-game state — games store their data here */
  data: Record<string, unknown>;
  /** Set by the game logic when the round is decided */
  result: MicrogameResult;
  /** Prompt text shown to the player */
  prompt: string;
}

/** Drawing context for microgame overlays */
export interface MicrogameDrawContext {
  /** 2D canvas context for drawing game objects */
  ctx: CanvasRenderingContext2D;
  /** Canvas width in pixels */
  w: number;
  /** Canvas height in pixels */
  h: number;
  /** Elapsed time in this round */
  time: number;
  /** Shared effects system — particles, shake, ripples, trails */
  fx: MicrogameEffects;
  /** Palette colors as CSS strings */
  colors: {
    primary: string;
    secondary: string;
    dim: string;
    bg: string;
    alert: string;
  };
}

/** Definition of a microgame type */
export interface MicrogameDefinition {
  /** Unique id */
  id: string;
  /** Which element type plays as background visual */
  elementType: string;
  /** The prompt shown to the player (e.g. "TAP THE TARGET!") */
  prompt: string;
  /** Base time in seconds for this game */
  baseTime: number;
  /** Called once when the round starts to set up game-specific state */
  setup: (state: MicrogameState) => void;
  /** Called each frame — drive game logic, check win/lose conditions */
  update: (state: MicrogameState, input: MicrogameInput, dt: number) => void;
  /** Called each frame AFTER update — draw game objects to the overlay canvas */
  draw: (state: MicrogameState, drawCtx: MicrogameDrawContext) => void;
}
