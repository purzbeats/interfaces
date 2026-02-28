import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import * as THREE from 'three';
import crtFrag from '../shaders/crt.frag';
import passthroughVert from '../shaders/passthrough.vert';

export function createCRTPass(width: number, height: number, intensity: number): ShaderPass {
  return new ShaderPass({
    uniforms: {
      tDiffuse: { value: null },
      intensity: { value: intensity },
      resolution: { value: new THREE.Vector2(width, height) },
      time: { value: 0 },
    },
    vertexShader: passthroughVert,
    fragmentShader: crtFrag,
  });
}
