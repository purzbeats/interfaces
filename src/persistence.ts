import type { Config } from './config';

const STORAGE_KEY = 'interfaces-config-v2';

/** Load persisted config from localStorage (partial — only safe keys) */
export function loadConfig(): Partial<Config> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const data = JSON.parse(raw);
    // Only restore known safe keys
    const result: Partial<Config> = {};
    if (typeof data.seed === 'number') result.seed = data.seed;
    if (typeof data.palette === 'string') result.palette = data.palette;
    if (typeof data.template === 'string') result.template = data.template;
    if (data.postfx && typeof data.postfx === 'object') {
      result.postfx = data.postfx;
    }
    if (data.timeline && typeof data.timeline === 'object') {
      result.timeline = data.timeline;
    }
    return result;
  } catch {
    return {};
  }
}

/** Save current config to localStorage */
export function saveConfig(config: Config): void {
  try {
    const toSave = {
      seed: config.seed,
      palette: config.palette,
      template: config.template,
      postfx: config.postfx,
      timeline: config.timeline,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
  } catch {
    // Storage full or unavailable — silently ignore
  }
}

/** Update URL with shareable seed params (without page reload) */
export function updateURL(config: Config): void {
  const url = new URL(window.location.href);
  url.searchParams.set('seed', String(config.seed));
  url.searchParams.set('palette', config.palette);
  url.searchParams.set('template', config.template);
  window.history.replaceState({}, '', url.toString());
}
