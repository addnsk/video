import {
  ACES_AP1,
  ARRI_WIDE_GAMUT_3,
  BMD_WIDE_GAMUT_GEN5,
  CINEMA_GAMUT,
  REC2020,
  REC709,
  S_GAMUT3_CINE,
  V_GAMUT,
  gamutMatrix,
  glslMat3,
  invert,
  type Mat3,
  type Primaries,
} from './colorspace';
import type { ColorScience } from '../core/model';
import type { FilterDef } from './types';

export interface InputSpace {
  readonly id: string;
  readonly label: string;
  readonly kind: 'display' | 'scene';
  readonly primaries: Primaries;
  readonly decode: string;
}

export const INPUT_SPACES: readonly InputSpace[] = [
  { id: 'rec709', label: 'Rec.709', kind: 'display', primaries: REC709, decode: 'rec709Decode(x)' },
  { id: 'srgb', label: 'sRGB', kind: 'display', primaries: REC709, decode: 'srgbDecode(x)' },
  { id: 'linear', label: 'Linear (Rec.709 primaries)', kind: 'scene', primaries: REC709, decode: 'x' },
  { id: 'bmdFilmGen5', label: 'Blackmagic Film Gen 5', kind: 'scene', primaries: BMD_WIDE_GAMUT_GEN5, decode: 'bmdGen5Decode(x)' },
  { id: 'slog3', label: 'Sony S-Log3 / S-Gamut3.Cine', kind: 'scene', primaries: S_GAMUT3_CINE, decode: 'slog3Decode(x)' },
  { id: 'logc3', label: 'ARRI LogC3 / Wide Gamut 3', kind: 'scene', primaries: ARRI_WIDE_GAMUT_3, decode: 'logc3Decode(x)' },
  { id: 'vlog', label: 'Panasonic V-Log / V-Gamut', kind: 'scene', primaries: V_GAMUT, decode: 'vlogDecode(x)' },
  { id: 'clog3', label: 'Canon Log 3 / Cinema Gamut', kind: 'scene', primaries: CINEMA_GAMUT, decode: 'clog3Decode(x)' },
  { id: 'rec2020Hlg', label: 'Rec.2020 HLG', kind: 'scene', primaries: REC2020, decode: 'hlgDecode(x)' },
  { id: 'rec2020Pq', label: 'Rec.2020 PQ', kind: 'scene', primaries: REC2020, decode: 'pqDecode(x)' },
];

export const DEFAULT_INPUT_SPACE = 'rec709';

export const inputSpace = (id: string | undefined): InputSpace => INPUT_SPACES.find((s) => s.id === id) ?? INPUT_SPACES[0];

export const needsInputTransform = (science: ColorScience, space: string | undefined): boolean =>
  science === 'aces' || inputSpace(space).kind === 'scene';

const ROW_IN: Mat3 = [0.59719, 0.35458, 0.04823, 0.076, 0.90834, 0.01566, 0.0284, 0.13383, 0.83777];
const ROW_OUT: Mat3 = [1.60475, -0.53108, -0.07367, -0.10208, 1.10813, -0.00605, -0.00327, -0.07276, 1.07602];

