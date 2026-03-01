import type { SeededRandom } from '../random';

export type CueAction = 'activate' | 'deactivate' | 'pulse' | 'glitch' | 'alert';

export interface Cue {
  time: number;
  elementId: string;
  action: CueAction;
}

export class Timeline {
  private cues: Cue[] = [];
  private index: number = 0;
  private elapsed: number = 0;
  public totalDuration: number = 30;
  public paused: boolean = false;
  public loop: boolean = false;

  get currentTime(): number {
    return this.elapsed;
  }

  get normalizedTime(): number {
    return this.elapsed / this.totalDuration;
  }

  get finished(): boolean {
    return this.elapsed >= this.totalDuration;
  }

  addCue(cue: Cue): void {
    this.cues.push(cue);
  }

  build(): void {
    this.cues.sort((a, b) => a.time - b.time);
    this.index = 0;
    this.elapsed = 0;
  }

  reset(): void {
    this.index = 0;
    this.elapsed = 0;
  }

  update(dt: number, onCue: (cue: Cue) => void): void {
    if (this.paused) return;

    this.elapsed += dt;

    // Loop: restart when finished
    if (this.loop && this.elapsed >= this.totalDuration) {
      this.reset();
    }

    while (this.index < this.cues.length && this.cues[this.index].time <= this.elapsed) {
      onCue(this.cues[this.index]);
      this.index++;
    }
  }

  clear(): void {
    this.cues = [];
    this.index = 0;
    this.elapsed = 0;
  }
}

export interface TimelinePhases {
  bootDuration: number;
  mainDuration: number;
  alertDuration: number;
  cooldownDuration: number;
}

/**
 * Procedurally generate a timeline with phases:
 * boot (staggered activations) → main (pulses/glitches) → alert → cooldown (deactivations)
 */
export function generateTimeline(
  elementIds: string[],
  phases: TimelinePhases,
  rng: SeededRandom
): Timeline {
  const tl = new Timeline();
  const { bootDuration, mainDuration, alertDuration, cooldownDuration } = phases;
  tl.totalDuration = bootDuration + mainDuration + alertDuration + cooldownDuration;

  const shuffled = [...elementIds];
  rng.shuffle(shuffled);

  // Boot phase: staggered activations
  const bootInterval = bootDuration / (shuffled.length + 1);
  shuffled.forEach((id, i) => {
    tl.addCue({ time: bootInterval * (i + 1), elementId: id, action: 'activate' });
  });

  // Main phase: random pulses and glitches
  const mainStart = bootDuration;
  const mainEnd = mainStart + mainDuration;
  const eventCount = rng.int(5, 15);
  for (let i = 0; i < eventCount; i++) {
    const time = rng.float(mainStart, mainEnd);
    const id = rng.pick(elementIds);
    const action: CueAction = rng.chance(0.6) ? 'pulse' : 'glitch';
    tl.addCue({ time, elementId: id, action });
  }

  // Alert phase
  const alertStart = mainEnd;
  const alertId = rng.pick(elementIds);
  tl.addCue({ time: alertStart, elementId: alertId, action: 'alert' });
  // Flash a few elements
  for (let i = 0; i < 3; i++) {
    tl.addCue({
      time: alertStart + rng.float(0.5, alertDuration - 0.5),
      elementId: rng.pick(elementIds),
      action: 'pulse',
    });
  }

  // Cooldown: staggered deactivations
  const cooldownStart = alertStart + alertDuration;
  const cooldownInterval = cooldownDuration / (shuffled.length + 1);
  shuffled.forEach((id, i) => {
    tl.addCue({
      time: cooldownStart + cooldownInterval * (i + 1),
      elementId: id,
      action: 'deactivate',
    });
  });

  tl.build();
  return tl;
}
