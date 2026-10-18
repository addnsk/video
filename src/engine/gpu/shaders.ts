import { GLYPH_DATA_WIDTH } from './raster';
import { type FilterDef, type NodeDef, type ParamSpec, type TransitionDef } from '../../effects/types';

export const VERTEX = `#version 300 es
layout(location = 0) in vec2 position;
out vec2 v_uv;
void main() {
  v_uv = position * 0.5 + 0.5;
  gl_Position = vec4(position, 0.0, 1.0);
}`;

const HEADER = `#version 300 es
precision highp float;
precision highp sampler3D;
in vec2 v_uv;
out vec4 outColor;
`;

export const FIT = `${HEADER}
uniform sampler2D u_image;
uniform vec2 u_size;
uniform vec2 u_center;
uniform vec2 u_extent;
uniform vec2 u_rotation;
void main() {
  vec2 d = v_uv * u_size - u_center;
  vec2 r = vec2(u_rotation.x * d.x + u_rotation.y * d.y, -u_rotation.y * d.x + u_rotation.x * d.y);
  vec2 p = r / u_extent + 0.5;
  if (any(lessThan(p, vec2(0.0))) || any(greaterThan(p, vec2(1.0)))) {
    outColor = vec4(0.0);
    return;
  }
  outColor = texture(u_image, vec2(p.x, 1.0 - p.y));
}`;

export const COPY = `${HEADER}
uniform sampler2D u_image;
uniform float u_opacity;
void main() {
  vec4 c = texture(u_image, v_uv);
  outColor = vec4(c.rgb, c.a * u_opacity);
}`;

export const PRESENT = `${HEADER}
uniform sampler2D u_image;
void main() {
  outColor = texture(u_image, vec2(v_uv.x, 1.0 - v_uv.y));
}`;

const GLSL_TYPES: Record<string, string> = {
  float: 'float',
  int: 'int',
  bool: 'bool',
  vec2: 'vec2',
  vec3: 'vec3',
  vec4: 'vec4',
  enum: 'int',
  color: 'vec4',
};

function uniformDeclaration(spec: ParamSpec): string {
  if (spec.type === 'text') return '';
  if (spec.type === 'points') return `uniform vec2 ${spec.name}[${spec.max}];\nuniform int ${spec.name}_count;`;
  if (spec.type === 'resource') return `uniform sampler3D ${spec.name};`;
  if (spec.type === 'curve') return `uniform sampler2D ${spec.name};`;
  return `uniform ${GLSL_TYPES[spec.type]} ${spec.name};`;
}

const FINITE_HELPER = `float finiteOrZero(float v) { return isnan(v) || isinf(v) ? 0.0 : v; }
vec3 finiteOrZero(vec3 v) { return vec3(finiteOrZero(v.x), finiteOrZero(v.y), finiteOrZero(v.z)); }`;

export function filterSource(def: FilterDef): string {
  return `${HEADER}
${FINITE_HELPER}
uniform sampler2D u_source;
vec4 sampleSource(vec2 uv) { return texture(u_source, uv); }
${WORKING_HELPER}
float curve(sampler2D c, float x) { return texture(c, vec2(clamp(x, 0.0, 1.0) * (255.0 / 256.0) + 0.5 / 256.0, 0.5)).r; }
${def.params.map(uniformDeclaration).join('\n')}
${def.glsl}
void main() {
  vec4 color = texture(u_source, v_uv);
  vec4 result = effect(color, v_uv);
  outColor = vec4(finiteOrZero(result.rgb), color.a);
}`;
}

const WORKING_HELPER = `uniform bool u_aces;
bool acesWorking() { return u_aces; }
vec3 toWorkingLinear(vec3 c) {
  if (!u_aces) return c;
  return mix((c - 0.0729055341958355) / 10.5402377416545, exp2(c * 17.52 - 9.72), step(0.155251141552511, c));
}
vec3 fromWorkingLinear(vec3 l) {
  if (!u_aces) return l;
  return mix(10.5402377416545 * l + 0.0729055341958355, (log2(max(l, 1e-10)) + 9.72) / 17.52, step(0.0078125, l));
}`;

