import type { FilterDef } from '../types';
import { BMD_WIDE_GAMUT_GEN5, REC709, gamutMatrix, glslMat3 } from '../colorspace';

const BMD_TO_REC709 = glslMat3(gamutMatrix(BMD_WIDE_GAMUT_GEN5, REC709));

const wheel = (name: string, label: string) =>
  ({ name, label, type: 'vec3', default: [0, 0, 0], min: -0.5, max: 0.5, step: 0.005 }) as const;

export const GRADE: FilterDef = {
  kind: 'filter',
  id: 'grade',
  name: 'Color',
  params: [
    {
      name: 'inputTransform',
      label: 'Input transform',
      type: 'enum',
      default: 'none',
      options: [
        { value: 'none', label: 'None (Rec.709)' },
        { value: 'bmdFilmGen5', label: 'Blackmagic Film Gen 5 → Rec.709' },
      ],
    },
    { name: 'exposure', label: 'Exposure', type: 'float', default: 0, min: -3, max: 3, step: 0.01 },
    { name: 'temperature', label: 'Temperature', type: 'float', default: 0, min: -1, max: 1, step: 0.01 },
    { name: 'tint', label: 'Tint', type: 'float', default: 0, min: -1, max: 1, step: 0.01 },
    { name: 'contrast', label: 'Contrast', type: 'float', default: 1, min: 0.5, max: 2, step: 0.01 },
    { name: 'pivot', label: 'Pivot', type: 'float', default: 0.435, min: 0, max: 1, step: 0.005 },
    { name: 'saturation', label: 'Saturation', type: 'float', default: 1, min: 0, max: 2, step: 0.01 },
    wheel('lift', 'Lift'),
    wheel('gamma', 'Gamma'),
    wheel('gain', 'Gain'),
  ],
  glsl: `
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
const mat3 BMD_GAMUT = ${BMD_TO_REC709};

vec3 bmdGen5Decode(vec3 x) {
  const float A = 0.08692876065491224;
  const float B = 0.005494072432257808;
  const float C = 0.5300133392291939;
  const float D = 8.283605932402494;
  const float E = 0.09246575342465753;
  const float CUT = D * 0.005 + E;
  return mix((x - E) / D, exp((x - C) / A) - B, step(CUT, x));
}

vec3 rec709Encode(vec3 l) {
  l = max(l, 0.0);
  return mix(4.5 * l, 1.099 * pow(l, vec3(0.45)) - 0.099, step(0.018, l));
}

vec3 bmdFilmToRec709(vec3 x) {
  vec3 l = max(BMD_GAMUT * bmdGen5Decode(x), 0.0);
  return rec709Encode(l / (l + 0.82));
}

vec3 wheelOffset(vec3 w) {
  float r = length(w.xy);
  if (r == 0.0) return vec3(0.0);
  float a = atan(-w.y, w.x);
  return vec3(cos(a), cos(a - 2.0943951), cos(a - 4.1887902)) * r;
}

vec4 effect(vec4 color, vec2 uv) {
  vec3 c = color.rgb;
  if (inputTransform == 1) c = bmdFilmToRec709(c);
  float t = temperature * 0.25;
  c *= exp2(exposure) * vec3(1.0 + t, 1.0 - tint * 0.2, 1.0 - t);
  vec3 l = wheelOffset(lift) * 0.25 + lift.z * 0.5;
  vec3 g = max(vec3(0.05), 1.0 + wheelOffset(gamma) * 0.6 + gamma.z);
  vec3 k = max(vec3(0.0), 1.0 + wheelOffset(gain) * 0.6 + gain.z);
  c = k * (c + l * (1.0 - c));
  c = sign(c) * pow(abs(c), 1.0 / g);
  c = (c - pivot) * contrast + pivot;
  c = mix(vec3(dot(c, LUMA)), c, saturation);
  return vec4(c, color.a);
}
`,
};

export const LUT: FilterDef = {
  kind: 'filter',
  id: 'lut',
  name: 'LUT',
  params: [
    { name: 'table', label: 'LUT', type: 'resource', resource: 'lut3d', default: '' },
    { name: 'strength', label: 'Strength', type: 'float', default: 1, min: 0, max: 1, step: 0.01 },
  ],
  glsl: `
vec4 effect(vec4 color, vec2 uv) {
  float size = float(textureSize(table, 0).x);
  vec3 coord = clamp(color.rgb, 0.0, 1.0) * ((size - 1.0) / size) + 0.5 / size;
  return vec4(mix(color.rgb, texture(table, coord).rgb, strength), color.a);
}
`,
};
