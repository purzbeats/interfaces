import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import passthroughVert from '../shaders/passthrough.vert';

const flickerFrag = `
uniform sampler2D tDiffuse;
uniform float intensity;
uniform float time;
varying vec2 vUv;

float rand(float n) {
  return fract(sin(n * 12.9898) * 43758.5453);
}

void main() {
  vec4 color = texture2D(tDiffuse, vUv);
  float flicker = 1.0 - rand(floor(time * 15.0)) * intensity;
  color.rgb *= flicker;
  gl_FragColor = color;
}
`;

export function createFlickerPass(intensity: number): ShaderPass {
  return new ShaderPass({
    uniforms: {
      tDiffuse: { value: null },
      intensity: { value: intensity },
      time: { value: 0 },
    },
    vertexShader: passthroughVert,
    fragmentShader: flickerFrag,
  });
}
