export interface Config {
  seed: number;
  width: number;
  height: number;
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
  export: {
    fps: number;
    duration: number;
  };
}

export const DEFAULT_CONFIG: Config = {
  seed: 42,
  width: window.innerWidth,
  height: window.innerHeight,
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
  export: {
    fps: 60,
    duration: 30,
  },
};
