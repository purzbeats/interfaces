/**
 * Shared visual effect utilities for consistent animation language across elements.
 */

/** Unified pulse opacity multiplier. Feed it a countdown timer. */
export function pulse(timer: number, freq: number = 14, min: number = 0.45): number {
  return min + Math.abs(Math.sin(timer * freq)) * (1 - min);
}

/** Glitch horizontal offset (pixel jitter). Feed it a countdown timer. */
export function glitchOffset(timer: number, maxPx: number = 6): number {
  // Stepped random-looking jitter using deterministic hash
  const t = Math.floor(timer * 30);
  const hash = Math.sin(t * 127.1) * 43758.5453;
  return (hash - Math.floor(hash) - 0.5) * 2 * maxPx * Math.min(timer * 4, 1);
}


/** Compute element opacity from state machine state + progress */
export function stateOpacity(state: string, progress: number): number {
  if (state === 'activating') return progress;
  if (state === 'deactivating') return 1 - progress;
  if (state === 'idle') return 0;
  return 1;
}
