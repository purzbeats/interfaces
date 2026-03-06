export type AspectRatio = 'fill' | '1:1' | '4:3' | '3:2' | '16:9' | '16:10' | '21:9' | '9:16' | '2:3' | '3:4';

export const ASPECT_RATIOS: AspectRatio[] = [
  'fill', '1:1', '4:3', '3:2', '16:9', '16:10', '21:9', '9:16', '2:3', '3:4',
];

/** Parse aspect ratio string to numeric value (w/h). Returns 0 for 'fill'. */
export function aspectToNumber(aspect: AspectRatio): number {
  if (aspect === 'fill') return 0;
  const [w, h] = aspect.split(':').map(Number);
  return w / h;
}

/**
 * Compute canvas width/height that fits the given aspect ratio
 * within the available window dimensions, centered.
 */
export function computeAspectSize(
  aspect: AspectRatio,
  windowW: number,
  windowH: number
): { width: number; height: number; offsetX: number; offsetY: number } {
  // Clamp to minimum to prevent crashes when overscan exceeds window size
  const safeW = Math.max(windowW, 64);
  const safeH = Math.max(windowH, 64);
  if (aspect === 'fill') {
    return { width: safeW, height: safeH, offsetX: 0, offsetY: 0 };
  }
  const ratio = aspectToNumber(aspect);
  let w: number, h: number;
  if (safeW / safeH > ratio) {
    h = safeH;
    w = Math.round(h * ratio);
  } else {
    w = safeW;
    h = Math.round(w / ratio);
  }
  return {
    width: Math.max(w, 64),
    height: Math.max(h, 64),
    offsetX: Math.round((windowW - w) / 2),
    offsetY: Math.round((windowH - h) / 2),
  };
}

export interface Config {
  seed: number;
  width: number;
  height: number;
  aspectRatio: AspectRatio;
  palette: string;
  template: string;
  timeline: {
    bootDuration: number;
    mainDuration: number;
    alertDuration: number;
    cooldownDuration: number;
  };
  postfx: {
    bloom: boolean;
    bloomStrength: number;
    bloomRadius: number;
    bloomThreshold: number;
    crt: boolean;
    crtIntensity: number;
    chromatic: boolean;
    chromaticIntensity: number;
    vignette: boolean;
    vignetteIntensity: number;
    noise: boolean;
    noiseIntensity: number;
    flicker: boolean;
    flickerIntensity: number;
  };
  dividerBrightness: number;
  dividerThickness: number;
  overscanPadding: number;
  overscanX: number;
  overscanY: number;
  audioReactive: {
    flicker: boolean;
    jiggle: boolean;
    gain: number;
    smoothing: number;
    kickThreshold: number;
    bassWeight: number;
    midWeight: number;
    highWeight: number;
  };
  hexLayout: boolean;
  rollingSwap: boolean;
  rollingInterval: number;
  export: {
    fps: number;
    duration: number;
  };
}

export const DEFAULT_CONFIG: Config = {
  seed: 42,
  width: window.innerWidth,
  height: window.innerHeight,
  aspectRatio: 'fill' as AspectRatio,
  palette: 'phosphor-green',
  template: 'auto',
  timeline: {
    bootDuration: 3,
    mainDuration: 17,
    alertDuration: 5,
    cooldownDuration: 5,
  },
  postfx: {
    bloom: true,
    bloomStrength: 0.65,
    bloomRadius: 1,
    bloomThreshold: 0.1,
    crt: false,
    crtIntensity: 0.5,
    chromatic: true,
    chromaticIntensity: 0.3,
    vignette: true,
    vignetteIntensity: 0.6,
    noise: true,
    noiseIntensity: 0.08,
    flicker: true,
    flickerIntensity: 0.03,
  },
  dividerBrightness: 3,
  dividerThickness: 1,
  overscanPadding: 0,
  overscanX: 0,
  overscanY: 0,
  audioReactive: {
    flicker: true,
    jiggle: true,
    gain: 1.0,
    smoothing: 0.3,
    kickThreshold: 1.0,
    bassWeight: 1.0,
    midWeight: 1.0,
    highWeight: 1.0,
  },
  hexLayout: false,
  rollingSwap: true,
  rollingInterval: 5,
  export: {
    fps: 60,
    duration: 30,
  },
};
