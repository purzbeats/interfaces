import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import type { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import type { Config } from '../config';
import { createBloomPass } from './bloom-pass';
import { createChromaticPass } from './chromatic-pass';
import { createCRTPass } from './crt-pass';
import { createVignettePass } from './vignette-pass';
import { createNoisePass } from './noise-pass';
import { createFlickerPass } from './flicker-pass';

export interface PostFXPipeline {
  composer: EffectComposer;
  bloomPass: UnrealBloomPass;
  chromaticPass: ShaderPass;
  crtPass: ShaderPass;
  vignettePass: ShaderPass;
  noisePass: ShaderPass;
  flickerPass: ShaderPass;
  update(time: number, config: Config): void;
  resize(width: number, height: number): void;
}

export function createPostFXPipeline(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  config: Config
): PostFXPipeline {
  const { width, height } = config;
  const pfx = config.postfx;

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));

  const bloomPass = createBloomPass(width, height, pfx.bloomStrength, pfx.bloomRadius, pfx.bloomThreshold);
  bloomPass.enabled = pfx.bloom;
  composer.addPass(bloomPass);

  const chromaticPass = createChromaticPass(width, height, pfx.chromaticIntensity);
  chromaticPass.enabled = pfx.chromatic;
  composer.addPass(chromaticPass);

  const crtPass = createCRTPass(width, height, pfx.crtIntensity);
  crtPass.enabled = pfx.crt;
  composer.addPass(crtPass);

  const vignettePass = createVignettePass(pfx.vignetteIntensity);
  vignettePass.enabled = pfx.vignette;
  composer.addPass(vignettePass);

  const noisePass = createNoisePass(pfx.noiseIntensity);
  noisePass.enabled = pfx.noise;
  composer.addPass(noisePass);

  const flickerPass = createFlickerPass(pfx.flickerIntensity);
  flickerPass.enabled = pfx.flicker;
  composer.addPass(flickerPass);

  return {
    composer,
    bloomPass,
    chromaticPass,
    crtPass,
    vignettePass,
    noisePass,
    flickerPass,

    update(time: number, cfg: Config) {
      // Update time-dependent uniforms
      if (crtPass.uniforms['time']) crtPass.uniforms['time'].value = time;
      if (noisePass.uniforms['time']) noisePass.uniforms['time'].value = time;
      if (flickerPass.uniforms['time']) flickerPass.uniforms['time'].value = time;

      // Sync config
      const p = cfg.postfx;
      bloomPass.enabled = p.bloom;
      bloomPass.strength = p.bloomStrength;
      bloomPass.radius = p.bloomRadius;
      bloomPass.threshold = p.bloomThreshold;

      chromaticPass.enabled = p.chromatic;
      if (chromaticPass.uniforms['intensity']) chromaticPass.uniforms['intensity'].value = p.chromaticIntensity;

      crtPass.enabled = p.crt;
      if (crtPass.uniforms['intensity']) crtPass.uniforms['intensity'].value = p.crtIntensity;

      vignettePass.enabled = p.vignette;
      if (vignettePass.uniforms['intensity']) vignettePass.uniforms['intensity'].value = p.vignetteIntensity;

      noisePass.enabled = p.noise;
      if (noisePass.uniforms['intensity']) noisePass.uniforms['intensity'].value = p.noiseIntensity;

      flickerPass.enabled = p.flicker;
      if (flickerPass.uniforms['intensity']) flickerPass.uniforms['intensity'].value = p.flickerIntensity;
    },

    resize(w: number, h: number) {
      composer.setSize(w, h);
      if (crtPass.uniforms['resolution']) {
        crtPass.uniforms['resolution'].value.set(w, h);
      }
      if (chromaticPass.uniforms['resolution']) {
        chromaticPass.uniforms['resolution'].value.set(w, h);
      }
    },
  };
}
