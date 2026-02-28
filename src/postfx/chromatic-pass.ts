import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import * as THREE from 'three';
import chromaticFrag from '../shaders/chromatic.frag';
import passthroughVert from '../shaders/passthrough.vert';

export function createChromaticPass(width: number, height: number, intensity: number): ShaderPass {
  return new ShaderPass({
    uniforms: {
      tDiffuse: { value: null },
      intensity: { value: intensity },
      resolution: { value: new THREE.Vector2(width, height) },
    },
    vertexShader: passthroughVert,
    fragmentShader: chromaticFrag,
  });
}
