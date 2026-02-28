import type { SeededRandom } from '../random';

export type EasingFn = (t: number) => number;

export const easing = {
  linear: (t: number) => t,

  easeInQuad: (t: number) => t * t,
  easeOutQuad: (t: number) => t * (2 - t),
  easeInOutQuad: (t: number) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),

  easeInCubic: (t: number) => t * t * t,
  easeOutCubic: (t: number) => (--t) * t * t + 1,
  easeInOutCubic: (t: number) =>
    t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1,

  easeInExpo: (t: number) => (t === 0 ? 0 : Math.pow(2, 10 * (t - 1))),
  easeOutExpo: (t: number) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t)),

  elastic: (t: number) => {
    if (t === 0 || t === 1) return t;
    return -Math.pow(2, 10 * (t - 1)) * Math.sin((t - 1.1) * 5 * Math.PI);
  },

  bounce: (t: number) => {
    if (t < 1 / 2.75) return 7.5625 * t * t;
    if (t < 2 / 2.75) return 7.5625 * (t -= 1.5 / 2.75) * t + 0.75;
    if (t < 2.5 / 2.75) return 7.5625 * (t -= 2.25 / 2.75) * t + 0.9375;
    return 7.5625 * (t -= 2.625 / 2.75) * t + 0.984375;
  },

  /** Quantize to n discrete steps */
  stepped: (n: number): EasingFn => (t: number) => Math.floor(t * n) / n,

  /** Glitchy easing with random jumps */
  glitch: (rng: SeededRandom, intensity: number = 0.3): EasingFn => {
    // Pre-generate glitch points for determinism
    const glitchPoints: Array<{ pos: number; offset: number }> = [];
    const count = rng.int(3, 8);
    for (let i = 0; i < count; i++) {
      glitchPoints.push({ pos: rng.next(), offset: rng.float(-intensity, intensity) });
    }
    return (t: number) => {
      let v = t;
      for (const g of glitchPoints) {
        if (Math.abs(t - g.pos) < 0.05) {
          v = Math.max(0, Math.min(1, t + g.offset));
        }
      }
      return v;
    };
  },

  /** Snap to a point then ease out */
  snap: (point: number = 0.5): EasingFn => (t: number) => {
    if (t < point) return (t / point) * 0.95;
    return 0.95 + ((t - point) / (1 - point)) * 0.05;
  },

  /** Overshoot and settle */
  overshoot: (amount: number = 1.5): EasingFn => (t: number) => {
    const s = amount;
    return (t -= 1) * t * ((s + 1) * t + s) + 1;
  },
};

const STANDARD_EASINGS: EasingFn[] = [
  easing.linear,
  easing.easeOutQuad,
  easing.easeInOutCubic,
  easing.easeOutExpo,
  easing.easeOutCubic,
];

export function randomEasing(rng: SeededRandom): EasingFn {
  return rng.pick(STANDARD_EASINGS);
}
