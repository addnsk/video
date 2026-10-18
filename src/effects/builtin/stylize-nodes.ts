import type { NodeDef, ParamSpec } from '../types';

const float = (name: string, label: string, value: number, min: number, max: number, step = 0.01): ParamSpec => ({ name, label, type: 'float', default: value, min, max, step });
const vec2 = (name: string, label: string, value: [number, number]): ParamSpec => ({ name, label, type: 'vec2', default: value, step: 0.01 });
const color = (name: string, label: string, value: [number, number, number, number]): ParamSpec => ({ name, label, type: 'color', default: value });
const bool = (name: string, label: string, value: boolean): ParamSpec => ({ name, label, type: 'bool', default: value });
const options = (...values: string[]) => values.map((value) => ({ value, label: value }));
const SOURCE = [{ name: 'source', label: 'Input' }];

const HASH = `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
float valueNoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = hash13(i), n100 = hash13(i + vec3(1, 0, 0)), n010 = hash13(i + vec3(0, 1, 0)), n110 = hash13(i + vec3(1, 1, 0));
  float n001 = hash13(i + vec3(0, 0, 1)), n101 = hash13(i + vec3(1, 0, 1)), n011 = hash13(i + vec3(0, 1, 1)), n111 = hash13(i + vec3(1, 1, 1));
  return mix(mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y), mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y), f.z);
}`;

const frameToUv = 'vec2 frameToUv(vec2 p) { return vec2(p.x + 0.5, 0.5 - p.y); }';

export const NOISE: NodeDef = {
  kind: 'node',
  id: 'noise',
  name: 'Noise',
  category: 'generator',
  inputs: [],
  temporal: true,
  params: [
    float('scale', 'Scale', 8, 0.5, 100, 0.5),
    { name: 'detail', label: 'Detail', type: 'int', default: 4, min: 1, max: 8, step: 1 },
    float('speed', 'Speed', 0.5, 0, 10, 0.05),
    float('seed', 'Seed', 0, 0, 1000, 1),
    color('low', 'Low color', [0, 0, 0, 1]),
    color('high', 'High color', [1, 1, 1, 1]),
  ],
  passes: [
    {
      glsl: `${HASH}
vec4 process(vec2 uv) {
  vec3 p = vec3(uv * vec2(aspect(), 1.0) * scale, time() * speed + seed * 17.0);
  float sum = 0.0;
  float amplitude = 0.5;
  float total = 0.0;
  for (int i = 0; i < 8; i++) {
    if (i >= detail) break;
    sum += valueNoise(p) * amplitude;
    total += amplitude;
    p = p * 2.03 + 11.7;
    amplitude *= 0.5;
  }
  return mix(low, high, sum / max(total, 1e-5));
}`,
    },
  ],
};

export const FILM_GRAIN: NodeDef = {
  kind: 'node',
  id: 'film-grain',
  name: 'Film grain',
  category: 'stylize',
  inputs: SOURCE,
  temporal: true,
  params: [float('amount', 'Amount', 0.08, 0, 1), float('grainSize', 'Size', 1.5, 0.5, 8, 0.1), float('shadows', 'Shadow response', 0.6, 0, 1), bool('mono', 'Monochrome', true)],
  passes: [
    {
      glsl: `${HASH}
vec4 process(vec2 uv) {
  vec4 c = input_source(uv);
  vec2 cell = floor(uv / texel() / max(px(grainSize), 0.5));
  float frame = floor(time() * 24.0);
  vec3 n = mono ? vec3(hash13(vec3(cell, frame))) : vec3(hash13(vec3(cell, frame)), hash13(vec3(cell + 7.1, frame)), hash13(vec3(cell + 13.3, frame)));
  float luma = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
  float weight = mix(1.0, 1.0 - clamp(luma, 0.0, 1.0), shadows) * 2.0;
  return vec4(max(c.rgb + (n - 0.5) * amount * weight, 0.0), c.a);
}`,
    },
  ],
};

