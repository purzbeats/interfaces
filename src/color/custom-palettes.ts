import { PALETTES, type Palette } from './palettes';
import * as THREE from 'three';

const STORAGE_KEY = 'interfaces-custom-palettes';

export interface CustomPaletteData {
  name: string;
  bg: string;
  primary: string;
  secondary: string;
  dim: string;
  alert: string;
}

function toPalette(d: CustomPaletteData): Palette {
  return {
    name: d.name,
    bg: new THREE.Color(d.bg),
    primary: new THREE.Color(d.primary),
    secondary: new THREE.Color(d.secondary),
    dim: new THREE.Color(d.dim),
    alert: new THREE.Color(d.alert),
  };
}

/** Load all custom palettes from localStorage and register them into PALETTES. */
export function loadCustomPalettes(): void {
  for (const d of listCustomPalettes()) {
    PALETTES[d.name] = toPalette(d);
  }
}

/** Get raw custom palette data from localStorage. */
export function listCustomPalettes(): CustomPaletteData[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr;
  } catch {
    return [];
  }
}

/** Save a custom palette (creates or overwrites by name). */
export function saveCustomPalette(data: CustomPaletteData): void {
  const list = listCustomPalettes().filter(p => p.name !== data.name);
  list.push(data);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  PALETTES[data.name] = toPalette(data);
}

/** Delete a custom palette by name. */
export function deleteCustomPalette(name: string): void {
  const list = listCustomPalettes().filter(p => p.name !== name);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  delete PALETTES[name];
}

/** Snapshot of built-in palette keys taken at module init (before custom palettes are registered). */
const BUILTIN_NAMES = new Set(Object.keys(PALETTES));

/** Check if a palette name is a built-in (non-deletable). */
export function isBuiltinPalette(name: string): boolean {
  return BUILTIN_NAMES.has(name);
}
