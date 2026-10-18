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

vec4 effect(vec4 color, vec2 uv) {
  vec3 c = clamp(color.rgb, 0.0, 1.0);
  c = vec3(curve(master, c.r), curve(master, c.g), curve(master, c.b));
  c = vec3(curve(red, c.r), curve(green, c.g), curve(blue, c.b));
  float sat = curve(hueSat, hueOf(c)) * 2.0;
  c = mix(vec3(dot(c, CURVE_LUMA)), c, sat);
  return vec4(c, color.a);
}
`,
};
