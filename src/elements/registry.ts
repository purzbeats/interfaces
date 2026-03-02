import type { Region } from '../layout/region';
import type { Palette } from '../color/palettes';
import type { SeededRandom } from '../random';
import { BaseElement, type AudioEmitter, type ElementRegistration } from './base-element';
import type { ElementMeta } from './tags';

type ElementFactory = (
  region: Region,
  palette: Palette,
  rng: SeededRandom,
  screenWidth: number,
  screenHeight: number,
  emitAudio?: AudioEmitter
) => BaseElement;

const REGISTRY: Record<string, ElementFactory> = {};
const META: Record<string, ElementMeta> = {};

/* ---------- auto-discovery via import.meta.glob ---------- */

const modules = import.meta.glob('./*.ts', { eager: true }) as Record<
  string,
  Record<string, unknown>
>;

for (const mod of Object.values(modules)) {
  for (const exported of Object.values(mod)) {
    if (
      typeof exported === 'function' &&
      exported.prototype instanceof BaseElement &&
      'registration' in exported
    ) {
      const { name, meta } = (exported as { registration: ElementRegistration }).registration;
      const Ctor = exported as unknown as new (...args: ConstructorParameters<typeof BaseElement>) => BaseElement;
      REGISTRY[name] = (r, p, rng, sw, sh, a) => new Ctor(r, p, rng, sw, sh, a);
      META[name] = meta;
    }
  }
}

/* ---------- public API ---------- */

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

export function getRegisteredMeta(name: string): ElementMeta | undefined {
  return META[name];
}

export function allRegisteredNames(): string[] {
  return Object.keys(META);
}
