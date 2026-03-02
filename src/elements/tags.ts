export type ShapeTag = 'rectangular' | 'linear' | 'radial';
export type RoleTag = 'structural' | 'gauge' | 'scanner' | 'data-display' | 'text' | 'decorative';
export type MoodTag = 'tactical' | 'diagnostic' | 'ambient';
export type SizeTag = 'works-small' | 'needs-medium' | 'needs-large';

export interface ElementMeta {
  shape: ShapeTag;
  roles: RoleTag[];
  moods: MoodTag[];
  sizes: SizeTag[];
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
