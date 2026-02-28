import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import noiseFrag from '../shaders/noise.frag';
import passthroughVert from '../shaders/passthrough.vert';

export function createNoisePass(intensity: number): ShaderPass {
  return new ShaderPass({
    uniforms: {
      tDiffuse: { value: null },
      intensity: { value: intensity },
      time: { value: 0 },
    },
    vertexShader: passthroughVert,
    fragmentShader: noiseFrag,
  });
}
