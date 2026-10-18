import type { FilterDef, NodeDef, ParamSpec, TransitionDef } from '../../effects/types';

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
  if (spec.type === 'points') return `uniform vec2 ${spec.name}[${spec.max}];\nuniform int ${spec.name}_count;`;
  if (spec.type === 'resource') return `uniform sampler3D ${spec.name};`;
  if (spec.type === 'curve') return `uniform sampler2D ${spec.name};`;
  return `uniform ${GLSL_TYPES[spec.type]} ${spec.name};`;
}

export function filterSource(def: FilterDef): string {
  return `${HEADER}
uniform sampler2D u_source;
vec4 sampleSource(vec2 uv) { return texture(u_source, uv); }
float curve(sampler2D c, float x) { return texture(c, vec2(clamp(x, 0.0, 1.0) * (255.0 / 256.0) + 0.5 / 256.0, 0.5)).r; }
${def.params.map(uniformDeclaration).join('\n')}
${def.glsl}
void main() {
  vec4 color = texture(u_source, v_uv);
  vec4 result = effect(color, v_uv);
  outColor = vec4(max(result.rgb, 0.0), color.a);
}`;
}

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
  const previous = pass > 0 ? 'uniform sampler2D u_previous;\nvec4 previous(vec2 uv) { return texture(u_previous, uv); }' : 'vec4 previous(vec2 uv) { return vec4(0.0); }';
  return `${HEADER}
uniform vec2 u_resolution;
uniform float u_pixel_scale;
vec2 texel() { return 1.0 / u_resolution; }
float px(float projectPixels) { return projectPixels * u_pixel_scale; }
float aspect() { return u_resolution.x / u_resolution.y; }
${CURVE_HELPER}
${inputs}
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
