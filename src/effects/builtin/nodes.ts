import type { NodeDef, ParamSpec } from '../types';

const float = (name: string, label: string, value: number, min: number, max: number, step = 0.01): ParamSpec => ({ name, label, type: 'float', default: value, min, max, step });
const vec2 = (name: string, label: string, value: [number, number]): ParamSpec => ({ name, label, type: 'vec2', default: value, step: 0.01 });
const color = (name: string, label: string, value: [number, number, number, number]): ParamSpec => ({ name, label, type: 'vec4', default: value, step: 0.01 });

const BLUR_TAPS = `
const int MAX_TAPS = 64;
vec4 gaussian(vec2 uv, vec2 direction, float radius, bool fromPrevious) {
  float sigma = max(radius, 0.001) / 2.0;
  int taps = int(min(ceil(radius), float(MAX_TAPS)));
  vec4 sum = vec4(0.0);
  float total = 0.0;
  for (int i = -MAX_TAPS; i <= MAX_TAPS; i++) {
    if (i < -taps || i > taps) continue;
    float w = exp(-float(i * i) / (2.0 * sigma * sigma));
    vec2 at = uv + direction * float(i) * texel();
    vec4 c = fromPrevious ? previous(at) : input_source(at);
    sum += vec4(c.rgb * c.a, c.a) * w;
    total += w;
  }
  sum /= total;
  return vec4(sum.rgb / max(sum.a, 1e-5), sum.a);
}`;

export const MERGE: NodeDef = {
  kind: 'node',
  id: 'merge',
  name: 'Merge',
  category: 'composite',
  inputs: [{ name: 'background', label: 'Background' }, { name: 'foreground', label: 'Foreground' }, { name: 'mask', label: 'Mask' }],
  params: [
    {
      name: 'mode',
      label: 'Blend',
      type: 'enum',
      default: 'normal',
      options: ['normal', 'add', 'screen', 'multiply', 'overlay', 'difference', 'lighten', 'darken'].map((value) => ({ value, label: value[0].toUpperCase() + value.slice(1) })),
    },
    float('opacity', 'Opacity', 1, 0, 1),
    vec2('offset', 'Offset', [0, 0]),
  ],
  passes: [
    {
      glsl: `
vec3 blendColors(vec3 b, vec3 f) {
  if (mode == 1) return b + f;
  if (mode == 2) return 1.0 - (1.0 - b) * (1.0 - f);
  if (mode == 3) return b * f;
  if (mode == 4) return mix(2.0 * b * f, 1.0 - 2.0 * (1.0 - b) * (1.0 - f), step(0.5, b));
  if (mode == 5) return abs(b - f);
  if (mode == 6) return max(b, f);
  if (mode == 7) return min(b, f);
  return f;
}
vec4 process(vec2 uv) {
  vec4 b = input_background(uv);
  vec4 f = input_foreground(uv - vec2(offset.x, -offset.y));
  float m = has_mask() ? input_mask(uv).a : 1.0;
  float a = clamp(f.a * opacity * m, 0.0, 1.0);
  vec3 blended = mix(f.rgb, blendColors(b.rgb, f.rgb), b.a);
  float alpha = a + b.a * (1.0 - a);
  vec3 rgb = (blended * a + b.rgb * b.a * (1.0 - a)) / max(alpha, 1e-5);
  return vec4(rgb, alpha);
}`,
    },
  ],
};

export const TRANSFORM: NodeDef = {
  kind: 'node',
  id: 'transform',
  name: 'Transform',
  category: 'transform',
  inputs: [{ name: 'source', label: 'Input' }],
  params: [vec2('offset', 'Offset', [0, 0]), float('scale', 'Scale', 1, 0.01, 8), float('rotation', 'Rotation', 0, -360, 360, 0.5), { name: 'flip', label: 'Flip horizontally', type: 'bool', default: false }],
  passes: [
    {
      glsl: `
vec4 process(vec2 uv) {
  vec2 p = uv - 0.5 - vec2(offset.x, -offset.y);
  p.x *= aspect();
  float a = radians(rotation);
  p = mat2(cos(a), -sin(a), sin(a), cos(a)) * p;
  p /= max(scale, 1e-4);
  p.x /= aspect();
  if (flip) p.x = -p.x;
  return input_source(p + 0.5);
}`,
    },
  ],
};

export const BLUR: NodeDef = {
  kind: 'node',
  id: 'blur',
  name: 'Blur',
  category: 'blur',
  inputs: [{ name: 'source', label: 'Input' }],
  params: [float('radius', 'Radius (px)', 8, 0, 64, 0.5)],
  passes: [
    { glsl: `${BLUR_TAPS}\nvec4 process(vec2 uv) { return gaussian(uv, vec2(1.0, 0.0), radius, false); }` },
    { glsl: `${BLUR_TAPS}\nvec4 process(vec2 uv) { return gaussian(uv, vec2(0.0, 1.0), radius, true); }` },
  ],
};

