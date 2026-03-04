export type ShapeTag = 'rectangular' | 'linear' | 'radial';
export type RoleTag = 'structural' | 'gauge' | 'scanner' | 'data-display' | 'text' | 'decorative' | 'border';
export type MoodTag = 'tactical' | 'diagnostic' | 'ambient';
export type SizeTag = 'works-small' | 'needs-medium' | 'needs-large';

export type AudioBand = 'sub' | 'bass' | 'mid' | 'high';
export const BAND_INDEX: Record<AudioBand, number> = { sub: 0, bass: 1, mid: 2, high: 3 };

export interface ElementMeta {
  shape: ShapeTag;
  roles: RoleTag[];
  moods: MoodTag[];
  sizes: SizeTag[];
  bandAffinity?: AudioBand;
  audioSensitivity?: number;
}

/* ---------- delegates to auto-built registry ---------- */

import { getRegisteredMeta, allRegisteredNames } from './registry';

export function getMeta(name: string): ElementMeta | undefined {
  return getRegisteredMeta(name);
}

export function elementsByTag(tag: string): string[] {
  return allRegisteredNames().filter((name) => {
    const meta = getRegisteredMeta(name);
    if (!meta) return false;
    return (
      meta.shape === tag ||
      meta.roles.includes(tag as RoleTag) ||
      meta.moods.includes(tag as MoodTag) ||
      meta.sizes.includes(tag as SizeTag)
    );
  });
}

export function allElementNames(): string[] {
  return allRegisteredNames();
}
