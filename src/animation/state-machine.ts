import { type EasingFn, easing } from './easing';

export type ElementState = 'idle' | 'activating' | 'active' | 'deactivating';

export interface StateConfig {
  duration: number;
  easing: EasingFn;
}

export class StateMachine {
  state: ElementState = 'idle';
  progress: number = 0;
  private elapsed: number = 0;

  readonly config: Record<ElementState, StateConfig> = {
    idle: { duration: 0, easing: easing.linear },
    activating: { duration: 0.5, easing: easing.easeOutExpo },
    active: { duration: Infinity, easing: easing.linear },
    deactivating: { duration: 0.3, easing: easing.easeInQuad },
  };

  transition(newState: ElementState): void {
    this.state = newState;
    this.elapsed = 0;
    this.progress = 0;
  }

  update(dt: number): void {
    if (this.state === 'idle') return;

    const cfg = this.config[this.state];
    this.elapsed += dt;

    if (cfg.duration === Infinity) {
      this.progress = 1;
      return;
    }

    const raw = Math.min(this.elapsed / cfg.duration, 1);
    this.progress = cfg.easing(raw);

    if (raw >= 1) {
      this.onComplete();
    }
  }

  private onComplete(): void {
    switch (this.state) {
      case 'activating':
        this.transition('active');
        break;
      case 'deactivating':
        this.transition('idle');
        break;
    }
  }
}