export const VIGNETTE: NodeDef = {
  kind: 'node',
  id: 'vignette',
  name: 'Vignette',
  category: 'stylize',
  inputs: SOURCE,
  params: [float('amount', 'Amount', 0.5, 0, 1), float('radius', 'Radius', 0.75, 0, 1.5), float('softness', 'Softness', 0.45, 0.01, 1), float('roundness', 'Roundness', 1, 0, 1), color('tint', 'Color', [0, 0, 0, 1])],
  passes: [
    {
      glsl: `
vec4 process(vec2 uv) {
  vec4 c = input_source(uv);
  vec2 p = (uv - 0.5) * 2.0 * mix(vec2(1.0), vec2(aspect(), 1.0) / max(aspect(), 1.0), roundness);
  float d = length(p);
  float v = smoothstep(radius, radius + softness, d) * amount * tint.a;
  return vec4(mix(c.rgb, tint.rgb * c.a, v), c.a);
}`,
    },
  ],
};

export const SHARPEN: NodeDef = {
  kind: 'node',
  id: 'sharpen',
  name: 'Sharpen',
  category: 'blur',
  inputs: SOURCE,
  params: [float('amount', 'Amount', 0.6, 0, 4), float('radius', 'Radius', 1.5, 0.5, 10, 0.1), float('threshold', 'Threshold', 0, 0, 0.5, 0.005)],
  passes: [
    {
      glsl: `
vec4 process(vec2 uv) {
  vec4 c = input_source(uv);
  vec2 r = texel() * max(px(radius), 0.5);
  vec4 blur = vec4(0.0);
  for (int y = -1; y <= 1; y++)
    for (int x = -1; x <= 1; x++) blur += input_source(uv + vec2(float(x), float(y)) * r) * (x == 0 && y == 0 ? 4.0 : (x == 0 || y == 0) ? 2.0 : 1.0);
  blur /= 16.0;
  vec3 detail = c.rgb - blur.rgb;
  vec3 gated = detail * step(vec3(threshold), abs(detail));
  return vec4(max(c.rgb + gated * amount, 0.0), c.a);
}`,
    },
  ],
};

export const DIRECTIONAL_BLUR: NodeDef = {
  kind: 'node',
  id: 'directional-blur',
  name: 'Directional blur',
  category: 'blur',
  inputs: SOURCE,
  params: [float('blurLength', 'Length', 20, 0, 400, 1), float('angle', 'Angle', 0, -180, 180, 0.5), bool('centered', 'Centered', true)],
  passes: [
    {
      glsl: `
vec4 process(vec2 uv) {
  float a = radians(angle);
  vec2 dir = vec2(cos(a), sin(a)) * px(blurLength) * texel();
  vec4 sum = vec4(0.0);
  for (int i = 0; i < 48; i++) {
    float f = float(i) / 47.0;
    vec4 c = input_source(uv + dir * (centered ? f - 0.5 : -f));
    sum += vec4(c.rgb * c.a, c.a);
  }
  sum /= 48.0;
  return vec4(sum.rgb / max(sum.a, 1e-5), sum.a);
}`,
    },
  ],
};

export const RADIAL_BLUR: NodeDef = {
  kind: 'node',
  id: 'radial-blur',
  name: 'Radial blur',
  category: 'blur',
  inputs: SOURCE,
  params: [vec2('center', 'Center', [0, 0]), float('amount', 'Amount', 0.1, 0, 1), { name: 'mode', label: 'Mode', type: 'enum', default: 'zoom', options: options('zoom', 'spin') }],
  passes: [
    {
      glsl: `${frameToUv}
vec4 process(vec2 uv) {
  vec2 asp = vec2(aspect(), 1.0);
  vec2 c = frameToUv(center);
  vec2 d = (uv - c) * asp;
  vec4 sum = vec4(0.0);
  for (int i = 0; i < 48; i++) {
    float f = float(i) / 47.0 - 0.5;
    vec2 q;
    if (mode == 0) q = d * (1.0 - f * amount);
    else {
      float a = f * amount * 3.14159;
      q = mat2(cos(a), sin(a), -sin(a), cos(a)) * d;
    }
    vec4 col = input_source(q / asp + c);
    sum += vec4(col.rgb * col.a, col.a);
  }
  sum /= 48.0;
  return vec4(sum.rgb / max(sum.a, 1e-5), sum.a);
}`,
    },
  ],
};

