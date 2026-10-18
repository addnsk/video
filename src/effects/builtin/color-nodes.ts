import type { FilterDef, NodeDef, ParamSpec } from '../types';

const float = (name: string, label: string, value: number, min: number, max: number, step = 0.01): ParamSpec => ({ name, label, type: 'float', default: value, min, max, step });
const color = (name: string, label: string, value: [number, number, number, number]): ParamSpec => ({ name, label, type: 'color', default: value });
const bool = (name: string, label: string, value: boolean): ParamSpec => ({ name, label, type: 'bool', default: value });
const zone = (name: string, label: string): ParamSpec => ({ name, label, type: 'vec3', default: [0, 0, 0], min: -1, max: 1, step: 0.005 });
const SOURCE = [{ name: 'source', label: 'Input' }];

const HSV = `
vec3 toHsv(vec3 c) {
  float hi = max(c.r, max(c.g, c.b));
  float lo = min(c.r, min(c.g, c.b));
  float d = hi - lo;
  float h = 0.0;
  if (d > 1e-5) h = (hi == c.r ? mod((c.g - c.b) / d, 6.0) : hi == c.g ? (c.b - c.r) / d + 2.0 : (c.r - c.g) / d + 4.0) / 6.0;
  return vec3(h, hi > 1e-5 ? d / hi : 0.0, hi);
}
vec3 fromHsv(vec3 hsv) {
  vec3 k = clamp(abs(mod(hsv.x * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
  return hsv.z * mix(vec3(1.0), k, hsv.y);
}
float hueDistance(float a, float b) {
  float d = abs(a - b);
  return min(d, 1.0 - d);
}`;

const OKLAB = `
vec3 toOklab(vec3 c) {
  c = max(c, 0.0);
  vec3 lms = mat3(0.4122214708, 0.2119034982, 0.0883024619, 0.5363325363, 0.6806995451, 0.2817188376, 0.0514459929, 0.1073969566, 0.6299787005) * c;
  lms = pow(lms, vec3(1.0 / 3.0));
  return mat3(0.2104542553, 1.9779984951, 0.0259040371, 0.7936177850, -2.4285922050, 0.7827717662, -0.0040720468, 0.4505937099, -0.8086757660) * lms;
}`;

export const HSL_QUALIFIER: NodeDef = {
  kind: 'node',
  id: 'qualifier',
  name: 'HSL qualifier',
  category: 'color',
  inputs: SOURCE,
  params: [
    bool('useHue', 'Use hue', true),
    float('hueCenter', 'Hue center', 0, 0, 1, 0.005),
    float('hueWidth', 'Hue width', 0.08, 0, 0.5, 0.005),
    float('hueSoft', 'Hue softness', 0.04, 0, 0.5, 0.005),
    bool('useSat', 'Use saturation', true),
    float('satLow', 'Saturation low', 0.15, 0, 1),
    float('satHigh', 'Saturation high', 1, 0, 1),
    float('satSoft', 'Saturation softness', 0.05, 0, 0.5, 0.005),
    bool('useLum', 'Use luminance', false),
    float('lumLow', 'Luminance low', 0, 0, 1),
    float('lumHigh', 'Luminance high', 1, 0, 1),
    float('lumSoft', 'Luminance softness', 0.05, 0, 0.5, 0.005),
    bool('invert', 'Invert', false),
  ],
  passes: [
    {
      glsl: `${HSV}
float band(float v, float lo, float hi, float soft) {
  float s = max(soft, 1e-4);
  return smoothstep(lo - s, lo, v) * (1.0 - smoothstep(hi, hi + s, v));
}
vec4 process(vec2 uv) {
  vec4 c = input_source(uv);
  vec3 hsv = toHsv(clamp(c.rgb, 0.0, 1.0));
  float m = 1.0;
  if (useHue) m *= 1.0 - smoothstep(hueWidth, hueWidth + max(hueSoft, 1e-4), hueDistance(hsv.x, hueCenter));
  if (useSat) m *= band(hsv.y, satLow, satHigh, satSoft);
  if (useLum) m *= band(dot(c.rgb, vec3(0.2126, 0.7152, 0.0722)), lumLow, lumHigh, lumSoft);
  if (invert) m = 1.0 - m;
  return vec4(m * c.a);
}`,
    },
  ],
};

export const QUALIFIER_3D: NodeDef = {
  kind: 'node',
  id: 'qualifier-3d',
  name: '3D qualifier',
  category: 'color',
  inputs: SOURCE,
  params: [
    color('key1', 'Color 1', [0.8, 0.2, 0.2, 1]),
    color('key2', 'Color 2', [0, 0, 0, 0]),
    color('key3', 'Color 3', [0, 0, 0, 0]),
    float('tolerance', 'Tolerance', 0.1, 0, 1, 0.005),
    float('softness', 'Softness', 0.05, 0, 1, 0.005),
    bool('ignoreLuma', 'Ignore luminance', true),
    bool('invert', 'Invert', false),
  ],
  passes: [
    {
      glsl: `${OKLAB}
float keyDistance(vec3 p, vec4 key) {
  if (key.a <= 0.0) return 1e3;
  vec3 k = toOklab(key.rgb);
  vec3 d = p - k;
  if (ignoreLuma) d.x *= 0.25;
  return length(d);
}
vec4 process(vec2 uv) {
  vec4 c = input_source(uv);
  vec3 p = toOklab(c.rgb);
  float d = min(keyDistance(p, key1), min(keyDistance(p, key2), keyDistance(p, key3)));
  float m = 1.0 - smoothstep(tolerance, tolerance + max(softness, 1e-4), d);
  if (invert) m = 1.0 - m;
  return vec4(m * c.a);
}`,
    },
  ],
};

