import { describe, it, expect } from 'vitest';
import { SeededRandom } from './random';

describe('SeededRandom', () => {
  it('produces deterministic sequences from the same seed', () => {
    const a = new SeededRandom(42);
    const b = new SeededRandom(42);
    for (let i = 0; i < 100; i++) {
      expect(a.next()).toBe(b.next());
    }
  });

  it('produces different sequences from different seeds', () => {
    const a = new SeededRandom(1);
    const b = new SeededRandom(2);
    const aValues = Array.from({ length: 10 }, () => a.next());
    const bValues = Array.from({ length: 10 }, () => b.next());
    expect(aValues).not.toEqual(bValues);
  });

  it('next() returns values in [0, 1)', () => {
    const rng = new SeededRandom(123);
    for (let i = 0; i < 1000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('int() returns integers in [min, max)', () => {
    const rng = new SeededRandom(99);
    for (let i = 0; i < 200; i++) {
      const v = rng.int(3, 7);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThan(7);
      expect(Number.isInteger(v)).toBe(true);
    }
  });

  it('float() returns values in [min, max)', () => {
    const rng = new SeededRandom(55);
    for (let i = 0; i < 200; i++) {
      const v = rng.float(-1, 1);
      expect(v).toBeGreaterThanOrEqual(-1);
      expect(v).toBeLessThan(1);
    }
  });

  it('chance() returns booleans with approximate probability', () => {
    const rng = new SeededRandom(77);
    let trueCount = 0;
    const n = 10000;
    for (let i = 0; i < n; i++) {
      if (rng.chance(0.3)) trueCount++;
    }
    // Should be roughly 30% — allow wide tolerance
    expect(trueCount / n).toBeGreaterThan(0.25);
    expect(trueCount / n).toBeLessThan(0.35);
  });

  it('pick() returns elements from the array', () => {
    const rng = new SeededRandom(11);
    const arr = ['a', 'b', 'c'] as const;
    for (let i = 0; i < 50; i++) {
      expect(arr).toContain(rng.pick(arr));
    }
  });

  it('shuffle() is deterministic and produces permutations', () => {
    const a = new SeededRandom(42);
    const b = new SeededRandom(42);
    const arr1 = [1, 2, 3, 4, 5];
    const arr2 = [1, 2, 3, 4, 5];
    a.shuffle(arr1);
    b.shuffle(arr2);
    expect(arr1).toEqual(arr2);
    // Should contain same elements
    expect(arr1.sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it('weighted() respects weights', () => {
    const rng = new SeededRandom(33);
    const counts = [0, 0, 0];
    const n = 10000;
    // Weight heavily toward index 2
    for (let i = 0; i < n; i++) {
      counts[rng.weighted([1, 1, 8])]++;
    }
    // Index 2 should get ~80%
    expect(counts[2] / n).toBeGreaterThan(0.7);
    expect(counts[0] / n).toBeLessThan(0.2);
  });

  it('fork() creates independent child RNG', () => {
    const parent = new SeededRandom(42);
    const child = parent.fork();
    // Child should produce values but not affect parent's sequence
    const parentNext = new SeededRandom(42);
    parentNext.next(); // consume the same value used for fork seed
    child.next();
    // Parent should still be in sync with a fresh copy that consumed one value
    expect(parent.next()).toBe(parentNext.next());
  });
});
