// Переходы в формате gl-transitions (https://gl-transitions.com):
// GLSL-функция vec4 transition(vec2 uv), которая смешивает getFromColor(uv)
// и getToColor(uv) по progress. Параметры объявляются как
//   uniform float smoothness; // = 0.5
// Любой переход из коллекции gl-transitions можно зарегистрировать как есть.

export type ParamValue = number | number[];

export interface TransitionDef {
  id: string;
  name: string;
  glsl: string;
  author?: string;
}

export interface TransitionParam {
  name: string;
  type: 'float' | 'int' | 'bool' | 'vec2' | 'vec3' | 'vec4';
  default: ParamValue;
}

const registry = new Map<string, TransitionDef & { params: TransitionParam[] }>();
const listeners = new Set<() => void>();

const PARAM_RE = /uniform\s+(float|int|bool|vec2|vec3|vec4)\s+(\w+)\s*;\s*(?:\/\/\s*=\s*([^\n]+))?/g;
const RESERVED = new Set(['progress', 'ratio']);

function parseDefault(type: TransitionParam['type'], raw: string | undefined): ParamValue {
  const size = { float: 1, int: 1, bool: 1, vec2: 2, vec3: 3, vec4: 4 }[type];
  if (!raw) return size === 1 ? 0 : new Array(size).fill(0);
  if (type === 'bool') return /true/.test(raw) ? 1 : 0;
  const nums = (raw.match(/-?\d*\.?\d+(?:e-?\d+)?/gi) ?? []).map(Number);
  if (size === 1) return nums[0] ?? 0;
  return Array.from({ length: size }, (_, i) => nums[i] ?? nums[0] ?? 0);
}

export function parseParams(glsl: string): TransitionParam[] {
  const out: TransitionParam[] = [];
  for (const m of glsl.matchAll(PARAM_RE)) {
    if (RESERVED.has(m[2])) continue;
    const type = m[1] as TransitionParam['type'];
    out.push({ name: m[2], type, default: parseDefault(type, m[3]?.trim()) });
  }
  return out;
}

export function registerTransition(def: TransitionDef) {
  if (!/^[\w-]+$/.test(def.id)) throw new Error('id перехода: латиница, цифры, _ и -');
  if (!/vec4\s+transition\s*\(/.test(def.glsl)) throw new Error('В GLSL нет функции vec4 transition(vec2 uv)');
  registry.set(def.id, { ...def, params: parseParams(def.glsl) });
  for (const fn of listeners) fn();
}

export const getTransition = (id: string) => registry.get(id) ?? null;
export const listTransitions = () => [...registry.values()];
export const onTransitionsChange = (fn: () => void) => listeners.add(fn);

// ---------- встроенные ----------

registerTransition({
  id: 'dissolve',
  name: 'Растворение',
  glsl: `vec4 transition(vec2 uv) {
  return mix(getFromColor(uv), getToColor(uv), progress);
}`,
});

registerTransition({
  id: 'fade-color',
  name: 'Через чёрный',
  glsl: `uniform vec3 color; // = vec3(0.0)
uniform float colorPhase; // = 0.4
vec4 transition(vec2 uv) {
  return mix(
    mix(vec4(color, 1.0), getFromColor(uv), smoothstep(1.0 - colorPhase, 0.0, progress)),
    mix(vec4(color, 1.0), getToColor(uv), smoothstep(colorPhase, 1.0, progress)),
    progress);
}`,
});

registerTransition({
  id: 'wipe',
  name: 'Шторка',
  glsl: `uniform vec2 direction; // = vec2(1.0, 0.0)
uniform float smoothness; // = 0.1
vec4 transition(vec2 uv) {
  vec2 d = normalize(direction);
  float pos = dot(uv - 0.5, d) / (abs(d.x) * 0.5 + abs(d.y) * 0.5) * 0.5 + 0.5;
  float m = smoothstep(-smoothness, 0.0, progress * (1.0 + smoothness) - smoothness - pos);
  return mix(getFromColor(uv), getToColor(uv), m);
}`,
});

registerTransition({
  id: 'slide',
  name: 'Сдвиг',
  glsl: `uniform vec2 direction; // = vec2(-1.0, 0.0)
vec4 transition(vec2 uv) {
  vec2 p = uv + progress * sign(direction);
  vec2 f = fract(p);
  return mix(getToColor(f), getFromColor(f),
    step(0.0, p.y) * step(p.y, 1.0) * step(0.0, p.x) * step(p.x, 1.0));
}`,
});

registerTransition({
  id: 'circle-open',
  name: 'Круг',
  glsl: `uniform float smoothness; // = 0.3
uniform bool opening; // = true
const vec2 center = vec2(0.5, 0.5);
const float SQRT_2 = 1.414213562373;
vec4 transition(vec2 uv) {
  float x = opening ? progress : 1.0 - progress;
  float m = smoothstep(-smoothness, 0.0, SQRT_2 * distance(center, uv) - x * (1.0 + smoothness));
  return mix(getFromColor(uv), getToColor(uv), opening ? 1.0 - m : m);
}`,
});

registerTransition({
  id: 'zoom',
  name: 'Наезд',
  glsl: `uniform float strength; // = 0.4
vec4 transition(vec2 uv) {
  float p = smoothstep(0.0, 1.0, progress);
  vec2 from = (uv - 0.5) / (1.0 + strength * p) + 0.5;
  vec2 to = (uv - 0.5) / (1.0 + strength * (1.0 - p)) + 0.5;
  return mix(getFromColor(from), getToColor(to), p);
}`,
});
