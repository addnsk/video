import type { FilterDef, ParamSpec, TransitionDef } from '../../effects/types';

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
uniform vec4 u_rect;
void main() {
  vec2 p = (v_uv - u_rect.xy) / u_rect.zw;
  if (any(lessThan(p, vec2(0.0))) || any(greaterThan(p, vec2(1.0)))) {
    outColor = vec4(0.0, 0.0, 0.0, 0.0);
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
};

function uniformDeclaration(spec: ParamSpec): string {
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
  outColor = vec4(clamp(result.rgb, 0.0, 1.0), color.a);
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
