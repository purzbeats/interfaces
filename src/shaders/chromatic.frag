uniform sampler2D tDiffuse;
uniform float intensity;
uniform vec2 resolution;
varying vec2 vUv;

void main() {
  // Radial chromatic aberration — offset increases toward edges
  vec2 center = vUv - 0.5;
  float dist = length(center);
  vec2 dir = normalize(center + 0.0001); // avoid div by zero

  // Three-channel split with radial direction
  float offsetR = intensity * dist * 3.0 / resolution.x;
  float offsetB = intensity * dist * 3.0 / resolution.x;

  float r = texture2D(tDiffuse, vUv + dir * offsetR).r;
  float g = texture2D(tDiffuse, vUv).g;
  float b = texture2D(tDiffuse, vUv - dir * offsetB).b;

  gl_FragColor = vec4(r, g, b, 1.0);
}
