import { describe, it, expect } from 'vitest';
import { StateMachine } from './state-machine';

describe('StateMachine', () => {
  it('starts in idle state', () => {
    const sm = new StateMachine();
    expect(sm.state).toBe('idle');
    expect(sm.progress).toBe(0);
  });

  it('transitions to activating', () => {
    const sm = new StateMachine();
    sm.transition('activating');
    expect(sm.state).toBe('activating');
    expect(sm.progress).toBe(0);
  });

  it('does nothing on update while idle', () => {
    const sm = new StateMachine();
    sm.update(1.0);
    expect(sm.state).toBe('idle');
    expect(sm.progress).toBe(0);
  });

  it('progresses during activating', () => {
    const sm = new StateMachine();
    sm.config.activating.duration = 1.0;
    sm.config.activating.easing = (t: number) => t; // linear
    sm.transition('activating');

    sm.update(0.5);
    expect(sm.state).toBe('activating');
    expect(sm.progress).toBeCloseTo(0.5, 5);
  });

  it('transitions activating → active when complete', () => {
    const sm = new StateMachine();
    sm.config.activating.duration = 1.0;
    sm.config.activating.easing = (t: number) => t;
    sm.transition('activating');

    sm.update(1.1);
    expect(sm.state).toBe('active');
  });

  it('stays in active state indefinitely', () => {
    const sm = new StateMachine();
    sm.transition('active');
    sm.update(100);
    expect(sm.state).toBe('active');
    expect(sm.progress).toBe(1);
  });

  it('transitions deactivating → idle when complete', () => {
    const sm = new StateMachine();
    sm.config.deactivating.duration = 0.3;
    sm.config.deactivating.easing = (t: number) => t;
    sm.transition('deactivating');

    sm.update(0.4);
    expect(sm.state).toBe('idle');
  });

  it('applies easing function to progress', () => {
    const sm = new StateMachine();
    sm.config.activating.duration = 1.0;
    sm.config.activating.easing = (t: number) => t * t; // quadratic
    sm.transition('activating');

    sm.update(0.5);
    // raw = 0.5, eased = 0.25
    expect(sm.progress).toBeCloseTo(0.25, 5);
  });

  it('forceIdle() immediately resets', () => {
    const sm = new StateMachine();
    sm.transition('activating');
    sm.update(0.2);
    sm.forceIdle();

    expect(sm.state).toBe('idle');
    expect(sm.progress).toBe(0);
  });

  it('clamps progress to 1 before completing', () => {
    const sm = new StateMachine();
    sm.config.activating.duration = 1.0;
    sm.config.activating.easing = (t: number) => t;
    sm.transition('activating');

    // Overshoot the duration
    sm.update(2.0);
    // Should have transitioned to active, not have progress > 1
    expect(sm.state).toBe('active');
  });
});
