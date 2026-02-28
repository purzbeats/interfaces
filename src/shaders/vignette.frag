uniform sampler2D tDiffuse;
uniform float intensity;
varying vec2 vUv;

void main() {
  vec4 color = texture2D(tDiffuse, vUv);

  // Smooth circular vignette with proper falloff
  vec2 center = vUv - 0.5;
  float dist = length(center) * 1.4; // scale so corners hit ~1.0
  float vignette = 1.0 - smoothstep(0.4, 1.1, dist * intensity);

  color.rgb *= max(vignette, 0.0);
  gl_FragColor = color;
}
