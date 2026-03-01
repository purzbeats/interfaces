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
