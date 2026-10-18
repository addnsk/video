import type { Animations, Easing, Item, Keyframe } from './model';

export const PROPERTY = {
  opacity: 'opacity',
  volume: 'volume',
  x: 'transform.x',
  y: 'transform.y',
  scale: 'transform.scale',
  rotation: 'transform.rotation',
} as const;

export const effectProperty = (effectType: string, param: string): string => `fx.${effectType}.${param}`;

const KEY_EPSILON = 1e-3;

export const EASINGS: Record<Easing, (f: number) => number> = {
  linear: (f) => f,
  in: (f) => f * f * f,
  out: (f) => 1 - (1 - f) ** 3,
  inOut: (f) => (f < 0.5 ? 4 * f * f * f : 1 - (-2 * f + 2) ** 3 / 2),
};

const BASE: Record<string, (item: Item) => number> = {
  [PROPERTY.opacity]: (i) => i.opacity,
  [PROPERTY.volume]: (i) => i.volume,
  [PROPERTY.x]: (i) => i.transform.x,
  [PROPERTY.y]: (i) => i.transform.y,
  [PROPERTY.scale]: (i) => i.transform.scale,
  [PROPERTY.rotation]: (i) => i.transform.rotation,
};

export function baseValue(item: Item, path: string): number {
  const read = BASE[path];
  if (read) return read(item);
  const [, type, param] = path.split('.');
  return Number(item.effects.find((e) => e.type === type)?.params[param] ?? 0);
}

export function valueAt(keys: readonly Keyframe[] | undefined, t: number, base: number): number {
  if (!keys?.length) return base;
  if (t <= keys[0].t) return keys[0].v;
  const last = keys[keys.length - 1];
  if (t >= last.t) return last.v;
  let i = 0;
  while (t > keys[i + 1].t) i++;
  const a = keys[i];
  const b = keys[i + 1];
  return a.v + (b.v - a.v) * segmentShape(a, (t - a.t) / Math.max(1e-9, b.t - a.t));
}

export function segmentShape(key: Keyframe, f: number): number {
  const ease = EASINGS[key.ease ?? 'linear'];
  if (!key.span) return ease(f);
  const [s0, s1] = key.span;
  const e0 = ease(s0);
  const range = ease(s1) - e0;
  if (Math.abs(range) < 1e-12) return f;
  return (ease(s0 + f * (s1 - s0)) - e0) / range;
}

export function upsertKey(keys: readonly Keyframe[] = [], t: number, v: number, ease?: Easing): Keyframe[] {
  const previous = ease === undefined ? keys.find((k) => Math.abs(k.t - t) <= KEY_EPSILON) : undefined;
  const out = keys.filter((k) => Math.abs(k.t - t) > KEY_EPSILON);
  if (previous) out.push({ ...previous, t, v });
  else out.push(ease && ease !== 'linear' ? { t, v, ease } : { t, v });
  return out.sort((a, b) => a.t - b.t);
}

export const removeKey = (keys: readonly Keyframe[] = [], t: number): Keyframe[] =>
  keys.filter((k) => Math.abs(k.t - t) > KEY_EPSILON);

export const keyAt = (keys: readonly Keyframe[] | undefined, t: number): Keyframe | undefined =>
  keys?.find((k) => Math.abs(k.t - t) <= KEY_EPSILON);

const spanOf = (key: Keyframe): readonly [number, number] => key.span ?? [0, 1];

const curved = (key: Keyframe) => !!key.ease && key.ease !== 'linear';

function withSpan(key: Keyframe, span: readonly [number, number]): Keyframe {
  const { span: _old, ...rest } = key;
  return span[0] === 0 && span[1] === 1 ? rest : { ...rest, span };
}

function cutKeys(keys: readonly Keyframe[], t: number): { before: Keyframe[]; after: Keyframe[] } {
  const i = keys.findIndex((k, n) => n < keys.length - 1 && k.t < t && keys[n + 1].t > t);
  const value = valueAt(keys, t, 0);
  if (i < 0) {
    const left = keys.filter((k) => k.t <= t + KEY_EPSILON);
    const right = keys.filter((k) => k.t >= t - KEY_EPSILON);
    return {
      before: left.length && Math.abs(left[left.length - 1].t - t) > KEY_EPSILON ? [...left, { t, v: value }] : left,
      after: right.length && Math.abs(right[0].t - t) > KEY_EPSILON ? [{ t, v: value }, ...right] : right,
    };
  }
  const a = keys[i];
  const b = keys[i + 1];
  const [s0, s1] = spanOf(a);
  const fc = s0 + ((t - a.t) / (b.t - a.t)) * (s1 - s0);
  const ease = curved(a) ? { ease: a.ease } : {};
  return {
    before: [...keys.slice(0, i), curved(a) ? withSpan(a, [s0, fc]) : a, { t, v: value }],
    after: [curved(a) ? withSpan({ t, v: value, ...ease }, [fc, s1]) : { t, v: value }, ...keys.slice(i + 1)],
  };
}

export function shiftAnimations(animations: Animations, offset: number, length: number): Animations {
  const out: Record<string, Keyframe[]> = {};
  for (const [path, keys] of Object.entries(animations)) {
    if (!keys.length) continue;
    let kept: readonly Keyframe[] = keys;
    if (kept[0].t < offset - KEY_EPSILON && kept[kept.length - 1].t > offset + KEY_EPSILON) kept = cutKeys(kept, offset).after;
    const end = offset + length;
    if (kept[0].t < end - KEY_EPSILON && kept[kept.length - 1].t > end + KEY_EPSILON) kept = cutKeys(kept, end).before;
    out[path] = kept.map((k) => ({ ...k, t: k.t - offset })).filter((k) => k.t >= -KEY_EPSILON && k.t <= length + KEY_EPSILON);
    if (!out[path].length) out[path] = [{ t: 0, v: valueAt(keys, offset, 0) }];
  }
  return out;
}
