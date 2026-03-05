import { describe, it, expect } from 'vitest';
import {
  pulse, glitchOffset, stateOpacity,
  powerOnOpacity, powerOffOpacity, bootStutter, bootFlicker,
  powerOffScaleY, powerOnBrightness,
} from './fx';

describe('pulse', () => {
  it('returns values between min and 1', () => {
    for (let t = 0; t <= 2; t += 0.01) {
      const v = pulse(t);
      expect(v).toBeGreaterThanOrEqual(0.45 - 0.01);
      expect(v).toBeLessThanOrEqual(1.01);
    }
  });

  it('respects custom min parameter', () => {
    const v = pulse(0, 14, 0.8);
    expect(v).toBeGreaterThanOrEqual(0.8);
  });
});

describe('glitchOffset', () => {
  it('returns ~0 when timer is 0', () => {
    expect(glitchOffset(0)).toBeCloseTo(0);
  });

  it('stays within maxPx bounds', () => {
    for (let t = 0; t <= 2; t += 0.05) {
      const v = glitchOffset(t, 10);
      expect(Math.abs(v)).toBeLessThanOrEqual(10 + 0.01);
    }
  });

  it('is deterministic for the same timer value', () => {
    expect(glitchOffset(0.5, 6)).toBe(glitchOffset(0.5, 6));
  });
});

describe('stateOpacity', () => {
  it('returns 0 for idle', () => {
    expect(stateOpacity('idle', 0)).toBe(0);
  });

  it('returns 1 for active', () => {
    expect(stateOpacity('active', 0.5)).toBe(1);
  });

  it('returns progress for activating', () => {
    expect(stateOpacity('activating', 0.7)).toBe(0.7);
  });

  it('returns 1-progress for deactivating', () => {
    expect(stateOpacity('deactivating', 0.3)).toBeCloseTo(0.7);
  });
});

describe('powerOnOpacity', () => {
  it('starts at 0 during dead zone', () => {
    expect(powerOnOpacity(0)).toBe(0);
    expect(powerOnOpacity(0.03)).toBe(0);
  });

  it('reaches near 1 at full progress', () => {
    const v = powerOnOpacity(1.0);
    expect(v).toBeGreaterThan(0.9);
    expect(v).toBeLessThanOrEqual(1.15);
  });

  it('is monotonically increasing after dead zone (roughly)', () => {
    let prev = 0;
    for (let p = 0.1; p <= 1.0; p += 0.1) {
      const v = powerOnOpacity(p);
      expect(v).toBeGreaterThanOrEqual(prev - 0.1); // allow small dips from overshoot
      prev = v;
    }
  });
});

describe('powerOffOpacity', () => {
  it('starts above 1 (brightness flash)', () => {
    expect(powerOffOpacity(0.04)).toBeGreaterThan(1.0);
  });

  it('reaches near 0 at full progress', () => {
    expect(powerOffOpacity(1.0)).toBeCloseTo(0, 1);
  });
});

describe('bootStutter', () => {
  it('quantizes progress into steps', () => {
    expect(bootStutter(0.0, 4)).toBe(0);
    expect(bootStutter(0.3, 4)).toBe(0.25);
    expect(bootStutter(0.5, 4)).toBe(0.5);
    expect(bootStutter(0.9, 4)).toBe(0.75);
  });
});

describe('bootFlicker', () => {
  it('returns 1 outside active range', () => {
    expect(bootFlicker(0.05)).toBe(1);
    expect(bootFlicker(0.75)).toBe(1);
  });

  it('returns deterministic values in active range', () => {
    const a = bootFlicker(0.4);
    const b = bootFlicker(0.4);
    expect(a).toBe(b);
  });

  it('returns either ~1 or ~0.05 in active range', () => {
    for (let p = 0.1; p <= 0.7; p += 0.01) {
      const v = bootFlicker(p);
      expect(v === 1 || v === 0.05).toBe(true);
    }
  });
});

describe('powerOffScaleY', () => {
  it('starts at 1', () => {
    expect(powerOffScaleY(0)).toBe(1);
    expect(powerOffScaleY(0.1)).toBe(1);
  });

  it('collapses toward 0', () => {
    expect(powerOffScaleY(1.0)).toBeCloseTo(0.01, 1);
  });
});

describe('powerOnBrightness', () => {
  it('is 1 before surge phase', () => {
    expect(powerOnBrightness(0.1)).toBe(1);
  });

  it('exceeds 1 during surge', () => {
    expect(powerOnBrightness(0.45)).toBeGreaterThan(1);
  });

  it('returns to 1 after surge', () => {
    expect(powerOnBrightness(0.8)).toBe(1);
  });
});
