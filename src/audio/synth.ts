/**
 * Otherworldly machine audio — the groans, tics, and disk reads of alien hardware.
 * Not musical. Think: coil whine, relay clicks, tape seek, capacitor discharge.
 * Everything through: LPF → bitcrusher → reverb → master.
 */
export class AudioSynth {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private lpf: BiquadFilterNode | null = null;
  private crusher: WaveShaperNode | null = null;
  private reverb: ConvolverNode | null = null;
  private reverbGain: GainNode | null = null;
  private dryGain: GainNode | null = null;
  private _muted: boolean = false;
  private _volume: number = 0.1;

  get muted(): boolean { return this._muted; }
  set muted(v: boolean) {
    this._muted = v;
    if (this.masterGain) {
      this.masterGain.gain.value = v ? 0 : this._volume;
    }
  }

  get volume(): number { return this._volume; }
  set volume(v: number) {
    this._volume = v;
    if (this.masterGain && !this._muted) {
      this.masterGain.gain.value = v;
    }
  }

  private ensureCtx(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();

      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this._muted ? 0 : this._volume;
      this.masterGain.connect(this.ctx.destination);

      // LPF — everything sounds like it's behind a panel
      this.lpf = this.ctx.createBiquadFilter();
      this.lpf.type = 'lowpass';
      this.lpf.frequency.value = 700;
      this.lpf.Q.value = 3.0;

      // Bitcrusher — lo-fi staircase quantization
      this.crusher = this.ctx.createWaveShaper();
      // @ts-expect-error Float32Array<ArrayBufferLike> vs Float32Array<ArrayBuffer>
      this.crusher.curve = this.makeCrusherCurve(12);
      this.crusher.oversample = 'none';

      // Reverb — small metallic enclosure
      this.reverb = this.ctx.createConvolver();
      this.reverb.buffer = this.makeReverbIR(1.4, 0.7);

      this.dryGain = this.ctx.createGain();
      this.dryGain.gain.value = 0.55;
      this.reverbGain = this.ctx.createGain();
      this.reverbGain.gain.value = 0.45;

      this.lpf.connect(this.crusher);
      this.crusher.connect(this.dryGain);
      this.crusher.connect(this.reverb);
      this.reverb.connect(this.reverbGain);
      this.dryGain.connect(this.masterGain);
      this.reverbGain.connect(this.masterGain);
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    return this.ctx;
  }

  private get bus(): AudioNode {
    return this.lpf!;
  }

  private makeCrusherCurve(steps: number): Float32Array {
    const samples = 8192;
    const curve = new Float32Array(samples);
    for (let i = 0; i < samples; i++) {
      const x = (i / samples) * 2 - 1;
      curve[i] = Math.round(x * steps) / steps;
    }
    return curve;
  }

