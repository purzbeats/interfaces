import type { Region } from '../layout/region';
import type { Palette } from '../color/palettes';
import type { SeededRandom } from '../random';
import { BaseElement, type AudioEmitter } from './base-element';
import { PanelElement } from './panel';
import { GridOverlayElement } from './grid-overlay';
import { GraphElement } from './graph';
import { WaveformElement } from './waveform';
import { ProgressBarElement } from './progress-bar';
import { RadarSweepElement } from './radar-sweep';
import { ScrollingNumbersElement } from './scrolling-numbers';
import { TextLabelElement } from './text-label';
import { StatusReadoutElement } from './status-readout';
import { SeparatorElement } from './separator';
import { HexGridElement } from './hex-grid';
import { ConcentricRingsElement } from './concentric-rings';
import { DataCascadeElement } from './data-cascade';
import { SignalBarsElement } from './signal-bars';
import { BracketFrameElement } from './bracket-frame';
import { CrossScopeElement } from './cross-scope';
import { RingGaugeElement } from './ring-gauge';
import { ThreatMeterElement } from './threat-meter';
import { ScanLineElement } from './scan-line';
import { BinaryStreamElement } from './binary-stream';
import { ClockDisplayElement } from './clock-display';
import { FreqAnalyzerElement } from './freq-analyzer';
import { PhaseIndicatorElement } from './phase-indicator';
import { SegmentDisplayElement } from './segment-display';
import { ThermalMapElement } from './thermal-map';
import { MemoryMapElement } from './memory-map';
import { CoordGridElement } from './coord-grid';
import { LevelRingsElement } from './level-rings';
import { RadialScannerElement } from './radial-scanner';
import { HexTunnelElement } from './hex-tunnel';
import { DotMatrixElement } from './dot-matrix';
import { OrbitalDisplayElement } from './orbital-display';
import { PulseWaveElement } from './pulse-wave';
import { SpectrogramElement } from './spectrogram';
import { ParticleFieldElement } from './particle-field';
import { TopologyMapElement } from './topology-map';
import { TargetLockElement } from './target-lock';

type ElementFactory = (
  region: Region,
  palette: Palette,
  rng: SeededRandom,
  screenWidth: number,
  screenHeight: number,
  emitAudio?: AudioEmitter
) => BaseElement;

const f = (Ctor: new (...args: ConstructorParameters<typeof BaseElement>) => BaseElement): ElementFactory =>
  (r, p, rng, sw, sh, a) => new Ctor(r, p, rng, sw, sh, a);

const REGISTRY: Record<string, ElementFactory> = {
  'panel':              f(PanelElement),
  'grid-overlay':       f(GridOverlayElement),
  'graph':              f(GraphElement),
  'waveform':           f(WaveformElement),
  'progress-bar':       f(ProgressBarElement),
  'radar-sweep':        f(RadarSweepElement),
  'scrolling-numbers':  f(ScrollingNumbersElement),
  'text-label':         f(TextLabelElement),
  'status-readout':     f(StatusReadoutElement),
  'separator':          f(SeparatorElement),
  'hex-grid':           f(HexGridElement),
 'concentric-rings':   f(ConcentricRingsElement),
 'data-cascade':       f(DataCascadeElement),
 'signal-bars':        f(SignalBarsElement),
 'bracket-frame':      f(BracketFrameElement),
 'cross-scope':        f(CrossScopeElement),
 'ring-gauge':         f(RingGaugeElement),
 'threat-meter':       f(ThreatMeterElement),
 'scan-line':          f(ScanLineElement),
 'binary-stream':      f(BinaryStreamElement),
 'clock-display':      f(ClockDisplayElement),
 'freq-analyzer':      f(FreqAnalyzerElement),
 'phase-indicator':    f(PhaseIndicatorElement),
 'segment-display':    f(SegmentDisplayElement),
 'thermal-map':        f(ThermalMapElement),
 'memory-map':         f(MemoryMapElement),
 'coord-grid':         f(CoordGridElement),
 'level-rings':        f(LevelRingsElement),
 'radial-scanner':     f(RadialScannerElement),
 'hex-tunnel':         f(HexTunnelElement),
 'dot-matrix':         f(DotMatrixElement),
 'orbital-display':    f(OrbitalDisplayElement),
 'pulse-wave':         f(PulseWaveElement),
 'spectrogram':        f(SpectrogramElement),
 'particle-field':     f(ParticleFieldElement),
 'topology-map':       f(TopologyMapElement),
 'target-lock':        f(TargetLockElement),
};

export function createElement(
  type: string,
  region: Region,
  palette: Palette,
  rng: SeededRandom,
  screenWidth: number,
  screenHeight: number,
  emitAudio?: AudioEmitter
): BaseElement {
  const factory = REGISTRY[type] ?? REGISTRY['panel'];
  const element = factory(region, palette, rng, screenWidth, screenHeight, emitAudio);
  element.build();
  return element;
}

/** Construct an element without calling build() — for deferred/staged loading. */
export function createElementDeferred(
  type: string,
  region: Region,
  palette: Palette,
  rng: SeededRandom,
  screenWidth: number,
  screenHeight: number,
  emitAudio?: AudioEmitter
): BaseElement {
  const factory = REGISTRY[type] ?? REGISTRY['panel'];
  return factory(region, palette, rng, screenWidth, screenHeight, emitAudio);
}

export function elementTypes(): string[] {
  return Object.keys(REGISTRY);
}
