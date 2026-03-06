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
    if (typeof data.aspectRatio === 'string') result.aspectRatio = data.aspectRatio as Config['aspectRatio'];
    if (data.postfx && typeof data.postfx === 'object') {
      result.postfx = data.postfx;
    }
    if (data.timeline && typeof data.timeline === 'object') {
      result.timeline = data.timeline;
    }
    if (data.audioReactive && typeof data.audioReactive === 'object') {
      // Merge with defaults to handle missing fields from older saved configs
      result.audioReactive = {
        flicker: data.audioReactive.flicker ?? true,
        jiggle: data.audioReactive.jiggle ?? true,
        gain: data.audioReactive.gain ?? 1.0,
        smoothing: data.audioReactive.smoothing ?? 0.3,
        kickThreshold: data.audioReactive.kickThreshold ?? 1.0,
        bassWeight: data.audioReactive.bassWeight ?? 1.0,
        midWeight: data.audioReactive.midWeight ?? 1.0,
        highWeight: data.audioReactive.highWeight ?? 1.0,
        bloomPump: data.audioReactive.bloomPump ?? true,
        bloomPumpStrength: data.audioReactive.bloomPumpStrength ?? 1.0,
        chromaticKick: data.audioReactive.chromaticKick ?? true,
        cameraKick: data.audioReactive.cameraKick ?? true,
        cameraKickStrength: data.audioReactive.cameraKickStrength ?? 1.0,
      };
    }
    if (typeof data.rollingSwap === 'boolean') result.rollingSwap = data.rollingSwap;
    if (typeof data.rollingInterval === 'number') result.rollingInterval = data.rollingInterval;
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
      aspectRatio: config.aspectRatio,
      postfx: config.postfx,
      timeline: config.timeline,
      audioReactive: config.audioReactive,
      rollingSwap: config.rollingSwap,
      rollingInterval: config.rollingInterval,
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
