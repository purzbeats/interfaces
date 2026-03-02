/**
 * Audio-reactive beat detection that drives the intensity system.
 * Uses its own AudioContext (separate from the synth) to avoid
 * corrupting frequency analysis with synth effects.
 *
 * Detection is onset-based: we look for sudden jumps in bass energy
 * (the derivative), not absolute amplitude. This fires on percussive
 * hits — kicks, snares, transients — and ignores sustained bass.
 */
export class AudioReactive {
  sensitivity: number = 1.0;
  onKick: ((level: number) => void) | null = null;

  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private source: MediaStreamAudioSourceNode | MediaElementAudioSourceNode | null = null;
  private stream: MediaStream | null = null;
  private audioEl: HTMLAudioElement | null = null;
  private freqData: Uint8Array<ArrayBuffer> = new Uint8Array(0) as Uint8Array<ArrayBuffer>;
  private prevEnergy: number = 0;
  private fluxAvg: number = 0;
  private cooldown: number = 0;
  private active: boolean = false;

  private async ensureContext(): Promise<AudioContext> {
    if (!this.ctx) {
      this.ctx = new AudioContext();
    }
    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }
    return this.ctx;
  }

  private async setupAnalyser(): Promise<AnalyserNode> {
    const ctx = await this.ensureContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.15;
    this.analyser = analyser;
    this.freqData = new Uint8Array(analyser.frequencyBinCount) as Uint8Array<ArrayBuffer>;
    this.prevEnergy = 0;
    this.fluxAvg = 0;
    this.cooldown = 0;
    return analyser;
  }

  async startMic(): Promise<void> {
    this.stop();
    const analyser = await this.setupAnalyser();
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.stream = stream;
    const ctx = this.ctx!;
    this.source = ctx.createMediaStreamSource(stream);
    this.source.connect(analyser);
    this.active = true;
  }

  async startFile(file: File): Promise<void> {
    this.stop();
    const analyser = await this.setupAnalyser();
    const ctx = this.ctx!;

    const audioEl = document.createElement('audio');
    audioEl.crossOrigin = 'anonymous';
    audioEl.src = URL.createObjectURL(file);
    audioEl.loop = true;
    this.audioEl = audioEl;

    this.source = ctx.createMediaElementSource(audioEl);
    this.source.connect(analyser);
    analyser.connect(ctx.destination);

    await audioEl.play();
    this.active = true;
  }

  stop(): void {
    this.active = false;

    if (this.source) {
      this.source.disconnect();
      this.source = null;
    }
    if (this.analyser) {
      this.analyser.disconnect();
      this.analyser = null;
    }
    if (this.stream) {
      for (const track of this.stream.getTracks()) {
        track.stop();
      }
      this.stream = null;
    }
    if (this.audioEl) {
      this.audioEl.pause();
      URL.revokeObjectURL(this.audioEl.src);
      this.audioEl = null;
    }

    this.freqData = new Uint8Array(0) as Uint8Array<ArrayBuffer>;
    this.prevEnergy = 0;
    this.fluxAvg = 0;
    this.cooldown = 0;
  }

  update(dt: number): void {
    if (!this.active || !this.analyser) return;

    if (this.cooldown > 0) {
      this.cooldown -= dt;
      return;
    }

    this.analyser.getByteFrequencyData(this.freqData);

    // Bass energy: bins 1-6 (~40-250Hz at 44.1kHz)
    let sum = 0;
    const bassEnd = Math.min(7, this.freqData.length);
    for (let i = 1; i < bassEnd; i++) {
      const v = this.freqData[i] / 255;
      sum += v * v;
    }
    const energy = Math.sqrt(sum / 6);

    // Spectral flux: only positive changes (onsets, not decays)
    const flux = Math.max(0, energy - this.prevEnergy);
    this.prevEnergy = energy;

    // Track the average flux with a slow EMA
    const alpha = 0.05;
    this.fluxAvg = this.fluxAvg === 0
      ? flux
      : this.fluxAvg * (1 - alpha) + flux * alpha;

    // Onset detection: flux must exceed average by a large margin
    // sensitivity scales the threshold — higher sensitivity = lower threshold
    const minFlux = 0.02;
    const threshold = Math.max(minFlux, this.fluxAvg * (3.0 / this.sensitivity));

    if (flux > threshold) {
      // Map the spike magnitude to intensity level
      const ratio = flux / Math.max(this.fluxAvg, 0.001);

      let level: number;
      if (ratio >= 10.0) level = 5;
      else if (ratio >= 7.0) level = 4;
      else if (ratio >= 5.0) level = 3;
      else if (ratio >= 3.5) level = 2;
      else level = 1;

      if (this.onKick) {
        this.onKick(level);
      }

      // Long cooldown — one hit per beat, not a stream
      this.cooldown = 0.15; // 150ms
    }
  }

  dispose(): void {
    this.stop();
    if (this.ctx) {
      this.ctx.close();
      this.ctx = null;
    }
  }
}
