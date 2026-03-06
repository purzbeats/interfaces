/**
 * Audio-reactive analysis: multi-band frequency decomposition, waveform
 * capture, onset detection, and continuous energy tracking.
 *
 * Uses its own AudioContext (separate from the synth) to avoid
 * corrupting frequency analysis with synth effects.
 */

/** Per-frame audio analysis snapshot available to all elements. */
export interface AudioFrame {
  /** 4 frequency bands: sub (20-80Hz), bass (80-250Hz), mid (250-4kHz), high (4k-16kHz). Each 0-1. */
  bands: Float32Array;
  /** 32 finer frequency bins for spectrum displays. Each 0-1. */
  spectrum: Float32Array;
  /** Overall RMS loudness 0-1. */
  rms: number;
  /** Instantaneous peak amplitude 0-1. */
  peak: number;
  /** Whether an onset (kick/transient) was detected this frame. */
  kick: boolean;
  /** Kick intensity level 0-5. 0 when no kick this frame. */
  kickLevel: number;
  /** Time-domain waveform (128 samples, -1 to 1). */
  waveform: Float32Array;
}

// Frequency band boundaries in Hz (at 44100 sample rate, FFT size 2048)
// Bin resolution = sampleRate / fftSize ≈ 21.5 Hz per bin
const FFT_SIZE = 2048;
const WAVEFORM_SIZE = 128;
const SPECTRUM_BINS = 32;

function hzToBin(hz: number, sampleRate: number): number {
  return Math.round(hz / (sampleRate / FFT_SIZE));
}

export class AudioReactive {
  sensitivity: number = 1.0;
  gain: number = 1.0;
  smoothing: number = 0.3;
  kickThreshold: number = 1.0;
  bandWeights: Float32Array = new Float32Array([1, 1, 1, 1]); // sub, bass, mid, high
  onKick: ((level: number) => void) | null = null;

  /** Latest audio analysis frame. Null when no audio source is active. */
  frame: AudioFrame | null = null;

  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private source: MediaStreamAudioSourceNode | MediaElementAudioSourceNode | null = null;
  private stream: MediaStream | null = null;
  private audioEl: HTMLAudioElement | null = null;
  private freqData: Uint8Array<ArrayBuffer> = new Uint8Array(0) as Uint8Array<ArrayBuffer>;
  private timeData: Uint8Array<ArrayBuffer> = new Uint8Array(0) as Uint8Array<ArrayBuffer>;
  private prevBassEnergy: number = 0;
  private fluxAvg: number = 0;
  private kickCooldown: number = 0;
  private active: boolean = false;

  // Band boundaries (computed once per setup based on actual sample rate)
  private bandRanges: [number, number][] = [];

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
    analyser.fftSize = FFT_SIZE;
    analyser.smoothingTimeConstant = 0.3;
    this.analyser = analyser;
    this.freqData = new Uint8Array(analyser.frequencyBinCount) as Uint8Array<ArrayBuffer>;
    this.timeData = new Uint8Array(FFT_SIZE) as Uint8Array<ArrayBuffer>;
    this.prevBassEnergy = 0;
    this.fluxAvg = 0;
    this.kickCooldown = 0;

    // Compute band boundaries from actual sample rate
    const sr = ctx.sampleRate;
    this.bandRanges = [
      [hzToBin(20, sr), hzToBin(80, sr)],     // sub
      [hzToBin(80, sr), hzToBin(250, sr)],     // bass
      [hzToBin(250, sr), hzToBin(4000, sr)],   // mid
      [hzToBin(4000, sr), hzToBin(16000, sr)], // high
    ];

