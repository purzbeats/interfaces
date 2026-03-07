import type { MicrogameDefinition } from './microgame-types';

const REGISTRY: MicrogameDefinition[] = [];

export function registerMicrogame(def: MicrogameDefinition): void {
  REGISTRY.push(def);
}

export function allMicrogames(): MicrogameDefinition[] {
  return [...REGISTRY];
}

export function getMicrogame(id: string): MicrogameDefinition | undefined {
  return REGISTRY.find(d => d.id === id);
}

/** Pick a random microgame, avoiding the last played if possible */
export function pickRandom(lastId: string | null): MicrogameDefinition {
  if (REGISTRY.length === 0) throw new Error('No microgames registered');
  if (REGISTRY.length === 1) return REGISTRY[0];
  const pool = REGISTRY.filter(d => d.id !== lastId);
  return pool[Math.floor(Math.random() * pool.length)];
}