const CURVES = `
vec3 rec709Encode(vec3 l) {
  l = max(l, 0.0);
  return mix(4.5 * l, 1.099 * pow(l, vec3(0.45)) - 0.099, step(0.018, l));
}
vec3 rec709Decode(vec3 x) {
  x = max(x, 0.0);
  return mix(x / 4.5, pow((x + 0.099) / 1.099, vec3(1.0 / 0.45)), step(0.081, x));
}
vec3 srgbDecode(vec3 x) {
  x = max(x, 0.0);
  return mix(x / 12.92, pow((x + 0.055) / 1.055, vec3(2.4)), step(0.04045, x));
}
vec3 bmdGen5Decode(vec3 x) {
  const float A = 0.08692876065491224;
  const float B = 0.005494072432257808;
  const float C = 0.5300133392291939;
  const float D = 8.283605932402494;
  const float E = 0.09246575342465753;
  return mix((x - E) / D, exp((x - C) / A) - B, step(D * 0.005 + E, x));
}
vec3 slog3Decode(vec3 x) {
  vec3 v = x * 1023.0;
  return mix((v - 95.0) * 0.01125 / (171.2102946929 - 95.0), pow(vec3(10.0), (v - 420.0) / 261.5) * 0.19 - 0.01, step(171.2102946929, v));
}
vec3 logc3Decode(vec3 x) {
  return mix((x - 0.092809) / 5.367655, (pow(vec3(10.0), (x - 0.385537) / 0.24719) - 0.052272) / 5.555556, step(5.367655 * 0.010591 + 0.092809, x));
}
vec3 vlogDecode(vec3 x) {
  return mix((x - 0.125) / 5.6, pow(vec3(10.0), (x - 0.598206) / 0.241514) - 0.00873, step(0.181, x));
}
vec3 clog3Decode(vec3 x) {
  vec3 lo = -(pow(vec3(10.0), (0.12783901 - x) / 0.36726845) - 1.0) / 14.98325;
  vec3 mid = (x - 0.12512219) / 1.9754798;
  vec3 hi = (pow(vec3(10.0), (x - 0.12240537) / 0.36726845) - 1.0) / 14.98325;
  return mix(mix(lo, mid, step(0.097465473, x)), hi, step(0.15277891, x));
}
vec3 hlgDecode(vec3 x) {
  const float A = 0.17883277;
  const float B = 1.0 - 4.0 * A;
  const float C = 0.5 - A * log(4.0 * A);
  vec3 e = mix(x * x / 3.0, (exp((x - C) / A) + B) / 12.0, step(0.5, x));
  return e / 0.2627;
}
vec3 pqDecode(vec3 x) {
  const float m1 = 2610.0 / 16384.0;
  const float m2 = 2523.0 / 4096.0 * 128.0;
  const float c1 = 3424.0 / 4096.0;
  const float c2 = 2413.0 / 4096.0 * 32.0;
  const float c3 = 2392.0 / 4096.0 * 32.0;
  vec3 p = pow(clamp(x, 0.0, 1.0), vec3(1.0 / m2));
  vec3 nits = pow(max(p - c1, 0.0) / (c2 - c3 * p), vec3(1.0 / m1)) * 10000.0;
  return nits / 203.0;
}
vec3 acescctEncode(vec3 l) {
  return mix(10.5402377416545 * l + 0.0729055341958355, (log2(max(l, 1e-10)) + 9.72) / 17.52, step(0.0078125, l));
}
vec3 acescctDecode(vec3 c) {
  return mix((c - 0.0729055341958355) / 10.5402377416545, exp2(c * 17.52 - 9.72), step(0.155251141552511, c));
}
vec3 rrtFit(vec3 v) {
  return (v * (v + 0.0245786) - 0.000090537) / (v * (0.983729 * v + 0.432951) + 0.238081);
}
vec3 rrtFitInverse(vec3 y) {
  y = clamp(y, 0.0, 0.99 / 0.983729);
  vec3 a = 0.983729 * y - 1.0;
  vec3 b = 0.432951 * y - 0.0245786;
  vec3 c = 0.238081 * y + 0.000090537;
  return (-b - sqrt(max(b * b - 4.0 * a * c, 0.0))) / (2.0 * a);
}
const mat3 ODT_IN = ${glslMat3(ROW_IN)};
const mat3 ODT_OUT = ${glslMat3(ROW_OUT)};
const mat3 ODT_IN_INV = ${glslMat3(invert(ROW_IN))};
const mat3 ODT_OUT_INV = ${glslMat3(invert(ROW_OUT))};
const mat3 AP1_TO_709 = ${glslMat3(gamutMatrix(ACES_AP1, REC709))};
const mat3 REC709_TO_AP1 = ${glslMat3(gamutMatrix(REC709, ACES_AP1))};
vec3 acesDisplay(vec3 lin709) {
  return rec709Encode(clamp(ODT_OUT * rrtFit(ODT_IN * lin709), 0.0, 1.0));
}
vec3 acesDisplayInverse(vec3 display) {
  return ODT_IN_INV * rrtFitInverse(ODT_OUT_INV * rec709Decode(clamp(display, 0.0, 1.0)));
}`;

const spaceBranches = (target: 'display' | 'aces') =>
  INPUT_SPACES.map((s, i) => {
    const toWorking = target === 'display' ? gamutMatrix(s.primaries, REC709) : gamutMatrix(s.primaries, ACES_AP1);
    const body =
      s.kind === 'display'
        ? target === 'display'
          ? 'c = x;'
          : `c = acescctEncode(REC709_TO_AP1 * acesDisplayInverse(rec709Encode(${s.decode})));`
        : target === 'display'
          ? `vec3 l = max(${glslMat3(toWorking)} * ${s.decode}, 0.0); c = rec709Encode(l / (l + 0.82));`
          : `c = acescctEncode(${glslMat3(toWorking)} * ${s.decode});`;
    return `${i === 0 ? '' : 'else '}if (space == ${i}) { ${body} }`;
  }).join('\n  ');

export const INPUT_TRANSFORM: FilterDef = {
  kind: 'filter',
  id: 'input-transform',
  name: 'Input transform',
  stage: 0,
  params: [
    { name: 'space', label: 'Input color space', type: 'enum', default: DEFAULT_INPUT_SPACE, options: INPUT_SPACES.map((s) => ({ value: s.id, label: s.label })) },
    { name: 'science', label: 'Working space', type: 'enum', default: 'display', options: [{ value: 'display', label: 'Rec.709 display' }, { value: 'aces', label: 'ACEScct' }] },
  ],
  glsl: `${CURVES}
vec3 toDisplay(vec3 x) {
  vec3 c = x;
  ${spaceBranches('display')}
  return c;
}
vec3 toAces(vec3 x) {
  vec3 c = x;
  ${spaceBranches('aces')}
  return c;
}
vec4 effect(vec4 color, vec2 uv) {
  return vec4(science == 1 ? toAces(color.rgb) : toDisplay(color.rgb), color.a);
}
`,
};

export const OUTPUT_TRANSFORM: FilterDef = {
  kind: 'filter',
  id: 'output-transform',
  name: 'Output transform',
  stage: 1000,
  params: [{ name: 'exposure', label: 'Exposure', type: 'float', default: 0, min: -4, max: 4, step: 0.01 }],
  glsl: `${CURVES}
vec4 effect(vec4 color, vec2 uv) {
  vec3 lin = AP1_TO_709 * acescctDecode(color.rgb) * exp2(exposure);
  return vec4(acesDisplay(lin), color.a);
}
`,
};

export const COLOR_MANAGEMENT_FILTERS: readonly FilterDef[] = [INPUT_TRANSFORM, OUTPUT_TRANSFORM];