const CURVE_HELPER = 'float curve(sampler2D c, float x) { return texture(c, vec2(clamp(x, 0.0, 1.0) * (255.0 / 256.0) + 0.5 / 256.0, 0.5)).r; }';

export const nodeInputUniform = (name: string): string => `u_in_${name}`;
export const nodeHasUniform = (name: string): string => `u_has_${name}`;

export function nodeSource(def: NodeDef, pass: number): string {
  const inputs = def.inputs
    .map(({ name }) => `uniform sampler2D ${nodeInputUniform(name)};
uniform bool ${nodeHasUniform(name)};
bool has_${name}() { return ${nodeHasUniform(name)}; }
vec4 input_${name}(vec2 uv) {
  if (!${nodeHasUniform(name)} || any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return vec4(0.0);
  return texture(${nodeInputUniform(name)}, uv);
}`)
    .join('\n');
  const raster = def.raster
    ? `uniform sampler2D u_raster;
uniform sampler2D u_atlas;
uniform highp sampler2D u_glyph_data;
uniform int u_glyph_count;
vec4 raster(vec2 uv) {
  if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return vec4(0.0);
  return texture(u_raster, vec2(uv.x, 1.0 - uv.y));
}
int glyph_count() { return u_glyph_count; }
vec4 glyphTexel(int i) { return texelFetch(u_glyph_data, ivec2(i % ${GLYPH_DATA_WIDTH}, i / ${GLYPH_DATA_WIDTH}), 0); }
vec4 glyph(int i) { return glyphTexel(i * 2); }
vec4 glyphCell(int i) { return glyphTexel(i * 2 + 1); }
vec4 glyphRaster(int i, vec2 uv) {
  vec4 box = glyph(i);
  vec4 cell = glyphCell(i);
  vec2 f = (uv - box.xy) / max(box.zw - box.xy, vec2(1e-6));
  if (any(lessThan(f, vec2(0.0))) || any(greaterThan(f, vec2(1.0)))) return vec4(0.0);
  vec2 a = mix(cell.xy, cell.zw, f);
  return texture(u_atlas, vec2(a.x, 1.0 - a.y));
}`
    : '';
  const history = def.history
    ? `uniform sampler2D u_history;
uniform bool u_has_history;
bool has_history() { return u_has_history; }
vec4 history(vec2 uv) { return u_has_history ? texture(u_history, uv) : vec4(0.0); }`
    : '';
  const previous = pass > 0 ? 'uniform sampler2D u_previous;\nvec4 previous(vec2 uv) { return texture(u_previous, uv); }' : 'vec4 previous(vec2 uv) { return vec4(0.0); }';
  return `${HEADER}
uniform vec2 u_resolution;
uniform float u_pixel_scale;
uniform float u_time;
float time() { return u_time; }
vec2 texel() { return 1.0 / u_resolution; }
float px(float projectPixels) { return projectPixels * u_pixel_scale; }
float aspect() { return u_resolution.x / u_resolution.y; }
${CURVE_HELPER}
${WORKING_HELPER}
${inputs}
${raster}
${history}
${previous}
${def.params.map(uniformDeclaration).join('\n')}
${def.passes[pass].glsl}
void main() {
  outColor = process(v_uv);
}`;
}

export function transitionSource(def: TransitionDef): string {
  return `${HEADER}
uniform sampler2D u_from;
uniform sampler2D u_to;
uniform float progress;
uniform float ratio;
vec4 getFromColor(vec2 uv) { return texture(u_from, uv); }
vec4 getToColor(vec2 uv) { return texture(u_to, uv); }
${def.glsl}
void main() {
  outColor = transition(v_uv);
}`;
}
