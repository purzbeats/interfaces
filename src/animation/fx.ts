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

// --- Power-on / power-off animation curves ---

/**
 * CRT-style power-on opacity: fast initial snap, brightness overshoot, settle.
 * Progress 0→1 maps to a curve that overshoots ~1.15 around 70% then settles.
 */
export function powerOnOpacity(progress: number): number {
  if (progress < 0.05) return 0;                         // brief dead zone (warming up)
  const p = (progress - 0.05) / 0.95;                    // remap to 0–1
  // Quick snap to ~0.8 then overshoot and settle
  const snap = Math.min(p * 3, 1);                       // fast rise
  const overshoot = 1 + 0.15 * Math.sin(p * Math.PI);    // gentle hump
  return Math.min(snap * overshoot, 1.15);
}

/**
 * CRT-style power-off opacity: brief brightness flash then quick collapse.
 * Progress 0→1 (where 0 = just started deactivating, 1 = fully off).
 */
export function powerOffOpacity(progress: number): number {
  if (progress < 0.08) {
    // Brief brightness flash at start of shutdown
    return 1 + 0.2 * Math.sin(progress / 0.08 * Math.PI);
  }
  // Rapid exponential decay
  const p = (progress - 0.08) / 0.92;
  return Math.max((1 - p) * (1 - p), 0);
}

/**
 * Stutter/step effect for power-on: quantizes smooth progress into discrete steps.
 * Simulates a CRT warming up in jumps.
 */
export function bootStutter(progress: number, steps: number = 5): number {
  return Math.floor(progress * steps) / steps;
}

/**
 * Deterministic flicker during boot: produces random-looking on/off flashes.
 * Returns an opacity multiplier (0 or 1 mostly, with some partial values).
 */
export function bootFlicker(progress: number): number {
  if (progress < 0.1 || progress > 0.7) return 1;
  // Hash-based flicker in the 10-70% range
  const t = Math.floor(progress * 60);
  const hash = Math.sin(t * 91.7) * 43758.5453;
  const frac = hash - Math.floor(hash);
  return frac > 0.3 ? 1 : 0.05;
}

/**
 * Vertical scale multiplier for power-off: CRT vertical collapse effect.
 * Goes from 1 → 0 with a characteristic pinch.
 */
export function powerOffScaleY(progress: number): number {
  if (progress < 0.15) return 1;
  const p = (progress - 0.15) / 0.85;
  // Fast squeeze with slight bounce
  return Math.max(1 - p * p * p, 0.01);
}

/**
 * Brightness multiplier for power-on: initial brightness surge then settle.
 * Returns values > 1 during the surge phase.
 */
export function powerOnBrightness(progress: number): number {
  if (progress < 0.3) return 1;
  if (progress < 0.6) {
    // Brightness surge
    const p = (progress - 0.3) / 0.3;
    return 1 + 0.3 * Math.sin(p * Math.PI);
  }
  return 1;
}
