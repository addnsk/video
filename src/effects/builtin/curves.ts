import type { FilterDef } from '../types';
import { FLAT_CURVE, IDENTITY_CURVE } from '../curves';

export const CURVES: FilterDef = {
  kind: 'filter',
  id: 'curves',
  name: 'Curves',
  stage: 20,
  params: [
    { name: 'master', label: 'Master', type: 'curve', default: IDENTITY_CURVE },
    { name: 'red', label: 'Red', type: 'curve', default: IDENTITY_CURVE },
    { name: 'green', label: 'Green', type: 'curve', default: IDENTITY_CURVE },
    { name: 'blue', label: 'Blue', type: 'curve', default: IDENTITY_CURVE },
    { name: 'hueSat', label: 'Hue vs Sat', type: 'curve', default: FLAT_CURVE, periodic: true },
    { name: 'hueHue', label: 'Hue vs Hue', type: 'curve', default: FLAT_CURVE, periodic: true },
    { name: 'hueLum', label: 'Hue vs Lum', type: 'curve', default: FLAT_CURVE, periodic: true },
    { name: 'lumSat', label: 'Lum vs Sat', type: 'curve', default: FLAT_CURVE },
    { name: 'satSat', label: 'Sat vs Sat', type: 'curve', default: IDENTITY_CURVE },
  ],
  glsl: `
const vec3 CURVE_LUMA = vec3(0.2126, 0.7152, 0.0722);

float hueOf(vec3 c) {
  float hi = max(c.r, max(c.g, c.b));
  float lo = min(c.r, min(c.g, c.b));
  float d = hi - lo;
  if (d < 1e-5) return 0.0;
  float h = hi == c.r ? mod((c.g - c.b) / d, 6.0) : hi == c.g ? (c.b - c.r) / d + 2.0 : (c.r - c.g) / d + 4.0;
  return h / 6.0;
}

vec3 hsvOf(vec3 c) {
  float hi = max(c.r, max(c.g, c.b));
  float lo = min(c.r, min(c.g, c.b));
  return vec3(hueOf(c), hi > 1e-5 ? (hi - lo) / hi : 0.0, hi);
}

vec3 rgbOf(vec3 hsv) {
  vec3 k = clamp(abs(mod(hsv.x * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
  return hsv.z * mix(vec3(1.0), k, hsv.y);
}

vec4 effect(vec4 color, vec2 uv) {
  vec3 c = color.rgb;
  c = vec3(curve(master, c.r), curve(master, c.g), curve(master, c.b));
  c = vec3(curve(red, c.r), curve(green, c.g), curve(blue, c.b));
  vec3 hsv = hsvOf(max(c, 0.0));
  float hue = hsv.x;
  float shift = curve(hueHue, hue) - 0.5;
  float satScale = curve(hueSat, hue) * 2.0 * curve(lumSat, dot(c, CURVE_LUMA)) * 2.0;
  float lumScale = exp2((curve(hueLum, hue) - 0.5) * 2.0 * hsv.y);
  float sat = clamp(curve(satSat, hsv.y), 0.0, 1.0);
  if (abs(shift) > 1e-4 || abs(sat - hsv.y) > 1e-4) c = rgbOf(vec3(fract(hue + shift), sat, hsv.z));
  c *= lumScale;
  c = mix(vec3(dot(c, CURVE_LUMA)), c, satScale);
  return vec4(c, color.a);
}
`,
};
