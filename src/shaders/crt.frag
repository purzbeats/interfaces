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

// Pseudo-random for tearing
float hash(float n) {
  return fract(sin(n * 127.1) * 43758.5453);
}

void main() {
  // Apply barrel distortion
  vec2 uv = barrelDistort(vUv, intensity * 0.25);

  // Soft edge fade with curvature falloff
  float edgeFade = smoothstep(0.0, 0.02, uv.x) * smoothstep(1.0, 0.98, uv.x)
                 * smoothstep(0.0, 0.02, uv.y) * smoothstep(1.0, 0.98, uv.y);

  // Corner darkening — CRT brightness falls off toward corners
  vec2 corner = abs(uv - 0.5) * 2.0;
  float cornerDark = 1.0 - dot(corner * corner, corner * corner) * intensity * 0.08;

  if (edgeFade <= 0.0) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }

  // Horizontal tearing — occasional displaced scanline bands
  float tearSeed = floor(time * 3.0);
  float tearY = hash(tearSeed) * 0.8 + 0.1;
  float tearH = hash(tearSeed + 7.0) * 0.03;
  float tearOffset = (hash(tearSeed + 13.0) - 0.5) * intensity * 0.008;
  if (uv.y > tearY && uv.y < tearY + tearH) {
    uv.x += tearOffset;
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

  // Interlacing — alternate even/odd field every other frame
  float field = mod(floor(time * 30.0), 2.0);
  float row = mod(floor(py), 2.0);
  float interlace = 1.0 - step(field, row) * intensity * 0.06;
  color.rgb *= interlace;

  // Scanlines — every other row dims slightly
  float scanline = sin(py * 3.14159) * 0.5 + 0.5;
  scanline = 1.0 - pow(1.0 - scanline, 2.5) * intensity * 0.25;
  color.rgb *= scanline;

  // Horizontal beam interference — subtle rolling band
  float beam = sin(uv.y * 6.0 - time * 1.5) * 0.5 + 0.5;
  beam = 1.0 - beam * intensity * 0.04;
  color.rgb *= beam;

  // Phosphor persistence / glow boost with slight bloom on bright areas
  float lum = dot(color.rgb, vec3(0.299, 0.587, 0.114));
  float glow = 1.0 + intensity * 0.08 + lum * intensity * 0.04;
  color.rgb *= glow;

  // Apply edge fade + corner darkening
  color.rgb *= edgeFade * cornerDark;

  gl_FragColor = color;
}
