import { type EasingFn, easing } from './easing';

export interface TweenOptions {
  from: number;
  to: number;
  duration: number;
  ease?: EasingFn;
  delay?: number;
  onUpdate: (value: number) => void;
  onComplete?: () => void;
}

export class Tween {
  private elapsed: number = 0;
  private readonly from: number;
  private readonly to: number;
  private readonly duration: number;
  private readonly delay: number;
  private readonly ease: EasingFn;
  private readonly onUpdate: (value: number) => void;
  private readonly onComplete?: () => void;
  public done: boolean = false;

  constructor(opts: TweenOptions) {
    this.from = opts.from;
    this.to = opts.to;
    this.duration = opts.duration;
    this.delay = opts.delay ?? 0;
    this.ease = opts.ease ?? easing.linear;
    this.onUpdate = opts.onUpdate;
    this.onComplete = opts.onComplete;
  }

  update(dt: number): void {
    if (this.done) return;
    this.elapsed += dt;

    const t = Math.max(0, this.elapsed - this.delay);
    if (t <= 0) return;

    const raw = Math.min(t / this.duration, 1);
    const eased = this.ease(raw);
    const value = this.from + (this.to - this.from) * eased;
    this.onUpdate(value);

    if (raw >= 1) {
      this.done = true;
      this.onComplete?.();
    }
  }
}

export class TweenManager {
  private tweens: Tween[] = [];

  add(opts: TweenOptions): Tween {
    const tween = new Tween(opts);
    this.tweens.push(tween);
    return tween;
  }

  update(dt: number): void {
    for (const tween of this.tweens) {
      tween.update(dt);
    }
    this.tweens = this.tweens.filter((t) => !t.done);
  }

  clear(): void {
    this.tweens = [];
  }
}
