import { describe, it, expect } from 'vitest';
import { easing } from './easing';

describe('easing functions', () => {
  const fns = Object.entries(easing);

  for (const [name, fn] of fns) {
    describe(name, () => {
      it('returns 0 at t=0', () => {
        expect(fn(0)).toBeCloseTo(0, 5);
      });

      it('returns 1 at t=1', () => {
        expect(fn(1)).toBeCloseTo(1, 5);
      });

      it('returns values in [0, 1] for inputs in [0, 1]', () => {
        for (let t = 0; t <= 1; t += 0.05) {
          const v = fn(t);
          expect(v).toBeGreaterThanOrEqual(-0.01);
          expect(v).toBeLessThanOrEqual(1.01);
        }
      });
    });
  }
});
