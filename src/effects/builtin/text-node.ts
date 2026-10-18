import { MAX_RASTER_GLYPHS, type NodeDef, type ParamSpec } from '../types';

const float = (name: string, label: string, value: number, min: number, max: number, step = 0.01): ParamSpec => ({ name, label, type: 'float', default: value, min, max, step });
const vec2 = (name: string, label: string, value: [number, number]): ParamSpec => ({ name, label, type: 'vec2', default: value, step: 0.01 });
const color = (name: string, label: string, value: [number, number, number, number]): ParamSpec => ({ name, label, type: 'color', default: value });
const options = (...values: string[]) => values.map((value) => ({ value, label: value }));

export const TEXT_NODE_FONTS = ['IBM Plex Sans', 'IBM Plex Mono', 'serif', 'sans-serif'] as const;

export const TEXT_NODE: NodeDef = {
  kind: 'node',
  id: 'text',
  name: 'Text',
  category: 'generator',
  inputs: [],
  raster: 'text',
  params: [
    { name: 'text', label: 'Text', type: 'text', default: 'Title' },
    { name: 'font', label: 'Font', type: 'enum', default: 'IBM Plex Sans', options: options(...TEXT_NODE_FONTS) },
    { name: 'weight', label: 'Weight', type: 'enum', default: '600', options: options('400', '600', '700') },
    float('size', 'Size', 0.1, 0.01, 0.5, 0.005),
    float('tracking', 'Tracking', 0, -0.2, 1, 0.01),
    float('lineSpacing', 'Line spacing', 1.2, 0.5, 3, 0.05),
    { name: 'align', label: 'Align', type: 'enum', default: 'center', options: options('left', 'center', 'right') },
    vec2('center', 'Center', [0, 0]),
    float('rotation', 'Rotation', 0, -360, 360, 0.5),
    color('fill', 'Fill', [1, 1, 1, 1]),
    color('outline', 'Outline', [0, 0, 0, 1]),
    float('outlineWidth', 'Outline width', 0, 0, 0.3, 0.005),
    color('shadow', 'Shadow', [0, 0, 0, 0]),
    vec2('shadowOffset', 'Shadow offset', [0.004, 0.006]),
    float('shadowSoftness', 'Shadow softness', 0.004, 0, 0.05, 0.001),
    float('progress', 'Progress', 1, 0, 1, 0.01),
    float('stagger', 'Stagger', 0.5, 0, 0.99, 0.01),
    { name: 'order', label: 'Order', type: 'enum', default: 'forward', options: options('forward', 'backward', 'center') },
    { name: 'ease', label: 'Ease', type: 'enum', default: 'out', options: options('linear', 'out', 'inOut', 'back') },
    vec2('fromOffset', 'From offset', [0, 0.05]),
    float('fromScale', 'From scale', 1, 0, 4, 0.01),
    float('fromRotation', 'From rotation', 0, -360, 360, 0.5),
    float('fromOpacity', 'From opacity', 0, 0, 1, 0.01),
  ],
  passes: [
    {
      glsl: `
float easeCurve(float t) {
  if (ease == 1) return 1.0 - pow(1.0 - t, 3.0);
  if (ease == 2) return t < 0.5 ? 4.0 * t * t * t : 1.0 - pow(-2.0 * t + 2.0, 3.0) / 2.0;
  if (ease == 3) { float c = 1.70158; return 1.0 + (c + 1.0) * pow(t - 1.0, 3.0) + c * pow(t - 1.0, 2.0); }
  return t;
}
vec2 rotateBy(vec2 p, float degrees) {
  float a = radians(degrees);
  return mat2(cos(a), sin(a), -sin(a), cos(a)) * p;
}
float glyphStart(int i, int n) {
  if (n < 2) return 0.0;
  float f = float(i) / float(n - 1);
  if (order == 1) f = 1.0 - f;
  if (order == 2) f = abs(f - 0.5) * 2.0;
  return stagger * f;
}
vec4 process(vec2 uv) {
  vec2 asp = vec2(aspect(), 1.0);
  vec2 p = rotateBy((uv - 0.5 - vec2(center.x, -center.y)) * asp, rotation) / asp + 0.5;
  int n = glyph_count();
  float span = max(1.0 - stagger, 1e-3);
  vec2 cover = vec2(0.0);
  for (int i = 0; i < ${MAX_RASTER_GLYPHS}; i++) {
    if (i >= n) break;
    float k = easeCurve(clamp((progress - glyphStart(i, n)) / span, 0.0, 1.0));
    float opacity = mix(fromOpacity, 1.0, k);
    if (opacity <= 0.0) continue;
    vec4 r = glyph(i);
    vec2 c = (r.xy + r.zw) * 0.5;
    vec2 offset = vec2(fromOffset.x, -fromOffset.y) * (1.0 - k);
    float s = max(mix(fromScale, 1.0, k), 1e-3);
    vec2 q = rotateBy((p - c - offset) * asp, fromRotation * (1.0 - k)) / s / asp + c;
    if (any(lessThan(q, r.xy)) || any(greaterThan(q, r.zw))) continue;
    cover = max(cover, raster(q).rg * opacity);
  }
  return vec4(cover, 0.0, 1.0);
}`,
    },
    {
      glsl: `
float coverage(vec2 uv) {
  vec2 c = previous(uv).rg;
  return max(c.r, c.g);
}
vec4 process(vec2 uv) {
  vec2 c = previous(uv).rg;
  float fillA = c.r * fill.a;
  float outlineA = max(c.g, c.r) * outline.a;
  float bodyA = fillA + outlineA * (1.0 - fillA);
  vec3 body = (fill.rgb * fillA + outline.rgb * outlineA * (1.0 - fillA)) / max(bodyA, 1e-5);
  float shadowA = 0.0;
  if (shadow.a > 0.0) {
    vec2 at = uv - vec2(shadowOffset.x, -shadowOffset.y);
    vec2 radius = vec2(shadowSoftness / aspect(), shadowSoftness);
    float sum = 0.0;
    for (int y = -2; y <= 2; y++)
      for (int x = -2; x <= 2; x++) sum += coverage(at + vec2(float(x), float(y)) * radius * 0.5);
    shadowA = sum / 25.0 * shadow.a;
  }
  float alpha = bodyA + shadowA * (1.0 - bodyA);
  vec3 rgb = (body * bodyA + shadow.rgb * shadowA * (1.0 - bodyA)) / max(alpha, 1e-5);
  return vec4(rgb, alpha);
}`,
    },
  ],
};