export const PARALLEL_MIXER: NodeDef = {
  kind: 'node',
  id: 'parallel-mixer',
  name: 'Parallel mixer',
  category: 'color',
  inputs: [{ name: 'a', label: 'Input 1' }, { name: 'b', label: 'Input 2' }, { name: 'c', label: 'Input 3' }, { name: 'd', label: 'Input 4' }],
  params: [float('weightA', 'Weight 1', 1, 0, 1), float('weightB', 'Weight 2', 1, 0, 1), float('weightC', 'Weight 3', 1, 0, 1), float('weightD', 'Weight 4', 1, 0, 1)],
  passes: [
    {
      glsl: `
vec4 process(vec2 uv) {
  vec4 sum = vec4(0.0);
  float total = 0.0;
  if (has_a()) { sum += input_a(uv) * weightA; total += weightA; }
  if (has_b()) { sum += input_b(uv) * weightB; total += weightB; }
  if (has_c()) { sum += input_c(uv) * weightC; total += weightC; }
  if (has_d()) { sum += input_d(uv) * weightD; total += weightD; }
  return total > 0.0 ? sum / total : vec4(0.0);
}`,
    },
  ],
};

export const HDR_WHEELS: FilterDef = {
  kind: 'filter',
  id: 'hdr-wheels',
  name: 'HDR wheels',
  stage: 12,
  params: [
    zone('dark', 'Dark'),
    zone('shadow', 'Shadow'),
    zone('light', 'Light'),
    zone('highlight', 'Highlight'),
    zone('global', 'Global'),
    float('darkPoint', 'Dark range (stops)', -4, -8, 0, 0.1),
    float('highlightPoint', 'Highlight range (stops)', 2.5, 0, 8, 0.1),
    float('falloff', 'Falloff', 1.5, 0.2, 4, 0.05),
    float('saturation', 'Saturation', 1, 0, 2),
  ],
  glsl: `
const vec3 HDR_LUMA = vec3(0.2126, 0.7152, 0.0722);
vec3 zoneShift(vec3 w) {
  vec3 tint = vec3(w.x, -0.5 * w.x - 0.8660254 * w.y, -0.5 * w.x + 0.8660254 * w.y);
  return tint + w.z * 2.0;
}
vec4 effect(vec4 color, vec2 uv) {
  vec3 c = max(toWorkingLinear(color.rgb), 0.0);
  float ev = log2(max(dot(c, HDR_LUMA), 1e-6) / 0.18);
  float f = max(falloff, 0.2);
  float wDark = 1.0 - smoothstep(darkPoint - f, darkPoint + f, ev);
  float wHighlight = smoothstep(highlightPoint - f, highlightPoint + f, ev);
  float mid = (darkPoint + highlightPoint) * 0.5;
  float wShadow = (1.0 - smoothstep(mid - f, mid + f, ev)) * (1.0 - wDark);
  float wLight = smoothstep(mid - f, mid + f, ev) * (1.0 - wHighlight);
  vec3 stops = zoneShift(dark) * wDark + zoneShift(shadow) * wShadow + zoneShift(light) * wLight + zoneShift(highlight) * wHighlight + zoneShift(global);
  c *= exp2(stops);
  c = mix(vec3(dot(c, HDR_LUMA)), c, saturation);
  return vec4(fromWorkingLinear(c), color.a);
}
`,
};

const HUES = ['red', 'yellow', 'green', 'cyan', 'blue', 'magenta'] as const;

export const COLOR_WARPER: FilterDef = {
  kind: 'filter',
  id: 'color-warper',
  name: 'Color warper',
  stage: 22,
  params: [
    ...HUES.map((hue): ParamSpec => ({ name: hue, label: `${hue[0].toUpperCase()}${hue.slice(1)} (hue, sat, lum)`, type: 'vec3', default: [0, 0, 0], min: -1, max: 1, step: 0.01 })),
    float('width', 'Range width', 1, 0.3, 2, 0.05),
  ],
  glsl: `${HSV}
vec4 effect(vec4 color, vec2 uv) {
  vec3 c = max(color.rgb, 0.0);
  vec3 hsv = toHsv(min(c, vec3(1.0)));
  float scale = max(c.r, max(c.g, c.b)) > 1.0 ? max(c.r, max(c.g, c.b)) : 1.0;
  vec3 controls[6] = vec3[6](red, yellow, green, cyan, blue, magenta);
  vec3 sum = vec3(0.0);
  for (int i = 0; i < 6; i++) {
    float w = max(0.0, 1.0 - hueDistance(hsv.x, float(i) / 6.0) * 6.0 / width);
    sum += controls[i] * w;
  }
  float amount = smoothstep(0.0, 0.15, hsv.y);
  vec3 warped = vec3(fract(hsv.x + sum.x / 6.0 * amount), clamp(hsv.y * (1.0 + sum.y * amount), 0.0, 1.0), hsv.z * exp2(sum.z * amount));
  return vec4(fromHsv(warped) * scale, color.a);
}
`,
};

export const COLOR_NODES: readonly NodeDef[] = [HSL_QUALIFIER, QUALIFIER_3D, PARALLEL_MIXER];
export const COLOR_FILTERS: readonly FilterDef[] = [HDR_WHEELS, COLOR_WARPER];