  private makeReverbIR(duration: number, decay: number): AudioBuffer {
    const ctx = this.ctx!;
    const length = Math.floor(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        const t = i / length;
        const envelope = Math.exp(-t * (3 + decay * 6));
        // Metallic early reflections
        const tap = (i % Math.floor(ctx.sampleRate * 0.023) < 3) ? 0.25 : 0;
        data[i] = ((Math.random() * 2 - 1) * envelope + tap * envelope * (Math.random() - 0.5)) * 0.35;
      }
    }
    return buffer;
  }

  /**
   * Relay click — a tiny mechanical tic. Like a relay closing inside a machine.
   * Used for element activation.
   */
  blip(freq: number = 300, _duration: number = 0.08): void {
    const ctx = this.ensureCtx();
    const t = ctx.currentTime;

    // Very short noise burst = the click
    const clickLen = Math.floor(ctx.sampleRate * 0.006);
    const clickBuf = ctx.createBuffer(1, clickLen, ctx.sampleRate);
    const clickData = clickBuf.getChannelData(0);
    for (let i = 0; i < clickLen; i++) {
      const env = 1 - (i / clickLen);
      clickData[i] = (Math.random() * 2 - 1) * env * env;
    }
    const click = ctx.createBufferSource();
    click.buffer = clickBuf;
    const clickGain = ctx.createGain();
    clickGain.gain.value = 0.18;
    click.connect(clickGain);
    clickGain.connect(this.bus);
    click.start(t);

    // Followed by a tiny resonant ping — the coil settling
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq * 0.5, t + 0.005);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.25, t + 0.06);
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.06, t + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    osc.connect(gain);
    gain.connect(this.bus);
    osc.start(t + 0.004);
    osc.stop(t + 0.1);
  }

  /**
   * Boot sequence — a series of disk seek sounds and capacitor whines.
   * Like a machine waking up: relay clicks, a rising hum, servo noises.
   */
  bootSequence(count: number = 5, _baseFreq: number = 120): void {
    const ctx = this.ensureCtx();
    const steps = Math.min(count, 8);

    // Low hum fading in — power supply warming up
    const hum = ctx.createOscillator();
    const humGain = ctx.createGain();
    hum.type = 'sawtooth';
    hum.frequency.value = 50;
    humGain.gain.setValueAtTime(0, ctx.currentTime);
    humGain.gain.linearRampToValueAtTime(0.04, ctx.currentTime + 0.5);
    humGain.gain.linearRampToValueAtTime(0.02, ctx.currentTime + steps * 0.15 + 0.3);
    humGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + steps * 0.15 + 1.0);
    hum.connect(humGain);
    humGain.connect(this.bus);
    hum.start(ctx.currentTime);
    hum.stop(ctx.currentTime + steps * 0.15 + 1.1);

    // Staggered seek/click sounds
    for (let i = 0; i < steps; i++) {
      const t = ctx.currentTime + i * 0.15 + Math.random() * 0.04;
      this.scheduleSeekSound(t, 0.03 + Math.random() * 0.03);
    }

    // Final "lock" — a slightly longer resonant thunk
    const lockTime = ctx.currentTime + steps * 0.15 + 0.1;
    const lockOsc = ctx.createOscillator();
    const lockGain = ctx.createGain();
    lockOsc.type = 'triangle';
    lockOsc.frequency.setValueAtTime(180, lockTime);
    lockOsc.frequency.exponentialRampToValueAtTime(60, lockTime + 0.15);
    lockGain.gain.setValueAtTime(0, lockTime);
    lockGain.gain.linearRampToValueAtTime(0.1, lockTime + 0.01);
    lockGain.gain.exponentialRampToValueAtTime(0.001, lockTime + 0.2);
    lockOsc.connect(lockGain);
    lockGain.connect(this.bus);
    lockOsc.start(lockTime);
    lockOsc.stop(lockTime + 0.25);
  }

  /** Schedule a single disk-seek-like sound at time t */
  private scheduleSeekSound(t: number, duration: number): void {
    const ctx = this.ctx!;

    // Short noise burst — head movement
    const len = Math.floor(ctx.sampleRate * duration);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      const env = Math.exp(-(i / len) * 8);
      // Bandlimited noise — not pure white, more of a "chk" texture
      data[i] = (Math.random() * 2 - 1) * env * (Math.sin(i * 0.3) > 0 ? 1 : 0.3);
    }

    const src = ctx.createBufferSource();
    src.buffer = buf;
    const gain = ctx.createGain();
    gain.gain.value = 0.12;
    src.connect(gain);
    gain.connect(this.bus);
    src.start(t);
  }

  /**
   * Data chirp — a brief whirring/processing sound.
   * Like tape spinning up for a split second.
   */
  dataChirp(): void {
    const ctx = this.ensureCtx();
    const t = ctx.currentTime;

    // Modulated noise — sounds like a brief spin-up
    const len = Math.floor(ctx.sampleRate * 0.12);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      const norm = i / len;
      const env = Math.sin(norm * Math.PI); // fade in, fade out
      // AM-modulated noise — the "whirr" texture
      const mod = Math.sin(i * 0.08) * 0.5 + 0.5;
      data[i] = (Math.random() * 2 - 1) * env * mod * 0.7;
    }

    const src = ctx.createBufferSource();
    src.buffer = buf;
    const gain = ctx.createGain();
    gain.gain.value = 0.08;
    src.connect(gain);
    gain.connect(this.bus);
    src.start(t);
  }

  /**
   * Alert — a low, ominous throb. Machine distress.
   * Not a klaxon — more like a capacitor straining under load.
   */
  alert(duration: number = 1.5): void {
    const ctx = this.ensureCtx();
    const t = ctx.currentTime;

    // Sub-bass groan
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(45, t);
    osc.frequency.linearRampToValueAtTime(55, t + duration * 0.5);
    osc.frequency.linearRampToValueAtTime(40, t + duration);

    // Slow amplitude throb via LFO
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.type = 'sine';
    lfo.frequency.value = 2;
    lfoGain.gain.value = 0.03;
    lfo.connect(lfoGain);
    lfoGain.connect(gain.gain);

    gain.gain.setValueAtTime(0.05, t);
    gain.gain.linearRampToValueAtTime(0.07, t + 0.3);
    gain.gain.setValueAtTime(0.07, t + duration - 0.4);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);

    osc.connect(gain);
    gain.connect(this.bus);
    lfo.start(t);
    osc.start(t);
    osc.stop(t + duration + 0.1);
    lfo.stop(t + duration + 0.1);

    // Occasional stressed clicks during alert
    for (let i = 0; i < 4; i++) {
      this.scheduleSeekSound(t + 0.2 + i * (duration / 5), 0.015);
    }
  }

  /**
   * Glitch — digital debris. Brief crackle of corrupt data.
   */
  glitchNoise(duration: number = 0.18): void {
    const ctx = this.ensureCtx();
    const t = ctx.currentTime;
    const length = Math.floor(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);

    // Sparse pops — like a scratched disk or bad memory read
    for (let i = 0; i < length; i++) {
      const norm = i / length;
      const env = (1 - norm) * (1 - norm);
      // Mostly silence with sudden pops
      if (Math.random() < 0.08) {
        data[i] = (Math.random() > 0.5 ? 1 : -1) * env * 0.8;
      } else if (Math.random() < 0.03) {
        // Occasional tiny crackle
        data[i] = (Math.random() * 2 - 1) * env * 0.2;
      }
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = 0.12;
    source.connect(gain);
    gain.connect(this.bus);
    source.start(t);
  }

  /** Keystroke — tiny per-character tic for typewriter text. Extremely subtle. */
  keystroke(charCode: number = 65): void {
    const ctx = this.ensureCtx();
    const t = ctx.currentTime;

    // Microscopic click — varies slightly per character for organic feel
    const freq = 80 + (charCode % 20) * 8;
    const len = Math.floor(ctx.sampleRate * 0.004);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      const env = 1 - (i / len);
      data[i] = (Math.sin(i * freq * 0.01) + (Math.random() - 0.5) * 0.5) * env * env;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const gain = ctx.createGain();
    gain.gain.value = 0.04; // very quiet
    src.connect(gain);
    gain.connect(this.bus);
    src.start(t);
  }

  /** Deactivation — tiny mechanical settle, like a servo parking */
  deactivate(): void {
    const ctx = this.ensureCtx();
    const t = ctx.currentTime;

    // Very short descending thud
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(40, t + 0.05);
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.05, t + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
    osc.connect(gain);
    gain.connect(this.bus);
    osc.start(t);
    osc.stop(t + 0.1);
  }

  /** Power-down — the machine winding down, coils demagnetizing */
  powerDown(): void {
    const ctx = this.ensureCtx();
    const t = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(120, t);
    osc.frequency.exponentialRampToValueAtTime(15, t + 1.2);
    gain.gain.setValueAtTime(0.06, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 1.3);
    osc.connect(gain);
    gain.connect(this.bus);
    osc.start(t);
    osc.stop(t + 1.4);
  }

  dispose(): void {
    this.ctx?.close();
    this.ctx = null;
    this.masterGain = null;
    this.lpf = null;
    this.crusher = null;
    this.reverb = null;
    this.reverbGain = null;
    this.dryGain = null;
  }
}
