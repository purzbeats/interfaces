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
import { TargetReticleElement } from './target-reticle';
import { ConcentricRingsElement } from './concentric-rings';
import { DiamondGaugeElement } from './diamond-gauge';
import { TriScannerElement } from './tri-scanner';
import { DataCascadeElement } from './data-cascade';
import { ArcReactorElement } from './arc-reactor';
import { SignalBarsElement } from './signal-bars';
import { RotatingGeometryElement } from './rotating-geometry';
import { OrbitalDotsElement } from './orbital-dots';
import { BracketFrameElement } from './bracket-frame';
import { CrossScopeElement } from './cross-scope';
import { RingGaugeElement } from './ring-gauge';

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
  'target-reticle':     f(TargetReticleElement),
  'concentric-rings':   f(ConcentricRingsElement),
  'diamond-gauge':      f(DiamondGaugeElement),
  'tri-scanner':        f(TriScannerElement),
  'data-cascade':       f(DataCascadeElement),
  'arc-reactor':        f(ArcReactorElement),
  'signal-bars':        f(SignalBarsElement),
  'rotating-geometry':  f(RotatingGeometryElement),
  'orbital-dots':       f(OrbitalDotsElement),
  'bracket-frame':      f(BracketFrameElement),
  'cross-scope':        f(CrossScopeElement),
  'ring-gauge':         f(RingGaugeElement),
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

export function elementTypes(): string[] {
  return Object.keys(REGISTRY);
}
