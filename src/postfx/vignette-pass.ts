import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import vignetteFrag from '../shaders/vignette.frag';
import passthroughVert from '../shaders/passthrough.vert';

export function createVignettePass(intensity: number): ShaderPass {
  return new ShaderPass({
    uniforms: {
      tDiffuse: { value: null },
      intensity: { value: intensity },
    },
    vertexShader: passthroughVert,
    fragmentShader: vignetteFrag,
  });
}