export const DISPLACE: NodeDef = {
  kind: 'node',
  id: 'displace',
  name: 'Displace',
  category: 'transform',
  inputs: [{ name: 'source', label: 'Input' }, { name: 'map', label: 'Displacement map' }],
  params: [vec2('strength', 'Strength', [0.02, 0.02]), { name: 'channel', label: 'Channels', type: 'enum', default: 'red-green', options: options('red-green', 'luma') }],
  passes: [
    {
      glsl: `
vec4 process(vec2 uv) {
  if (!has_map()) return input_source(uv);
  vec4 m = input_map(uv);
  vec2 d = channel == 0 ? m.rg - 0.5 : vec2(dot(m.rgb, vec3(0.2126, 0.7152, 0.0722)) - 0.5);
  return input_source(uv + vec2(d.x * strength.x, -d.y * strength.y) * 2.0);
}`,
    },
  ],
};

export const CORNER_PIN: NodeDef = {
  kind: 'node',
  id: 'corner-pin',
  name: 'Corner pin',
  category: 'transform',
  inputs: SOURCE,
  params: [vec2('topLeft', 'Top left', [-0.5, -0.5]), vec2('topRight', 'Top right', [0.5, -0.5]), vec2('bottomRight', 'Bottom right', [0.5, 0.5]), vec2('bottomLeft', 'Bottom left', [-0.5, 0.5])],
  passes: [
    {
      glsl: `${frameToUv}
vec4 process(vec2 uv) {
  vec2 q0 = frameToUv(bottomLeft), q1 = frameToUv(bottomRight), q2 = frameToUv(topRight), q3 = frameToUv(topLeft);
  float dx1 = q1.x - q2.x, dx2 = q3.x - q2.x, dx3 = q0.x - q1.x + q2.x - q3.x;
  float dy1 = q1.y - q2.y, dy2 = q3.y - q2.y, dy3 = q0.y - q1.y + q2.y - q3.y;
  float a, b, c, d, e, f, g, h;
  if (abs(dx3) < 1e-7 && abs(dy3) < 1e-7) {
    a = q1.x - q0.x; b = q2.x - q1.x; c = q0.x; d = q1.y - q0.y; e = q2.y - q1.y; f = q0.y; g = 0.0; h = 0.0;
  } else {
    float den = dx1 * dy2 - dx2 * dy1;
    if (abs(den) < 1e-9) return vec4(0.0);
    g = (dx3 * dy2 - dx2 * dy3) / den;
    h = (dx1 * dy3 - dx3 * dy1) / den;
    a = q1.x - q0.x + g * q1.x; b = q3.x - q0.x + h * q3.x; c = q0.x;
    d = q1.y - q0.y + g * q1.y; e = q3.y - q0.y + h * q3.y; f = q0.y;
  }
  float A = e - f * h, B = c * h - b, C = b * f - c * e;
  float D = f * g - d, E = a - c * g, F = c * d - a * f;
  float G = d * h - e * g, H = b * g - a * h, I = a * e - b * d;
  vec3 s = vec3(A * uv.x + B * uv.y + C, D * uv.x + E * uv.y + F, G * uv.x + H * uv.y + I);
  if (abs(s.z) < 1e-9) return vec4(0.0);
  vec2 st = s.xy / s.z;
  if (any(lessThan(st, vec2(0.0))) || any(greaterThan(st, vec2(1.0)))) return vec4(0.0);
  return input_source(st);
}`,
    },
  ],
};

