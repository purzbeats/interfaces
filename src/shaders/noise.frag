uniform sampler2D tDiffuse;
uniform float intensity;
uniform float time;
varying vec2 vUv;

// Better noise with some temporal coherence
float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec4 color = texture2D(tDiffuse, vUv);

  // Temporal dithering — mix two noise frames for smoother grain
  float t = floor(time * 24.0); // lock to 24fps noise rate
  float n1 = hash(vUv * 800.0 + t);
  float n2 = hash(vUv * 800.0 + t + 1.0);
  float blend = fract(time * 24.0);
  float noise = mix(n1, n2, blend) * 2.0 - 1.0;

  // Slight luminance-dependent grain (brighter areas get less noise)
  float lum = dot(color.rgb, vec3(0.299, 0.587, 0.114));
  float strength = intensity * (1.0 - lum * 0.5);

  color.rgb += noise * strength;
  gl_FragColor = color;
}