export const GLOW: NodeDef = {
  kind: 'node',
  id: 'glow',
  name: 'Glow',
  category: 'stylize',
  inputs: [{ name: 'source', label: 'Input' }],
  params: [float('threshold', 'Threshold', 0.7, 0, 2), float('radius', 'Radius (px)', 16, 0, 64, 0.5), float('intensity', 'Intensity', 1, 0, 4)],
  passes: [
    {
      glsl: `${BLUR_TAPS}
vec4 process(vec2 uv) {
  float sigma = max(radius, 0.001) / 2.0;
  int taps = int(min(ceil(radius), float(MAX_TAPS)));
  vec3 sum = vec3(0.0);
  float total = 0.0;
  for (int i = -MAX_TAPS; i <= MAX_TAPS; i++) {
    if (i < -taps || i > taps) continue;
    float w = exp(-float(i * i) / (2.0 * sigma * sigma));
    vec4 c = input_source(uv + vec2(float(i), 0.0) * texel());
    sum += max(c.rgb * c.a - threshold, 0.0) * w;
    total += w;
  }
  return vec4(sum / total, 1.0);
}`,
    },
    { glsl: `${BLUR_TAPS}\nvec4 process(vec2 uv) { return gaussian(uv, vec2(0.0, 1.0), radius, true); }` },
    {
      glsl: `
vec4 process(vec2 uv) {
  vec4 c = input_source(uv);
  vec3 glow = previous(uv).rgb * intensity;
  float a = max(c.a, clamp(max(glow.r, max(glow.g, glow.b)), 0.0, 1.0));
  return vec4((c.rgb * c.a + glow) / max(a, 1e-5), a);
}`,
    },
  ],
};

export const BACKGROUND: NodeDef = {
  kind: 'node',
  id: 'background',
  name: 'Background',
  category: 'generator',
  inputs: [],
  params: [color('color', 'Color (RGBA)', [0, 0, 0, 1])],
  passes: [{ glsl: 'vec4 process(vec2 uv) { return color; }' }],
};

export const GRADIENT: NodeDef = {
  kind: 'node',
  id: 'gradient',
  name: 'Gradient',
  category: 'generator',
  inputs: [],
  params: [
    { name: 'shape', label: 'Shape', type: 'enum', default: 'linear', options: [{ value: 'linear', label: 'Linear' }, { value: 'radial', label: 'Radial' }] },
    color('from', 'Start color', [0, 0, 0, 1]),
    color('to', 'End color', [1, 1, 1, 1]),
    float('angle', 'Angle', 0, -180, 180, 1),
  ],
  passes: [
    {
      glsl: `
vec4 process(vec2 uv) {
  vec2 p = uv - 0.5;
  p.x *= aspect();
  float a = radians(angle);
  float t = shape == 1 ? length(p) / (0.5 * length(vec2(aspect(), 1.0))) : dot(p, vec2(cos(a), sin(a))) + 0.5;
  return mix(from, to, clamp(t, 0.0, 1.0));
}`,
    },
  ],
};

const SHAPE_PARAMS: ParamSpec[] = [
  vec2('center', 'Center', [0, 0]),
  vec2('size', 'Size', [0.5, 0.5]),
  float('softness', 'Softness', 0.02, 0, 0.5, 0.005),
  { name: 'invert', label: 'Invert', type: 'bool', default: false },
];

const shapeMask = (id: string, name: string, distance: string): NodeDef => ({
  kind: 'node',
  id,
  name,
  category: 'mask',
  inputs: [],
  params: SHAPE_PARAMS,
  passes: [
    {
      glsl: `
float shapeDistance(vec2 p, vec2 extent) { ${distance} }
vec4 process(vec2 uv) {
  vec2 p = uv - 0.5 - vec2(center.x, -center.y);
  p.x *= aspect();
  vec2 extent = max(size * vec2(aspect(), 1.0) * 0.5, vec2(1e-4));
  float d = shapeDistance(p, extent);
  float m = 1.0 - smoothstep(-softness, softness, d);
  if (invert) m = 1.0 - m;
  return vec4(m);
}`,
    },
  ],
});

export const ELLIPSE_MASK = shapeMask('ellipse-mask', 'Ellipse mask', 'return (length(p / extent) - 1.0) * min(extent.x, extent.y);');
export const RECTANGLE_MASK = shapeMask('rectangle-mask', 'Rectangle mask', 'vec2 q = abs(p) - extent; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);');

export const CROP: NodeDef = {
  kind: 'node',
  id: 'crop',
  name: 'Crop',
  category: 'transform',
  inputs: [{ name: 'source', label: 'Input' }],
  params: [float('left', 'Left', 0, 0, 1), float('right', 'Right', 0, 0, 1), float('top', 'Top', 0, 0, 1), float('bottom', 'Bottom', 0, 0, 1)],
  passes: [
    {
      glsl: `
vec4 process(vec2 uv) {
  if (uv.x < left || uv.x > 1.0 - right || uv.y < bottom || uv.y > 1.0 - top) return vec4(0.0);
  return input_source(uv);
}`,
    },
  ],
};

export const INVERT: NodeDef = {
  kind: 'node',
  id: 'invert',
  name: 'Invert',
  category: 'color',
  inputs: [{ name: 'source', label: 'Input' }],
  params: [],
  passes: [{ glsl: 'vec4 process(vec2 uv) { vec4 c = input_source(uv); return vec4(1.0 - c.rgb, c.a); }' }],
};

export const BUILTIN_NODES: readonly NodeDef[] = [MERGE, TRANSFORM, BLUR, GLOW, BACKGROUND, GRADIENT, ELLIPSE_MASK, RECTANGLE_MASK, CROP, INVERT];
