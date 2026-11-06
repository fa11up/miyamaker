/**
 * Desktop wave, GLSL ES 1.00 (WebGL 1: runs everywhere WebGL does, Safari/iOS included).
 *
 * The voronoi "fish scale" water is the original miyaOS shader (webgl.ts), trimmed of the sky and
 * sun code that always returned black. Two changes that matter:
 *  1. The output is opaque (alpha 1). The old shader wrote `vec4(color, 0)`: a non-zero colour with
 *     zero alpha is not a valid premultiplied pixel, so compositors disagree about it. Chrome and
 *     Firefox add it to the page (the faint glow everyone saw), WebKit/Safari drops it, so the wave
 *     never showed there. The glow is now done explicitly with CSS `mix-blend-mode: plus-lighter`
 *     (additive) on an opaque canvas, and the old `opacity: 0.1` lives in `uGain`.
 *  2. A surfable crest: `crest()` is the same formula as crestHeight() in surface.ts.
 *
 * Precision is chosen at runtime (highp when the fragment shader supports it).
 */

export const WAVE_VS = `
attribute vec2 aPos;
void main() {
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`

export const waveFs = (precision: 'highp' | 'mediump') => `
precision ${precision} float;

#define PI 3.1415926535
#define TAU 6.2831853072
#define STEPS 15

uniform float uTime;
uniform vec2 uResolution;   // drawing buffer, px
uniform float uScale;       // drawing-buffer px per CSS px
uniform float uGain;        // brightness of the water field (was the canvas opacity)
uniform vec4 uCrestA;       // base, a1, l1, w1
uniform vec4 uCrestB;       // a2, l2, w2, -

mat2 rot(float a) {
  float c = cos(a);
  float s = sin(a);
  return mat2(c, s, -s, c);
}

float noise(vec2 p) {
  p *= rot(1.941611);
  return sin(p.x) * 0.25 + sin(p.y) * 0.25 + 0.5;
}

// the two closest voronoi points, projected height in z
void grid(vec2 p, inout vec3 projClosest, inout vec3 projSecondClosest) {
  vec2 center = floor(p) + 0.5;
  vec2 secondBestCenter = center;
  float secondBestDist = 99999.9;
  vec2 bestCenter = center;
  float bestDist = 99999.9;
  for (int y = -1; y <= 1; y++)
  for (int x = -1; x <= 1; x++) {
    vec2 currentCenter = center + vec2(float(x), float(y));
    currentCenter.x += noise(uTime * vec2(0.5124, 0.5894) + currentCenter * vec2(1.3124, 1.7894)) - 0.5;
    currentCenter.y += noise(uTime * vec2(0.5565, 0.5561) - currentCenter * vec2(1.5124, 1.6053)) - 0.5;
    vec2 delta = p - currentCenter;
    float currentDist = dot(delta, delta) * 0.5;
    float if1 = step(currentDist, bestDist);
    float if1m = 1.0 - if1;
    secondBestCenter = if1 * bestCenter + if1m * secondBestCenter;
    secondBestDist = if1 * bestDist + if1m * secondBestDist;
    bestCenter = if1 * currentCenter + if1m * bestCenter;
    bestDist = if1 * currentDist + if1m * bestDist;
    float if2 = step(currentDist, secondBestDist) * if1m;
    float if2m = 1.0 - if2;
    secondBestCenter = if2 * currentCenter + if2m * secondBestCenter;
    secondBestDist = if2 * currentDist + if2m * secondBestDist;
  }
  projClosest = vec3(bestCenter, bestDist);
  projSecondClosest = vec3(secondBestCenter, secondBestDist);
}

float de(vec3 p, inout vec3 projClosest, inout vec3 projSecondClosest) {
  grid(p.xy, projClosest, projSecondClosest);
  float below = 0.0;
  below -= sin(dot(p.xy, vec2(0.005, 0.051)) * 4.0 + uTime * 0.5) * 0.4 + 0.2;
  below -= 1.0 - projClosest.z;
  return max(0.0, p.z - below);
}

// cyan, darker towards the voronoi cell edges, with a screen-space scanline
vec3 waveColor(vec3 projClosest, vec3 projSecondClosest, float dist, vec2 frag) {
  float distanceToEdge = abs(projClosest.z - projSecondClosest.z);
  float distanceFrac = smoothstep(-10.0, 100.0, dist);
  distanceFrac *= distanceFrac;
  distanceFrac *= distanceFrac;
  float frac = smoothstep(0.0, 0.1 + distanceFrac * 0.9, distanceToEdge);
  frac *= (sin(frag.y / uResolution.y * 700.0) * 0.5 + 0.5) * (1.0 - distanceFrac);
  return vec3(0.43, 0.77, 0.85) * (1.0 - frac);
}

float crest(float x) {
  return uCrestA.x
    + uCrestA.y * sin(TAU * x / uCrestA.z - uCrestA.w * uTime)
    + uCrestB.x * sin(TAU * x / uCrestB.y + uCrestB.z * uTime + 1.7);
}

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution.xy * 2.0 - 1.0;
  uv.y *= uResolution.y / uResolution.x;

  vec3 dir = normalize(vec3(uv.x * 0.6, 1.0, uv.y * -0.6));
  dir.xy *= rot(PI * 0.5);
  dir.xz *= rot(3.16 - (-4.15 * 1.5));

  vec3 color = vec3(0.0);
  if (dir.z <= 0.0) {
    float totdist = 0.0;
    for (int steps = 0; steps < STEPS; steps++) {
      vec3 p = totdist * dir;
      vec3 projClosest = vec3(0.0);
      vec3 projSecondClosest = vec3(0.0);
      p.x -= uTime * 1.5;
      float dist = de(p, projClosest, projSecondClosest);
      totdist += dist;
      if (dist < 0.01 || steps == STEPS - 1) {
        color = waveColor(projClosest, projSecondClosest, totdist, gl_FragCoord.xy);
        break;
      }
    }
  }
  color *= uGain;

  // the crest the pet surfs on: a soft glow under it, faint y2k scanlines in the swell
  vec2 css = gl_FragCoord.xy / uScale;
  float d = css.y - crest(css.x);
  float under = (1.0 - step(0.0, d)) * (1.0 - smoothstep(0.0, 110.0, -d));
  float lines = step(0.5, fract(css.y / 5.0));
  color += vec3(0.62, 0.86, 0.96) * under * (0.035 + 0.035 * lines);

  gl_FragColor = vec4(color, 1.0);
}
`