export const LENS_DISTORTION: NodeDef = {
  kind: 'node',
  id: 'lens-distortion',
  name: 'Lens distortion',
  category: 'transform',
  inputs: SOURCE,
  params: [float('k1', 'Distortion', 0.1, -1, 1), float('k2', 'Edge distortion', 0, -1, 1), float('zoom', 'Zoom', 1, 0.2, 4), float('dispersion', 'Dispersion', 0, 0, 0.1, 0.001)],
  passes: [
    {
      glsl: `
vec2 distort(vec2 uv, float k) {
  vec2 asp = vec2(aspect(), 1.0);
  vec2 p = (uv - 0.5) * asp / length(asp * 0.5);
  float r2 = dot(p, p);
  vec2 q = p * (1.0 + k * r2 + k2 * r2 * r2) / max(zoom, 1e-3);
  return q * length(asp * 0.5) / asp + 0.5;
}
vec4 process(vec2 uv) {
  vec4 g = input_source(distort(uv, k1));
  if (dispersion <= 0.0) return g;
  float r = input_source(distort(uv, k1 + dispersion)).r;
  float b = input_source(distort(uv, k1 - dispersion)).b;
  return vec4(r, g.g, b, g.a);
}`,
    },
  ],
};

export const LETTERBOX: NodeDef = {
  kind: 'node',
  id: 'letterbox',
  name: 'Letterbox',
  category: 'transform',
  inputs: SOURCE,
  params: [float('ratio', 'Aspect ratio', 2.39, 0.2, 5, 0.01), float('offset', 'Offset', 0, -0.5, 0.5), color('fill', 'Bars', [0, 0, 0, 1])],
  passes: [
    {
      glsl: `
vec4 process(vec2 uv) {
  vec4 c = input_source(uv);
  float a = aspect();
  vec2 bars = ratio > a ? vec2(0.0, (1.0 - a / ratio) * 0.5) : vec2((1.0 - ratio / a) * 0.5, 0.0);
  vec2 p = uv - vec2(0.0, -offset);
  bool outside = any(lessThan(p, bars)) || any(greaterThan(p, 1.0 - bars));
  return outside ? mix(c, fill, fill.a) : c;
}`,
    },
  ],
};

export const LUMA_KEY: NodeDef = {
  kind: 'node',
  id: 'luma-key',
  name: 'Luma key',
  category: 'mask',
  inputs: SOURCE,
  params: [float('low', 'Low', 0, 0, 1), float('high', 'High', 0.5, 0, 1), float('softness', 'Softness', 0.05, 0, 0.5, 0.005), bool('invert', 'Invert', false), bool('matte', 'Show matte', false)],
  passes: [
    {
      glsl: `
vec4 process(vec2 uv) {
  vec4 c = input_source(uv);
  float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
  float s = max(softness, 1e-4);
  float inside = smoothstep(low - s, low, l) * (1.0 - smoothstep(high, high + s, l));
  float alpha = invert ? inside : 1.0 - inside;
  alpha *= c.a;
  return matte ? vec4(vec3(alpha), 1.0) : vec4(c.rgb, alpha);
}`,
    },
  ],
};

export const MASK_COMBINE: NodeDef = {
  kind: 'node',
  id: 'mask-combine',
  name: 'Combine masks',
  category: 'mask',
  inputs: [{ name: 'a', label: 'Mask A' }, { name: 'b', label: 'Mask B' }],
  params: [{ name: 'mode', label: 'Mode', type: 'enum', default: 'union', options: options('union', 'intersect', 'subtract', 'difference') }, bool('invert', 'Invert', false)],
  passes: [
    {
      glsl: `
vec4 process(vec2 uv) {
  float a = input_a(uv).a;
  float b = input_b(uv).a;
  float m = mode == 0 ? max(a, b) : mode == 1 ? min(a, b) : mode == 2 ? a * (1.0 - b) : abs(a - b);
  if (invert) m = 1.0 - m;
  return vec4(1.0, 1.0, 1.0, m);
}`,
    },
  ],
};

export const STYLIZE_NODES: readonly NodeDef[] = [NOISE, FILM_GRAIN, VIGNETTE, SHARPEN, DIRECTIONAL_BLUR, RADIAL_BLUR, DISPLACE, CORNER_PIN, LENS_DISTORTION, LETTERBOX, LUMA_KEY, MASK_COMBINE];
