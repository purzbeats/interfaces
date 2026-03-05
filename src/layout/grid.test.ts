import { describe, it, expect } from 'vitest';
import { subdivide } from './grid';
import { createRegion } from './region';
import { SeededRandom } from '../random';

describe('BSP subdivide', () => {
  it('returns the input region when maxDepth is 0', () => {
    const rng = new SeededRandom(42);
    const root = createRegion('root', 0, 0, 1, 1);
    const result = subdivide(root, rng, { maxDepth: 0 });
    expect(result).toEqual([root]);
  });

  it('produces multiple regions for a large enough input', () => {
    const rng = new SeededRandom(42);
    const root = createRegion('root', 0, 0, 1, 1);
    const result = subdivide(root, rng, { maxDepth: 3 });
    expect(result.length).toBeGreaterThan(1);
  });

  it('all regions are within the original bounds', () => {
    const rng = new SeededRandom(42);
    const root = createRegion('root', 0, 0, 1, 1);
    const result = subdivide(root, rng, { maxDepth: 4 });

    for (const r of result) {
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.x + r.width).toBeLessThanOrEqual(1 + 1e-10);
      expect(r.y + r.height).toBeLessThanOrEqual(1 + 1e-10);
    }
  });

  it('regions do not overlap', () => {
    const rng = new SeededRandom(42);
    const root = createRegion('root', 0, 0, 1, 1);
    const regions = subdivide(root, rng, { maxDepth: 4 });

    for (let i = 0; i < regions.length; i++) {
      for (let j = i + 1; j < regions.length; j++) {
        const a = regions[i];
        const b = regions[j];
        const overlapX = a.x < b.x + b.width && b.x < a.x + a.width;
        const overlapY = a.y < b.y + b.height && b.y < a.y + a.height;
        if (overlapX && overlapY) {
          // Overlapping area should be negligible (floating point tolerance)
          const ox = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
          const oy = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
          expect(ox * oy).toBeLessThan(1e-10);
        }
      }
    }
  });

  it('total area equals input area', () => {
    const rng = new SeededRandom(42);
    const root = createRegion('root', 0, 0, 1, 1);
    const regions = subdivide(root, rng, { maxDepth: 4 });
    const totalArea = regions.reduce((sum, r) => sum + r.width * r.height, 0);
    expect(totalArea).toBeCloseTo(1.0, 10);
  });

  it('respects minWidth and minHeight', () => {
    const rng = new SeededRandom(42);
    const root = createRegion('root', 0, 0, 1, 1);
    const minW = 0.15;
    const minH = 0.15;
    const regions = subdivide(root, rng, { minWidth: minW, minHeight: minH, maxDepth: 10 });

    for (const r of regions) {
      expect(r.width).toBeGreaterThanOrEqual(minW - 1e-10);
      expect(r.height).toBeGreaterThanOrEqual(minH - 1e-10);
    }
  });

  it('is deterministic with the same seed', () => {
    const a = subdivide(createRegion('r', 0, 0, 1, 1), new SeededRandom(99), { maxDepth: 4 });
    const b = subdivide(createRegion('r', 0, 0, 1, 1), new SeededRandom(99), { maxDepth: 4 });

    expect(a.length).toBe(b.length);
    for (let i = 0; i < a.length; i++) {
      expect(a[i].x).toBeCloseTo(b[i].x, 10);
      expect(a[i].y).toBeCloseTo(b[i].y, 10);
      expect(a[i].width).toBeCloseTo(b[i].width, 10);
      expect(a[i].height).toBeCloseTo(b[i].height, 10);
    }
  });

  it('produces different layouts with different seeds', () => {
    const a = subdivide(createRegion('r', 0, 0, 1, 1), new SeededRandom(1), { maxDepth: 3 });
    const b = subdivide(createRegion('r', 0, 0, 1, 1), new SeededRandom(2), { maxDepth: 3 });

    // At least some regions should differ
    const aCoords = a.map(r => `${r.x.toFixed(4)},${r.y.toFixed(4)}`).join('|');
    const bCoords = b.map(r => `${r.x.toFixed(4)},${r.y.toFixed(4)}`).join('|');
    expect(aCoords).not.toBe(bCoords);
  });

  it('does not split regions that are already at minimum size', () => {
    const rng = new SeededRandom(42);
    const small = createRegion('s', 0, 0, 0.1, 0.1);
    const result = subdivide(small, rng, { minWidth: 0.12, minHeight: 0.12, maxDepth: 4 });
    expect(result).toEqual([small]);
  });

  it('generates unique IDs for all regions', () => {
    const rng = new SeededRandom(42);
    const root = createRegion('root', 0, 0, 1, 1);
    const regions = subdivide(root, rng, { maxDepth: 4 });
    const ids = regions.map(r => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