    // Initialize frame
    this.frame = {
      bands: new Float32Array(4),
      spectrum: new Float32Array(SPECTRUM_BINS),
      rms: 0,
      peak: 0,
      kick: false,
      kickLevel: 0,
      waveform: new Float32Array(WAVEFORM_SIZE),
    };

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
    this.timeData = new Uint8Array(0) as Uint8Array<ArrayBuffer>;
    this.prevBassEnergy = 0;
    this.fluxAvg = 0;
    this.kickCooldown = 0;
    this.frame = null;
  }

  update(dt: number): void {
    if (!this.active || !this.analyser || !this.frame) return;

    // Sync smoothing to analyser
    this.analyser.smoothingTimeConstant = this.smoothing;

    // --- Frequency data ---
    this.analyser.getByteFrequencyData(this.freqData);

    // --- Time-domain waveform ---
    this.analyser.getByteTimeDomainData(this.timeData);
    const wf = this.frame.waveform;
    // Downsample FFT_SIZE → WAVEFORM_SIZE and normalize to -1..1
    const step = this.timeData.length / WAVEFORM_SIZE;
    let rmsSum = 0;
    let peakVal = 0;
    for (let i = 0; i < WAVEFORM_SIZE; i++) {
      const idx = Math.floor(i * step);
      const v = (this.timeData[idx] - 128) / 128;
      wf[i] = v;
      rmsSum += v * v;
      const abs = Math.abs(v);
      if (abs > peakVal) peakVal = abs;
    }
    this.frame.rms = Math.min(1, Math.sqrt(rmsSum / WAVEFORM_SIZE) * this.gain);
    this.frame.peak = Math.min(1, peakVal * this.gain);

    // --- 4 frequency bands ---
    const bands = this.frame.bands;
    for (let b = 0; b < 4; b++) {
      const [lo, hi] = this.bandRanges[b];
      const count = Math.max(1, hi - lo);
      let sum = 0;
      for (let i = lo; i < hi && i < this.freqData.length; i++) {
        const v = this.freqData[i] / 255;
        sum += v;
      }
      bands[b] = Math.min(1, (sum / count) * this.gain * this.bandWeights[b]);
    }

    // --- 32-bin spectrum (log-spaced for perceptual accuracy) ---
    const spectrum = this.frame.spectrum;
    const binCount = this.freqData.length;
    const sr = this.ctx!.sampleRate;
    const minHz = 30;
    const maxHz = Math.min(16000, sr / 2);
    const logMin = Math.log(minHz);
    const logMax = Math.log(maxHz);
    for (let i = 0; i < SPECTRUM_BINS; i++) {
      const loHz = Math.exp(logMin + (i / SPECTRUM_BINS) * (logMax - logMin));
      const hiHz = Math.exp(logMin + ((i + 1) / SPECTRUM_BINS) * (logMax - logMin));
      const loBin = Math.max(0, Math.floor(loHz / (sr / FFT_SIZE)));
      const hiBin = Math.min(binCount, Math.ceil(hiHz / (sr / FFT_SIZE)));
      let sum = 0;
      let count = 0;
      for (let j = loBin; j < hiBin; j++) {
        sum += this.freqData[j] / 255;
        count++;
      }
      spectrum[i] = count > 0 ? sum / count : 0;
    }

    // --- Kick detection (onset on bass = sub + bass bands) ---
    if (this.kickCooldown > 0) {
      this.kickCooldown -= dt;
      this.frame.kick = false;
      this.frame.kickLevel = 0;
    } else {
      const bassEnergy = (bands[0] + bands[1]) / 2;
      const flux = Math.max(0, bassEnergy - this.prevBassEnergy);
      this.prevBassEnergy = bassEnergy;

      const alpha = 0.05;
      this.fluxAvg = this.fluxAvg === 0 ? flux : this.fluxAvg * (1 - alpha) + flux * alpha;

      const minFlux = 0.02;
      const threshold = Math.max(minFlux, this.fluxAvg * (3.0 / this.sensitivity) * this.kickThreshold);

      if (flux > threshold) {
        const ratio = flux / Math.max(this.fluxAvg, 0.001);
        let level: number;
        if (ratio >= 10.0) level = 5;
        else if (ratio >= 7.0) level = 4;
        else if (ratio >= 5.0) level = 3;
        else if (ratio >= 3.5) level = 2;
        else level = 1;

        this.frame.kick = true;
        this.frame.kickLevel = level;

        if (this.onKick) {
          this.onKick(level);
        }
        this.kickCooldown = 0.15;
      } else {
        this.frame.kick = false;
        this.frame.kickLevel = 0;
      }
    }
  }

  get isActive(): boolean {
    return this.active;
  }

  dispose(): void {
    this.stop();
    if (this.ctx) {
      this.ctx.close();
      this.ctx = null;
    }
  }
}
