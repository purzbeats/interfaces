uniform sampler2D tDiffuse;
uniform float intensity;
uniform vec2 resolution;
varying vec2 vUv;

void main() {
  // Radial chromatic aberration — all 3 channels shift outward at different rates
  vec2 center = vUv - 0.5;
  float dist = length(center);
  vec2 dir = normalize(center + 0.0001); // avoid div by zero

  // Non-linear falloff — stronger toward edges
  float distSq = dist * dist;
  float scale = intensity * 3.0 / resolution.x;

  // Each channel has a different radial offset (R > G > B, like real glass)
  float offsetR = distSq * scale * 1.5;
  float offsetG = distSq * scale * 0.5;
  float offsetB = distSq * scale * -1.0;

  float r = texture2D(tDiffuse, vUv + dir * offsetR).r;
  float g = texture2D(tDiffuse, vUv + dir * offsetG).g;
  float b = texture2D(tDiffuse, vUv + dir * offsetB).b;

  gl_FragColor = vec4(r, g, b, 1.0);
}
