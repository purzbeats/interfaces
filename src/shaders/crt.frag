uniform sampler2D tDiffuse;
uniform float intensity;
uniform vec2 resolution;
uniform float time;
varying vec2 vUv;

// Barrel distortion
vec2 barrelDistort(vec2 uv, float amt) {
  vec2 cc = uv - 0.5;
  float dist = dot(cc, cc);
  return uv + cc * dist * amt;
}

void main() {
  // Apply barrel distortion
  vec2 uv = barrelDistort(vUv, intensity * 0.25);

  // Soft edge fade instead of hard cutoff
  float edgeFade = smoothstep(0.0, 0.02, uv.x) * smoothstep(1.0, 0.98, uv.x)
                 * smoothstep(0.0, 0.02, uv.y) * smoothstep(1.0, 0.98, uv.y);

  if (edgeFade <= 0.0) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }

  vec4 color = texture2D(tDiffuse, uv);

  // RGB phosphor sub-pixel pattern (simulate CRT shadow mask)
  float px = uv.x * resolution.x;
  float py = uv.y * resolution.y;
  float subPixel = mod(px, 3.0);
  vec3 mask = vec3(1.0);
  float maskStr = intensity * 0.15;
  if (subPixel < 1.0)      mask = vec3(1.0, 1.0 - maskStr, 1.0 - maskStr);
  else if (subPixel < 2.0) mask = vec3(1.0 - maskStr, 1.0, 1.0 - maskStr);
  else                      mask = vec3(1.0 - maskStr, 1.0 - maskStr, 1.0);
  color.rgb *= mask;

  // Scanlines — every other row dims slightly
  float scanline = sin(py * 3.14159) * 0.5 + 0.5;
  scanline = 1.0 - pow(1.0 - scanline, 2.5) * intensity * 0.25;
  color.rgb *= scanline;

  // Horizontal beam interference — subtle rolling band
  float beam = sin(uv.y * 6.0 - time * 1.5) * 0.5 + 0.5;
  beam = 1.0 - beam * intensity * 0.04;
  color.rgb *= beam;

  // Phosphor persistence / glow boost
  color.rgb *= 1.0 + intensity * 0.08;

  // Apply edge fade
  color.rgb *= edgeFade;

  gl_FragColor = color;
}
