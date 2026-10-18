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
  const f = EASINGS[a.ease ?? 'linear']((t - a.t) / Math.max(1e-9, b.t - a.t));
  return a.v + (b.v - a.v) * f;
}

export function upsertKey(keys: readonly Keyframe[] = [], t: number, v: number, ease?: Easing): Keyframe[] {
  const out = keys.filter((k) => Math.abs(k.t - t) > KEY_EPSILON);
  out.push(ease && ease !== 'linear' ? { t, v, ease } : { t, v });
  return out.sort((a, b) => a.t - b.t);
}

export const removeKey = (keys: readonly Keyframe[] = [], t: number): Keyframe[] =>
  keys.filter((k) => Math.abs(k.t - t) > KEY_EPSILON);

export const keyAt = (keys: readonly Keyframe[] | undefined, t: number): Keyframe | undefined =>
  keys?.find((k) => Math.abs(k.t - t) <= KEY_EPSILON);

function boundaryKey(keys: readonly Keyframe[], t: number, at: number): Keyframe {
  const before = keys.filter((k) => k.t < t).at(-1);
  const v = valueAt(keys, t, 0);
  return before?.ease && before.ease !== 'linear' ? { t: at, v, ease: before.ease } : { t: at, v };
}

export function shiftAnimations(animations: Animations, offset: number, length: number): Animations {
  const out: Record<string, Keyframe[]> = {};
  for (const [path, keys] of Object.entries(animations)) {
    if (!keys.length) continue;
    const shifted = keys.map((k) => ({ ...k, t: k.t - offset })).filter((k) => k.t >= -KEY_EPSILON && k.t <= length + KEY_EPSILON);
    if (keys[0].t < offset - KEY_EPSILON && !shifted.some((k) => Math.abs(k.t) <= KEY_EPSILON)) shifted.unshift(boundaryKey(keys, offset, 0));
    if (keys[keys.length - 1].t > offset + length + KEY_EPSILON && !shifted.some((k) => Math.abs(k.t - length) <= KEY_EPSILON)) shifted.push(boundaryKey(keys, offset + length, length));
    out[path] = shifted;
  }
  return out;
}
